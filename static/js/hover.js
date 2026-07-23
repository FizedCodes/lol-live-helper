// Champion hover panel: tip slider + combat stats (live for you, items for others).
// Any element with data-champ-hover (JSON payload) opens the shared panel.

import {
  getChampion, combatProfile, combatLines, itemGold, champIconUrl, itemIconUrl,
} from "./items.js";

const HEALERS = new Set([
  "Aatrox", "Dr. Mundo", "Illaoi", "Kayn", "Maokai", "Nami", "Senna", "Seraphine",
  "Sona", "Soraka", "Swain", "Sylas", "Vladimir", "Warwick", "Yuumi", "Zac", "Briar",
]);

function tipsFor(player, ctx) {
  const tips = [];
  const champ = getChampion(player.champion);
  const tags = champ?.tags || [];
  const sc = player.scores || {};
  const items = player.items || [];
  const gold = items.reduce((s, it) => s + itemGold(it.id) * (it.count || 1), 0);

  if (player.is_me) {
    tips.push(player.live_stats
      ? "That's you — chips use live client totals (including ability haste)."
      : "That's you — hover enemies for fight tips and item-powered stats.");
  }
  if (player.is_lane_opponent) {
    tips.push("Your direct lane opponent. Track CS and item spikes before all-ining.");
  }
  if (player.verdict) {
    tips.push(`${player.verdict.label}: ${player.verdict.note}`);
  }
  if (player.is_dead) {
    tips.push("Currently dead — use the window to shove, take plates, or invade.");
  }
  if (tags.includes("Assassin")) {
    tips.push("Assassin: respect fog of war and keep vision on side brushes.");
  }
  if (tags.includes("Tank") || (champ && champ.info.defense >= 8)) {
    tips.push("Tanky frontline — bring % health or pen; don't facetank forever.");
  }
  if (HEALERS.has(player.champion)) {
    tips.push("Heals a lot — Grievous Wounds (Executioner's / Morello) cuts them hard.");
  }
  if (sc.kills >= 5 && sc.kills > sc.deaths + 2) {
    tips.push("Fed — avoid 1v1s unless you have a clear item or number advantage.");
  }
  if (sc.deaths >= 5 && sc.deaths > sc.kills + 2) {
    tips.push("Tilting / behind — look for picks when they're caught alone.");
  }
  if (gold >= 8000) {
    tips.push(`Heavy item lead (~${gold.toLocaleString()}g in items) — their spike is online.`);
  } else if (items.length <= 1 && (ctx?.game_time || 0) > 600) {
    tips.push("Behind on items — punish before they complete their next legendary.");
  }
  if (tags.includes("Marksman") || player.position === "BOTTOM") {
    tips.push("Squishy carry — dive with CC or flank; don't walk up without vision.");
  }
  if (!tips.length) {
    tips.push(`${player.champion} — watch their item spikes and play around cooldowns.`);
  }
  return tips;
}

function combatStatsHtml(player) {
  const profile = combatProfile(player);
  const lines = combatLines(profile);
  if (!lines.length) return '<p class="muted">No combat stats yet.</p>';
  return `<div class="hover-stats">${lines.map((l) => `<span>${l}</span>`).join("")}</div>`;
}

function itemsHtml(items) {
  if (!items?.length) return '<p class="muted">No items.</p>';
  const sorted = [...items].sort((a, b) => a.slot - b.slot);
  return `<div class="items">${sorted.map((it) =>
    `<img src="${itemIconUrl(it.id)}" alt="" data-item-id="${it.id}"
          onerror="this.style.visibility='hidden'" />`).join("")}</div>`;
}

