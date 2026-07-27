/**
 * LoL Live Helper — Electron desktop shell (launcher + overlay).
 * No Overwolf. Owns uvicorn lifecycle and the always-on-top HUD.
 */
const {
  app,
  BrowserWindow,
  globalShortcut,
  screen,
  ipcMain,
  shell,
} = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");
const { checkForUpdates, applyUpdate } = require("./updater");

function runPy(args, { timeoutMs = 15000 } = {}) {
  const py = findPython();
  return new Promise((resolve) => {
    let settled = false;
    const child = spawn(py, args, {
      cwd: ROOT,
      windowsHide: true,
      stdio: "ignore",
    });
    const done = (code) => {
      if (settled) return;
      settled = true;
      resolve(code);
    };
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      done(null);
    }, timeoutMs);
    child.on("exit", (code) => {
      clearTimeout(timer);
      done(code);
    });
    child.on("error", () => {
      clearTimeout(timer);
      done(null);
    });
  });
}

const ROOT = path.join(__dirname, "..");
const OVERLAY_URL = "http://127.0.0.1:8000/overlay";
const LIVE_URL = "http://127.0.0.1:8000/api/live";
const DASHBOARD_URL = "http://127.0.0.1:8000/";
const GEOM_PATH = path.join(ROOT, "data", "overlay_geom.json");
const PREFS_PATH = path.join(ROOT, "data", "launcher_prefs.json");
const VERSION_PATH = path.join(ROOT, "VERSION");
const DEFAULT_W = 360;
const DEFAULT_H = 340;

const DEFAULT_PREFS = {
  overlayVisible: true,
  clickThrough: true,
  modules: {
    liveStats: true,
    rankGrind: false,
    habits: false,
  },
};

let launcherWin = null;
let overlayWin = null;
let serverProc = null;
let serverState = "stopped"; // starting | ready | error | stopped
let serverError = "";
let clickThrough = true;
let userHidden = false;
let inGame = false;
let prefs = { ...DEFAULT_PREFS, modules: { ...DEFAULT_PREFS.modules } };
let updateInfo = {
  status: "idle",
  localVersion: null,
  remoteVersion: null,
  commitsBehind: 0,
  dirty: false,
  message: "Click Check for updates when you want the latest from GitHub.",
  needsRelaunch: false,
};
let updateBusy = false;

function readVersion() {
  try {
    return fs.readFileSync(VERSION_PATH, "utf8").trim() || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function loadPrefs() {
  try {
    const raw = JSON.parse(fs.readFileSync(PREFS_PATH, "utf8"));
    prefs = {
      ...DEFAULT_PREFS,
      ...raw,
      modules: { ...DEFAULT_PREFS.modules, ...(raw.modules || {}) },
    };
  } catch {
    prefs = { ...DEFAULT_PREFS, modules: { ...DEFAULT_PREFS.modules } };
  }
  clickThrough = Boolean(prefs.clickThrough);
  userHidden = !Boolean(prefs.overlayVisible);
}

function savePrefs() {
  try {
    fs.mkdirSync(path.dirname(PREFS_PATH), { recursive: true });
    prefs.overlayVisible = !userHidden;
    prefs.clickThrough = clickThrough;
    fs.writeFileSync(PREFS_PATH, JSON.stringify(prefs, null, 2), "utf8");
  } catch {
    /* ignore */
  }
}

function loadGeom() {
  try {
    const raw = JSON.parse(fs.readFileSync(GEOM_PATH, "utf8"));
    let w = Number(raw.width) || DEFAULT_W;
    let h = Number(raw.height) || DEFAULT_H;
    if (w > 420 || h > 420 || w < 260 || h < 200) {
      w = DEFAULT_W;
      h = DEFAULT_H;
      raw.x = null;
    }
    return {
      x: raw.x == null ? null : Number(raw.x),
      y: raw.y == null ? 56 : Number(raw.y),
      width: w,
      height: h,
    };
  } catch {
    return { x: null, y: 56, width: DEFAULT_W, height: DEFAULT_H };
  }
}

function saveGeom() {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  try {
    const b = overlayWin.getBounds();
    fs.mkdirSync(path.dirname(GEOM_PATH), { recursive: true });
    fs.writeFileSync(
      GEOM_PATH,
      JSON.stringify({ x: b.x, y: b.y, width: b.width, height: b.height }),
      "utf8"
    );
  } catch {
    /* ignore */
  }
}

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 8000 }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
  });
}

function getPublicState() {
  return {
    version: readVersion(),
    server: serverState,
    serverError,
    inGame,
    overlayVisible: !userHidden,
    clickThrough,
    modules: { ...prefs.modules },
    update: { ...updateInfo, busy: updateBusy },
  };
}

async function restartServerAndOverlay() {
  const ok = await startServer();
  if (ok) {
    if (!overlayWin || overlayWin.isDestroyed()) {
      createOverlayWindow();
    } else {
      overlayWin.loadURL(OVERLAY_URL);
    }
  }
  return ok;
}

