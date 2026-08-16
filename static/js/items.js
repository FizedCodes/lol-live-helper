// Data Dragon data: game version, the full item catalog, icon URLs, stats helpers,
// and the shared item hover tooltip. Everything here comes from Riot's free CDN
// (no API key), fetched once per page load.

let version = "14.14.1"; // fallback if the version lookup fails
let itemData = {};       // item id (string) -> entry from item.json
let champByName = {};    // display name ("Wukong") -> entry from champion.json
let runeById = {};       // perk / style id (number) -> { name, icon, ... }

// Resolves once the version + catalogs are loaded (or failed gracefully).
export const ready = (async () => {
  try {
    const versions = await (await fetch("https://ddragon.leagueoflegends.com/api/versions.json")).json();
    if (versions && versions[0]) version = versions[0];
  } catch { /* keep the pinned fallback */ }
  try {
    const data = await (await fetch(
      `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/item.json`)).json();
    itemData = data.data || {};
  } catch { /* tooltips and the builds tab just won't have item details */ }
  try {
    const data = await (await fetch(
      `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`)).json();
    for (const entry of Object.values(data.data || {})) champByName[entry.name] = entry;
  } catch { /* builds tab falls back to generic advice */ }
  try {
    const trees = await (await fetch(
      `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/runesReforged.json`)).json();
    for (const tree of trees || []) {
      runeById[tree.id] = { id: tree.id, name: tree.name, icon: tree.icon, kind: "tree" };
      for (const slot of tree.slots || []) {
        for (const rune of slot.runes || []) {
          runeById[rune.id] = {
            id: rune.id, name: rune.name, icon: rune.icon,
            kind: "perk", shortDesc: rune.shortDesc || "",
          };
        }
      }
    }
  } catch { /* fight card still shows live-client display names without icons */ }
})();

export function ddVersion() { return version; }
export function allItems() { return itemData; }
export function getItem(id) { return itemData[String(id)] || null; }
export function getRune(id) { return runeById[Number(id)] || null; }

// Champion catalog entry (info scores, tags) by display name from the live client.
export function getChampion(name) { return champByName[name] || null; }

/** Sorted display names from Data Dragon (empty until `ready` resolves). */
export function allChampions() {
  return Object.keys(champByName).sort((a, b) => a.localeCompare(b));
}

export function itemGold(id) {
  const it = getItem(id);
  return it && it.gold ? it.gold.total : 0;
}

export function itemIconUrl(id) {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/item/${id}.png`;
}

export function itemFrom(id) {
  const it = getItem(id);
  return (it && it.from) ? it.from.map(String) : [];
}

export function itemInto(id) {
  const it = getItem(id);
  return (it && it.into) ? it.into.map(String) : [];
}

/** Data Dragon rune / tree icon. Stat shards fall back to a generic perk path. */
export function runeIconUrl(id) {
  const r = getRune(id);
  if (r && r.icon) {
    return `https://ddragon.leagueoflegends.com/cdn/img/${r.icon}`;
  }
  // Unknown ids (often stat shards) — hide via onerror on the <img>.
  return `https://ddragon.leagueoflegends.com/cdn/img/perk-images/StatMods/StatModsAdaptiveForceIcon.png`;
}

export function runeName(id, fallback = "") {
  const r = getRune(id);
  return (r && r.name) || fallback || `Rune ${id}`;
}

// Human labels for the Flat* / Percent* keys Data Dragon uses.
const STAT_LABELS = {
  FlatHPPoolMod: "HP",
  FlatMPPoolMod: "Mana",
  FlatArmorMod: "Armor",
  FlatSpellBlockMod: "MR",
  FlatPhysicalDamageMod: "AD",
  FlatMagicDamageMod: "AP",
  FlatAttackSpeedMod: "AS",
  PercentAttackSpeedMod: "AS%",
  FlatCritChanceMod: "Crit",
  FlatMovementSpeedMod: "MS",
  PercentMovementSpeedMod: "MS%",
  FlatHPRegenMod: "HP regen",
  PercentLifeStealMod: "Life steal",
  AbilityHaste: "AH",
};

