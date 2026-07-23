// Builds tab: a common META core for your champion, plus situational alternatives
// based on what the enemy team is building / who they picked.
// Riot doesn't publish "meta builds", so cores are curated archetypes (filtered
// against the live Data Dragon item catalog so removed items drop out).

import { getChampion, getItem, itemIconUrl, champIconUrl } from "./items.js";

const HEALERS = new Set([
  "Aatrox", "Dr. Mundo", "Illaoi", "Kayn", "Maokai", "Nami", "Rhaast", "Senna",
  "Seraphine", "Sona", "Soraka", "Swain", "Sylas", "Vladimir", "Warwick",
  "Yuumi", "Zac", "Briar", "Naafiri",
]);

// Archetype META cores — typical completed items, not a full shopping list.
const META_CORES = {
  adc: {
    label: "Crit ADC",
    items: [6672, 3031, 3046, 3036, 3072, 3006], // Kraken, IE, PD, LDR, BT, Berserkers
  },
  onhit: {
    label: "On-hit ADC",
    items: [3153, 3091, 3085, 3078, 3047], // BotRK, Wit's End, Runaan's, Trinity, Steelcaps
  },
  mage: {
    label: "Burst mage",
    items: [6655, 4645, 3089, 3135, 3157, 3020], // Luden's/shadowfire era: Shadowflame, Rabadon, Void, Zhonya, Sorcs
  },
  battlemage: {
    label: "Battle mage",
    items: [6653, 3118, 3135, 3157, 3089, 3020], // Liandry's, Riftmaker-ish, Void, Zhonya, Rabadon
  },
  assassin_ad: {
    label: "AD assassin",
    items: [6691, 6693, 3036, 3814, 3142, 3158], // Duskblade/eclipse era: Youmuu, Opportunity, LDR, EoN, Ghostblade, Ionians
  },
  assassin_ap: {
    label: "AP assassin",
    items: [6655, 4645, 3089, 3135, 3102, 3020], // Luden-line, Shadowflame, Rabadon, Void, Banshee's
  },
  bruiser: {
    label: "Bruiser",
    items: [6631, 3078, 3053, 6333, 3742, 3047], // Goredrinker-line / Trinity, Sterak's, Death's Dance, Titanic, Steelcaps
  },
  tank: {
    label: "Tank",
    items: [3068, 3075, 3143, 3065, 3110, 3047], // Sunfire, Thornmail, Randuin's, Spirit Visage, Frozen Heart, Steelcaps
  },
  enchanter: {
    label: "Enchanter support",
    items: [6617, 3504, 3107, 3222, 3011, 3158], // Moonstone, Ardent, Redemption, Mikael's, Chemtech, Ionians
  },
  catcher: {
    label: "Catcher support",
    items: [3869, 3001, 3110, 3109, 3190, 3117], // support starting / Locket-line, Frozen Heart, Knight's Vow, Boots
  },
};

function profile(name) {
  const c = getChampion(name);
  if (!c) return null;
  return {
    name,
    attack: c.info.attack,
    magic: c.info.magic,
    defense: c.info.defense,
    tags: c.tags || [],
  };
}

function pickArchetype(champName, position) {
  const p = profile(champName);
  const tags = p ? p.tags : [];
  const pos = (position || "").toUpperCase();
  const isAp = p && p.magic > p.attack;

  if (pos === "UTILITY" || tags.includes("Support")) {
    if (tags.includes("Mage") || tags.includes("Tank")) return "catcher";
    return "enchanter";
  }
  if (tags.includes("Tank") && (pos === "TOP" || pos === "JUNGLE" || p.defense >= 8)) return "tank";
  if (tags.includes("Assassin")) return isAp ? "assassin_ap" : "assassin_ad";
  if (pos === "BOTTOM" || (tags.includes("Marksman") && !tags.includes("Assassin"))) {
    // On-hit lean for a few well-known names; everyone else gets crit.
    const onhit = new Set(["Varus", "Kog'Maw", "KogMaw", "Vayne", "Kai'Sa", "Twitch"]);
    return onhit.has(champName) ? "onhit" : "adc";
  }
  if (tags.includes("Mage")) {
    if (tags.includes("Fighter") || (p && p.defense >= 5)) return "battlemage";
    return "mage";
  }
  if (tags.includes("Fighter") || tags.includes("Marksman")) return "bruiser";
  return isAp ? "mage" : "bruiser";
}

function livingItems(ids) {
  return ids.filter((id) => getItem(id));
}

function itemStrip(ids) {
  const icons = livingItems(ids)
    .map((id) => `<img src="${itemIconUrl(id)}" alt="" data-item-id="${id}"
                       onerror="this.style.visibility='hidden'" />`)
    .join("");
  return `<div class="items build-items">${icons}</div>`;
}

function champStrip(names) {
  return names.map((n) =>
    `<img class="mini-champ" src="${champIconUrl(n)}" alt="" title="${n}"
          onerror="this.style.visibility='hidden'" />`).join("");
}

function section(title, why, champs, itemIds) {
  const items = livingItems(itemIds);
  if (!items.length) return "";
  return `<div class="build-section">
    <div class="build-head">
      <span class="build-title">${title}</span>
      ${champs.length ? `<span class="build-champs">${champStrip(champs)}</span>` : ""}
    </div>
    <p class="muted">${why}</p>
    ${itemStrip(items)}
  </div>`;
}

