/** Free overlay HUD — floating card. Polls /api/live. */

const POLL_MS = 2000;
const OPACITY_KEY = "lolhelp.overlayOpacity";
const DEFAULT_OPACITY = 22; // percent — mostly see-through

const hudEl = document.getElementById("hud");
const statusEl = document.getElementById("status");
const matchupEl = document.getElementById("matchup");
const statsEl = document.getElementById("stats");
const objEl = document.getElementById("obj");
const opacityEl = document.getElementById("opacity");
const opacityValEl = document.getElementById("opacityVal");

function clampOpacity(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return DEFAULT_OPACITY;
  return Math.min(90, Math.max(5, v));
}

function applyOpacity(pct) {
  const v = clampOpacity(pct);
  hudEl.style.setProperty("--hud-op", String(v / 100));
  opacityEl.value = String(v);
  opacityValEl.textContent = `${v}%`;
  try {
    localStorage.setItem(OPACITY_KEY, String(v));
  } catch (_) {
    /* private / blocked storage */
  }
}

function loadOpacity() {
  let saved = DEFAULT_OPACITY;
  try {
    const raw = localStorage.getItem(OPACITY_KEY);
    if (raw != null) saved = clampOpacity(raw);
  } catch (_) {
    /* ignore */
  }
  applyOpacity(saved);
}

opacityEl.addEventListener("input", () => applyOpacity(opacityEl.value));
loadOpacity();

function fmtClock(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function wrBits(agg) {
  if (!agg || !agg.games) return `<div class="wr">no WR yet — Sync in dashboard</div>`;
  const cls = agg.win_rate >= 55 ? "good" : agg.win_rate <= 45 ? "bad" : "";
  return `<div class="wr"><span class="${cls}">${agg.win_rate}%</span> personal (${agg.games}g)</div>`;
}

function pace(n, gameTime) {
  const mins = (Number(gameTime) || 0) / 60;
  if (mins < 0.5) return "—";
  return (n / mins).toFixed(1);
}

function kp(meScores, allyKills) {
  const k = Number(meScores?.kills) || 0;
  const a = Number(meScores?.assists) || 0;
  const den = Number(allyKills) || 0;
  if (den <= 0) return "—";
  return `${Math.round((100 * (k + a)) / den)}%`;
}

function objectivesText(obj) {
  if (!obj) return "";
  const bits = [];
  if (obj.dragon) bits.push(`<strong>${obj.dragon}</strong> drag`);
  if (obj.baron) bits.push(`<strong>${obj.baron}</strong> baron`);
  if (obj.herald) bits.push(`<strong>${obj.herald}</strong> herald`);
  if (obj.horde) bits.push(`<strong>${obj.horde}</strong> grubs`);
  if (obj.tower) bits.push(`<strong>${obj.tower}</strong> towers`);
  if (obj.inhibitor) bits.push(`<strong>${obj.inhibitor}</strong> inhibs`);
  if (!bits.length) return "Obj: none yet";
  return `Obj: ${bits.join(" · ")}`;
}

function liveStatsEnabled() {
  return document.documentElement.dataset.modLiveStats !== "0";
}

function renderInGame(data) {
  if (!liveStatsEnabled()) {
    hudEl.classList.remove("idle");
    statusEl.textContent = "IN GAME";
    statusEl.classList.add("ingame");
    matchupEl.innerHTML = `<div class="wr">Live stats module off — enable in launcher</div>`;
    statsEl.hidden = true;
    objEl.hidden = true;
    return;
  }

  const me = data.me || {};
  const scores = me.scores || {};
  const gameTime = data.game_time || 0;
  const gold = me.live_stats?.current_gold;
  const laner = (data.enemies || []).find((e) => e.is_lane_opponent) || (data.enemies || [])[0];
  const matchup = laner?.stats?.vs_as_laner || laner?.stats?.vs_any;
  const verdict = laner?.verdict || { call: "unknown", label: "No data yet" };

  hudEl.classList.remove("idle");
  statusEl.textContent = "IN GAME";
  statusEl.classList.add("ingame");

  const opp = laner
    ? `<div class="opp-line">
         <div class="opp-name">vs ${laner.champion}${laner.is_lane_opponent ? "" : " (closest)"}</div>
         <div class="verdict ${verdict.call}">${verdict.label}</div>
       </div>
       ${wrBits(matchup)}`
    : `<div class="opp-name">No opponent yet</div>`;

  matchupEl.innerHTML = `
    <div class="you-line">
      <div class="you-name">${me.champion || "You"}${me.level != null ? ` · ${me.level}` : ""}</div>
      <div class="clock">${fmtClock(gameTime)}</div>
    </div>
    ${opp}
  `;

  const gpm = typeof gold === "number" ? pace(gold, gameTime) : "—";
  const csMin = pace(scores.cs || 0, gameTime);
  const ward = scores.ward_score != null ? Number(scores.ward_score).toFixed(0) : "—";
  const goldTxt = typeof gold === "number" ? Math.round(gold) : "—";

  statsEl.hidden = false;
  statsEl.innerHTML = `
    <div class="stat"><div class="label">KDA</div><div class="value">${scores.kills ?? 0}/${scores.deaths ?? 0}/${scores.assists ?? 0}</div></div>
    <div class="stat"><div class="label">CS</div><div class="value">${scores.cs ?? 0}</div><div class="sub">${csMin}/m</div></div>
    <div class="stat"><div class="label">GPM</div><div class="value">${gpm}</div></div>
    <div class="stat"><div class="label">KP</div><div class="value">${kp(scores, data.team_kills?.ally)}</div></div>
    <div class="stat"><div class="label">Wards</div><div class="value">${ward}</div></div>
    <div class="stat"><div class="label">Gold</div><div class="value">${goldTxt}</div></div>
  `;

  objEl.hidden = false;
  objEl.innerHTML = objectivesText(data.objectives);
}

function renderIdle(data) {
  hudEl.classList.add("idle");
  statusEl.classList.remove("ingame");
  statusEl.textContent = data?.last_game?.data ? "Out of game" : "Waiting for game…";
  matchupEl.innerHTML = `<div class="wr">Shows when you're in a match</div>`;
  statsEl.hidden = true;
  statsEl.innerHTML = "";
  objEl.hidden = true;
  objEl.innerHTML = "";
}

async function tick() {
  try {
    const resp = await fetch("/api/live", { cache: "no-store" });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.detail || resp.statusText);
    if (data.in_game && !data.error) {
      renderInGame(data);
    } else if (data.in_game && data.error) {
      hudEl.classList.add("idle");
      statusEl.textContent = data.error;
      statusEl.classList.remove("ingame");
      matchupEl.innerHTML = "";
      statsEl.hidden = true;
      objEl.hidden = true;
    } else {
      renderIdle(data);
    }
  } catch (e) {
    hudEl.classList.add("idle");
    statusEl.textContent = "Dashboard offline";
    statusEl.classList.remove("ingame");
    matchupEl.innerHTML = `<div class="wr">Is the server running?</div>`;
    statsEl.hidden = true;
    objEl.hidden = true;
  }
}

tick();
setInterval(tick, POLL_MS);
