// Fight compare card: pick any enemy to compare against, show item-powered
// fight call + both rune setups in the same panel.
import {
  champIconUrl, itemGold, sumItemStats, formatStatValue,
  runeIconUrl, runeName, getRune,
} from "./items.js";

let selectedEnemyId = null; // riot_id — survives 10s live polls
let lastData = null;
let lastContainer = null;

function gameClock(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function powerScore(stats) {
  return (stats.FlatPhysicalDamageMod || 0)
    + (stats.FlatMagicDamageMod || 0)
    + (stats.FlatArmorMod || 0) * 0.6
    + (stats.FlatSpellBlockMod || 0) * 0.6
    + (stats.FlatHPPoolMod || 0) * 0.05
    + (stats.FlatCritChanceMod || 0) * 80
    + (stats.FlatMovementSpeedMod || 0) * 0.15
    + (stats.PercentMovementSpeedMod || 0) * 40
    + (stats.PercentAttackSpeedMod || 0) * 50
    + (stats.FlatAttackSpeedMod || 0) * 40;
}

const ICONS = {
  kda: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M2 14 L8 2 L14 14 Z M5.5 10h5"/></svg>',
  cs: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="2" fill="currentColor"/></svg>',
  gold: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/><text x="8" y="11" text-anchor="middle" font-size="8" font-weight="700" fill="currentColor">G</text></svg>',
  ad: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M9 1 L15 7 L13 9 L11 7 L6 12 L4 14 L2 12 L4 10 L9 5 L7 3 Z"/></svg>',
  ap: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 1 L9.5 6 L14 6.5 L10.5 9.5 L12 14 L8 11.5 L4 14 L5.5 9.5 L2 6.5 L6.5 6 Z"/></svg>',
  armor: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 1 L14 4 V8 C14 12 8 15 8 15 C8 15 2 12 2 8 V4 Z"/></svg>',
  mr: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 1 L14 4 V8 C14 12 8 15 8 15 C8 15 2 12 2 8 V4 Z"/><path fill="var(--bg)" d="M8 4 L11 5.5 V8 C11 10 8 12 8 12 C8 12 5 10 5 8 V5.5 Z"/></svg>',
  hp: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 14 L2.5 8.5 C1 7 1 4.5 3 3.2 C4.5 2.2 6.5 2.5 8 4 C9.5 2.5 11.5 2.2 13 3.2 C15 4.5 15 7 13.5 8.5 Z"/></svg>',
  as: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M3 8h10 M8 3v10 M4.5 4.5l7 7 M11.5 4.5l-7 7" stroke="currentColor" stroke-width="1.4" fill="none"/></svg>',
  ms: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M2 9 L7 3 L7 7 L14 7 L9 13 L9 9 Z"/></svg>',
  crit: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 1 L10 6 L15 6 L11 9 L13 14 L8 11 L3 14 L5 9 L1 6 L6 6 Z"/></svg>',
};

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/"/g, "&quot;")
    .replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function hoverPayload(p, ctx) {
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

function statChip(icon, value, title, cls = "") {
  return `<div class="stat-chip ${cls}" title="${esc(title)}">
    <span class="stat-icon">${icon}</span>
    <span class="stat-val">${value}</span>
  </div>`;
}

function chipsFor(player, other, sideStats, otherStats) {
  const gold = (player.items || []).reduce((s, it) => s + itemGold(it.id) * (it.count || 1), 0);
  const otherGold = (other.items || []).reduce((s, it) => s + itemGold(it.id) * (it.count || 1), 0);
  const csCls = player.scores.cs === other.scores.cs ? ""
    : player.scores.cs > other.scores.cs ? "good" : "bad";
  const combatKeys = [
    ["FlatPhysicalDamageMod", ICONS.ad, "AD"],
    ["FlatMagicDamageMod", ICONS.ap, "AP"],
    ["FlatArmorMod", ICONS.armor, "Armor"],
    ["FlatSpellBlockMod", ICONS.mr, "MR"],
    ["FlatHPPoolMod", ICONS.hp, "HP"],
  ];
  // Prefer percent AS when present; otherwise flat.
  if ((sideStats.PercentAttackSpeedMod || 0) || (otherStats.PercentAttackSpeedMod || 0)) {
    combatKeys.push(["PercentAttackSpeedMod", ICONS.as, "Attack speed"]);
  } else if ((sideStats.FlatAttackSpeedMod || 0) || (otherStats.FlatAttackSpeedMod || 0)) {
    combatKeys.push(["FlatAttackSpeedMod", ICONS.as, "Attack speed"]);
  }
  if ((sideStats.FlatCritChanceMod || 0) || (otherStats.FlatCritChanceMod || 0)) {
    combatKeys.push(["FlatCritChanceMod", ICONS.crit, "Crit"]);
  }
  if ((sideStats.FlatMovementSpeedMod || 0) || (otherStats.FlatMovementSpeedMod || 0)) {
    combatKeys.push(["FlatMovementSpeedMod", ICONS.ms, "Move speed"]);
  } else if ((sideStats.PercentMovementSpeedMod || 0) || (otherStats.PercentMovementSpeedMod || 0)) {
    combatKeys.push(["PercentMovementSpeedMod", ICONS.ms, "Move speed %"]);
  }

  const combat = combatKeys
    .filter(([k]) => (sideStats[k] || 0) || (otherStats[k] || 0))
    .map(([k, icon, label]) => {
      const m = sideStats[k] || 0;
      const t = otherStats[k] || 0;
      const cls = m === t ? "" : m > t ? "good" : "bad";
      return statChip(icon, formatStatValue(k, m), `${label} from items`, cls);
    });

  return [
    statChip(ICONS.kda, `${player.scores.kills}/${player.scores.deaths}/${player.scores.assists}`, "K / D / A"),
    statChip(ICONS.cs, player.scores.cs, "Creep score", csCls),
    statChip(ICONS.gold, `${gold.toLocaleString()}g`, "Item gold",
      gold === otherGold ? "" : gold > otherGold ? "good" : "bad"),
    ...combat,
  ].join("");
}

function runeImg(bit, cls = "") {
  if (!bit || bit.id == null) return "";
  const name = runeName(bit.id, bit.name || "");
  const tip = getRune(bit.id)?.shortDesc
    ? `${name} — ${String(getRune(bit.id).shortDesc).replace(/<[^>]+>/g, "")}`
    : name;
  return `<img class="rune-icon ${cls}" src="${runeIconUrl(bit.id)}" alt="${esc(name)}"
              title="${esc(tip)}" onerror="this.style.visibility='hidden'" />`;
}

function runesBlock(label, runes) {
  if (!runes) {
    return `<div class="fight-runes-side">
      <div class="fight-runes-label">${esc(label)}</div>
      <p class="muted">No runes from live client</p>
    </div>`;
  }
  const key = runeImg(runes.keystone, "keystone");
  const primary = runeImg(runes.primary, "tree");
  const secondary = runeImg(runes.secondary, "tree");
  const perks = (runes.perks || []).map((p) => runeImg(p)).join("");
  const shards = (runes.shards || []).map((s) => runeImg(s, "shard")).join("");
  const names = [
    runes.keystone?.name || runeName(runes.keystone?.id),
    runes.primary?.name || runeName(runes.primary?.id),
    runes.secondary?.name || runeName(runes.secondary?.id),
  ].filter(Boolean);

  return `<div class="fight-runes-side">
    <div class="fight-runes-label">${esc(label)}</div>
    <div class="rune-row main">
      ${key}${primary}${secondary}
    </div>
    ${perks ? `<div class="rune-row perks">${perks}</div>` : ""}
    ${shards ? `<div class="rune-row shards">${shards}</div>` : ""}
    <div class="sub rune-names">${esc(names.join(" · "))}</div>
  </div>`;
}

function pickFoe(enemies) {
  if (!enemies || !enemies.length) return null;
  if (selectedEnemyId) {
    const kept = enemies.find((e) => e.riot_id === selectedEnemyId);
    if (kept) return kept;
  }
  return enemies.find((e) => e.is_lane_opponent) || enemies[0];
}

function buildHtml(mePlayer, foe, enemies, gameTime) {
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

  const options = enemies.map((e) => {
    const sel = e.riot_id === foe.riot_id ? " selected" : "";
    const lane = e.is_lane_opponent ? " (lane)" : "";
    const pos = e.position ? ` · ${e.position}` : "";
    return `<option value="${esc(e.riot_id)}"${sel}>${esc(e.champion)}${esc(pos)}${lane}</option>`;
  }).join("");

  const vsLabel = foe.is_lane_opponent ? "vs lane" : `vs ${foe.position || foe.champion}`;

  return `<div class="card fight-card">
    <div class="fight-toolbar">
      <label class="fight-swap">
        <span class="muted">Compare vs</span>
        <select id="fight-enemy-select">${options}</select>
      </label>
    </div>
    <div class="fight-head">
      <div class="fight-side">
        <img class="fight-portrait" src="${champIconUrl(mePlayer.champion)}" alt="" />
        <span class="fight-who">You · ${esc(mePlayer.champion)}</span>
        <div class="fight-stat-grid">${chipsFor(mePlayer, foe, meStats, foeStats)}</div>
      </div>
      <div class="fight-call ${callCls}">
        <div class="label">${call}</div>
        <div class="muted">${vsLabel} · ${gameClock(gameTime || 0)}</div>
        <p class="muted fight-note">${esc(note)}</p>
      </div>
      <div class="fight-side">
        <img class="fight-portrait champ-portrait" src="${champIconUrl(foe.champion)}" alt=""
             data-champ-hover="${hoverPayload(foe, { game_time: gameTime })}" />
        <span class="fight-who">${esc(foe.champion)}</span>
        <div class="fight-stat-grid">${chipsFor(foe, mePlayer, foeStats, meStats)}</div>
      </div>
    </div>
    <div class="fight-runes">
      <div class="hover-section-label">Rune setups</div>
      <div class="fight-runes-grid">
        ${runesBlock(`You · ${mePlayer.champion}`, mePlayer.runes)}
        <div class="fight-runes-vs muted">vs</div>
        ${runesBlock(foe.champion, foe.runes)}
      </div>
    </div>
  </div>`;
}

function wireSelect(container) {
  const sel = container.querySelector("#fight-enemy-select");
  if (!sel) return;
  sel.addEventListener("change", () => {
    selectedEnemyId = sel.value || null;
    if (lastData && lastContainer) renderFight(lastData, lastContainer);
  });
}

/** Render the fight compare + runes panel into #fight (or any container). */
export function renderFight(data, container) {
  lastData = data;
  lastContainer = container;
  if (!container) return;

  const mePlayer = (data.allies || []).find((a) => a.is_me)
    || (data.me
      ? {
          champion: data.me.champion,
          scores: data.me.scores,
          items: [],
          runes: null,
          riot_id: "",
          position: data.me.position,
          is_me: true,
        }
      : null);
  const enemies = data.enemies || [];
  const foe = pickFoe(enemies);

  if (!mePlayer || !foe) {
    container.innerHTML = "";
    return;
  }

  selectedEnemyId = foe.riot_id || selectedEnemyId;
  container.innerHTML = buildHtml(mePlayer, foe, enemies, data.game_time);
  wireSelect(container);
}
