// Entry point: wires up the page, polls the backend, delegates rendering to render.js.
import { api, post, streamNdjson, progressBarHtml } from "./api.js";
import { renderLive, renderSummary, renderPlayerCard, timeAgo } from "./render.js";
import { renderBuilds } from "./builds.js";
import { renderFight } from "./fight.js";
import { renderCamps, initCampsDock, campsContainer } from "./camps.js";
import { renderPostgame, renderPostgameList } from "./postgame.js";
import { ready as ddReady, initItemTooltips } from "./items.js";
import { initChampHover } from "./hover.js";

const $ = (id) => document.getElementById(id);
initCampsDock();
const liveEls = {
  scoreboard: $("scoreboard"),
  enemies: $("enemies"),
  allies: $("allies"),
  fight: $("fight"),
  camps: campsContainer(),
};

// --- Tabs -----------------------------------------------------------------
// Hash-based so every tab is linkable: /#live, /#builds, /#stats, /#postgame, /#setup.

const TABS = ["live", "builds", "stats", "postgame", "player", "setup"];
let lastLiveData = null; // latest payload with teams in it (live game or last-game snapshot)
let lastPlayerLookup = null; // cached /api/player payload so polls only refresh items
let lastPostgame = null;
let lastPostgameId = null;
let lastPostgameList = null;
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
  if (tab === "stats") loadSummary();
  if (tab === "postgame") loadPostgameTab();
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
  const status = $("sync-status");
  status.innerHTML = progressBarHtml("Syncing match history…", 0, 0);
  try {
    let last = null;
    await streamNdjson("/api/sync?stream=1", (ev) => {
      if (ev.type === "meta") {
        status.innerHTML = progressBarHtml(
          ev.todo ? "Syncing new matches…" : "Nothing new to sync…",
          0,
          ev.todo || 0,
        );
      } else if (ev.type === "progress") {
        status.innerHTML = progressBarHtml(
          `Syncing… ${ev.stored || 0} stored`,
          ev.done || 0,
          ev.total || 0,
        );
      } else if (ev.type === "done") {
        last = ev;
      }
    }, { method: "POST" });

    if (last?.partial) {
      status.textContent =
        `Partial: ${last.stored} stored (${last.total_known} total). ${last.detail || ""}`;
    } else if (last) {
      status.textContent =
        `Done: ${last.stored} new matches stored (${last.total_known} total).`;
    } else {
      status.textContent = "Sync finished.";
    }
    loadSummary();
    loadPostgameTab(true);
  } catch (e) {
    $("setup-error").textContent = e.message;
    status.textContent = "";
  } finally {
    $("sync-btn").disabled = false;
  }
});

async function loadSummary() {
  try {
    renderSummary(await api("/api/stats"), $("summary"));
  } catch { /* non-critical */ }
}

function wirePostgameListClicks() {
  const list = $("postgame-list");
  if (!list || list.dataset.wired) return;
  list.dataset.wired = "1";
  list.addEventListener("click", (e) => {
    const btn = e.target.closest?.("[data-match-id]");
    if (!btn) return;
    openPostgameMatch(btn.dataset.matchId);
  });
}

async function loadPostgameTab(forceList = false) {
  wirePostgameListClicks();
  const listBox = $("postgame-list");
  const detail = $("postgame-detail");
  try {
    if (forceList || !lastPostgameList) {
      if (listBox) listBox.innerHTML = `<p class="muted">Loading game history…</p>`;
      lastPostgameList = await api("/api/postgame/list");
      if (forceList) {
        lastPostgame = null;
        lastPostgameId = lastPostgameList?.games?.[0]?.match_id || null;
      }
    }
    const games = lastPostgameList?.games || [];
    const active = lastPostgameId || games[0]?.match_id || null;
    renderPostgameList(lastPostgameList, listBox, active);
    if (active) {
      await openPostgameMatch(active, {
        quiet: !!lastPostgame?.ready && lastPostgameId === active,
      });
    } else if (detail) {
      renderPostgame({
        ready: false,
        note: "No synced matches yet. Hit Sync in Setup after a game.",
      }, detail);
    }
  } catch (e) {
    if (listBox) listBox.innerHTML = `<p class="error">${e.message}</p>`;
  }
}

