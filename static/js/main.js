// Entry point: wires up the page, polls the backend, delegates rendering to render.js.
import { api, post } from "./api.js";
import { renderLive, renderSummary, timeAgo } from "./render.js";

const $ = (id) => document.getElementById(id);
const liveEls = { scoreboard: $("scoreboard"), enemies: $("enemies"), allies: $("allies") };

// --- API key status ------------------------------------------------------

async function refreshKeyPill() {
  const pill = $("key-pill");
  try {
    const s = await api("/api/key/status");
    if (!s.configured) {
      pill.textContent = "No API key";
      pill.className = "pill bad";
    } else if (s.valid === false) {
      pill.textContent = "Key expired";
      pill.className = "pill bad";
    } else if (s.valid === true) {
      pill.textContent = "API key OK";
      pill.className = "pill ok";
    } else {
      pill.textContent = "Key: unknown";
      pill.className = "pill idle";
    }
  } catch {
    pill.textContent = "Key: unknown";
    pill.className = "pill idle";
  }
}

$("save-key").addEventListener("click", async () => {
  $("key-status").textContent = "Validating with Riot…";
  $("save-key").disabled = true;
  try {
    const key = $("api-key").value.trim();
    await post("/api/key", { key });
    $("api-key").value = key; // keep visible so you can confirm what was saved
    $("key-status").textContent = "✓ Key accepted and saved.";
    refreshKeyPill();
  } catch (e) {
    $("key-status").textContent = e.message;
  } finally {
    $("save-key").disabled = false;
  }
});

// --- Riot ID + sync ------------------------------------------------------

async function loadConfig() {
  const cfg = await api("/api/config");
  if (cfg.game_name) $("game-name").value = cfg.game_name;
  if (cfg.tag_line) $("tag-line").value = cfg.tag_line;
  if (cfg.api_key) $("api-key").value = cfg.api_key;
  $("setup").classList.remove("hidden");
}

$("save-config").addEventListener("click", async () => {
  $("setup-error").textContent = "";
  $("sync-status").textContent = "Checking with Riot…";
  $("save-config").disabled = true;
  try {
    const r = await post("/api/config", { game_name: $("game-name").value, tag_line: $("tag-line").value });
    $("game-name").value = r.game_name;
    $("tag-line").value = r.tag_line;
    $("sync-status").textContent = `✓ Player found: ${r.game_name}#${r.tag_line}. Now hit Sync.`;
  } catch (e) {
    $("setup-error").textContent = e.message;
    $("sync-status").textContent = "";
  } finally {
    $("save-config").disabled = false;
  }
});

$("sync-btn").addEventListener("click", async () => {
  $("setup-error").textContent = "";
  $("sync-btn").disabled = true;
  $("sync-status").textContent = "Syncing… this can take a few minutes (Riot rate limits).";
  try {
    const r = await api("/api/sync", { method: "POST" });
    $("sync-status").textContent = `Done: ${r.stored} new matches stored (${r.total_known} total).`;
    loadSummary();
  } catch (e) {
    $("setup-error").textContent = e.message;
    $("sync-status").textContent = "";
  } finally {
    $("sync-btn").disabled = false;
  }
});

async function loadSummary() {
  try {
    renderSummary(await api("/api/stats"), $("summary"));
  } catch { /* non-critical */ }
}

// --- Live polling --------------------------------------------------------

async function poll() {
  try {
    const data = await api("/api/live");
    const pill = $("status-pill");
    const banner = $("live-banner");
    if (data.in_game && data.me) {
      pill.textContent = "In game";
      pill.className = "pill ingame";
      banner.classList.add("hidden");
      $("live").classList.remove("hidden");
      $("idle").classList.add("hidden");
      renderLive(data, liveEls);
    } else {
      pill.textContent = "Not in game";
      pill.className = "pill idle";
      $("idle").classList.remove("hidden");
      if (data.last_game && data.last_game.data && data.last_game.data.me) {
        const lg = data.last_game;
        const result = lg.data.result
          ? `<span class="${lg.data.result === "Win" ? "good" : "bad"} result">${lg.data.result === "Win" ? "VICTORY" : "DEFEAT"}</span> · `
          : "";
        banner.innerHTML = `LAST GAME · ${result}${timeAgo(lg.saved_at)}`;
        banner.classList.remove("hidden");
        $("live").classList.remove("hidden");
        renderLive(lg.data, liveEls);
      } else {
        $("live").classList.add("hidden");
      }
    }
  } catch {
    /* server briefly unavailable; retry on next tick */
  }
}

loadConfig();
loadSummary();
refreshKeyPill();
setInterval(refreshKeyPill, 5 * 60 * 1000); // dev keys die every 24h; re-check occasionally
poll();
setInterval(poll, 10000);
