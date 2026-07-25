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
      pill.textContent = s.source === "session" ? "Session key OK" : "API key OK";
      pill.className = "pill ok";
    } else {
      pill.textContent = "Key: unknown";
      pill.className = "pill idle";
    }
    return s;
  } catch {
    pill.textContent = "Key: unknown";
    pill.className = "pill idle";
    return null;
  }
}

function describeKeyStatus(s) {
  if (!s || !s.configured) {
    return "No key yet — paste one above for this session, or set RIOT_API_KEY in .env.";
  }
  const where = s.source === "session" ? "session (memory only)" : ".env";
  if (s.valid === false) {
    return `Key rejected by Riot (expired?). Paste a fresh one for this session, or update .env.`;
  }
  if (s.valid === true) {
    return `✓ Key OK (${where}).`;
  }
  return `Key is set (${where}), but Riot could not be reached just now.`;
}

$("check-key").addEventListener("click", async () => {
  $("key-status").textContent = "Checking key…";
  $("check-key").disabled = true;
  try {
    const s = await refreshKeyPill();
    $("key-status").textContent = describeKeyStatus(s);
  } catch (e) {
    $("key-status").textContent = e.message;
  } finally {
    $("check-key").disabled = false;
  }
});

$("use-session-key").addEventListener("click", async () => {
  const input = $("session-api-key");
  const raw = (input.value || "").trim();
  if (!raw) {
    $("key-status").textContent = "Paste a Riot API key first.";
    return;
  }
  $("key-status").textContent = "Checking key with Riot…";
  $("use-session-key").disabled = true;
  try {
    await post("/api/key", { api_key: raw });
    input.value = ""; // drop from the page DOM after handoff to server memory
    const s = await refreshKeyPill();
    $("key-status").textContent = describeKeyStatus(s);
  } catch (e) {
    $("key-status").textContent = e.message;
  } finally {
    $("use-session-key").disabled = false;
  }
});

$("clear-session-key").addEventListener("click", async () => {
  $("key-status").textContent = "Clearing session key…";
  $("clear-session-key").disabled = true;
  try {
    await api("/api/key", { method: "DELETE" });
    $("session-api-key").value = "";
    const s = await refreshKeyPill();
    $("key-status").textContent = s?.source === "env"
      ? "Session key cleared. Still using RIOT_API_KEY from .env."
      : describeKeyStatus(s);
  } catch (e) {
    $("key-status").textContent = e.message;
  } finally {
    $("clear-session-key").disabled = false;
  }
});

// --- Riot ID + sync ------------------------------------------------------

async function loadConfig() {
  const cfg = await api("/api/config");
  if (cfg.game_name) $("game-name").value = cfg.game_name;
  if (cfg.tag_line) $("tag-line").value = cfg.tag_line;
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
  const refreshBtn = box.querySelector("#player-refresh");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
      refreshBtn.disabled = true;
      refreshBtn.textContent = "Refreshing…";
      try {
        await showPlayer(p.riot_id, { refresh: true });
      } finally {
        // showPlayer re-paints the card; only restore if the old node is still around
        if (refreshBtn.isConnected) {
          refreshBtn.disabled = false;
          refreshBtn.textContent = "Refresh games";
        }
      }
    });
  }
  const clearBtn = box.querySelector("#player-clear-cache");
  if (clearBtn) {
    clearBtn.addEventListener("click", async () => {
      clearBtn.disabled = true;
      clearBtn.textContent = "Clearing…";
      try {
        const matchIds = [
          ...(p.recent_matches || []).map((m) => m.match_id).filter(Boolean),
        ];
        const r = await post("/api/player/cache/clear", {
          riot_id: p.riot_id,
          match_ids: matchIds,
        });
        $("player-search-status").textContent =
          `Cache cleared (${r.cleared_matches || 0} games). Re-pulling…`;
        await showPlayer(p.riot_id, { refresh: true });
        $("player-search-status").textContent = "";
      } catch (e) {
        $("player-search-status").textContent = e.message;
        if (clearBtn.isConnected) {
          clearBtn.disabled = false;
          clearBtn.textContent = "Clear cache";
        }
      }
    });
  }
}

async function showPlayer(riotId, { start = 0, append = false, refresh = false } = {}) {
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
        next_start: 0,
        from_cache: false,
        history_days: 30,
      };

  if (!append) {
    // Keep ranks card if re-searching same player; don't wipe match list until done
    // (that wipe made history look like it was fluctuating every search).
    if (!lastPlayerLookup || lastPlayerLookup.riot_id?.toLowerCase() !== riotId.toLowerCase()) {
      lastPlayerLookup = null;
      box.innerHTML =
        `<p class="muted">Looking up ${riotId}…</p>${progressBarHtml("Loading…", 0, 0)}`;
    } else {
      paintProgressKeep(box, "Refreshing last 30 days…", 0, 0);
    }
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
    paintProgressKeep(box, label, done, total, riotId);
  };

  try {
    let finished = false;
    const q =
      `/api/player?riot_id=${encodeURIComponent(riotId)}&stream=1&start=${start}&count=20`
      + (refresh ? "&refresh=1" : "");
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
          history_days: ev.history_days || 30,
        });
        if (!append) {
          // Keep existing matches visible while loading; only clear smurf until done.
          if (!payload.recent_matches?.length && lastPlayerLookup?.recent_matches?.length) {
            payload.recent_matches = [...lastPlayerLookup.recent_matches];
          }
          paintPlayerCard(payload);
          paintProgress("Loading matches (last 30 days)…", 0, 0);
        }
      } else if (ev.type === "progress") {
        paintProgress("Loading matches (last 30 days)…", ev.done || 0, ev.total || 0);
      } else if (ev.type === "match") {
        // Don't push piecemeal on first page — wait for done so order stays stable.
      } else if (ev.type === "done") {
        payload.smurf = ev.smurf;
        payload.matches_warning = ev.matches_warning || null;
        payload.has_more = !!ev.has_more;
        payload.match_ids_total = ev.match_ids_total || payload.match_ids_total || 0;
        payload.match_start = ev.match_start || start;
        payload.next_start = ev.next_start ?? (start + 20);
        payload.from_cache = !!ev.from_cache;
        payload.history_days = ev.history_days || 30;
        if (append) {
          const page = ev.page_matches || [];
          const seen = new Set((payload.recent_matches || []).map((m) => m.match_id));
          for (const m of page) {
            if (m?.match_id && !seen.has(m.match_id)) {
              payload.recent_matches.push(m);
              seen.add(m.match_id);
            }
          }
        } else {
          // Server returns id-list order for the loaded window — take it as truth.
          payload.recent_matches = ev.recent_matches || [];
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

function paintProgressKeep(box, label, done, total, riotId) {
  const bar = progressBarHtml(label, done, total);
  const head = box.querySelector(".player-card-head");
  if (!head) {
    box.innerHTML = `<p class="muted">Looking up ${riotId || ""}…</p>${bar}`;
    return;
  }
  let slot = box.querySelector(".load-progress-slot");
  if (!slot) {
    slot = document.createElement("div");
    slot.className = "load-progress-slot";
    const matches = box.querySelector(".recent-matches");
    if (matches) matches.before(slot);
    else box.appendChild(slot);
  }
  slot.innerHTML = bar;
}

async function loadMoreMatches(riotId) {
  const p = lastPlayerLookup;
  if (!p) return;
  const start = Number.isFinite(p.next_start) ? p.next_start : (p.recent_matches || []).length;
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
