// Jungle / objective schedule as a bottom-right pull-up dock (Live companion).
// Uses live game_time only — Live Client does not reliably report camp kills,
// so this is a typical spawn/respawn schedule, not tracked clear times.
//
// Assumptions (Summoner's Rift, standard SR timings as of mid-2025 / 2026):
// - Blue / Red: first 1:30, respawn every 5:00
// - Gromp / Wolves / Raptors / Krugs: first 1:30, respawn every 2:15
// - Dragon: first 5:00, respawn every 5:00 (Elder / soul not modeled separately)
// - Voidgrubs: first 6:00, once, despawn ~14:45
// - Rift Herald: first 15:00, once, despawn ~19:45
// - Baron: first 20:00, respawn every 6:00
// Marker % positions are approximate on Community Dragon's map11 minimap.

import { gameClock } from "./render.js";

const UP_GRACE_SEC = 20;
const SOON_SEC = 30;
const STORAGE_KEY = "camps-dock-open";

const CDRAGON = "https://raw.communitydragon.org/latest";
const MAP_IMG = `${CDRAGON}/game/assets/maps/info/map11/2dlevelminimap_base_baron1.png`;
const ICON = `${CDRAGON}/game/assets/ux/minimap/icons`;

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   group: "buff" | "camp" | "epic",
 *   first: number,
 *   respawn?: number | null,
 *   despawn?: number | null,
 *   icon: string,
 * }} CampDef
 */

/** @type {Record<string, CampDef>} */
const CAMP_BY_ID = {
  blue: { id: "blue", name: "Blue buff", group: "buff", first: 90, respawn: 300, icon: `${ICON}/blue.png` },
  red: { id: "red", name: "Red buff", group: "buff", first: 90, respawn: 300, icon: `${ICON}/red.png` },
  gromp: { id: "gromp", name: "Gromp", group: "camp", first: 90, respawn: 135, icon: `${ICON}/smallcamp.png` },
  wolves: { id: "wolves", name: "Wolves", group: "camp", first: 90, respawn: 135, icon: `${ICON}/smallcamp.png` },
  raptors: { id: "raptors", name: "Raptors", group: "camp", first: 90, respawn: 135, icon: `${ICON}/smallcamp.png` },
  krugs: { id: "krugs", name: "Krugs", group: "camp", first: 90, respawn: 135, icon: `${ICON}/smallcamp.png` },
  dragon: { id: "dragon", name: "Dragon", group: "epic", first: 300, respawn: 300, icon: `${ICON}/dragon.png` },
  grubs: { id: "grubs", name: "Voidgrubs", group: "epic", first: 360, respawn: null, despawn: 885, icon: `${ICON}/grub.png` },
  herald: { id: "herald", name: "Herald", group: "epic", first: 900, respawn: null, despawn: 1185, icon: `${ICON}/riftherald.png` },
  baron: { id: "baron", name: "Baron", group: "epic", first: 1200, respawn: 360, icon: `${ICON}/baron.png` },
};

/**
 * Map pins: x/y are % from top-left of the minimap (blue base bottom-left).
 * Top pit (grubs → herald → baron) is one pin; which camp shows depends on game time.
 * @type {{ campId: string, x: number, y: number, short: string, pit?: boolean }[]}
 */
const MARKERS = [
  { campId: "blue", x: 21, y: 54, short: "Blue" },
  { campId: "gromp", x: 12, y: 48, short: "Gromp" },
  { campId: "wolves", x: 29, y: 46, short: "Wolves" },
  { campId: "raptors", x: 38, y: 58, short: "Raptors" },
  { campId: "red", x: 37, y: 68, short: "Red" },
  { campId: "krugs", x: 47, y: 76, short: "Krugs" },
  { campId: "blue", x: 79, y: 46, short: "Blue" },
  { campId: "gromp", x: 88, y: 52, short: "Gromp" },
  { campId: "wolves", x: 71, y: 54, short: "Wolves" },
  { campId: "raptors", x: 62, y: 42, short: "Raptors" },
  { campId: "red", x: 63, y: 32, short: "Red" },
  { campId: "krugs", x: 53, y: 24, short: "Krugs" },
  { campId: "dragon", x: 58, y: 68, short: "Drake" },
  { campId: "baron", x: 42, y: 32, short: "Pit", pit: true },
];

/** @type {HTMLElement | null} */
let dockEl = null;
/** @type {HTMLElement | null} */
let bodyEl = null;
/** @type {HTMLButtonElement | null} */
let toggleBtn = null;

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/"/g, "&quot;")
    .replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * @param {number} gameTime
 * @param {CampDef} camp
 */
export function campState(gameTime, camp) {
  const t = Math.max(0, Number(gameTime) || 0);
  const first = camp.first;
  const respawn = camp.respawn;
  const despawn = camp.despawn;

  if (t < first) {
    return { status: "waiting", eta: first - t, note: "first spawn" };
  }

  if (respawn == null) {
    if (despawn != null && t >= despawn) {
      return { status: "gone", eta: 0, note: "window closed" };
    }
    return { status: "up", eta: 0, note: "spawn window" };
  }

  const since = (t - first) % respawn;
  if (since < UP_GRACE_SEC) {
    return { status: "up", eta: 0, note: "typical spawn" };
  }
  return { status: "waiting", eta: respawn - since, note: "typical respawn" };
}

