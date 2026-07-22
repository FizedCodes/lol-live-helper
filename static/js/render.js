// Pure rendering: functions take data and return HTML strings (or write to a container).

// Data Dragon CDN version: fetch the current one so new champs/items resolve;
// fall back to a pinned version if the lookup fails.
let ddVersion = "14.14.1";
fetch("https://ddragon.leagueoflegends.com/api/versions.json")
  .then((r) => r.json())
  .then((versions) => { if (versions && versions[0]) ddVersion = versions[0]; })
  .catch(() => {});

// Data Dragon square icons use champion "id" keys; live client gives display names.
// Normalizing common punctuation covers almost every champion.
export function champIcon(name) {
  const fixups = {
    "Wukong": "MonkeyKing", "Renata Glasc": "Renata", "Nunu & Willump": "Nunu",
  };
  const key = fixups[name] || name.replace(/['. ]/g, "");
  return `https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/champion/${key}.png`;
}

function itemIcon(id) {
  return `https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/item/${id}.png`;
}

function itemsRow(items) {
  if (!items || !items.length) return "";
  const sorted = [...items].sort((a, b) => a.slot - b.slot);
  const icons = sorted.map((it) =>
    `<img src="${itemIcon(it.id)}" alt="" title="${it.name}${it.count > 1 ? ` ×${it.count}` : ""}"
          onerror="this.style.visibility='hidden'" />`).join("");
  return `<div class="items">${icons}</div>`;
}

export function wrSpan(agg) {
  if (!agg) return '<span class="muted">no data</span>';
  const cls = agg.win_rate >= 55 ? "good" : agg.win_rate <= 45 ? "bad" : "";
  return `<span class="wr ${cls}">${agg.win_rate}%</span> <span class="muted">(${agg.games}g)</span>`;
}

export function gameClock(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export function timeAgo(epochSeconds) {
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
           <div class="sub">${kdaSpan(me.scores)} · overall: ${wrSpan(me.overall)}</div>
         </div>
       </div>
     </div>`;

  els.enemies.innerHTML = data.enemies.map((e) => playerRow(e, me.champion)).join("");
  els.allies.innerHTML = data.allies.map((a) => playerRow(a, me.champion)).join("");
}

export function renderSummary(s, container) {
  if (!s.matches_synced) {
    container.innerHTML = '<p class="muted">No matches synced yet.</p>';
    return;
  }
  const rows = s.champions.slice(0, 15).map((c) =>
    `<tr><td>${c.champion}</td><td>${c.games}</td><td>${c.win_rate}%</td></tr>`).join("");
  container.innerHTML =
    `<p class="muted">${s.matches_synced} matches synced.</p>
     <table><tr><th>Your champion</th><th>Games</th><th>Win rate</th></tr>${rows}</table>`;
}