export function initChampHover() {
  const panel = document.createElement("div");
  panel.id = "champ-hover";
  panel.className = "hidden";
  document.body.appendChild(panel);

  let tipIndex = 0;
  let tips = [];
  let hideTimer = null;
  let slideTimer = null;

  const place = (e) => {
    const pad = 16;
    let x = e.clientX + pad;
    let y = e.clientY + pad;
    const r = panel.getBoundingClientRect();
    if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - pad;
    if (y + r.height > window.innerHeight - 8) y = e.clientY - r.height - pad;
    panel.style.left = `${Math.max(8, x)}px`;
    panel.style.top = `${Math.max(8, y)}px`;
  };

  const renderTip = () => {
    const tipEl = panel.querySelector(".tip-slide");
    const dots = panel.querySelectorAll(".tip-dot");
    if (!tipEl || !tips.length) return;
    tipEl.classList.remove("tip-in");
    // Force reflow so the animation restarts.
    void tipEl.offsetWidth;
    tipEl.textContent = tips[tipIndex];
    tipEl.classList.add("tip-in");
    dots.forEach((d, i) => d.classList.toggle("active", i === tipIndex));
  };

  const startSlider = () => {
    clearInterval(slideTimer);
    if (tips.length < 2) return;
    slideTimer = setInterval(() => {
      tipIndex = (tipIndex + 1) % tips.length;
      renderTip();
    }, 3200);
  };

  const show = (el, e) => {
    clearTimeout(hideTimer);
    let payload;
    try { payload = JSON.parse(el.dataset.champHover); }
    catch { return; }

    tips = tipsFor(payload.player, payload.ctx);
    tipIndex = 0;
    const sc = payload.player.scores || {};
    const gold = (payload.player.items || [])
      .reduce((s, it) => s + itemGold(it.id) * (it.count || 1), 0);

    const profile = combatProfile(payload.player);
    const statsLabel = profile.source === "live"
      ? "Live combat stats"
      : "Stats from items";
    const lvl = payload.player.level || profile.level;

    panel.innerHTML = `
      <div class="hover-head">
        <img src="${champIconUrl(payload.player.champion)}" alt="" />
        <div>
          <div class="hover-name">${payload.player.champion}</div>
          <div class="muted">${payload.player.riot_id || ""}
            ${payload.player.position ? ` · ${payload.player.position}` : ""}
            ${lvl ? ` · Lv ${lvl}` : ""}</div>
        </div>
      </div>
      <div class="hover-kda">
        <b>${sc.kills || 0}</b>/<span class="d">${sc.deaths || 0}</span>/${sc.assists || 0}
        <span class="muted">· ${sc.cs || 0} cs · ${gold.toLocaleString()}g items</span>
      </div>
      <div class="tip-track">
        <div class="tip-slide tip-in"></div>
        <div class="tip-dots">${tips.map((_, i) =>
          `<button type="button" class="tip-dot ${i === 0 ? "active" : ""}" data-i="${i}"></button>`
        ).join("")}</div>
      </div>
      <div class="hover-section-label">${statsLabel}</div>
      ${combatStatsHtml(payload.player)}
      <div class="hover-section-label">Items</div>
      ${itemsHtml(payload.player.items)}
    `;
    panel.classList.remove("hidden");
    renderTip();
    startSlider();
    place(e);

    panel.querySelectorAll(".tip-dot").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        tipIndex = Number(btn.dataset.i);
        renderTip();
        startSlider();
      });
    });
  };

  const scheduleHide = () => {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      panel.classList.add("hidden");
      clearInterval(slideTimer);
    }, 180);
  };

  document.addEventListener("mouseover", (e) => {
    const el = e.target.closest?.("[data-champ-hover]");
    if (el) show(el, e);
    if (e.target.closest?.("#champ-hover")) clearTimeout(hideTimer);
  });
  document.addEventListener("mousemove", (e) => {
    if (!panel.classList.contains("hidden") && e.target.closest?.("[data-champ-hover]")) place(e);
  });
  document.addEventListener("mouseout", (e) => {
    const leavingChamp = e.target.closest?.("[data-champ-hover]");
    const leavingPanel = e.target.closest?.("#champ-hover");
    if (!leavingChamp && !leavingPanel) return;
    const to = e.relatedTarget;
    if (to?.closest?.("[data-champ-hover]") || to?.closest?.("#champ-hover")) return;
    scheduleHide();
  });
}
