// Thin wrapper over fetch: all backend calls go through here.
function formatDetail(detail, fallback) {
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const parts = detail.map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item.msg === "string") return item.msg;
      return "";
    }).filter(Boolean);
    if (parts.length) return parts.join("; ");
  }
  return fallback;
}

export async function api(path, opts = {}) {
  let resp;
  try {
    resp = await fetch(path, { cache: "no-store", ...opts });
  } catch (e) {
    const msg = e && e.message ? String(e.message) : "network error";
    if (/failed to fetch|networkerror|load failed/i.test(msg)) {
      throw new Error(
        "Can't reach the local helper on port 8000. Is the launcher still running?"
      );
    }
    throw e instanceof Error ? e : new Error(msg);
  }
  let body = null;
  try {
    body = await resp.json();
  } catch {
    body = null;
  }
  if (!resp.ok) {
    throw new Error(formatDetail(body?.detail, resp.statusText || `HTTP ${resp.status}`));
  }
  return body;
}

export function post(path, data) {
  return api(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

/**
 * Read an NDJSON StreamingResponse. Calls `onEvent` for each parsed line.
 * Throws on HTTP error JSON or a stream `{ type: "error", detail }` event.
 */
export async function streamNdjson(path, onEvent, opts = {}) {
  const resp = await fetch(path, { cache: "no-store", ...opts });
  if (!resp.ok) {
    let detail = resp.statusText;
    try {
      const body = await resp.json();
      detail = body.detail || detail;
    } catch { /* not JSON */ }
    throw new Error(detail);
  }
  if (!resp.body) throw new Error("No response body to stream.");

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let ev;
      try { ev = JSON.parse(line); }
      catch { continue; }
      if (ev.type === "error") throw new Error(ev.detail || "Request failed.");
      onEvent(ev);
    }
  }
  const tail = buf.trim();
  if (tail) {
    try {
      const ev = JSON.parse(tail);
      if (ev.type === "error") throw new Error(ev.detail || "Request failed.");
      onEvent(ev);
    } catch (e) {
      if (e instanceof Error && e.message !== "Request failed." && !e.message.includes("JSON")) {
        // rethrow our error events only; ignore trailing parse junk
        if (e.message && !e.message.startsWith("Unexpected")) throw e;
      } else if (e instanceof Error && e.message !== "Unexpected end of JSON input") {
        throw e;
      }
    }
  }
}

/** Simple determinate progress bar markup. */
export function progressBarHtml(label, done, total) {
  const safeTotal = Math.max(0, Number(total) || 0);
  const safeDone = Math.max(0, Math.min(safeTotal || Number(done) || 0, safeTotal || Number(done) || 0));
  const pct = safeTotal > 0 ? Math.round((100 * safeDone) / safeTotal) : 0;
  const count = safeTotal > 0 ? `${safeDone} / ${safeTotal}` : `${safeDone}`;
  return `<div class="load-progress" role="progressbar" aria-valuemin="0"
              aria-valuemax="${safeTotal || 100}" aria-valuenow="${safeDone}"
              aria-label="${label}">
    <div class="load-progress-label"><span>${label}</span><span class="load-progress-count">${count}</span></div>
    <div class="load-progress-track"><div class="load-progress-fill" style="width:${pct}%"></div></div>
  </div>`;
}
