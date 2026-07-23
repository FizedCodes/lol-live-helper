// Builds tab: META core, suggested build order (when to buy), item component
// trees, plus situational alternatives from the enemy team / their purchases.

import {
  getChampion, getItem, itemIconUrl, champIconUrl, itemFrom, itemGold,
} from "./items.js";

const HEALERS = new Set([
  "Aatrox", "Dr. Mundo", "Illaoi", "Kayn", "Maokai", "Nami", "Rhaast", "Senna",
  "Seraphine", "Sona", "Soraka", "Swain", "Sylas", "Vladimir", "Warwick",
  "Yuumi", "Zac", "Briar", "Naafiri",
]);

const BOOT_IDS = new Set([3006, 3009, 3020, 3047, 3111, 3117, 3158]);

// Archetype META cores — typical completed items, not a full shopping list.
const META_CORES = {
  adc: {
    label: "Crit ADC",
    items: [6672, 3031, 3046, 3036, 3072, 3006],
  },
  onhit: {
    label: "On-hit ADC",
    items: [3153, 3091, 3085, 3078, 3047],
  },
  mage: {
    label: "Burst mage",
    items: [6655, 4645, 3089, 3135, 3157, 3020],
  },
  battlemage: {
    label: "Battle mage",
    items: [6653, 3118, 3135, 3157, 3089, 3020],
  },
  assassin_ad: {
    label: "AD assassin",
    items: [6691, 6693, 3036, 3814, 3142, 3158],
  },
  assassin_ap: {
    label: "AP assassin",
    items: [6655, 4645, 3089, 3135, 3102, 3020],
  },
  bruiser: {
    label: "Bruiser",
    items: [6631, 3078, 3053, 6333, 3742, 3047],
  },
  tank: {
    label: "Tank",
    items: [3068, 3075, 3143, 3065, 3110, 3047],
  },
  enchanter: {
    label: "Enchanter support",
    items: [6617, 3504, 3107, 3222, 3011, 3158],
  },
  catcher: {
    label: "Catcher support",
    items: [3869, 3001, 3110, 3109, 3190, 3117],
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

function itemIcon(id, extraClass = "") {
  const into = (getItem(id)?.into || []).length;
  const badge = into ? `<span class="into-badge" title="Builds into ${into} item(s)">↑${into}</span>` : "";
  return `<span class="item-wrap ${extraClass}">
    <img src="${itemIconUrl(id)}" alt="" data-item-id="${id}"
         onerror="this.style.visibility='hidden'" />
    ${badge}
  </span>`;
}

function itemStrip(ids) {
  const icons = livingItems(ids).map((id) => itemIcon(id)).join("");
  return `<div class="items build-items">${icons}</div>`;
}

function componentTree(id) {
  const from = itemFrom(id).filter((c) => getItem(c));
  if (!from.length) return "";
  return `<div class="component-row">
    <span class="muted">from</span>
    ${from.map((c) => itemIcon(c, "tiny")).join('<span class="plus">+</span>')}
    <span class="arrow">→</span>
    ${itemIcon(id)}
    <span class="muted comp-gold">${itemGold(id).toLocaleString()}g</span>
  </div>`;
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

  if (tags.armor >= 3) {
    parts.push(section(
      "They're stacking armor",
      "Several enemies already bought armor — swap a damage item for penetration or % health.",
      [],
      iAmAp ? [3135, 6653] : [3036, 6694, 3153],
    ));
  }
  if (tags.mr >= 3) {
    parts.push(section(
      "They're stacking MR",
      "Magic resist is showing up on their team — magic pen or a physical pivot helps.",
      [],
      iAmAp ? [3135, 4645] : [3036, 6676],
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

/** Split a META core into timed buy steps with component recipes. */
function buildOrder(coreItems) {
  const boots = coreItems.filter((id) => BOOT_IDS.has(Number(id)));
  const legendaries = coreItems.filter((id) => !BOOT_IDS.has(Number(id)));
  const steps = [];

  steps.push({
    when: "First back (~1100g)",
    tip: "Pick up a long sword / chapter / kindlegem component, or rush boots if you're getting poked out of lane.",
    ids: boots.length ? boots : legendaries.slice(0, 0),
    showComponentsOf: legendaries[0] || null,
  });

  if (boots.length) {
    steps.push({
      when: "Boots",
      tip: "Finish boots on your second back unless you're racing a spike — mobility saves more gold than it spends.",
      ids: boots,
    });
  }

  legendaries.forEach((id, i) => {
    const name = getItem(id)?.name || "Item";
    const labels = ["Mythic / first item", "Second item", "Third item", "Fourth item", "Fifth item", "Sixth item"];
    steps.push({
      when: `${labels[i] || `Item ${i + 1}`} · ${name}`,
      tip: i === 0
        ? "Complete your first legendary as soon as you can — it's the biggest power spike of the early game."
        : i === 1
          ? "Second item is usually your damage identity (crit, pen, mythic pair). Don't delay it for a luxury defensive."
          : "Finish the core, then adapt — defensive or pen based on who's fed.",
      ids: [id],
      showComponentsOf: id,
    });
  });

  return steps;
}

function renderOrder(coreItems) {
  const steps = buildOrder(coreItems);
  const cards = steps.map((s, idx) => {
    const comps = s.showComponentsOf ? componentTree(s.showComponentsOf) : "";
    const icons = livingItems(s.ids).map((id) => itemIcon(id)).join("") || comps;
    if (!icons && !comps) return "";
    return `<div class="order-step">
      <div class="order-num">${idx + 1}</div>
      <div class="order-body">
        <div class="order-when">${s.when}</div>
        <p class="muted">${s.tip}</p>
        <div class="items build-items">${livingItems(s.ids).map((id) => itemIcon(id)).join("")}</div>
        ${comps}
      </div>
    </div>`;
  }).filter(Boolean).join("");

  return `<h3>Build order</h3>
    <p class="muted">Suggested buy timing. Hover items to see components and what they upgrade into.</p>
    <div class="order-list">${cards}</div>`;
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

  // Owned items: grey out / mark what's already purchased.
  const owned = new Set((data.allies || [])
    .concat(data.enemies || [])
    .filter((p) => p.is_me)
    .flatMap((p) => (p.items || []).map((it) => String(it.id))));

  const metaIcons = coreItems.map((id) =>
    itemIcon(id, owned.has(String(id)) ? "owned" : "")).join("");

  const metaBlock = `<div class="build-section meta-core">
    <div class="build-head">
      <img class="mini-champ" src="${champIconUrl(meChamp)}" alt=""
           onerror="this.style.visibility='hidden'" />
      <span class="build-title">META core · ${core.label}</span>
      ${position ? `<span class="tag">${position}</span>` : ""}
    </div>
    <p class="muted">Common completed items for ${meChamp}'s usual playstyle.
      ↑ badges mark components that build into other items. Green ring = you already own it.</p>
    ${coreItems.length
      ? `<div class="items build-items">${metaIcons}</div>`
      : '<p class="muted">Item data still loading…</p>'}
  </div>`;

  const orderBlock = coreItems.length ? renderOrder(coreItems) : "";

  const alts = alternatives(meChamp, position, data.enemies || []);
  const vs = champStrip((data.enemies || []).map((e) => e.champion));
  const altBlock = alts.length
    ? `<h3>Alternatives vs this lobby</h3>
       <div class="build-vs"><span class="muted">Against:</span> ${vs}</div>
       ${alts.join("")}`
    : `<h3>Alternatives vs this lobby</h3>
       <p class="muted">Balanced lobby so far — stick to the META core and react if someone gets fed or stacks resists.</p>
       <div class="build-vs"><span class="muted">Against:</span> ${vs}</div>`;

  container.innerHTML = metaBlock + orderBlock + altBlock;
}
