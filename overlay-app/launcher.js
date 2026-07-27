/** Launcher UI — talks to Electron main via window.lolhelp */

const $ = (id) => document.getElementById(id);

function paintUpdate(update) {
  const u = update || {};
  const status = u.status || "idle";
  const busy = Boolean(u.busy);
  const dot = $("updateDot");
  const text = $("updateText");
  const hint = $("updateHint");
  const btnCheck = $("btnCheckUpdates");
  const btnApply = $("btnApplyUpdate");

  if (status === "checking" || status === "updating") {
    dot.className = "dot warn";
  } else if (status === "available") {
    dot.className = "dot warn";
  } else if (status === "upToDate" || status === "done") {
    dot.className = "dot on";
  } else if (status === "blocked" || status === "error") {
    dot.className = "dot off";
  } else {
    dot.className = "dot";
  }

  if (status === "checking") {
    text.textContent = "Checking…";
  } else if (status === "updating") {
    text.textContent = "Updating…";
  } else if (status === "available") {
    const remote = u.remoteVersion || "?";
    const local = u.localVersion || "?";
    text.textContent =
      remote !== local ? `Update: v${local} → v${remote}` : "Update available";
  } else if (status === "upToDate") {
    text.textContent = `Up to date (v${u.localVersion || "?"})`;
  } else if (status === "done") {
    text.textContent = `Updated (v${u.localVersion || "?"})`;
  } else if (status === "blocked") {
    text.textContent = "Blocked — local edits";
  } else if (status === "error") {
    text.textContent = "Check failed";
  } else {
    text.textContent = "Not checked yet";
  }

  hint.textContent =
    u.message ||
    "Pulls the latest code, then restarts the server. Won't overwrite local edits.";

  const showApply = status === "available" && !u.dirty;
  btnApply.hidden = !showApply;
  btnCheck.disabled = busy;
  btnApply.disabled = busy;
}

function paint(state) {
  if (!state) return;

  $("version").textContent = `v${state.version || "?"}`;

  const serverDot = $("serverDot");
  const serverText = $("serverText");
  if (state.server === "ready") {
    serverDot.className = "dot on";
    serverText.textContent = "Running on :8000";
  } else if (state.server === "starting") {
    serverDot.className = "dot warn";
    serverText.textContent = "Starting…";
  } else if (state.server === "error") {
    serverDot.className = "dot off";
    serverText.textContent = state.serverError || "Failed to start";
  } else {
    serverDot.className = "dot off";
    serverText.textContent = "Stopped";
  }

  const liveDot = $("liveDot");
  const liveText = $("liveText");
  if (state.inGame) {
    liveDot.className = "dot on";
    liveText.textContent = "In game";
  } else if (state.server === "ready") {
    liveDot.className = "dot warn";
    liveText.textContent = "Lobby / out of game";
  } else {
    liveDot.className = "dot";
    liveText.textContent = "—";
  }

  $("overlayVisible").checked = Boolean(state.overlayVisible);
  $("clickThrough").checked = Boolean(state.clickThrough);
  $("modLiveStats").checked = state.modules?.liveStats !== false;
  $("modRankGrind").checked = Boolean(state.modules?.rankGrind);
  $("modHabits").checked = Boolean(state.modules?.habits);

  const busy = state.server === "starting" || Boolean(state.update?.busy);
  // Always clickable — if the server is down the browser just won't load,
  // which is clearer than a dead-looking button.
  $("btnDashboard").disabled = busy;
  $("btnRestart").disabled = busy;
  $("overlayVisible").disabled = busy;
  $("clickThrough").disabled = busy;

  paintUpdate(state.update);
}

async function refresh() {
  try {
    const state = await window.lolhelp.getState();
    paint(state);
  } catch (e) {
    $("serverText").textContent = String(e.message || e);
  }
}

$("overlayVisible").addEventListener("change", async (e) => {
  await window.lolhelp.setOverlayVisible(e.target.checked);
  refresh();
});

$("clickThrough").addEventListener("change", async (e) => {
  await window.lolhelp.setClickThrough(e.target.checked);
  refresh();
});

$("modLiveStats").addEventListener("change", async (e) => {
  await window.lolhelp.setModule("liveStats", e.target.checked);
  refresh();
});

$("btnDashboard").addEventListener("click", () => window.lolhelp.openDashboard());
$("btnRestart").addEventListener("click", async () => {
  $("serverText").textContent = "Restarting…";
  await window.lolhelp.restartServer();
  refresh();
});
$("btnCheckUpdates").addEventListener("click", async () => {
  $("updateText").textContent = "Checking…";
  await window.lolhelp.checkUpdates();
  refresh();
});
$("btnApplyUpdate").addEventListener("click", async () => {
  $("updateText").textContent = "Updating…";
  await window.lolhelp.applyUpdate();
  refresh();
});
$("btnQuit").addEventListener("click", () => window.lolhelp.quitApp());

window.lolhelp.onState(paint);
refresh();
setInterval(refresh, 2000);
