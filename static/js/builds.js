// Counter-build suggestions: looks at the enemy team (from the live game or the
// last-game snapshot) and recommends items to itemize against them.
// Rules-based — Riot's API has no counter-build data, so this uses champion
// damage profiles + tags from Data Dragon and a few curated item lists.

import { getChampion, getItem, itemIconUrl, champIconUrl } from "./items.js";

// Champions with meaningful healing worth buying anti-heal against.
const HEALERS = new Set([
  "Aatrox", "Dr. Mundo", "Illaoi", "Kayn", "Maokai", "Nami", "Rhaast", "Senna",
  "Seraphine", "Sona", "Soraka", "Swain", "Sylas", "Vladimir", "Warwick",
  "Yuumi", "Zac", "Briar", "Naafiri",
]);

// Curated item pools. Anything Data Dragon no longer knows about is silently
// dropped, so a patch removing an item can't break the tab.
const POOLS = {
  armor:      [3047, 3075, 3143, 3110, 3026],       // Steelcaps, Thornmail, Randuin's, Frozen Heart, GA
  armorAp:    [3157],                                // Zhonya's (armor for mages)
  mr:         [3111, 3065, 3102, 3091, 3156],        // Mercs, Spirit Visage, Banshee's, Wit's End, Maw
  antiHealAd: [3123, 3033],                          // Executioner's, Mortal Reminder
  antiHealAp: [3165, 3011],                          // Morellonomicon, Chemtech Putrifier
  antiHealTank: [3076, 3075],                        // Bramble Vest, Thornmail
  tankBustAd: [3153, 3036, 6694],                    // BotRK, Lord Dominik's, Serylda's
  tankBustAp: [3135, 6653],                          // Void Staff, Liandry's
  antiBurst:  [3157, 3102, 3026, 3053, 3814],        // Zhonya's, Banshee's, GA, Sterak's, Edge of Night
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

function itemStrip(ids) {
  const icons = ids
    .filter((id) => getItem(id)) // drop anything this patch doesn't have
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
  return `<div class="build-section">
    <div class="build-head">
      <span class="build-title">${title}</span>
      ${champs.length ? `<span class="build-champs">${champStrip(champs)}</span>` : ""}
    </div>
    <p class="muted">${why}</p>
    ${itemStrip(itemIds)}
  </div>`;
}

export function renderBuilds(data, container) {
  if (!data || !data.enemies || !data.enemies.length) {
    container.innerHTML =
      '<p class="muted">No game data yet. Suggestions appear once you\'re in a game (or from your last game).</p>';
    return;
  }

  const profiles = data.enemies.map((e) => profile(e.champion)).filter(Boolean);
  if (!profiles.length) {
    container.innerHTML = '<p class="muted">Champion data hasn\'t loaded yet — try again in a few seconds.</p>';
    return;
  }

  const meProfile = data.me ? profile(data.me.champion) : null;
  const iAmAp = !!meProfile && meProfile.magic > meProfile.attack;

  const adHeavy = profiles.filter((p) => p.attack >= p.magic + 2).map((p) => p.name);
  const apHeavy = profiles.filter((p) => p.magic >= p.attack + 2).map((p) => p.name);
  const healers = data.enemies.map((e) => e.champion).filter((n) => HEALERS.has(n));
  const tanks = profiles.filter((p) => p.tags.includes("Tank") || p.defense >= 8).map((p) => p.name);
  const assassins = profiles.filter((p) => p.tags.includes("Assassin")).map((p) => p.name);

  const parts = [];

  if (adHeavy.length >= 2) {
    parts.push(section(
      "Armor", `${adHeavy.length} of ${profiles.length} enemies deal mostly physical damage — armor is worth its gold.`,
      adHeavy, iAmAp ? [...POOLS.armorAp, ...POOLS.armor] : POOLS.armor));
  }
  if (apHeavy.length >= 2) {
    parts.push(section(
      "Magic resist", `${apHeavy.length} of ${profiles.length} enemies deal mostly magic damage — grab some MR.`,
      apHeavy, POOLS.mr));
  }
  if (healers.length) {
    const pool = meProfile && meProfile.tags.includes("Tank")
      ? POOLS.antiHealTank : iAmAp ? POOLS.antiHealAp : POOLS.antiHealAd;
    parts.push(section(
      "Anti-heal", "These enemies heal a lot — Grievous Wounds cuts their healing hard. Buy it early, not as a last item.",
      healers, pool));
  }
  if (tanks.length >= 2) {
    parts.push(section(
      "Tank busting", "Multiple tanky enemies — you'll want penetration or % health damage to not tickle them late game.",
      tanks, iAmAp ? POOLS.tankBustAp : POOLS.tankBustAd));
  }
  if (assassins.length >= 2) {
    parts.push(section(
      "Survive the burst", "Multiple assassins on their team — one defensive item can be worth more than another damage item.",
      assassins, POOLS.antiBurst));
  }

  if (!parts.length) {
    parts.push('<p class="muted">Balanced enemy comp — no standout threats. Build your usual core and adapt to whoever is fed.</p>');
  }

  const vs = champStrip(data.enemies.map((e) => e.champion));
  container.innerHTML = `<div class="build-vs"><span class="muted">Against:</span> ${vs}</div>${parts.join("")}`;
}
