/**
 * Git-based updater for the source checkout.
 * Fetches origin, compares versions / commits, pulls with --ff-only when safe.
 */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function runCapture(cmd, args, { cwd, timeoutMs = 60000 } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    const child = spawn(cmd, args, {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const done = (code) => {
      if (settled) return;
      settled = true;
      resolve({
        code: code == null ? -1 : code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    };
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      done(null);
    }, timeoutMs);
    child.stdout.on("data", (c) => {
      stdout += c.toString();
    });
    child.stderr.on("data", (c) => {
      stderr += c.toString();
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      done(code);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        resolve({ code: -1, stdout: "", stderr: String(err.message || err) });
      }
    });
  });
}

function fileHash(filePath) {
  try {
    return crypto
      .createHash("sha256")
      .update(fs.readFileSync(filePath))
      .digest("hex");
  } catch {
    return "";
  }
}

function parseVersion(raw) {
  const m = String(raw || "")
    .trim()
    .match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) return [0, 0, 0];
  return [Number(m[1]) || 0, Number(m[2]) || 0, Number(m[3]) || 0];
}

function cmpVersion(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

function readLocalVersion(root) {
  try {
    return fs.readFileSync(path.join(root, "VERSION"), "utf8").trim() || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

async function git(root, args, timeoutMs = 60000) {
  return runCapture("git", args, { cwd: root, timeoutMs });
}

async function resolveUpstream(root) {
  const up = await git(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  if (up.code === 0 && up.stdout) return up.stdout;
  const head = await git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const branch = head.code === 0 && head.stdout ? head.stdout : "master";
  return `origin/${branch}`;
}

async function isDirty(root) {
  const st = await git(root, ["status", "--porcelain"]);
  if (st.code !== 0) {
    return { dirty: true, detail: st.stderr || "Could not read git status." };
  }
  return { dirty: Boolean(st.stdout), detail: st.stdout };
}

/**
 * @returns {Promise<object>} update status for the launcher UI
 */
async function checkForUpdates(root) {
  const localVersion = readLocalVersion(root);

  const inside = await git(root, ["rev-parse", "--is-inside-work-tree"]);
  if (inside.code !== 0 || inside.stdout !== "true") {
    return {
      status: "error",
      localVersion,
      remoteVersion: null,
      commitsBehind: 0,
      dirty: false,
      message: "This folder is not a git checkout — update needs git.",
      needsRelaunch: false,
    };
  }

  const dirtyInfo = await isDirty(root);

  const fetch = await git(root, ["fetch", "--quiet", "origin"], 90000);
  if (fetch.code !== 0) {
    return {
      status: "error",
      localVersion,
      remoteVersion: null,
      commitsBehind: 0,
      dirty: dirtyInfo.dirty,
      message:
        fetch.stderr ||
        "Could not reach GitHub (check internet / git remote).",
      needsRelaunch: false,
    };
  }

  const upstream = await resolveUpstream(root);
  const behind = await git(root, ["rev-list", "--count", `HEAD..${upstream}`]);
  let commitsBehind = 0;
  if (behind.code === 0) {
    commitsBehind = Number(behind.stdout) || 0;
  }

  let remoteVersion = localVersion;
  const showVer = await git(root, ["show", `${upstream}:VERSION`]);
  if (showVer.code === 0 && showVer.stdout) {
    remoteVersion = showVer.stdout.trim();
  }

  const versionNewer = cmpVersion(remoteVersion, localVersion) > 0;
  const updateAvailable = commitsBehind > 0 || versionNewer;

  if (dirtyInfo.dirty && updateAvailable) {
    return {
      status: "blocked",
      localVersion,
      remoteVersion,
      commitsBehind,
      dirty: true,
      message:
        "You have local edits — commit or stash them before updating, so nothing gets overwritten.",
      needsRelaunch: false,
    };
  }

  if (!updateAvailable) {
    return {
      status: "upToDate",
      localVersion,
      remoteVersion,
      commitsBehind: 0,
      dirty: dirtyInfo.dirty,
      message: dirtyInfo.dirty
        ? `Up to date (v${localVersion}) — you still have local edits.`
        : `Up to date (v${localVersion})`,
      needsRelaunch: false,
    };
  }

  const verBit =
    remoteVersion !== localVersion
      ? `v${localVersion} → v${remoteVersion}`
      : `v${localVersion}`;
  const commitBit =
    commitsBehind > 0
      ? `${commitsBehind} new commit${commitsBehind === 1 ? "" : "s"}`
      : "newer VERSION on remote";

  return {
    status: "available",
    localVersion,
    remoteVersion,
    commitsBehind,
    dirty: false,
    message: `Update available: ${verBit} (${commitBit})`,
    needsRelaunch: false,
  };
}

/**
 * Pull + optional pip. Caller restarts the server / relaunches Electron.
 * @returns {Promise<object>}
 */
async function applyUpdate(root) {
  const localVersion = readLocalVersion(root);
  const preCheck = await checkForUpdates(root);

  if (preCheck.status === "upToDate") {
    return { ...preCheck, applied: false };
  }
  if (preCheck.status === "blocked" || preCheck.status === "error") {
    return { ...preCheck, applied: false };
  }

  const dirtyInfo = await isDirty(root);
  if (dirtyInfo.dirty) {
    return {
      status: "blocked",
      localVersion,
      remoteVersion: preCheck.remoteVersion,
      commitsBehind: preCheck.commitsBehind,
      dirty: true,
      message:
        "You have local edits — commit or stash them before updating, so nothing gets overwritten.",
      needsRelaunch: false,
      applied: false,
    };
  }

  const reqPath = path.join(root, "requirements.txt");
  const reqBefore = fileHash(reqPath);
  const headBefore = await git(root, ["rev-parse", "HEAD"]);
  const oldHead = headBefore.code === 0 ? headBefore.stdout : "";

  const pull = await git(root, ["pull", "--ff-only"], 120000);
  if (pull.code !== 0) {
    return {
      status: "error",
      localVersion: readLocalVersion(root),
      remoteVersion: preCheck.remoteVersion,
      commitsBehind: preCheck.commitsBehind,
      dirty: false,
      message:
        pull.stderr ||
        pull.stdout ||
        "git pull failed (branch may have diverged — use Cursor/git to fix).",
      needsRelaunch: false,
      applied: false,
    };
  }

  const headAfter = await git(root, ["rev-parse", "HEAD"]);
  const newHead = headAfter.code === 0 ? headAfter.stdout : "";
  let changedFiles = [];
  if (oldHead && newHead && oldHead !== newHead) {
    const diff = await git(root, ["diff", "--name-only", oldHead, newHead]);
    if (diff.code === 0 && diff.stdout) {
      changedFiles = diff.stdout.split(/\r?\n/).filter(Boolean);
    }
  }

  const reqAfter = fileHash(reqPath);
  let pipOk = true;
  let pipNote = "";
  if (reqBefore !== reqAfter) {
    const pip =
      process.platform === "win32"
        ? path.join(root, ".venv", "Scripts", "pip.exe")
        : path.join(root, ".venv", "bin", "pip");
    const pipCmd = fs.existsSync(pip) ? pip : "pip";
    const install = await runCapture(
      pipCmd,
      ["install", "-r", "requirements.txt"],
      { cwd: root, timeoutMs: 180000 }
    );
    pipOk = install.code === 0;
    if (!pipOk) {
      pipNote = install.stderr || "pip install failed — see terminal / try manually.";
    }
  }

  const needsRelaunch = changedFiles.some(
    (f) =>
      f === "lolhelp.cmd" ||
      f.startsWith("overlay-app/") ||
      f.replace(/\\/g, "/").startsWith("overlay-app/")
  );

  const newVersion = readLocalVersion(root);
  if (!pipOk) {
    return {
      status: "error",
      localVersion: newVersion,
      remoteVersion: newVersion,
      commitsBehind: 0,
      dirty: false,
      message: `Code pulled (v${newVersion}), but deps failed: ${pipNote}`,
      needsRelaunch,
      applied: true,
      changedFiles,
    };
  }

  return {
    status: "done",
    localVersion: newVersion,
    remoteVersion: newVersion,
    commitsBehind: 0,
    dirty: false,
    message: needsRelaunch
      ? `Updated to v${newVersion}. Launcher files changed — restarting the app…`
      : `Updated to v${newVersion}. Restarting the server…`,
    needsRelaunch,
    applied: true,
    changedFiles,
  };
}

module.exports = {
  checkForUpdates,
  applyUpdate,
  readLocalVersion,
  cmpVersion,
};
