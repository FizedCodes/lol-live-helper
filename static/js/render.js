// Pure rendering: functions take data and return HTML strings (or write to a container).
import { champIconUrl, itemIconUrl, itemGold } from "./items.js";

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

function playerRow(p, meChamp) {
  const isEnemy = !!p.verdict;
  const stats = isEnemy
    ? `<div class="sub">vs them: ${wrSpan(p.stats.vs_as_laner || p.stats.vs_any)} ·
       on ${meChamp}: ${wrSpan(p.stats.on_my_champ)}</div>`
    : "";
  const verdict = isEnemy
    ? `<div class="verdict ${p.verdict.call}" title="${p.verdict.note}">
         <div class="label">${p.verdict.label}</div>
       </div>`
    : "";
  return `<div class="player-row ${p.is_lane_opponent ? "laner" : ""} ${p.is_dead ? "dead" : ""}">
    <img src="${champIcon(p.champion)}" alt="" onerror="this.style.visibility='hidden'" />
    <div class="info">
      <div class="name">${p.is_me ? "You — " : ""}${p.champion}
        ${p.is_lane_opponent ? '<span class="tag">YOUR LANE</span>' : ""}
        ${p.position ? `<span class="tag">${p.position}</span>` : ""}</div>
      <div class="sub player-name">${p.riot_id || ""}</div>
      <div class="sub">${rankSpan(p.rank)}</div>
      ${stats}
      ${itemsRow(p.items)}
    </div>
    ${kdaSpan(p.scores)}
    ${verdict}
  </div>`;
}

export function renderLive(data, els) {
  const me = data.me;
  const tk = data.team_kills || { ally: 0, enemy: 0 };
  const lead = tk.ally > tk.enemy ? "good" : tk.ally < tk.enemy ? "bad" : "";
  els.scoreboard.innerHTML =
    `<div class="score-row">
       <div class="score ${lead}">
         <span class="side-label">YOUR TEAM</span>
         <span class="big">${tk.ally}</span>
         <span class="vs">—</span>
         <span class="big">${tk.enemy}</span>
         <span class="side-label">ENEMY</span>
       </div>
       <div class="clock">${gameClock(data.game_time)}</div>
       <div class="me-brief">
         <img src="${champIcon(me.champion)}" alt="" onerror="this.style.visibility='hidden'" />
         <div>
           <div class="name">${me.champion}${me.position ? ` <span class="tag">${me.position}</span>` : ""}</div>
           <div class="sub">${kdaSpan(me.scores)}</div>
           <div class="wr-strip">
             <span class="wr-chip" title="Your ranked solo + flex win rate">
               Ranked ${wrPct(me.ranked)}
             </span>
             <span class="wr-chip" title="Your win rate on this champion">
               ${me.champion} ${wrPct(me.overall)}
               <span class="muted">${me.overall ? `(${me.overall.games}g)` : ""}</span>
             </span>
             <a class="wr-more" href="#stats">Full stats →</a>
           </div>
         </div>
       </div>
     </div>`;

  els.enemies.innerHTML = data.enemies.map((e) => playerRow(e, me.champion)).join("");
  els.allies.innerHTML = data.allies.map((a) => playerRow(a, me.champion)).join("");
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
     <h3>Recently played</h3>
     <p class="muted">Champions from your latest synced games, with your average win rate on each.</p>
     <div class="recent-list">${recent || '<p class="muted">No recent champions yet.</p>'}</div>
     <h3>All champions</h3>
     <p class="muted">${s.matches_synced} matches synced.</p>
     <table>
       <tr><th>Champion</th><th>Games</th><th>Wins</th><th>Win rate</th></tr>
       ${rows}
     </table>`;
}
