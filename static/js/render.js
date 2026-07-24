// Pure rendering: functions take data and return HTML strings (or write to a container).
import {
  champIconUrl, itemIconUrl, itemGold,
} from "./items.js";

export const champIcon = champIconUrl;

function itemsRow(items) {
  if (!items || !items.length) return "";
  const sorted = [...items].sort((a, b) => a.slot - b.slot);
  const icons = sorted.map((it) =>
    `<img src="${itemIconUrl(it.id)}" alt="" data-item-id="${it.id}"
          class="${it.slot === 6 ? "trinket" : ""}"
          onerror="this.style.visibility='hidden'" />`).join("");
  const gold = sorted.reduce((sum, it) => sum + itemGold(it.id) * (it.count || 1), 0);
  const goldTag = gold > 0
    ? `<span class="item-gold" title="Total gold spent on items">${gold.toLocaleString()}g</span>`
    : "";
  return `<div class="items">${icons}${goldTag}</div>`;
}

export function wrSpan(agg) {
  if (!agg) return '<span class="muted">no data</span>';
  const cls = agg.win_rate >= 55 ? "good" : agg.win_rate <= 45 ? "bad" : "";
  return `<span class="wr ${cls}">${agg.win_rate}%</span> <span class="muted">(${agg.games}g)</span>`;
}

function wrPct(agg) {
  if (!agg) return '<span class="muted">—</span>';
  const cls = agg.win_rate >= 55 ? "good" : agg.win_rate <= 45 ? "bad" : "";
  return `<span class="wr ${cls}">${agg.win_rate}%</span>`;
}