async function doCheckForUpdates() {
  if (updateBusy) return getPublicState();
  updateBusy = true;
  updateInfo = {
    ...updateInfo,
    status: "checking",
    message: "Checking GitHub…",
  };
  broadcastState();
  try {
    updateInfo = await checkForUpdates(ROOT);
  } catch (e) {
    updateInfo = {
      status: "error",
      localVersion: readVersion(),
      remoteVersion: null,
      commitsBehind: 0,
      dirty: false,
      message: String(e.message || e),
      needsRelaunch: false,
    };
  }
  updateBusy = false;
  broadcastState();
  return getPublicState();
}

async function doApplyUpdate() {
  if (updateBusy) return getPublicState();
  updateBusy = true;
  updateInfo = {
    ...updateInfo,
    status: "updating",
    message: "Downloading update…",
  };
  broadcastState();
  try {
    const result = await applyUpdate(ROOT);
    updateInfo = { ...result };
    broadcastState();
    if (result.applied) {
      if (result.needsRelaunch) {
        // Give the UI a moment to show the message, then relaunch Electron.
        setTimeout(() => {
          app.relaunch();
          app.quit();
        }, 900);
      } else {
        updateInfo = {
          ...updateInfo,
          message: `Updated to v${result.localVersion}. Restarting the server…`,
        };
        broadcastState();
        await restartServerAndOverlay();
        updateInfo = {
          ...updateInfo,
          status: "done",
          message: `Updated to v${readVersion()}. You're on the latest.`,
        };
      }
    }
  } catch (e) {
    updateInfo = {
      status: "error",
      localVersion: readVersion(),
      remoteVersion: null,
      commitsBehind: 0,
      dirty: false,
      message: String(e.message || e),
      needsRelaunch: false,
    };
  }
  updateBusy = false;
  broadcastState();
  return getPublicState();
}

function broadcastState() {
  const state = getPublicState();
  if (launcherWin && !launcherWin.isDestroyed() && !launcherWin.webContents.isDestroyed()) {
    try {
      launcherWin.webContents.send("launcher:state", state);
    } catch {
      /* renderer mid-reload */
    }
  }
}

function findPython() {
  const winPy = path.join(ROOT, ".venv", "Scripts", "python.exe");
  if (fs.existsSync(winPy)) return winPy;
  return process.platform === "win32" ? "python" : "python3";
}

function stopServer() {
  if (serverProc && !serverProc.killed) {
    try {
      if (process.platform === "win32") {
        spawn("taskkill", ["/pid", String(serverProc.pid), "/T", "/F"], {
          windowsHide: true,
        });
      } else {
        serverProc.kill("SIGTERM");
      }
    } catch {
      /* ignore */
    }
  }
  serverProc = null;
  serverState = "stopped";
  broadcastState();
}

