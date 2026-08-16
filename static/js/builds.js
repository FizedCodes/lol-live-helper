// Builds tab: shopping list from a champ's META core (pickable before games),
// with starter item, situational swaps, optional build order, and inventory sync.

import {
  allChampions, getChampion, getItem, itemIconUrl, champIconUrl, itemFrom, itemGold,
} from "./items.js";

const HEALERS = new Set([
  "Aatrox", "Dr. Mundo", "Illaoi", "Kayn", "Maokai", "Nami", "Rhaast", "Senna",
  "Seraphine", "Sona", "Soraka", "Swain", "Sylas", "Vladimir", "Warwick",
  "Yuumi", "Zac", "Briar", "Naafiri",
]);

const BOOT_IDS = new Set([3006, 3009, 3020, 3047, 3111, 3117, 3158]);
const ORDER_PREF_KEY = "builds.showOrder";
const PICK_CHAMP_KEY = "builds.champ";
const PICK_ROLE_KEY = "builds.role";
const FOLLOW_LIVE_KEY = "builds.followLive";

const ROLES = [
  ["", "Auto (from champ)"],
  ["TOP", "Top"],
  ["JUNGLE", "Jungle"],
  ["MIDDLE", "Mid"],
  ["BOTTOM", "Bot"],
  ["UTILITY", "Support"],
];

// Archetype META cores — starter + typical completed items (not a full shop dump).
const META_CORES = {
  adc: {
    label: "Crit ADC",
    starter: 1055, // Doran's Blade
    items: [6672, 3031, 3046, 3036, 3072, 3006],
  },
  onhit: {
    label: "On-hit ADC",
    starter: 1086, // Doran's Bow (AS / on-hit)
    items: [3153, 3091, 3085, 3078, 3047],
  },
  mage: {
    label: "Burst mage",
    starter: 1056, // Doran's Ring
    items: [6655, 4645, 3089, 3135, 3157, 3020],
  },
  battlemage: {
    label: "Battle mage",
    starter: 1056,
    items: [6653, 3118, 3135, 3157, 3089, 3020],
  },
  assassin_ad: {
    label: "AD assassin",
    starter: 1055,
    items: [6691, 6693, 3036, 3814, 3142, 3158],
  },
  assassin_ap: {
    label: "AP assassin",
    starter: 1082, // Dark Seal
    items: [6655, 4645, 3089, 3135, 3102, 3020],
  },
  bruiser: {
    label: "Bruiser",
    starter: 1055,
    items: [6631, 3078, 3053, 6333, 3742, 3047],
  },
  tank: {
    label: "Tank",
    starter: 1054, // Doran's Shield
    items: [3068, 3075, 3143, 3065, 3110, 3047],
  },
  enchanter: {
    label: "Enchanter support",
    starter: 3865, // World Atlas
    items: [6617, 3504, 3107, 3222, 3011, 3158],
  },
  catcher: {
    label: "Catcher support",
    starter: 3865,
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

  if (pos === "UTILITY" || (!pos && tags.includes("Support"))) {
    if (tags.includes("Mage") || tags.includes("Tank")) return "catcher";
    return "enchanter";
  }
  if (tags.includes("Tank") && (pos === "TOP" || pos === "JUNGLE" || !pos || (p && p.defense >= 8))) {
    return "tank";
  }
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

/** Most common starter for this archetype / role (jungle pets, Atlas, Doran's…). */
function pickStarter(archKey, position) {
  const pos = (position || "").toUpperCase();
  if (pos === "JUNGLE") {
    if (archKey === "tank") return "1103"; // Mosstomper
    if (archKey === "assassin_ap" || archKey === "mage" || archKey === "battlemage"
        || archKey === "assassin_ad") {
      return "1101"; // Scorchclaw
    }
    return "1102"; // Gustwalker
  }
  if (pos === "UTILITY") return "3865";
  const id = META_CORES[archKey]?.starter;
  return id != null ? String(id) : null;
}

function followLivePref() {
  return localStorage.getItem(FOLLOW_LIVE_KEY) !== "0";
}

function savedChamp() {
  return localStorage.getItem(PICK_CHAMP_KEY) || "";
}

function savedRole() {
  return localStorage.getItem(PICK_ROLE_KEY) || "";
}

function livingItems(ids) {
  return (ids || []).map(String).filter((id) => getItem(id));
}

function myPlayer(data) {
  return (data.allies || []).find((p) => p.is_me) || null;
}

function ownedIdSet(data) {
  const me = myPlayer(data);
  return new Set((me?.items || []).map((it) => String(it.id)));
}

/** True if ownedId appears anywhere in targetId's component tree. */
function isComponentOf(ownedId, targetId) {
  const stack = [...itemFrom(targetId)];
  const seen = new Set();
  while (stack.length) {
    const c = String(stack.pop());
    if (seen.has(c)) continue;
    seen.add(c);
    if (c === String(ownedId)) return true;
    stack.push(...itemFrom(c));
  }
  return false;
}

function ownershipState(owned, itemId) {
  const id = String(itemId);
  if (owned.has(id)) return "owned";
  for (const o of owned) {
    if (isComponentOf(o, id)) return "progress";
  }
  return "todo";
}

function itemIcon(id, extraClass = "", title = "") {
  const into = (getItem(id)?.into || []).length;
  const name = getItem(id)?.name || id;
  const tip = title || name;
  const badge = into ? `<span class="into-badge" title="Builds into ${into} item(s)">↑${into}</span>` : "";
  return `<span class="item-wrap ${extraClass}" title="${esc(tip)}">
    <img src="${itemIconUrl(id)}" alt="" data-item-id="${id}"
         onerror="this.style.visibility='hidden'" />
    ${badge}
  </span>`;
}

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/"/g, "&quot;")
    .replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
    `<img class="mini-champ" src="${champIconUrl(n)}" alt="" title="${esc(n)}"
          onerror="this.style.visibility='hidden'" />`).join("");
}