function pitCamp(gameTime) {
  const t = Math.max(0, Number(gameTime) || 0);
  if (t < 885) return CAMP_BY_ID.grubs;
  if (t < 1200) return CAMP_BY_ID.herald;
  return CAMP_BY_ID.baron;
}

function etaLabel(eta) {
  if (eta <= 0) return "now";
  return gameClock(eta);
}

function markerHtml(marker, gameTime) {
  const camp = marker.pit ? pitCamp(gameTime) : CAMP_BY_ID[marker.campId];
  if (!camp) return "";

  const state = campState(gameTime, camp);
  const urgent = state.status === "waiting" && state.eta > 0 && state.eta <= SOON_SEC;

  let timeText;
  if (state.status === "up") timeText = "Up";
  else if (state.status === "gone") timeText = "—";
  else timeText = etaLabel(state.eta);

  const short = marker.pit ? camp.name.replace("Voidgrubs", "Grubs") : marker.short;
  const cls = [
    "camp-pin",
    `camp-${camp.group}`,
    state.status,
    urgent ? "soon" : "",
  ].filter(Boolean).join(" ");

  const title = `${camp.name} — ${state.note} (schedule, not tracked clears)`;

  return `<button type="button" class="${cls}" style="left:${marker.x}%;top:${marker.y}%"
            title="${esc(title)}" aria-label="${esc(title)}">
    <img class="camp-pin-icon" src="${esc(camp.icon)}" alt="" loading="lazy" width="22" height="22" />
    <span class="camp-pin-eta">${esc(timeText)}</span>
    <span class="camp-pin-name">${esc(short)}</span>
  </button>`;
}

function isOpen() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function setOpen(open) {
  try {
    localStorage.setItem(STORAGE_KEY, open ? "1" : "0");
  } catch { /* ignore */ }
  if (!dockEl || !toggleBtn) return;
  dockEl.classList.toggle("open", open);
  toggleBtn.setAttribute("aria-expanded", open ? "true" : "false");
  const arrow = toggleBtn.querySelector(".camps-dock-arrow");
  if (arrow) arrow.textContent = open ? "▼" : "▲";
  toggleBtn.title = open ? "Hide camp map" : "Show camp map";
}

/** Build the fixed bottom-right dock once (like champ hover). */
export function initCampsDock() {
  if (dockEl) return bodyEl;

  const dock = document.createElement("div");
  dock.id = "camps-dock";
  dock.className = "camps-dock hidden";
  dock.innerHTML = `
    <button type="button" class="camps-dock-tab" id="camps-dock-toggle"
            aria-expanded="false" aria-controls="camps" title="Show camp map">
      <span class="camps-dock-arrow" aria-hidden="true">▲</span>
      <span class="camps-dock-label">Camps</span>
      <span class="camps-dock-clock" id="camps-dock-clock"></span>
    </button>
    <div id="camps" class="camps-dock-body" role="region" aria-label="Camp schedule map"></div>
  `;
  document.body.appendChild(dock);

  dockEl = dock;
  bodyEl = dock.querySelector("#camps");
  toggleBtn = dock.querySelector("#camps-dock-toggle");
  toggleBtn?.addEventListener("click", () => setOpen(!dock.classList.contains("open")));
  setOpen(isOpen());
  return bodyEl;
}

export function campsContainer() {
  return bodyEl || document.getElementById("camps");
}

/**
 * Update dock map from live / last-game payload. Hides dock when no game clock.
 * @param {{ game_time?: number } | null} data
 * @param {HTMLElement | null} [_container] ignored — dock owns its body
 */
export function renderCamps(data, _container) {
  if (!dockEl || !bodyEl) initCampsDock();
  if (!dockEl || !bodyEl) return;

  if (!data || data.game_time == null) {
    dockEl.classList.add("hidden");
    bodyEl.innerHTML = "";
    return;
  }

  const t = Number(data.game_time) || 0;
  const pins = MARKERS.map((m) => markerHtml(m, t)).join("");
  const clock = gameClock(t);

  dockEl.classList.remove("hidden");
  const clockEl = dockEl.querySelector("#camps-dock-clock");
  if (clockEl) clockEl.textContent = clock;

  bodyEl.innerHTML =
    `<div class="camps-panel">
       <div class="camps-head">
         <div>
           <div class="camps-title">Camp schedule</div>
           <p class="muted camps-note">Typical spawn / respawn from the game clock —
             not tracked kills.</p>
         </div>
         <div class="camps-clock" title="Live game time">${clock}</div>
       </div>
       <div class="camps-map-wrap">
         <div class="camps-map" style="background-image:url('${MAP_IMG}')">
           ${pins}
         </div>
       </div>
     </div>`;
}
