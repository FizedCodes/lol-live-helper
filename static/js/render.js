// Pure rendering: functions take data and return HTML strings (or write to a container).
import {
  champIconUrl, itemIconUrl, itemGold, sumItemStats, formatStatValue,
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
    ? `<div class="sub">vs them: ${wrSpan(p.stats.vs_as_laner || p.stats.vs_any)} ·
       on ${meChamp}: ${wrSpan(p.stats.on_my_champ)}</div>`
    : "";
  const verdict = isEnemy
    ? `<div class="verdict ${p.verdict.call}" title="${p.verdict.note}">
         <div class="label">${p.verdict.label}</div>
       </div>`
    : "";
  const nameBtn = p.riot_id
    ? `<button type="button" class="player-link" data-riot-id="${p.riot_id}">${p.riot_id}</button>`
    : "";
  return `<div class="player-row ${p.is_lane_opponent ? "laner" : ""} ${p.is_dead ? "dead" : ""}">
    <img class="champ-portrait" src="${champIcon(p.champion)}" alt=""
         data-champ-hover="${hoverPayload(p, ctx)}"
         onerror="this.style.visibility='hidden'" />
    <div class="info">
      <div class="name">${p.is_me ? "You — " : ""}${p.champion}
        ${p.is_lane_opponent ? '<span class="tag">YOUR LANE</span>' : ""}
        ${p.position ? `<span class="tag">${p.position}</span>` : ""}</div>
      <div class="sub player-name">${nameBtn}</div>
      <div class="sub">${rankSpan(p.rank)}</div>
      ${stats}
      ${itemsRow(p.items)}
    </div>
    ${kdaSpan(p.scores)}
    ${verdict}
  </div>`;
}

function powerScore(stats) {
  // Rough "can I fight them?" score from item stats only (not champ base).
  return (stats.FlatPhysicalDamageMod || 0)
    + (stats.FlatMagicDamageMod || 0)
    + (stats.FlatArmorMod || 0) * 0.6
    + (stats.FlatSpellBlockMod || 0) * 0.6
    + (stats.FlatHPPoolMod || 0) * 0.05
    + (stats.FlatCritChanceMod || 0) * 80;
}

// Compact SVG icons for the fight card (no external assets).
const ICONS = {
  kda: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M2 14 L8 2 L14 14 Z M5.5 10h5"/></svg>',
  cs: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="2" fill="currentColor"/></svg>',
  gold: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/><text x="8" y="11" text-anchor="middle" font-size="8" font-weight="700" fill="currentColor">G</text></svg>',
  ad: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M9 1 L15 7 L13 9 L11 7 L6 12 L4 14 L2 12 L4 10 L9 5 L7 3 Z"/></svg>',
  ap: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 1 L9.5 6 L14 6.5 L10.5 9.5 L12 14 L8 11.5 L4 14 L5.5 9.5 L2 6.5 L6.5 6 Z"/></svg>',
  armor: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 1 L14 4 V8 C14 12 8 15 8 15 C8 15 2 12 2 8 V4 Z"/></svg>',
  mr: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 1 L14 4 V8 C14 12 8 15 8 15 C8 15 2 12 2 8 V4 Z"/><path fill="var(--bg)" d="M8 4 L11 5.5 V8 C11 10 8 12 8 12 C8 12 5 10 5 8 V5.5 Z"/></svg>',
  hp: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 14 L2.5 8.5 C1 7 1 4.5 3 3.2 C4.5 2.2 6.5 2.5 8 4 C9.5 2.5 11.5 2.2 13 3.2 C15 4.5 15 7 13.5 8.5 Z"/></svg>',
};

function statChip(icon, value, title, cls = "") {
  return `<div class="stat-chip ${cls}" title="${title}">
    <span class="stat-icon">${icon}</span>
    <span class="stat-val">${value}</span>
  </div>`;
}