function section(title, why, champs, itemIds, opts = {}) {
  const items = livingItems(itemIds).filter((id) => !opts.hideIds?.has(String(id)));
  if (!items.length) return "";
  return `<div class="build-section">
    <div class="build-head">
      <span class="build-title">${esc(title)}</span>
      ${champs.length ? `<span class="build-champs">${champStrip(champs)}</span>` : ""}
    </div>
    <p class="muted">${esc(why)}</p>
    <div class="items build-items">${items.map((id) => itemIcon(id)).join("")}</div>
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

/**
 * Ranked situational picks for this lobby. Higher priority installs first into
 * the shopping list (replacing unfinished META slots).
 */
function situationalPicks(meChamp, position, enemies) {
  const arch = pickArchetype(meChamp, position);
  const iAmAp = arch.includes("mage") || arch === "assassin_ap" || arch === "battlemage" || arch === "enchanter";
  const iAmTank = arch === "tank" || arch === "catcher";
  const tags = enemyItemTags(enemies);
  const profiles = (enemies || []).map((e) => profile(e.champion)).filter(Boolean);
  const picks = [];

  const add = (priority, reason, champs, ids) => {
    for (const id of livingItems(ids)) {
      picks.push({ id, priority, reason, champs: champs || [] });
    }
  };

  if (tags.armor >= 3) {
    add(90, "They're stacking armor — pen / % health over raw damage",
      [], iAmAp ? [3135, 6653] : [3036, 6694, 3153]);
  }
  if (tags.mr >= 3) {
    add(88, "They're stacking MR — magic pen or a physical pivot",
      [], iAmAp ? [3135, 4645] : [3036, 6676]);
  }
  if (tags.health >= 4 || profiles.filter((p) => p.defense >= 8).length >= 2) {
    add(80, "Tanky frontline — % health and sustained damage",
      profiles.filter((p) => p.defense >= 8).map((p) => p.name),
      iAmAp ? [6653, 3135] : [3153, 3072]);
  }
  if (tags.heal >= 2 || (enemies || []).some((e) => HEALERS.has(e.champion))) {
    const healers = (enemies || []).map((e) => e.champion).filter((n) => HEALERS.has(n));
    add(95, "Healing threats — Grievous Wounds is worth an early slot",
      healers, iAmTank ? [3076, 3075] : iAmAp ? [3165, 3011] : [3123, 3033]);
  }

  const adHeavy = profiles.filter((p) => p.attack >= p.magic + 2).map((p) => p.name);
  const apHeavy = profiles.filter((p) => p.magic >= p.attack + 2).map((p) => p.name);
  const assassins = profiles.filter((p) => p.tags.includes("Assassin")).map((p) => p.name);

  if (adHeavy.length >= 2) {
    add(70, `${adHeavy.length} AD threats — armor / steelcaps`,
      adHeavy, iAmAp ? [3157, 3047] : [3047, 3075, 3143, 3026]);
  }
  if (apHeavy.length >= 2) {
    add(70, `${apHeavy.length} AP threats — grab MR before they snowball`,
      apHeavy, [3111, 3065, 3102, 3156]);
  }
  if (assassins.length >= 2) {
    add(75, "Multiple assassins — one defensive piece can save the game",
      assassins, [3157, 3102, 3026, 3053, 3814]);
  }

  // Deduplicate by item id, keep highest priority.
  const best = new Map();
  for (const p of picks) {
    const prev = best.get(p.id);
    if (!prev || p.priority > prev.priority) best.set(p.id, p);
  }
  return [...best.values()].sort((a, b) => b.priority - a.priority);
}

function alternativesHtml(meChamp, position, enemies, inPlan) {
  const arch = pickArchetype(meChamp, position);
  const iAmAp = arch.includes("mage") || arch === "assassin_ap" || arch === "battlemage" || arch === "enchanter";
  const iAmTank = arch === "tank" || arch === "catcher";
  const tags = enemyItemTags(enemies);
  const profiles = (enemies || []).map((e) => profile(e.champion)).filter(Boolean);
  const hide = inPlan || new Set();
  const parts = [];

  if (tags.armor >= 3) {
    parts.push(section("They're stacking armor",
      "Several enemies already bought armor — swap a damage item for penetration or % health.",
      [], iAmAp ? [3135, 6653] : [3036, 6694, 3153], { hideIds: hide }));
  }
  if (tags.mr >= 3) {
    parts.push(section("They're stacking MR",
      "Magic resist is showing up on their team — magic pen or a physical pivot helps.",
      [], iAmAp ? [3135, 4645] : [3036, 6676], { hideIds: hide }));
  }
  if (tags.health >= 4 || profiles.filter((p) => p.defense >= 8).length >= 2) {
    parts.push(section("Tanky frontline",
      "Lots of HP on their side — % health damage and sustained burn outscale raw burst.",
      profiles.filter((p) => p.defense >= 8).map((p) => p.name),
      iAmAp ? [6653, 3135] : [3153, 3072], { hideIds: hide }));
  }
  if (tags.heal >= 2 || (enemies || []).some((e) => HEALERS.has(e.champion))) {
    const healers = (enemies || []).map((e) => e.champion).filter((n) => HEALERS.has(n));
    parts.push(section("Anti-heal",
      "Healing threats (or heal items) on their team — Grievous Wounds early is worth more than a late luxury item.",
      healers, iAmTank ? [3076, 3075] : iAmAp ? [3165, 3011] : [3123, 3033], { hideIds: hide }));
  }

  const adHeavy = profiles.filter((p) => p.attack >= p.magic + 2).map((p) => p.name);
  const apHeavy = profiles.filter((p) => p.magic >= p.attack + 2).map((p) => p.name);
  const assassins = profiles.filter((p) => p.tags.includes("Assassin")).map((p) => p.name);

  if (adHeavy.length >= 2) {
    parts.push(section("Armor vs AD",
      `${adHeavy.length} enemies lean physical — a defensive piece or steelcaps pays off.`,
      adHeavy, iAmAp ? [3157, 3047] : [3047, 3075, 3143, 3026], { hideIds: hide }));
  }
  if (apHeavy.length >= 2) {
    parts.push(section("MR vs AP",
      `${apHeavy.length} enemies lean magic — grab MR before they snowball.`,
      apHeavy, [3111, 3065, 3102, 3156], { hideIds: hide }));
  }
  if (assassins.length >= 2) {
    parts.push(section("Survive the burst",
      "Multiple assassins — one defensive item can be worth more than another damage item.",
      assassins, [3157, 3102, 3026, 3053, 3814], { hideIds: hide }));
  }

  return parts.filter(Boolean);
}

/**
 * META core + situational swaps. Unowned late slots get replaced by higher-priority
 * lobby counters; owned / in-progress slots stay put.
 */
function buildShoppingPlan(coreItems, owned, picks) {
  const plan = livingItems(coreItems).map((id) => ({
    id,
    kind: "meta",
    reason: null,
    replaced: null,
    state: ownershipState(owned, id),
  }));

  const inPlan = () => new Set(plan.map((s) => String(s.id)));

  for (const pick of picks) {
    if (inPlan().has(String(pick.id))) continue;
    if (ownershipState(owned, pick.id) === "owned") continue;

    // Prefer replacing the last unfinished non-boot META slot (luxury / late core).
    let replaceIdx = -1;
    for (let i = plan.length - 1; i >= 0; i--) {
      const slot = plan[i];
      if (BOOT_IDS.has(Number(slot.id))) continue;
      if (slot.state === "owned" || slot.state === "progress") continue;
      if (slot.kind === "swap") continue; // don't thrash earlier swaps
      // Keep the first legendary sticky when possible.
      const legendaries = plan.filter((s) => !BOOT_IDS.has(Number(s.id)));
      if (legendaries[0] && String(legendaries[0].id) === String(slot.id) && legendaries.length > 1) {
        continue;
      }
      replaceIdx = i;
      break;
    }

    if (replaceIdx >= 0) {
      const old = plan[replaceIdx];
      plan[replaceIdx] = {
        id: String(pick.id),
        kind: "swap",
        reason: pick.reason,
        replaced: old.id,
        state: ownershipState(owned, pick.id),
      };
    } else if (plan.length < 6) {
      plan.push({
        id: String(pick.id),
        kind: "swap",
        reason: pick.reason,
        replaced: null,
        state: ownershipState(owned, pick.id),
      });
    }
  }

  // Mark the next unfinished slot for emphasis.
  const next = plan.find((s) => s.state === "todo" || s.state === "progress");
  if (next) next.next = true;

  return plan;
}

/** Timed buy steps for the current shopping plan (starter → first back → core). */
function buildOrder(planItems, starterId, owned) {
  const ids = planItems.map((s) => s.id);
  const boots = ids.filter((id) => BOOT_IDS.has(Number(id)));
  const legendaries = ids.filter((id) => !BOOT_IDS.has(Number(id)));
  const steps = [];
  const first = legendaries[0] || boots[0] || null;
  const starter = starterId && getItem(starterId) ? String(starterId) : null;

  if (starter) {
    const name = getItem(starter)?.name || "Starter";
    steps.push({
      when: `Game start · ${name}`,
      tip: "Buy this with your starting gold (plus pots / control ward as usual).",
      ids: [starter],
      state: ownershipState(owned || new Set(), starter),
    });
  }

  steps.push({
    when: "First back (~1100g)",
    tip: boots.length
      ? "Grab a key component for your first item, or finish boots if you're getting poked out of lane."
      : "Pick up the main component for your first legendary — don't sit on raw gold.",
    ids: [],
    showComponentsOf: first,
  });

  if (boots.length) {
    steps.push({
      when: "Boots",
      tip: "Finish boots on an early back unless you're racing a huge spike — mobility saves more gold than it spends.",
      ids: boots,
    });
  }

  legendaries.forEach((id, i) => {
    const name = getItem(id)?.name || "Item";
    const labels = ["First item", "Second item", "Third item", "Fourth item", "Fifth item", "Sixth item"];
    const slot = planItems.find((s) => String(s.id) === String(id));
    const swapNote = slot?.kind === "swap" && slot.reason
      ? ` Situational: ${slot.reason}.`
      : "";
    steps.push({
      when: `${labels[i] || `Item ${i + 1}`} · ${name}`,
      tip: (i === 0
        ? "Complete your first legendary as soon as you can — biggest early power spike."
        : i === 1
          ? "Second item locks in your damage identity (crit, pen, sustain). Don't delay it for a luxury defensive."
          : "Finish the core, then adapt — defensive or pen based on who's fed.") + swapNote,
      ids: [id],
      showComponentsOf: id,
      state: slot?.state,
    });
  });

  return steps;
}

function renderOrder(plan, starterId, owned) {
  const steps = buildOrder(plan, starterId, owned);
  const cards = steps.map((s, idx) => {
    const comps = s.showComponentsOf ? componentTree(s.showComponentsOf) : "";
    const icons = livingItems(s.ids).map((id) => {
      const slot = plan.find((p) => String(p.id) === String(id));
      const state = slot?.state || s.state;
      const cls = state === "owned" ? "owned" : state === "progress" ? "progress" : "";
      return itemIcon(id, cls);
    }).join("");
    if (!icons && !comps) return "";
    return `<div class="order-step${s.state === "owned" ? " done" : ""}">
      <div class="order-num">${idx + 1}</div>
      <div class="order-body">
        <div class="order-when">${esc(s.when)}</div>
        <p class="muted">${esc(s.tip)}</p>
        ${icons ? `<div class="items build-items">${icons}</div>` : ""}
        ${comps}
      </div>
    </div>`;
  }).filter(Boolean).join("");

  const open = localStorage.getItem(ORDER_PREF_KEY) === "1";
  return `<details class="build-order-details" id="build-order-details"${open ? " open" : ""}>
    <summary class="build-order-summary">
      <span>Build order</span>
      <span class="muted">optional · component trees + timing tips</span>
    </summary>
    <p class="muted order-intro">Suggested buy timing for your <em>current</em> shopping list
      (updates when situational items replace META slots).</p>
    <div class="order-list">${cards}</div>
  </details>`;
}

function inventoryStrip(me) {
  const items = (me?.items || []).slice().sort((a, b) => a.slot - b.slot);
  if (!items.length) {
    return `<div class="inv-strip">
      <span class="inv-label">Your items</span>
      <span class="muted">Nothing bought yet — shopping list starts from the META core.</span>
    </div>`;
  }
  return `<div class="inv-strip">
    <span class="inv-label">Your items</span>
    <div class="items build-items">${items.map((it) => itemIcon(it.id, "owned")).join("")}</div>
  </div>`;
}

function planStrip(plan) {
  return plan.map((slot) => {
    const name = getItem(slot.id)?.name || slot.id;
    let cls = slot.state;
    if (slot.kind === "swap") cls += " swapped";
    if (slot.next) cls += " next";
    let tip = name;
    if (slot.state === "owned") tip += " · owned";
    else if (slot.state === "progress") tip += " · building (you own a component)";
    else if (slot.next) tip += " · buy next";
    if (slot.kind === "swap") {
      tip += slot.replaced
        ? ` · swapped in for ${getItem(slot.replaced)?.name || slot.replaced}`
        : " · situational add";
      if (slot.reason) tip += ` — ${slot.reason}`;
    }
    return itemIcon(slot.id, cls.trim(), tip);
  }).join("");
}

function swapNotes(plan) {
  const notes = plan.filter((s) => s.kind === "swap" && s.reason);
  if (!notes.length) return "";
  return `<ul class="swap-notes">
    ${notes.map((s) => {
      const into = getItem(s.id)?.name || s.id;
      const from = s.replaced ? getItem(s.replaced)?.name : null;
      return `<li><b>${esc(into)}</b>${from ? ` replaces <b>${esc(from)}</b>` : " added"}
        — ${esc(s.reason)}</li>`;
    }).join("")}
  </ul>`;
}

function starterState(owned, starterId) {
  if (!starterId) return null;
  return ownershipState(owned, starterId);
}

function starterRow(starterId, owned) {
  if (!starterId || !getItem(starterId)) return "";
  const state = starterState(owned, starterId) || "todo";
  const name = getItem(starterId)?.name || starterId;
  let tip = `${name} · starting item`;
  if (state === "owned") tip += " · owned";
  else if (state === "progress") tip += " · building";
  return `<div class="starter-row">
    <span class="inv-label">Start with</span>
    ${itemIcon(starterId, state === "todo" ? "starter" : state, tip)}
    <span class="muted">${esc(name)} — buy this with your starting gold</span>
  </div>`;
}

function renderPicker(opts) {
  const {
    meChamp, position, liveChamp, followLive, hasLive,
  } = opts;
  const champs = allChampions();
  const champOpts = champs.length
    ? champs.map((n) =>
      `<option value="${esc(n)}"${n === meChamp ? " selected" : ""}>${esc(n)}</option>`).join("")
    : `<option value="${esc(meChamp)}" selected>${esc(meChamp || "Loading champions…")}</option>`;
  const roleOpts = ROLES.map(([val, label]) =>
    `<option value="${esc(val)}"${val === position ? " selected" : ""}>${esc(label)}</option>`).join("");

  const liveBtn = hasLive
    ? `<button type="button" class="builds-live-btn${followLive ? " active" : ""}" id="builds-follow-live"
         title="Snap back to your current / last-game champion">
         ${followLive ? "Following live" : `Use live · ${esc(liveChamp || "game")}`}
       </button>`
    : "";

  return `<div class="builds-picker">
    <div class="builds-picker-fields">
      <label class="builds-field">
        <span class="inv-label">Champion</span>
        <select id="builds-champ">${champOpts}</select>
      </label>
      <label class="builds-field">
        <span class="inv-label">Role</span>
        <select id="builds-role">${roleOpts}</select>
      </label>
      ${liveBtn}
    </div>
    <p class="muted builds-picker-hint">${followLive && hasLive
      ? "Tracking your live / last-game champ. Pick another champion anytime to browse builds before queue."
      : "Pick a champion to preview a shopping list before the game starts."}</p>
  </div>`;
}

function wirePicker(container, data) {
  const champEl = container.querySelector("#builds-champ");
  const roleEl = container.querySelector("#builds-role");
  const liveBtn = container.querySelector("#builds-follow-live");

  const rerender = () => renderBuilds(data, container);

  if (champEl) {
    champEl.addEventListener("change", () => {
      localStorage.setItem(PICK_CHAMP_KEY, champEl.value || "");
      localStorage.setItem(FOLLOW_LIVE_KEY, "0");
      rerender();
    });
  }
  if (roleEl) {
    roleEl.addEventListener("change", () => {
      localStorage.setItem(PICK_ROLE_KEY, roleEl.value || "");
      localStorage.setItem(FOLLOW_LIVE_KEY, "0");
      rerender();
    });
  }
  if (liveBtn) {
    liveBtn.addEventListener("click", () => {
      localStorage.setItem(FOLLOW_LIVE_KEY, "1");
      const live = data?.me;
      if (live?.champion) localStorage.setItem(PICK_CHAMP_KEY, live.champion);
      if (live?.position) localStorage.setItem(PICK_ROLE_KEY, live.position);
      rerender();
    });
  }
}

function wireOrderToggle(container) {
  const details = container.querySelector("#build-order-details");
  if (!details) return;
  details.addEventListener("toggle", () => {
    localStorage.setItem(ORDER_PREF_KEY, details.open ? "1" : "0");
  });
}

function resolvePick(data) {
  const liveChamp = data?.me?.champion || "";
  const livePos = data?.me?.position || "";
  const hasLive = Boolean(liveChamp);
  const followLive = followLivePref() && hasLive;

  let meChamp = followLive ? liveChamp : (savedChamp() || liveChamp || "");
  let position = followLive ? (livePos || savedRole()) : (savedRole() || (meChamp === liveChamp ? livePos : "") || "");

  // Keep saved pick in sync when following live so the dropdown shows the right champ.
  if (followLive && liveChamp) {
    localStorage.setItem(PICK_CHAMP_KEY, liveChamp);
    if (livePos) localStorage.setItem(PICK_ROLE_KEY, livePos);
  }

  // If catalog loaded and saved name is stale, clear it.
  const catalog = allChampions();
  if (meChamp && catalog.length && !catalog.includes(meChamp) && meChamp !== liveChamp) {
    meChamp = liveChamp || "";
  }

  return { meChamp, position, liveChamp, followLive, hasLive };
}

export function renderBuilds(data, container) {
  const pick = resolvePick(data);
  const { meChamp, position } = pick;
  const picker = renderPicker(pick);

  if (!meChamp) {
    container.innerHTML = `${picker}
      <p class="muted">No champion selected yet. Choose one above to see a starter + shopping list
        (works before you enter a game).</p>`;
    wirePicker(container, data);
    return;
  }

  const archKey = pickArchetype(meChamp, position);
  const core = META_CORES[archKey];
  const coreItems = livingItems(core.items);
  const starterId = livingItems([pickStarter(archKey, position)])[0] || null;

  const sameAsLive = Boolean(data?.me && data.me.champion === meChamp);
  const owned = sameAsLive ? ownedIdSet(data) : new Set();
  const me = sameAsLive ? myPlayer(data) : null;
  const enemies = sameAsLive ? (data.enemies || []) : [];
  const picks = situationalPicks(meChamp, position, enemies);
  const plan = buildShoppingPlan(coreItems, owned, picks);
  const planIds = new Set(plan.map((s) => String(s.id)));

  const ownedCount = plan.filter((s) => s.state === "owned").length;
  const swapCount = plan.filter((s) => s.kind === "swap").length;
  const roleTag = position
    ? `<span class="tag">${esc(position)}</span>`
    : `<span class="tag">Auto role</span>`;

  const metaBlock = `<div class="build-section meta-core">
    <div class="build-head">
      <img class="mini-champ" src="${champIconUrl(meChamp)}" alt=""
           onerror="this.style.visibility='hidden'" />
      <span class="build-title">Shopping list · ${esc(core.label)}</span>
      ${roleTag}
      ${swapCount ? `<span class="tag swap-tag">${swapCount} situational</span>` : ""}
      ${sameAsLive
        ? `<span class="tag">${ownedCount}/${plan.length} owned</span>`
        : `<span class="tag">preview</span>`}
    </div>
    <p class="muted">${sameAsLive
      ? "Updates every live poll from your inventory and what enemies buy."
      : "Preview build — inventory sync and lobby counters kick in when you play this champ."}
      <span class="legend"><i class="dot owned"></i>owned</span>
      <span class="legend"><i class="dot progress"></i>building</span>
      <span class="legend"><i class="dot next"></i>buy next</span>
      <span class="legend"><i class="dot swapped"></i>situational swap</span>
    </p>
    ${starterRow(starterId, owned)}
    ${sameAsLive ? inventoryStrip(me) : ""}
    ${coreItems.length
      ? `<div class="items build-items plan-items">${planStrip(plan)}</div>${swapNotes(plan)}`
      : '<p class="muted">Item data still loading…</p>'}
  </div>`;

  const orderBlock = plan.length || starterId ? renderOrder(plan, starterId, owned) : "";

  const alts = alternativesHtml(meChamp, position, enemies, planIds);
  const vs = enemies.length ? champStrip(enemies.map((e) => e.champion)) : "";
  let altBlock = "";
  if (enemies.length) {
    altBlock = alts.length
      ? `<h3>More options vs this lobby</h3>
         <p class="muted">Extra counters not already slotted into your shopping list.</p>
         <div class="build-vs"><span class="muted">Against:</span> ${vs}</div>
         ${alts.join("")}`
      : `<h3>More options vs this lobby</h3>
         <p class="muted">${swapCount
           ? "Situational picks are already in your shopping list — stick to it unless the lobby shifts."
           : "Balanced lobby so far — stick to the list and react if someone gets fed or stacks resists."}</p>
         <div class="build-vs"><span class="muted">Against:</span> ${vs}</div>`;
  } else {
    altBlock = `<h3>Lobby counters</h3>
      <p class="muted">Situational swaps show up once you're in a game on this champion
        (or browsing your last-game champ).</p>`;
  }

  container.innerHTML = picker + metaBlock + orderBlock + altBlock;
  wirePicker(container, data);
  wireOrderToggle(container);
}