async function waitForServer(tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const { status } = await httpGetJson(LIVE_URL);
      if (status === 200) return true;
    } catch {
      /* keep waiting */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function startServer() {
  stopServer();
  serverState = "starting";
  serverError = "";
  broadcastState();

  // Must finish BEFORE spawning uvicorn — otherwise stop-server can race and
  // kill the brand-new server (looks like "exited code 1").
  await runPy(
    [
      path.join(ROOT, "launcher_ctl.py"),
      "stop-server",
      "--except-pid",
      String(process.pid),
    ],
    { timeoutMs: 20000 }
  );
  // Brief settle so the port is actually free on Windows.
  await new Promise((r) => setTimeout(r, 250));

  const py = findPython();
  const logPath = path.join(ROOT, "data", "server.log");
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const logFd = fs.openSync(logPath, "a");

  serverProc = spawn(
    py,
    ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"],
    {
      cwd: ROOT,
      windowsHide: true,
      stdio: ["ignore", logFd, logFd],
      env: { ...process.env },
    }
  );

  // Close our handle; child keeps the log file open.
  try {
    fs.closeSync(logFd);
  } catch {
    /* ignore */
  }

  serverProc.on("exit", (code) => {
    if (serverState === "starting" || serverState === "ready") {
      serverState = "error";
      serverError = `Server exited (code ${code})`;
      broadcastState();
    }
    serverProc = null;
  });

  const ok = await waitForServer();
  if (ok) {
    serverState = "ready";
    serverError = "";
  } else {
    serverState = "error";
    serverError = "Server did not become ready — see data/server.log";
    stopServer();
  }
  broadcastState();
  return ok;
}

function notifyMouseMode() {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  const mode = clickThrough ? "through" : "grab";
  const label = clickThrough ? "play-through" : "DRAG / RESIZE";
  overlayWin.webContents
    .executeJavaScript(
      `document.documentElement.dataset.mouse="${mode}";` +
        `var el=document.getElementById("mouseMode");if(el)el.textContent="${label}";`
    )
    .catch(() => {});
}

function applyClickThrough() {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  overlayWin.setIgnoreMouseEvents(clickThrough, { forward: true });
  overlayWin.setResizable(!clickThrough);
  try {
    overlayWin.setFocusable(!clickThrough);
  } catch {
    /* ignore */
  }
  notifyMouseMode();
  savePrefs();
  broadcastState();
}

function setOverlayVisible(show) {
  userHidden = !show;
  if (!overlayWin || overlayWin.isDestroyed()) return;
  if (show) {
    if (!overlayWin.isVisible()) overlayWin.showInactive();
    overlayWin.setAlwaysOnTop(true, "screen-saver");
    applyClickThrough();
  } else {
    overlayWin.hide();
  }
  savePrefs();
  broadcastState();
}

function toggleOverlayVisible() {
  setOverlayVisible(userHidden);
}

function setClickThrough(next) {
  clickThrough = Boolean(next);
  applyClickThrough();
}

function toggleClickThrough() {
  setClickThrough(!clickThrough);
}

function setInGame(next) {
  const was = inGame;
  inGame = next;
  if (next && !was) {
    setOverlayVisible(true);
  }
  broadcastState();
}

async function pollLive() {
  if (serverState !== "ready") {
    inGame = false;
    return;
  }
  try {
    const { data } = await httpGetJson(LIVE_URL);
    const playing = Boolean(data.in_game) && !data.error;
    setInGame(playing);
  } catch {
    /* keep HUD */
  }
}

function createLauncherWindow() {
  launcherWin = new BrowserWindow({
    width: 440,
    height: 760,
    minWidth: 400,
    minHeight: 620,
    title: "LoL Live Helper",
    backgroundColor: "#0c1018",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  launcherWin.loadFile(path.join(__dirname, "launcher.html"));
  launcherWin.on("closed", () => {
    launcherWin = null;
    // Closing launcher exits the whole helper
    app.quit();
  });
}

function createOverlayWindow() {
  const geom = loadGeom();
  const display = screen.getPrimaryDisplay().workArea;
  const x =
    geom.x == null
      ? Math.max(40, display.x + display.width - geom.width - 28)
      : geom.x;
  const y = geom.y == null ? 56 : geom.y;

  overlayWin = new BrowserWindow({
    width: geom.width,
    height: geom.height,
    x,
    y,
    minWidth: 280,
    minHeight: 220,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    fullscreenable: false,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  overlayWin.setAlwaysOnTop(true, "screen-saver");
  overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWin.loadURL(OVERLAY_URL);

  overlayWin.webContents.on("did-finish-load", () => {
    applyClickThrough();
    setOverlayVisible(!userHidden);
  });

  overlayWin.on("moved", saveGeom);
  overlayWin.on("resized", saveGeom);
  overlayWin.on("close", (e) => {
    // Overlay close shouldn't kill the app — just hide
    e.preventDefault();
    setOverlayVisible(false);
  });
}

function registerHotkeys() {
  globalShortcut.register("CommandOrControl+Shift+O", toggleOverlayVisible);
  globalShortcut.register("CommandOrControl+Shift+I", toggleClickThrough);
}

function registerIpc() {
  ipcMain.handle("launcher:getState", () => getPublicState());
  ipcMain.handle("launcher:setOverlayVisible", (_e, visible) => {
    setOverlayVisible(Boolean(visible));
    return getPublicState();
  });
  ipcMain.handle("launcher:setClickThrough", (_e, next) => {
    setClickThrough(Boolean(next));
    return getPublicState();
  });
  ipcMain.handle("launcher:setModule", (_e, key, enabled) => {
    if (key === "liveStats") {
      prefs.modules.liveStats = Boolean(enabled);
      savePrefs();
      // Push a flag the overlay page can read later
      if (overlayWin && !overlayWin.isDestroyed()) {
        overlayWin.webContents
          .executeJavaScript(
            `document.documentElement.dataset.modLiveStats="${prefs.modules.liveStats ? "1" : "0"}";`
          )
          .catch(() => {});
      }
    }
    // rankGrind / habits stay gated for now
    broadcastState();
    return getPublicState();
  });
  ipcMain.handle("launcher:openDashboard", () => {
    // Open even when the server is down so the button never feels dead.
    shell.openExternal(DASHBOARD_URL);
    return true;
  });
  ipcMain.handle("launcher:restartServer", async () => {
    await restartServerAndOverlay();
    return getPublicState();
  });
  ipcMain.handle("launcher:checkUpdates", async () => doCheckForUpdates());
  ipcMain.handle("launcher:applyUpdate", async () => doApplyUpdate());
  ipcMain.handle("launcher:quit", () => {
    app.quit();
    return true;
  });
}

app.whenReady().then(async () => {
  loadPrefs();
  registerIpc();
  createLauncherWindow();
  registerHotkeys();

  const ok = await startServer();
  if (ok) {
    createOverlayWindow();
    setInterval(pollLive, 1000);
  }

  // Quiet background check so the Updates panel isn't empty on open.
  setTimeout(() => {
    doCheckForUpdates().catch(() => {});
  }, 2500);

  console.log("LoL Live Helper launcher ready.");
  console.log("  Ctrl+Shift+O  overlay show/hide");
  console.log("  Ctrl+Shift+I  play-through ↔ grab");
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  saveGeom();
  savePrefs();
  stopServer();
});

app.on("window-all-closed", () => {
  app.quit();
});