export function gameClock(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export function timeAgo(epochSeconds) {
  if (!epochSeconds) return "";
  const mins = Math.round((Date.now() / 1000 - epochSeconds) / 60);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
}

/** Short local date/time so a skewed relative label is still checkable. */
export function shortWhen(epochSeconds) {
  if (!epochSeconds) return "";
  try {
    return new Date(epochSeconds * 1000).toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function kdaSpan(sc) {
  return `<span class="kda"><b>${sc.kills}</b>/<span class="d">${sc.deaths}</span>/${sc.assists}</span>
          <span class="cs muted">${sc.cs} cs</span>`;
}

function rankSpan(rank) {
  if (!rank) return "";
  if (!rank.tier) return '<span class="rank unranked">Unranked</span>';
  const tier = rank.tier.toLowerCase();
  const pretty = rank.tier.charAt(0) + tier.slice(1);
  const div = ["MASTER", "GRANDMASTER", "CHALLENGER"].includes(rank.tier) ? "" : ` ${rank.division}`;
  return `<span class="rank ${tier}" title="${rank.queue} queue">${pretty}${div} · ${rank.lp} LP</span>`;
}

function hoverPayload(p, ctx) {
  // Keep the JSON small — only what the hover panel needs.
  const raw = JSON.stringify({
    ctx: { game_time: ctx.game_time || 0 },
    player: {
      champion: p.champion,
      riot_id: p.riot_id,
      position: p.position,
      scores: p.scores,
      items: p.items,
      live_stats: p.live_stats || null,
      level: p.level,
      is_me: !!p.is_me,
      is_dead: !!p.is_dead,
      is_lane_opponent: !!p.is_lane_opponent,
      verdict: p.verdict || null,
    },
  });
  return raw.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function playerRow(p, meChamp, ctx) {
  const isEnemy = !!p.verdict;
  const stats = isEnemy
    ? `<span class="matchup-wr">vs ${wrSpan(p.stats.vs_as_laner || p.stats.vs_any)} · on ${meChamp}: ${wrSpan(p.stats.on_my_champ)}</span>`
    : "";
  const verdict = isEnemy
    ? `<div class="verdict ${p.verdict.call}" title="${p.verdict.note}">
         <div class="label">${p.verdict.label}</div>
       </div>`
    : "";
  const nameBtn = p.riot_id
    ? `<button type="button" class="player-link" data-riot-id="${encodeURIComponent(p.riot_id)}">${p.riot_id}</button>`
    : "";
  const metaBits = [
    p.is_lane_opponent ? '<span class="tag">YOUR LANE</span>' : "",
    p.position ? `<span class="tag dim">${p.position}</span>` : "",
    rankSpan(p.rank),
  ].filter(Boolean).join(" ");
  return `<div class="player-row ${p.is_lane_opponent ? "laner" : ""} ${p.is_dead ? "dead" : ""}">
    <img class="champ-portrait" src="${champIcon(p.champion)}" alt=""
         data-champ-hover="${hoverPayload(p, ctx)}"
         onerror="this.style.visibility='hidden'" />
    <div class="info">
      <div class="name-line">
        <span class="name">${p.is_me ? "You — " : ""}${p.champion}</span>
        ${metaBits}
      </div>
      <div class="sub player-name">${nameBtn}${stats ? ` · ${stats}` : ""}</div>
      ${itemsRow(p.items)}
    </div>
    <div class="scores">${kdaSpan(p.scores)}</div>
    ${verdict}
  </div>`;
}

export function renderLive(data, els) {
  const me = data.me;
  const tk = data.team_kills || { ally: 0, enemy: 0 };
  const lead = tk.ally > tk.enemy ? "good" : tk.ally < tk.enemy ? "bad" : "";
  const ctx = { game_time: data.game_time || 0 };
  const mePlayer = (data.allies || []).find((a) => a.is_me)
    || { champion: me.champion, scores: me.scores, items: [], riot_id: "", position: me.position, is_me: true };

  els.scoreboard.innerHTML =
    `<div class="score-row">
       <div class="score ${lead}">
         <span class="side-label">US</span>
         <span class="big">${tk.ally}</span>
         <span class="vs">:</span>
         <span class="big">${tk.enemy}</span>
         <span class="side-label">THEM</span>
       </div>
       <div class="clock" title="Game time">${gameClock(data.game_time)}</div>
       <div class="me-brief">
         <img class="champ-portrait" src="${champIcon(me.champion)}" alt=""
              data-champ-hover="${hoverPayload(mePlayer, ctx)}"
              onerror="this.style.visibility='hidden'" />
         <div>
           <div class="name">${me.champion}${me.position ? ` <span class="tag dim">${me.position}</span>` : ""}</div>
           <div class="sub">${kdaSpan(me.scores)}</div>
           <div class="wr-strip">
             <span class="wr-chip" title="Your ranked solo + flex win rate">
               Ranked ${wrPct(me.ranked)}
             </span>
             <span class="wr-chip" title="Your win rate on this champion">
               ${me.champion} ${wrPct(me.overall)}
               <span class="muted">${me.overall ? `(${me.overall.games}g)` : ""}</span>
             </span>
             <a class="wr-more" href="#stats">Stats →</a>
           </div>
         </div>
       </div>
     </div>`;

  // Fight compare + runes live in fight.js; camps in camps.js (wired from main.js).
  els.enemies.innerHTML = data.enemies.map((e) => playerRow(e, me.champion, ctx)).join("");
  els.allies.innerHTML = data.allies.map((a) => playerRow(a, me.champion, ctx)).join("");
}

function wrCard(label, agg, note) {
  return `<div class="wr-card">
    <div class="wr-card-label">${label}</div>
    <div class="wr-card-value">${wrPct(agg)}</div>
    <div class="muted">${agg ? `${agg.wins}W · ${agg.games}g` : (note || "No data yet")}</div>
  </div>`;
}

export function renderSummary(s, container) {
  if (!s.matches_synced) {
    container.innerHTML = '<p class="muted">No matches synced yet. Hit Sync in Setup to pull your history.</p>';
    return;
  }

  const rankedNote = s.ranked_ready
    ? ""
    : "Re-sync match history to split ranked vs normals.";

  const recent = (s.recent_champions || []).map((c) =>
    `<div class="recent-champ">
       <img src="${champIcon(c.champion)}" alt="" onerror="this.style.visibility='hidden'" />
       <div>
         <div class="name">${c.champion}</div>
         <div class="sub">${wrSpan(c)}${c.last_played ? ` · ${timeAgo(c.last_played)}` : ""}</div>
       </div>
     </div>`).join("");

  const rows = (s.champions || []).slice(0, 20).map((c) =>
    `<tr>
       <td class="champ-cell"><img src="${champIcon(c.champion)}" alt="" /> ${c.champion}</td>
       <td>${c.games}</td>
       <td>${c.wins ?? "—"}</td>
       <td>${wrPct(c)}</td>
     </tr>`).join("");

  container.innerHTML =
    `<div class="wr-cards">
       ${wrCard("Overall", s.overall)}
       ${wrCard("Ranked", s.ranked, rankedNote)}
       ${wrCard("Normals / Quickplay", s.normals)}
     </div>
     ${!s.ranked_ready ? `<p class="muted hint">${rankedNote}</p>` : ""}
     ${renderPerformance(s.performance)}
     <h3>Recently played</h3>
     <p class="muted">Champions from your latest synced games, with your average win rate on each.</p>
     <div class="recent-list">${recent || '<p class="muted">No recent champions yet.</p>'}</div>
     <h3>All champions</h3>
     <p class="muted">${s.matches_synced} matches synced.</p>
     <table>
       <tr><th>Champion</th><th>Games</th><th>Wins</th><th>Win rate</th></tr>
       ${rows}
     </table>`;

  wirePerfIgnore(container);
}

const PERF_IGNORE_KEY = "perf.ignored";

function ignoredPerfKeys() {
  try {
    const raw = JSON.parse(localStorage.getItem(PERF_IGNORE_KEY) || "[]");
    return new Set(Array.isArray(raw) ? raw : []);
  } catch {
    return new Set();
  }
}

function saveIgnoredPerfKeys(keys) {
  localStorage.setItem(PERF_IGNORE_KEY, JSON.stringify([...keys]));
}

function formatPerfValue(m) {
  if (m.value == null) return "—";
  if (m.unit === "%") return `${m.value}%`;
  if (m.unit === "/m") return `${m.value}${m.unit}`;
  return String(m.value);
}

/** Compact habit bubble — value + short label, color-coded grade. */
function perfBubble(m, { ignorable = true } = {}) {
  const tip = [
    m.tip,
    m.baseline != null ? `Baseline ${m.baseline}${m.unit || ""}` : "",
  ].filter(Boolean).join(" · ");
  return `<div class="habit-bubble ${m.grade}" data-perf-key="${m.key}" title="${tip}">
    <span class="habit-grade">${m.grade}</span>
    <span class="habit-value">${formatPerfValue(m)}</span>
    <span class="habit-label">${m.label}</span>
    ${ignorable
      ? `<button type="button" class="habit-ignore" data-ignore="${m.key}" title="Ignore this habit" aria-label="Ignore">✕</button>`
      : ""}
  </div>`;
}

function renderPerformance(perf) {
  if (!perf) {
    return `<div class="perf-panel">
      <h3>Habit tracker</h3>
      <p class="muted">Restart the app server, then hit Sync in Setup to unlock habits.</p>
    </div>`;
  }
  if (!perf.ready) {
    return `<div class="perf-panel">
      <h3>Habit tracker</h3>
      <p class="muted">${perf.note || "Sync match history to unlock CS / vision / fight habits."}</p>
    </div>`;
  }

  const ignored = ignoredPerfKeys();
  const visible = (perf.metrics || []).filter((m) => !ignored.has(m.key));
  const focus = (perf.focus || []).filter((m) => !ignored.has(m.key));
  const hiddenN = (perf.metrics || []).length - visible.length;

  const focusBlock = focus.length
    ? `<div class="perf-focus">
         <div class="hover-section-label">Focus these</div>
         <p class="muted">Below soft ${perf.main_role || "role"} baselines — improve or hit ✕ to ignore.</p>
         <div class="habit-bubbles">${focus.map((m) => perfBubble(m)).join("")}</div>
       </div>`
    : `<p class="muted">No weak habits vs your ${perf.main_role || "main"} baseline — nice.</p>`;

  const allBlock = `<div class="habit-bubbles">${visible.map((m) => perfBubble(m)).join("")}</div>`;

  const roleRows = (perf.by_role || []).map((r) => {
    const weak = (r.weak || []).length
      ? `<span class="tag loss-tag">${r.weak.length} weak</span>`
      : `<span class="tag win-tag">solid</span>`;
    const chips = (r.metrics || [])
      .filter((m) => !ignored.has(m.key))
      .map((m) => perfBubble(m, { ignorable: false }))
      .join("");
    return `<details class="perf-role">
      <summary>${r.position} · ${r.games} games ${weak}</summary>
      <div class="habit-bubbles">${chips}</div>
    </details>`;
  }).join("");

  return `<div class="perf-panel">
    <h3>Habit tracker</h3>
    <p class="muted">${perf.note || ""}</p>
    ${focusBlock}
    <div class="hover-section-label">All habits${hiddenN ? ` · ${hiddenN} ignored` : ""}</div>
    ${allBlock}
    ${hiddenN ? `<button type="button" class="ghost" id="perf-reset-ignore">Show ignored habits</button>` : ""}
    ${roleRows ? `<div class="hover-section-label">By role</div>${roleRows}` : ""}
  </div>`;
}

function wirePerfIgnore(container) {
  container.querySelectorAll("[data-ignore]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const key = btn.getAttribute("data-ignore");
      if (!key) return;
      const set = ignoredPerfKeys();
      set.add(key);
      saveIgnoredPerfKeys(set);
      container.querySelectorAll(`[data-perf-key="${key}"]`).forEach((el) => el.remove());
    });
  });
  const reset = container.querySelector("#perf-reset-ignore");
  if (reset) {
    reset.addEventListener("click", async () => {
      localStorage.removeItem(PERF_IGNORE_KEY);
      try {
        const { api } = await import("./api.js");
        renderSummary(await api("/api/stats"), container);
      } catch {
        reset.textContent = "Switch away and back to Stats";
        reset.disabled = true;
      }
    });
  }
}

function sideBlock(label, player, emptyNote) {
  if (!player) {
    return `<div class="item-side">
      <div class="muted">${emptyNote || "Not in this game"}</div>
    </div>`;
  }
  const gold = (player.items || []).reduce((s, it) => s + itemGold(it.id) * (it.count || 1), 0);
  return `<div class="item-side">
    <div class="item-side-head">
      <img src="${champIcon(player.champion)}" alt=""
           onerror="this.style.visibility='hidden'" />
      <div>
        <div class="name">${label}</div>
        <div class="sub">${player.champion}${player.position ? ` · ${player.position}` : ""}</div>
        <div class="sub">${kdaSpan(player.scores)} · ${gold.toLocaleString()}g</div>
      </div>
    </div>
    ${itemsRow(player.items) || '<div class="muted">No items yet</div>'}
  </div>`;
}

export function renderPlayerCard(p, container, { them = null, me = null } = {}) {
  const q = (entry) => {
    if (!entry) return '<div class="muted">Unranked</div>';
    const tier = entry.tier
      ? `${entry.tier.charAt(0)}${entry.tier.slice(1).toLowerCase()} ${["MASTER", "GRANDMASTER", "CHALLENGER"].includes(entry.tier) ? "" : entry.division} · ${entry.lp} LP`
      : "Unranked";
    const wr = entry.win_rate != null
      ? `${wrPct(entry)} <span class="muted">(${entry.wins}W ${entry.losses}L)</span>`
      : "";
    return `<div><span class="rank ${(entry.tier || "").toLowerCase()}">${tier}</span><div class="sub">${wr}</div></div>`;
  };

  const sm = p.smurf || {};
  const severity = sm.severity || (sm.likely_smurf ? "flagged" : "ok");
  const smurfBlock = `<div class="smurf-card ${severity}">
    <div class="smurf-head">
      <span class="smurf-label">${sm.label || "Account check"}</span>
      <span class="muted">Lv ${p.summoner_level ?? "?"} · ${sm.ranked_games ?? 0} ranked games${
        sm.score != null ? ` · signal ${sm.score}` : ""
      }</span>
    </div>
    <p class="muted">${sm.note || ""}</p>
    ${(sm.flags || []).length
      ? `<ul class="smurf-flags">${sm.flags.map((f) => `<li>${f}</li>`).join("")}</ul>`
      : ""}
  </div>`;

  const matchRows = (p.recent_matches || []).map((m) =>
    `<div class="match-row ${m.win ? "win" : "loss"}">
       <img src="${champIcon(m.champion)}" alt="" onerror="this.style.visibility='hidden'" />
       <div class="match-main">
         <div class="name">${m.champion}
           <span class="tag ${m.win ? "win-tag" : "loss-tag"}">${m.win ? "WIN" : "LOSS"}</span>
         </div>
         <div class="sub">${m.queue}${m.played_at ? ` · ${timeAgo(m.played_at)} · ${shortWhen(m.played_at)}` : ""}</div>
       </div>
       <div class="match-score">
         <span class="kda"><b>${m.kills}</b>/<span class="d">${m.deaths}</span>/${m.assists}</span>
         <span class="muted">${m.cs} cs · ${gameClock(m.duration)}</span>
       </div>
     </div>`).join("");

  const warn = p.matches_warning
    ? `<p class="error matches-warning">${p.matches_warning}</p>`
    : "";
  const n = (p.recent_matches || []).length;
  const total = p.match_ids_total || n;
  const more = p.has_more
    ? `<button type="button" id="player-load-more" class="ghost load-more-btn">
         Load more (${n} / ${total})
       </button>`
    : (total > n
      ? `<p class="muted load-more-note">Showing ${n} of ${total} indexed games.</p>`
      : "");
  const cacheNote = p.from_cache
    ? `<span class="muted cache-pill" title="Ranks + match list remembered ~5 min; finished games stay in SQLite">cached</span>`
    : "";
  const matchesBlock = `<div class="recent-matches">
    <div class="hover-section-label">Recent matches${n ? ` (${n}${total > n ? ` / ${total}` : ""})` : ""} ${cacheNote}</div>
    ${warn}
    ${matchRows || '<p class="muted">No recent matches returned (rate limit or empty history).</p>'}
    ${more}
  </div>`;

  const itemsCompare = (them || me)
    ? `<div class="items-compare">
         <div class="hover-section-label">Items this game</div>
         <div class="items-compare-grid">
           ${sideBlock("You", me, "You're not in a live game snapshot")}
           <div class="items-compare-vs muted">vs</div>
           ${sideBlock(them?.riot_id || p.riot_id, them, "Player not in this lobby")}
         </div>
       </div>`
    : `<p class="muted">No live game data — ranked + match history only. Click a name on Live during a match to compare items.</p>`;

  container.innerHTML = `
    <div class="player-card-head">
      <h3>${p.riot_id}</h3>
      <button type="button" id="player-card-close" class="ghost">Clear</button>
    </div>
    <div class="wr-cards player-rank-cards">
      <div class="wr-card"><div class="wr-card-label">Solo / Duo</div>${q(p.solo)}</div>
      <div class="wr-card"><div class="wr-card-label">Flex</div>${q(p.flex)}</div>
    </div>
    ${smurfBlock}
    ${itemsCompare}
    ${matchesBlock}
  `;
}
