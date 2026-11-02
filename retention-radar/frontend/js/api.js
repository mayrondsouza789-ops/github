// Thin fetch wrapper. Token lives in sessionStorage when available, else memory.
let memToken = null;
export const tokenStore = {
  get() { try { return sessionStorage.getItem("rr_token") || memToken; } catch { return memToken; } },
  set(t) { memToken = t; try { sessionStorage.setItem("rr_token", t); } catch { /* storage blocked */ } },
  clear() { memToken = null; try { sessionStorage.removeItem("rr_token"); } catch { /* ignore */ } },
};
export class ApiError extends Error { constructor(msg, status) { super(msg); this.status = status; } }
let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

async function request(method, path, body) {
  const headers = {};
  const t = tokenStore.get();
  if (t) headers.Authorization = `Bearer ${t}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let res;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError("We could not reach the server. Check your connection and try again", 0);
  }
  if (res.status === 401 && path !== "/auth/login") { onUnauthorized(); throw new ApiError("Your session ended. Sign in again to continue", 401); }
  let data = null;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("json")) data = await res.json();
  if (!res.ok) {
    const d = data && data.detail;
    throw new ApiError(typeof d === "string" ? d : "Something went wrong. Try again", res.status);
  }
  return data;
}
export const api = {
  get: (p) => request("GET", p),
  post: (p, b) => request("POST", p, b ?? {}),
  patch: (p, b) => request("PATCH", p, b),
  put: (p, b) => request("PUT", p, b),
  async download(path, filename) {
    const t = tokenStore.get();
    const res = await fetch(`/api${path}`, { headers: t ? { Authorization: `Bearer ${t}` } : {} });
    if (!res.ok) throw new ApiError("The export failed. Try again", res.status);
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },
};