// Tag helpers against whatever the enemy team has already purchased.
function enemyItemTags(enemies) {
  let armor = 0, mr = 0, health = 0, heal = 0, total = 0;
  for (const e of enemies || []) {
    for (const it of e.items || []) {
      const data = getItem(it.id);
      if (!data) continue;
      total += 1;
      const tags = data.tags || [];
      if (tags.includes("Armor")) armor += 1;
      if (tags.includes("SpellBlock")) mr += 1;
      if (tags.includes("Health")) health += 1;
      // Rough heal/shield signal from description text.
      const desc = (data.description || "").toLowerCase();
      if (desc.includes("heal") || desc.includes("omnivamp") || desc.includes("life steal")) heal += 1;
    }
  }
  return { armor, mr, health, heal, total };
}

function alternatives(meChamp, position, enemies) {
  const arch = pickArchetype(meChamp, position);
  const iAmAp = arch.includes("mage") || arch === "assassin_ap" || arch === "battlemage" || arch === "enchanter";
  const iAmTank = arch === "tank" || arch === "catcher";
  const tags = enemyItemTags(enemies);
  const profiles = (enemies || []).map((e) => profile(e.champion)).filter(Boolean);
  const parts = [];

  // Adapt to what they *bought*, not just who they picked.
  if (tags.armor >= 3) {
    parts.push(section(
      "They're stacking armor",
      "Several enemies already bought armor — swap a damage item for penetration or % health.",
      [],
      iAmAp ? [3135, 6653] : [3036, 6694, 3153], // Void/Liandry vs LDR/Serylda/BotRK
    ));
  }
  if (tags.mr >= 3) {
    parts.push(section(
      "They're stacking MR",
      "Magic resist is showing up on their team — magic pen or a physical pivot helps.",
      [],
      iAmAp ? [3135, 4645] : [3036, 6676], // Void/Shadowflame vs LDR/Collector
    ));
  }
  if (tags.health >= 4 || profiles.filter((p) => p.defense >= 8).length >= 2) {
    parts.push(section(
      "Tanky frontline",
      "Lots of HP on their side — % health damage and sustained burn outscale raw burst.",
      profiles.filter((p) => p.defense >= 8).map((p) => p.name),
      iAmAp ? [6653, 3135] : [3153, 3072],
    ));
  }
  if (tags.heal >= 2 || (enemies || []).some((e) => HEALERS.has(e.champion))) {
    const healers = (enemies || []).map((e) => e.champion).filter((n) => HEALERS.has(n));
    parts.push(section(
      "Anti-heal",
      "Healing threats (or heal items) on their team — Grievous Wounds early is worth more than a late luxury item.",
      healers,
      iAmTank ? [3076, 3075] : iAmAp ? [3165, 3011] : [3123, 3033],
    ));
  }

  // Comp-based counters (same idea as before, still useful early game before items).
  const adHeavy = profiles.filter((p) => p.attack >= p.magic + 2).map((p) => p.name);
  const apHeavy = profiles.filter((p) => p.magic >= p.attack + 2).map((p) => p.name);
  const assassins = profiles.filter((p) => p.tags.includes("Assassin")).map((p) => p.name);

  if (adHeavy.length >= 2) {
    parts.push(section(
      "Armor vs AD",
      `${adHeavy.length} enemies lean physical — a defensive piece or steelcaps pays off.`,
      adHeavy,
      iAmAp ? [3157, 3047] : [3047, 3075, 3143, 3026],
    ));
  }
  if (apHeavy.length >= 2) {
    parts.push(section(
      "MR vs AP",
      `${apHeavy.length} enemies lean magic — grab MR before they snowball.`,
      apHeavy,
      [3111, 3065, 3102, 3156],
    ));
  }
  if (assassins.length >= 2) {
    parts.push(section(
      "Survive the burst",
      "Multiple assassins — one defensive item can be worth more than another damage item.",
      assassins,
      [3157, 3102, 3026, 3053, 3814],
    ));
  }

  return parts.filter(Boolean);
}

export function renderBuilds(data, container) {
  if (!data || !data.me) {
    container.innerHTML =
      '<p class="muted">No game data yet. META + situational builds appear once you\'re in a game (or from your last game).</p>';
    return;
  }

  const meChamp = data.me.champion;
  const position = data.me.position;
  const archKey = pickArchetype(meChamp, position);
  const core = META_CORES[archKey];
  const coreItems = livingItems(core.items);

  const metaBlock = `<div class="build-section meta-core">
    <div class="build-head">
      <img class="mini-champ" src="${champIconUrl(meChamp)}" alt=""
           onerror="this.style.visibility='hidden'" />
      <span class="build-title">META core · ${core.label}</span>
      ${position ? `<span class="tag">${position}</span>` : ""}
    </div>
    <p class="muted">Common completed items for ${meChamp}'s usual playstyle.
      Treat this as a baseline — adapt with the alternatives below.</p>
    ${coreItems.length ? itemStrip(coreItems)
      : '<p class="muted">Item data still loading…</p>'}
  </div>`;

  const alts = alternatives(meChamp, position, data.enemies || []);
  const vs = champStrip((data.enemies || []).map((e) => e.champion));
  const altBlock = alts.length
    ? `<h3>Alternatives vs this lobby</h3>
       <div class="build-vs"><span class="muted">Against:</span> ${vs}</div>
       ${alts.join("")}`
    : `<h3>Alternatives vs this lobby</h3>
       <p class="muted">Balanced lobby so far — stick to the META core and react if someone gets fed or stacks resists.</p>
       <div class="build-vs"><span class="muted">Against:</span> ${vs}</div>`;

  container.innerHTML = metaBlock + altBlock;
}
