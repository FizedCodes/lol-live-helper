// Entry point: wires up the page, polls the backend, delegates rendering to render.js.
import { api, post } from "./api.js";
import { renderLive, renderSummary, renderPlayerCard, timeAgo } from "./render.js";
import { renderBuilds } from "./builds.js";
import { renderFight } from "./fight.js";
import { renderPostgame } from "./postgame.js";
import { ready as ddReady, initItemTooltips } from "./items.js";
import { initChampHover } from "./hover.js";

const $ = (id) => document.getElementById(id);
const liveEls = {
  scoreboard: $("scoreboard"),
  enemies: $("enemies"),
  allies: $("allies"),
  fight: $("fight"),
};

// --- Tabs -----------------------------------------------------------------
// Hash-based so every tab is linkable: /#live, /#builds, /#stats, /#setup.

const TABS = ["live", "builds", "stats", "player", "setup"];
let lastLiveData = null; // latest payload with teams in it (live game or last-game snapshot)
let lastPlayerLookup = null; // cached /api/player payload so polls only refresh items
let lastPostgame = null;
let lastPostgameId = null;
let postgameInflight = null;
let actuallyInGame = false; // last_game snapshots also have in_game:true — don't trust that alone

function currentTab() {
  const t = location.hash.replace("#", "");
  return TABS.includes(t) ? t : "live";
}

function showTab() {
  const tab = currentTab();
  for (const t of TABS) {
    $(`tab-${t}`).classList.toggle("hidden", t !== tab);
    document.querySelector(`.tabs a[data-tab="${t}"]`).classList.toggle("active", t === tab);
  }
  if (tab === "builds") renderBuilds(lastLiveData, $("builds-content"));
  if (tab === "stats") {
    loadSummary();
    loadPostgame();
  }
  if (tab === "live" && !actuallyInGame) loadPostgame();
}
window.addEventListener("hashchange", showTab);

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
    $("api-key").value = key;
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
    loadPostgame(true);
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

function paintPostgame(data) {
  const liveBox = $("postgame-live");
  const statsBox = $("postgame-stats");
  if (statsBox) renderPostgame(data, statsBox);
  // On Live, only show when reviewing last game / idle — not mid-match.
  if (liveBox) {
    if (actuallyInGame) {
      liveBox.innerHTML = "";
    } else {
      renderPostgame(data, liveBox);
    }
  }
}

async function loadPostgame(force = false) {
  if (postgameInflight) return postgameInflight;
  postgameInflight = (async () => {
    try {
      if (!force && lastPostgame && lastPostgame.ready) {
        paintPostgame(lastPostgame);
        return;
      }
      const liveBox = $("postgame-live");
      const statsBox = $("postgame-stats");
      const loading = { ready: false, note: "Loading post-game report…" };
      if (statsBox && (!lastPostgame || force)) renderPostgame(loading, statsBox);
      if (liveBox && !actuallyInGame && (!lastPostgame || force)) renderPostgame(loading, liveBox);

      const data = await api("/api/postgame");
      if (data?.match_id && data.match_id === lastPostgameId && lastPostgame?.ready && !force) {
        paintPostgame(lastPostgame);
        return;
      }
      lastPostgame = data;
      lastPostgameId = data?.match_id || null;
      paintPostgame(data);
    } catch (e) {
      const msg = e.message || "Could not load post-game.";
      const err = {
        ready: false,
        note: msg.includes("Not Found")
          ? "Post-game API missing — restart the local server, then refresh."
          : msg,
      };
      lastPostgame = err;
      paintPostgame(err);
    } finally {
      postgameInflight = null;
    }
  })();
  return postgameInflight;
}

// --- Player lookup (one-click + search) ----------------------------------

function findLivePlayer(riotId) {
  if (!lastLiveData || !riotId) return null;
  return [...(lastLiveData.enemies || []), ...(lastLiveData.allies || [])]
    .find((p) => p.riot_id === riotId) || null;
}

function meFromLive() {
  if (!lastLiveData) return null;
  return (lastLiveData.allies || []).find((p) => p.is_me) || null;
}

function paintPlayerCard(p) {
  const box = $("player-search-result");
  renderPlayerCard(p, box, {
    them: findLivePlayer(p.riot_id),
    me: meFromLive(),
  });
  const close = box.querySelector("#player-card-close");
  if (close) close.addEventListener("click", () => {
    lastPlayerLookup = null;
    box.innerHTML = "";
    $("player-search").value = "";
  });
}

async function showPlayer(riotId) {
  const box = $("player-search-result");
  $("player-search").value = riotId;
  box.innerHTML = `<p class="muted">Looking up ${riotId}…</p>`;
  try {
    const p = await api(`/api/player?riot_id=${encodeURIComponent(riotId)}`);
    lastPlayerLookup = p;
    paintPlayerCard(p);
  } catch (e) {
    lastPlayerLookup = null;
    box.innerHTML = `<p class="error">${e.message}</p>`;
  }
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest?.("[data-riot-id]");
  if (!btn) return;
  e.preventDefault();
  // One-click from Live (or anywhere) jumps to the Player tab.
  if (location.hash !== "#player") location.hash = "#player";
  showPlayer(decodeURIComponent(btn.dataset.riotId || ""));
});

$("player-search-btn").addEventListener("click", async () => {
  const q = $("player-search").value.trim();
  $("player-search-status").textContent = "";
  if (!q.includes("#")) {
    $("player-search-status").textContent = "Use Name#Tag format.";
    return;
  }
  $("player-search-status").textContent = "Searching…";
  await showPlayer(q);
  $("player-search-status").textContent = "";
});
$("player-search").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("player-search-btn").click();
});

// --- Live polling --------------------------------------------------------

async function poll() {
  try {
    const data = await api("/api/live");
    const pill = $("status-pill");
    const banner = $("live-banner");
    if (data.in_game && data.me) {
      actuallyInGame = true;
      pill.textContent = "In game";
      pill.className = "pill ingame";
      banner.classList.add("hidden");
      $("live").classList.remove("hidden");
      $("idle").classList.add("hidden");
      lastLiveData = data;
      renderLive(data, liveEls);
      renderFight(data, liveEls.fight);
      if ($("postgame-live")) $("postgame-live").innerHTML = "";
    } else {
      actuallyInGame = false;
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
        lastLiveData = lg.data;
        renderLive(lg.data, liveEls);
        renderFight(lg.data, liveEls.fight);
      } else {
        $("live").classList.add("hidden");
        if (liveEls.fight) liveEls.fight.innerHTML = "";
      }
      // Post-game uses the latest *synced* match (may need a Sync after the game).
      loadPostgame();
    }
    if (currentTab() === "builds") renderBuilds(lastLiveData, $("builds-content"));
    // Refresh you-vs-them items on the Player tab without re-hitting Riot.
    if (currentTab() === "player" && lastPlayerLookup) paintPlayerCard(lastPlayerLookup);
  } catch {
    /* server briefly unavailable; retry on next tick */
  }
}

initItemTooltips();
initChampHover();
showTab();
loadConfig();
loadSummary();
loadPostgame();
refreshKeyPill();
setInterval(refreshKeyPill, 5 * 60 * 1000);
poll();
setInterval(poll, 10000);
ddReady.then(() => poll());
