// Thin wrapper over fetch: all backend calls go through here.
export async function api(path, opts) {
  const resp = await fetch(path, opts);
  const body = await resp.json();
  if (!resp.ok) throw new Error(body.detail || resp.statusText);
  return body;
}

export function post(path, data) {
  return api(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}