export function formatStatKey(key) {
  return STAT_LABELS[key] || key.replace(/^Flat|^Percent|Mod$/g, "");
}

export function formatStatValue(key, value) {
  if (key.startsWith("Percent") || key.includes("CritChance") || key.includes("LifeSteal")) {
    return `${Math.round(value * 1000) / 10}%`;
  }
  if (key.includes("AttackSpeed") && value < 3) {
    // Some patches use FlatAttackSpeedMod as a fraction.
    return value < 1 ? `${Math.round(value * 1000) / 10}%` : String(Math.round(value));
  }
  return String(Math.round(value));
}

/** Sum Flat/Percent stats across a list of {id, count?} item slots. */
export function sumItemStats(items) {
  const totals = {};
  for (const slot of items || []) {
    const it = getItem(slot.id);
    if (!it || !it.stats) continue;
    const n = slot.count || 1;
    for (const [k, v] of Object.entries(it.stats)) {
      if (typeof v !== "number") continue;
      totals[k] = (totals[k] || 0) + v * n;
    }
  }
  return totals;
}

export function statsLines(stats) {
  return Object.entries(stats || {})
    .filter(([, v]) => v)
    .map(([k, v]) => `${formatStatValue(k, v)} ${formatStatKey(k)}`);
}

/**
 * Unified combat profile for fight/hover chips.
 * Prefers live client championStats (you only); otherwise item Flat/Percent sums.
 * Enemies never get live totals from the client API.
 */
export function combatProfile(player) {
  const live = player?.live_stats;
  if (live && (typeof live.attackDamage === "number" || typeof live.maxHealth === "number")) {
    return {
      source: "live",
      ad: live.attackDamage || 0,
      ap: live.abilityPower || 0,
      armor: live.armor || 0,
      mr: live.magicResist || 0,
      hp: live.maxHealth || 0,
      currentHp: live.currentHealth,
      as: live.attackSpeed || 0,
      asKind: "rate", // attacks per second
      crit: live.critChance || 0, // 0–1
      ms: live.moveSpeed || 0,
      ah: live.abilityHaste || 0,
      level: live.level,
    };
  }
  const items = sumItemStats(player?.items);
  const asPercent = items.PercentAttackSpeedMod || 0;
  const asFlat = items.FlatAttackSpeedMod || 0;
  return {
    source: "items",
    ad: items.FlatPhysicalDamageMod || 0,
    ap: items.FlatMagicDamageMod || 0,
    armor: items.FlatArmorMod || 0,
    mr: items.FlatSpellBlockMod || 0,
    hp: items.FlatHPPoolMod || 0,
    currentHp: null,
    as: asPercent || asFlat,
    asKind: asPercent ? "percent" : "flat",
    crit: items.FlatCritChanceMod || 0,
    ms: items.FlatMovementSpeedMod || 0,
    msPercent: items.PercentMovementSpeedMod || 0,
    ah: 0, // Data Dragon item.stats rarely exposes FlatAbilityHaste
    level: player?.level,
  };
}

/** Format a combatProfile field for chip / hover display. */
export function formatCombatValue(profile, key) {
  if (!profile) return "0";
  if (key === "hp" && profile.source === "live" && profile.currentHp != null) {
    return `${Math.round(profile.currentHp)}/${Math.round(profile.hp)}`;
  }
  if (key === "as") {
    if (profile.asKind === "rate") {
      return `${Math.round((profile.as || 0) * 100) / 100}`;
    }
    if (profile.asKind === "percent" || (profile.as || 0) < 3) {
      return `${Math.round((profile.as || 0) * 1000) / 10}%`;
    }
    return String(Math.round(profile.as || 0));
  }
  if (key === "crit") {
    return `${Math.round((profile.crit || 0) * 1000) / 10}%`;
  }
  if (key === "ms" && profile.source === "items" && !profile.ms && profile.msPercent) {
    return `${Math.round(profile.msPercent * 1000) / 10}%`;
  }
  return String(Math.round(profile[key] || 0));
}