async function openPostgameMatch(matchId, { quiet = false } = {}) {
  if (!matchId) return;
  const detail = $("postgame-detail");
  const listBox = $("postgame-list");
  if (quiet && lastPostgame?.ready && lastPostgameId === matchId) {
    renderPostgameList(lastPostgameList, listBox, matchId);
    renderPostgame(lastPostgame, detail);
    return;
  }
  if (postgameInflight) return postgameInflight;

  postgameInflight = (async () => {
    try {
      renderPostgameList(lastPostgameList, listBox, matchId);
      if (detail) renderPostgame({ ready: false, note: "Loading report…" }, detail);
      const data = await api(`/api/postgame?match_id=${encodeURIComponent(matchId)}`);
      lastPostgame = data;
      lastPostgameId = data?.match_id || matchId;
      // Mark this row as saved in the list after first successful build.
      if (lastPostgameList?.games && data?.ready) {
        const row = lastPostgameList.games.find((g) => g.match_id === lastPostgameId);
        if (row) row.has_report_cache = true;
      }
      renderPostgameList(lastPostgameList, listBox, lastPostgameId);
      renderPostgame(data, detail);
    } catch (e) {
      const msg = e.message || "Could not load post-game.";
      lastPostgame = {
        ready: false,
        note: msg.includes("Not Found")
          ? "Post-game API missing — restart the local server, then refresh."
          : msg,
      };
      renderPostgame(lastPostgame, detail);
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
  const more = box.querySelector("#player-load-more");
  if (more) {
    more.addEventListener("click", () => loadMoreMatches(p.riot_id));
  }
}

async function showPlayer(riotId, { start = 0, append = false } = {}) {
  const box = $("player-search-result");
  $("player-search").value = riotId;

  const payload = append && lastPlayerLookup && lastPlayerLookup.riot_id
    ? {
        ...lastPlayerLookup,
        matches_warning: null,
      }
    : {
        riot_id: riotId,
        puuid: null,
        solo: null,
        flex: null,
        summoner_level: null,
        smurf: null,
        recent_matches: [],
        matches_warning: null,
        has_more: false,
        match_ids_total: 0,
        from_cache: false,
      };

  if (!append) {
    lastPlayerLookup = null;
    box.innerHTML =
      `<p class="muted">Looking up ${riotId}…</p>${progressBarHtml("Loading…", 0, 0)}`;
  } else {
    const moreBtn = box.querySelector("#player-load-more");
    if (moreBtn) {
      moreBtn.disabled = true;
      moreBtn.textContent = "Loading…";
    }
  }

  const paintProgress = (label, done, total) => {
    if (append) {
      const moreBtn = box.querySelector("#player-load-more");
      if (moreBtn) moreBtn.textContent = `Loading… ${done}/${total || "?"}`;
      return;
    }
    const bar = progressBarHtml(label, done, total);
    const head = box.querySelector(".player-card-head");
    if (!head) {
      box.innerHTML = `<p class="muted">Looking up ${riotId}…</p>${bar}`;
      return;
    }
    let slot = box.querySelector(".load-progress-slot");
    if (!slot) {
      slot = document.createElement("div");
      slot.className = "load-progress-slot";
      const matches = box.querySelector(".recent-matches");
      if (matches) matches.replaceWith(slot);
      else box.appendChild(slot);
    }
    slot.innerHTML = bar;
  };

  try {
    let finished = false;
    const q =
      `/api/player?riot_id=${encodeURIComponent(riotId)}&stream=1&start=${start}&count=20`;
    await streamNdjson(q, (ev) => {
      if (ev.type === "meta") {
        Object.assign(payload, {
          riot_id: ev.riot_id,
          puuid: ev.puuid,
          solo: ev.solo,
          flex: ev.flex,
          summoner_level: ev.summoner_level,
          from_cache: !!ev.from_cache,
          match_ids_total: ev.match_ids_total || 0,
        });
        if (!append) {
          payload.recent_matches = [];
          payload.smurf = null;
          paintPlayerCard(payload);
          paintProgress("Loading matches…", 0, 0);
        }
      } else if (ev.type === "progress") {
        paintProgress("Loading matches…", ev.done || 0, ev.total || 0);
      } else if (ev.type === "match") {
        if (ev.match && !append) payload.recent_matches.push(ev.match);
      } else if (ev.type === "done") {
        payload.smurf = ev.smurf;
        payload.matches_warning = ev.matches_warning || null;
        payload.has_more = !!ev.has_more;
        payload.match_ids_total = ev.match_ids_total || payload.match_ids_total || 0;
        payload.match_start = ev.match_start || start;
        payload.from_cache = !!ev.from_cache;
        if (append) {
          const page = ev.page_matches || ev.recent_matches || [];
          const seen = new Set((payload.recent_matches || []).map((m) => m.match_id));
          for (const m of page) {
            if (m?.match_id && !seen.has(m.match_id)) {
              payload.recent_matches.push(m);
              seen.add(m.match_id);
            }
          }
          payload.recent_matches.sort(
            (a, b) => (b.played_at || 0) - (a.played_at || 0),
          );
        } else {
          payload.recent_matches = ev.recent_matches || payload.recent_matches;
        }
        lastPlayerLookup = payload;
        finished = true;
        paintPlayerCard(payload);
      }
    });
    if (!finished) {
      lastPlayerLookup = payload;
      paintPlayerCard(payload);
    }
  } catch (e) {
    if (!append) {
      lastPlayerLookup = null;
      box.innerHTML = `<p class="error">${e.message}</p>`;
    } else {
      const moreBtn = box.querySelector("#player-load-more");
      if (moreBtn) {
        moreBtn.disabled = false;
        moreBtn.textContent = "Load more (retry)";
      }
      alert(e.message);
    }
  }
}

async function loadMoreMatches(riotId) {
  const p = lastPlayerLookup;
  if (!p) return;
  const start = (p.recent_matches || []).length;
  await showPlayer(riotId || p.riot_id, { start, append: true });
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
      renderCamps(data, liveEls.camps);
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
        banner.innerHTML = `LAST GAME · ${result}${timeAgo(lg.saved_at)} · <a href="#postgame">Postgame</a>`;
        banner.classList.remove("hidden");
        $("live").classList.remove("hidden");
        lastLiveData = lg.data;
        renderLive(lg.data, liveEls);
        renderFight(lg.data, liveEls.fight);
        // Freeze camp map at last-game clock so you can check layout out of game
        renderCamps(lg.data, liveEls.camps);
      } else {
        $("live").classList.add("hidden");
        if (liveEls.fight) liveEls.fight.innerHTML = "";
        renderCamps(null, liveEls.camps);
      }
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
refreshKeyPill();
setInterval(refreshKeyPill, 5 * 60 * 1000);
poll();
setInterval(poll, 10000);
ddReady.then(() => poll());