function fightCompare(mePlayer, foe, gameTime) {
  if (!mePlayer || !foe) return "";
  const meStats = sumItemStats(mePlayer.items);
  const foeStats = sumItemStats(foe.items);
  const meGold = (mePlayer.items || []).reduce((s, it) => s + itemGold(it.id) * (it.count || 1), 0);
  const foeGold = (foe.items || []).reduce((s, it) => s + itemGold(it.id) * (it.count || 1), 0);
  const mePow = powerScore(meStats);
  const foePow = powerScore(foeStats);
  const meKda = (mePlayer.scores.kills + mePlayer.scores.assists) / Math.max(1, mePlayer.scores.deaths);
  const foeKda = (foe.scores.kills + foe.scores.assists) / Math.max(1, foe.scores.deaths);

  let call = "EVEN";
  let callCls = "even";
  let note = "Close on items and score — look for a numbers advantage or cooldown window.";
  const edge = mePow - foePow + (meGold - foeGold) * 0.01 + (meKda - foeKda) * 8;
  if (edge > 18) {
    call = "TAKE THE FIGHT";
    callCls = "favored";
    note = "You're ahead on items/score — look for a pick or all-in when your summs are up.";
  } else if (edge < -18) {
    call = "PLAY SAFE";
    callCls = "unfavored";
    note = "They're stronger right now — farm, wait for jungle, or trade short.";
  }

  const meCsCls = mePlayer.scores.cs === foe.scores.cs ? ""
    : mePlayer.scores.cs > foe.scores.cs ? "good" : "bad";
  const foeCsCls = meCsCls === "good" ? "bad" : meCsCls === "bad" ? "good" : "";

  const meChips = [
    statChip(ICONS.kda, `${mePlayer.scores.kills}/${mePlayer.scores.deaths}/${mePlayer.scores.assists}`, "K / D / A"),
    statChip(ICONS.cs, mePlayer.scores.cs, "Creep score", meCsCls),
    statChip(ICONS.gold, `${meGold.toLocaleString()}g`, "Item gold",
      meGold === foeGold ? "" : meGold > foeGold ? "good" : "bad"),
    ...[["FlatPhysicalDamageMod", ICONS.ad, "AD"],
        ["FlatMagicDamageMod", ICONS.ap, "AP"],
        ["FlatArmorMod", ICONS.armor, "Armor"],
        ["FlatSpellBlockMod", ICONS.mr, "MR"],
        ["FlatHPPoolMod", ICONS.hp, "HP"]]
      .filter(([k]) => (meStats[k] || 0) || (foeStats[k] || 0))
      .map(([k, icon, label]) => {
        const m = meStats[k] || 0;
        const t = foeStats[k] || 0;
        const cls = m === t ? "" : m > t ? "good" : "bad";
        return statChip(icon, formatStatValue(k, m), `${label} from items`, cls);
      }),
  ].join("");

  const foeChips = [
    statChip(ICONS.kda, `${foe.scores.kills}/${foe.scores.deaths}/${foe.scores.assists}`, "K / D / A"),
    statChip(ICONS.cs, foe.scores.cs, "Creep score", foeCsCls),
    statChip(ICONS.gold, `${foeGold.toLocaleString()}g`, "Item gold",
      meGold === foeGold ? "" : foeGold > meGold ? "good" : "bad"),
    ...[["FlatPhysicalDamageMod", ICONS.ad, "AD"],
        ["FlatMagicDamageMod", ICONS.ap, "AP"],
        ["FlatArmorMod", ICONS.armor, "Armor"],
        ["FlatSpellBlockMod", ICONS.mr, "MR"],
        ["FlatHPPoolMod", ICONS.hp, "HP"]]
      .filter(([k]) => (meStats[k] || 0) || (foeStats[k] || 0))
      .map(([k, icon, label]) => {
        const m = foeStats[k] || 0;
        const t = meStats[k] || 0;
        const cls = m === t ? "" : m > t ? "good" : "bad";
        return statChip(icon, formatStatValue(k, m), `${label} from items`, cls);
      }),
  ].join("");

  return `<div class="card fight-card">
    <div class="fight-head">
      <div class="fight-side">
        <img class="fight-portrait" src="${champIcon(mePlayer.champion)}" alt="" />
        <span class="fight-who">You · ${mePlayer.champion}</span>
        <div class="fight-stat-grid">${meChips}</div>
      </div>
      <div class="fight-call ${callCls}">
        <div class="label">${call}</div>
        <div class="muted">vs lane · ${gameClock(gameTime || 0)}</div>
        <p class="muted fight-note">${note}</p>
      </div>
      <div class="fight-side">
        <img class="fight-portrait champ-portrait" src="${champIcon(foe.champion)}" alt=""
             data-champ-hover="${hoverPayload(foe, { game_time: gameTime })}" />
        <span class="fight-who">${foe.champion}</span>
        <div class="fight-stat-grid">${foeChips}</div>
      </div>
    </div>
  </div>`;
}

export function renderLive(data, els) {
  const me = data.me;
  const tk = data.team_kills || { ally: 0, enemy: 0 };
  const lead = tk.ally > tk.enemy ? "good" : tk.ally < tk.enemy ? "bad" : "";
  const ctx = { game_time: data.game_time || 0 };
  const mePlayer = (data.allies || []).find((a) => a.is_me)
    || { champion: me.champion, scores: me.scores, items: [], riot_id: "", position: me.position, is_me: true };
  const laner = (data.enemies || []).find((e) => e.is_lane_opponent) || (data.enemies || [])[0];

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
         <img class="champ-portrait" src="${champIcon(me.champion)}" alt=""
              data-champ-hover="${hoverPayload(mePlayer, ctx)}"
              onerror="this.style.visibility='hidden'" />
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

  if (els.fight) {
    els.fight.innerHTML = laner ? fightCompare(mePlayer, laner, data.game_time) : "";
  }
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
  const smurfBlock = `<div class="smurf-card ${sm.likely_smurf ? "flagged" : "ok"}">
    <div class="smurf-head">
      <span class="smurf-label">${sm.label || "Account check"}</span>
      <span class="muted">Lv ${p.summoner_level ?? "?"} · ${sm.ranked_games ?? 0} ranked games</span>
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
         <div class="sub">${m.queue}${m.played_at ? ` · ${timeAgo(m.played_at)}` : ""}</div>
       </div>
       <div class="match-score">
         <span class="kda"><b>${m.kills}</b>/<span class="d">${m.deaths}</span>/${m.assists}</span>
         <span class="muted">${m.cs} cs · ${gameClock(m.duration)}</span>
       </div>
     </div>`).join("");

  const matchesBlock = `<div class="recent-matches">
    <div class="hover-section-label">Recent matches</div>
    ${matchRows || '<p class="muted">No recent matches returned (rate limit or empty history).</p>'}
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