/** Short lines for the hover panel from a combatProfile. */
export function combatLines(profile) {
  if (!profile) return [];
  const rows = [
    ["ad", "AD"],
    ["ap", "AP"],
    ["armor", "Armor"],
    ["mr", "MR"],
    ["hp", "HP"],
    ["as", "AS"],
    ["crit", "Crit"],
    ["ms", "MS"],
    ["ah", "AH"],
  ];
  return rows
    .filter(([k]) => {
      if (k === "ms" && profile.source === "items") {
        return (profile.ms || 0) || (profile.msPercent || 0);
      }
      if (k === "ah") return profile.source === "live" || (profile.ah || 0);
      return (profile[k] || 0) || (k === "hp" && profile.currentHp);
    })
    .map(([k, label]) => `${formatCombatValue(profile, k)} ${label}`);
}

// Data Dragon square icons use champion "id" keys; the live client gives
// display names. Normalizing punctuation covers almost every champion.
export function champIconUrl(name) {
  const fixups = {
    "Wukong": "MonkeyKing", "Renata Glasc": "Renata", "Nunu & Willump": "Nunu",
  };
  const key = fixups[name] || name.replace(/['. ]/g, "");
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${key}.png`;
}

// Item descriptions ship with Riot's own markup (<mainText>, <stats>, <br>…).
// Parse them in an inert document and keep just the text with line breaks.
export function plainDescription(html) {
  const doc = new DOMParser().parseFromString(
    String(html || "").replace(/<br\s*\/?>/gi, "\n"), "text/html");
  return (doc.body.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
}

function iconRow(ids) {
  return ids
    .filter((id) => getItem(id))
    .map((id) => `<img src="${itemIconUrl(id)}" alt="" data-item-id="${id}" />`)
    .join("");
}

// --- hover tooltip --------------------------------------------------------
// One shared element for the whole page; any element with data-item-id shows it.

export function initItemTooltips() {
  const tip = document.createElement("div");
  tip.id = "item-tooltip";
  tip.className = "hidden";
  document.body.appendChild(tip);

  const line = (cls, text) => {
    const d = document.createElement("div");
    d.className = cls;
    d.textContent = text;
    return d;
  };

  const htmlBlock = (cls, html) => {
    const d = document.createElement("div");
    d.className = cls;
    d.innerHTML = html;
    return d;
  };

  const move = (e) => {
    if (tip.classList.contains("hidden")) return;
    const pad = 14;
    let x = e.clientX + pad;
    let y = e.clientY + pad;
    const r = tip.getBoundingClientRect();
    if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - pad;
    if (y + r.height > window.innerHeight - 8) y = e.clientY - r.height - pad;
    tip.style.left = `${Math.max(8, x)}px`;
    tip.style.top = `${Math.max(8, y)}px`;
  };

  document.addEventListener("mouseover", (e) => {
    const el = e.target.closest && e.target.closest("[data-item-id]");
    if (!el) return;
    // Don't fight the champion hover panel for focus.
    if (e.target.closest("[data-champ-hover]")) return;
    const it = getItem(el.dataset.itemId);
    if (!it) return;

    const kids = [
      line("tip-name", it.name),
      line("tip-gold", `${it.gold.total} gold`),
    ];
    const from = itemFrom(el.dataset.itemId);
    const into = itemInto(el.dataset.itemId);
    if (from.length) {
      kids.push(line("tip-path-label", "Builds from"));
      kids.push(htmlBlock("tip-path", iconRow(from)));
    }
    if (into.length) {
      kids.push(line("tip-path-label", "Builds into"));
      kids.push(htmlBlock("tip-path", iconRow(into)));
    }
    const stats = statsLines(it.stats);
    if (stats.length) kids.push(line("tip-stats", stats.join(" · ")));
    kids.push(line("tip-desc", plainDescription(it.description)));

    tip.replaceChildren(...kids);
    tip.classList.remove("hidden");
    move(e);
  });
  document.addEventListener("mousemove", move);
  document.addEventListener("mouseout", (e) => {
    if (e.target.closest && e.target.closest("[data-item-id]")
        && !e.relatedTarget?.closest?.("[data-item-id]")) {
      tip.classList.add("hidden");
    }
  });
}
