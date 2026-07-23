// Data Dragon data: game version, the full item catalog, icon URLs, and the
// shared item hover tooltip. Everything here comes from Riot's free CDN
// (no API key), fetched once per page load.

let version = "14.14.1"; // fallback if the version lookup fails
let itemData = {};       // item id (string) -> entry from item.json
let champByName = {};    // display name ("Wukong") -> entry from champion.json

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
})();

export function ddVersion() { return version; }
export function allItems() { return itemData; }
export function getItem(id) { return itemData[String(id)] || null; }

// Champion catalog entry (info scores, tags) by display name from the live client.
export function getChampion(name) { return champByName[name] || null; }

export function itemGold(id) {
  const it = getItem(id);
  return it && it.gold ? it.gold.total : 0;
}

export function itemIconUrl(id) {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/item/${id}.png`;
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
    const it = getItem(el.dataset.itemId);
    if (!it) return;
    tip.replaceChildren(
      line("tip-name", it.name),
      line("tip-gold", `${it.gold.total} gold`),
      line("tip-desc", plainDescription(it.description)),
    );
    tip.classList.remove("hidden");
    move(e);
  });
  document.addEventListener("mousemove", move);
  document.addEventListener("mouseout", (e) => {
    if (e.target.closest && e.target.closest("[data-item-id]")) tip.classList.add("hidden");
  });
}
