// Post-game report: grades, you vs laner graphs, objectives, final items + buy order.
import { champIconUrl, itemIconUrl } from "./items.js";

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/"/g, "&quot;")
    .replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function gameClock(seconds) {
  const m = Math.floor((seconds || 0) / 60);
  const s = Math.floor((seconds || 0) % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function fmt(v, unit = "") {
  if (v == null) return "—";
  if (unit === "%") return `${v}%`;
  if (unit === "/m") return `${v}/m`;
  return String(v);
}

function unitForKey(key) {
  if (key.includes("participation") || key.includes("share") || key.includes("kp") || key.includes("dmg")) {
    return "%";
  }
  if (key.includes("per_min") || key === "cs_per_min" || key === "vision_per_min") return "/m";
  return "";
}

function gradeChip(g) {
  if (!g) return "";
  return `<div class="habit-bubble ${g.grade}" title="Baseline ${g.baseline}${g.unit || ""}">
    <span class="habit-grade">${esc(g.grade)}</span>
    <span class="habit-value">${fmt(g.value, g.unit)}</span>
    <span class="habit-label">${esc(g.label)}</span>
  </div>`;
}

function itemStrip(items) {
  if (!items?.length) return '<span class="muted">No items</span>';
  return `<div class="items build-items">${items.map((it) =>
    `<img src="${itemIconUrl(it.id)}" alt="" data-item-id="${it.id}"
          onerror="this.style.visibility='hidden'" />`).join("")}</div>`;
}

function buyOrder(steps) {
  if (!steps?.length) return '<p class="muted">Buy order not available for this match.</p>';
  return `<div class="buy-order">
    ${steps.map((s) =>
      `<div class="buy-step" title="${gameClock(s.time_s)}">
         <img src="${itemIconUrl(s.id)}" alt="" data-item-id="${s.id}"
              onerror="this.style.visibility='hidden'" />
         <span class="muted">${gameClock(s.time_s)}</span>
       </div>`).join("")}
  </div>`;
}

function sideCard(label, p, { lane = false } = {}) {
  if (!p) {
    return `<div class="pg-side"><p class="muted">No opponent found.</p></div>`;
  }
  const grades = Object.values(p.grades || {}).map(gradeChip).join("");
  return `<div class="pg-side">
    <div class="pg-side-head">
      <img src="${champIconUrl(p.champion)}" alt="" />
      <div>
        <div class="name">${esc(label)} · ${esc(p.champion)}</div>
        <div class="sub">${esc(p.riot_id)}${p.position ? ` · ${esc(p.position)}` : ""}
          ${lane ? '<span class="tag">LANE</span>' : ""}</div>
        <div class="sub"><b>${p.kills}</b>/<span class="d">${p.deaths}</span>/${p.assists}
          · ${p.cs} cs · ${p.vision_score} vision · ${(p.gold || 0).toLocaleString()}g</div>
      </div>
    </div>
    <div class="pg-obj muted">
      Turrets ${p.turret_takedowns ?? p.turret_kills ?? 0}
      · Inhibs ${p.inhibitor_kills ?? 0}
      · Dragons ${p.dragon_kills ?? 0}
      · Barons ${p.baron_kills ?? 0}
      · Wards ${p.wards_placed ?? 0}/${p.wards_killed ?? 0}
    </div>
    <div class="habit-bubbles">${grades}</div>
    <div class="hover-section-label">Final items</div>
    ${itemStrip(p.items)}
    <div class="hover-section-label">Buy order</div>
    ${buyOrder(p.build_order)}
  </div>`;
}

/** Dual horizontal bars: you vs opponent. */
function vsOpponentChart(rows) {
  if (!rows?.length) return "";
  const max = Math.max(1, ...rows.map((r) => Math.max(Number(r.me) || 0, Number(r.foe) || 0)));
  const bars = rows.map((r) => {
    const me = Number(r.me) || 0;
    const foe = Number(r.foe) || 0;
    const unit = unitForKey(r.key || "");
    const mePct = Math.round((me / max) * 100);
    const foPct = Math.round((foe / max) * 100);
    const meWin = r.winner === "me";
    const foWin = r.winner === "foe";
    return `<div class="pg-bar-row">
      <div class="pg-bar-label">${esc(r.label)}</div>
      <div class="pg-bar-tracks">
        <div class="pg-bar-track">
          <span class="pg-bar-who">You</span>
          <div class="pg-bar-fill me ${meWin ? "ahead" : ""}" style="width:${mePct}%"></div>
          <span class="pg-bar-num ${meWin ? "good" : foWin ? "bad" : ""}">${fmt(r.me, unit)}</span>
        </div>
        <div class="pg-bar-track">
          <span class="pg-bar-who">Them</span>
          <div class="pg-bar-fill foe ${foWin ? "ahead" : ""}" style="width:${foPct}%"></div>
          <span class="pg-bar-num ${foWin ? "good" : meWin ? "bad" : ""}">${r.foe == null ? "—" : fmt(r.foe, unit)}</span>
        </div>
      </div>
    </div>`;
  }).join("");

  return `<div class="pg-charts">
    <div class="hover-section-label">After-match graphs · you vs opponent</div>
    <div class="pg-bar-chart">${bars}</div>
  </div>`;
}

/** Bars for this game vs your personal champ average. */
function vsAvgChart(rows, games) {
  if (!rows?.length) return "";
  const max = Math.max(
    1,
    ...rows.flatMap((r) => [Math.abs(Number(r.value) || 0), Math.abs(Number(r.avg) || 0)]),
  );
  const bars = rows.map((r) => {
    const val = Number(r.value) || 0;
    const avg = Number(r.avg) || 0;
    const unit = unitForKey(r.key || "");
    const vPct = Math.round((Math.abs(val) / max) * 100);
    const aPct = Math.round((Math.abs(avg) / max) * 100);
    const sign = r.delta > 0 ? "+" : "";
    return `<div class="pg-bar-row">
      <div class="pg-bar-label">${esc(r.label)}
        <span class="pg-delta ${r.grade}">${sign}${r.delta}</span>
      </div>
      <div class="pg-bar-tracks">
        <div class="pg-bar-track">
          <span class="pg-bar-who">Game</span>
          <div class="pg-bar-fill me ${r.grade}" style="width:${vPct}%"></div>
          <span class="pg-bar-num">${fmt(r.value, unit)}</span>
        </div>
        <div class="pg-bar-track">
          <span class="pg-bar-who">Avg</span>
          <div class="pg-bar-fill avg" style="width:${aPct}%"></div>
          <span class="pg-bar-num muted">${fmt(r.avg, unit)}</span>
        </div>
      </div>
    </div>`;
  }).join("");

  return `<div class="pg-charts pg-vs-avg">
    <div class="hover-section-label">Vs your ${games}-game average on this champ</div>
    <div class="pg-bar-chart">${bars}</div>
  </div>`;
}

function compareTable(rows) {
  if (!rows?.length) return "";
  return `<div class="pg-compare">
    <div class="hover-section-label">You vs opponent (table)</div>
    <table class="pg-table">
      <tr><th>Stat</th><th>You</th><th>Them</th></tr>
      ${rows.map((r) => {
        const meCls = r.winner === "me" ? "good" : r.winner === "foe" ? "bad" : "";
        const foCls = r.winner === "foe" ? "good" : r.winner === "me" ? "bad" : "";
        const unit = unitForKey(r.key || "");
        return `<tr>
          <td>${esc(r.label)}</td>
          <td class="${meCls}">${fmt(r.me, unit)}</td>
          <td class="${foCls}">${r.foe == null ? "—" : fmt(r.foe, unit)}</td>
        </tr>`;
      }).join("")}
    </table>
  </div>`;
}

/** Render post-game report into a container. */
export function renderPostgame(data, container) {
  if (!container) return;
  if (!data || !data.ready) {
    container.innerHTML = `<div class="pg-card">
      <h3>Post-game</h3>
      <p class="muted">${esc(data?.note || data?.error || "Sync a match to unlock the post-game report.")}</p>
    </div>`;
    return;
  }

  const me = data.me;
  const foe = data.opponent;
  const resultCls = data.result === "Win" ? "good" : "bad";
  const focus = (data.focus || []).map(gradeChip).join("");

  container.innerHTML = `<div class="pg-card">
    <div class="pg-head">
      <div>
        <h3>Post-game · <span class="${resultCls}">${esc(data.result)}</span></h3>
        <p class="muted">${esc(data.queue)} · ${gameClock(data.duration)}
          · ${esc(me?.champion || "")}${me?.position ? ` ${esc(me.position)}` : ""}</p>
      </div>
    </div>
    ${data.warning ? `<p class="error matches-warning">${esc(data.warning)}</p>` : ""}
    ${focus
      ? `<div class="perf-focus">
           <div class="hover-section-label">What went poorly</div>
           <p class="muted">Below soft role baseline this game — focus these next time.</p>
           <div class="habit-bubbles">${focus}</div>
         </div>`
      : `<p class="muted">No weak grades vs role baseline this game.</p>`}
    ${vsOpponentChart(data.compare)}
    ${vsAvgChart(data.vs_champ_avg, data.champ_avg_games)}
    ${compareTable(data.compare)}
    <div class="pg-grid">
      ${sideCard("You", me)}
      ${sideCard(foe?.is_lane_opponent ? "Lane opponent" : "Opponent", foe, {
        lane: !!foe?.is_lane_opponent,
      })}
    </div>
  </div>`;
}
