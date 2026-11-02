// Formatting, escaping and the icon set. Icons are simple 24px monochrome strokes.
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const P = {
  overview: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  customers: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.4c2.2.7 3.5 2.5 3.5 5.6"/>',
  churn: '<path d="M3 17l5-5 4 4 8-9"/><path d="M15 7h5v5"/>',
  segments: '<path d="M12 3v9h9"/><path d="M20.5 15A9 9 0 1 1 9 3.5"/>',
  campaigns: '<path d="M3 11v3a1 1 0 0 0 1 1h3l6 4V6L7 10H4a1 1 0 0 0-1 1z"/><path d="M17 8.5a5 5 0 0 1 0 7"/>',
  cohorts: '<rect x="3" y="3" width="5" height="5"/><rect x="10" y="3" width="5" height="5"/><rect x="17" y="3" width="4" height="5"/><rect x="3" y="10" width="5" height="5"/><rect x="10" y="10" width="5" height="5"/><rect x="3" y="17" width="5" height="4"/>',
  products: '<path d="M3 7l9-4 9 4-9 4z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M12 11v10"/>',
  interventions: '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/>',
  reports: '<path d="M7 3h8l4 4v14H7z"/><path d="M15 3v4h4M10 12h6M10 16h6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  download: '<path d="M12 4v11"/><path d="M7 11l5 5 5-5"/><path d="M5 20h14"/>',
  collapse: '<path d="M15 6l-6 6 6 6"/>',
  expand: '<path d="M9 6l6 6-6 6"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
  up: '<path d="M7 14l5-5 5 5"/>', down: '<path d="M7 10l5 5 5-5"/>', sort: '<path d="M8 9l4-4 4 4M8 15l4 4 4-4"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>',
  empty: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M8 11h6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  chevleft: '<path d="M15 6l-6 6 6 6"/>', chevright: '<path d="M9 6l6 6-6 6"/>',
};
export const icon = (name, cls = "") => `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${P[name] || ""}</svg>`;

const nf = new Intl.NumberFormat("en-IN");
export const int = (v) => (v == null ? "n/a" : nf.format(Math.round(v)));
export const pct = (v, d = 1) => (v == null ? "n/a" : `${(v * 100).toFixed(d)}%`);
export const pct0 = (v) => pct(v, 0);
export const dec = (v, d = 1) => (v == null ? "n/a" : Number(v).toFixed(d));
export function inr(v, compact = false) {
  if (v == null) return "n/a";
  const a = Math.abs(v), s = v < 0 ? "-" : "";
  if (compact) {
    if (a >= 1e7) return `${s}₹${(a / 1e7).toFixed(2)} Cr`;
    if (a >= 1e5) return `${s}₹${(a / 1e5).toFixed(2)} L`;
    if (a >= 1e3) return `${s}₹${(a / 1e3).toFixed(1)}K`;
  }
  return `${s}₹${nf.format(Math.round(a))}`;
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function date(s) {
  if (!s) return "n/a";
  const d = new Date(String(s).length <= 10 ? s + "T00:00:00" : s);
  if (isNaN(d)) return "n/a";
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
export function dateTime(s) {
  if (!s) return "n/a";
  const d = new Date(s);
  if (isNaN(d)) return "n/a";
  return `${date(s.slice(0, 10))}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
export function fmt(kind, v) {
  if (kind === "int") return int(v);
  if (kind === "pct") return pct(v);
  if (kind === "money") return inr(v, true);
  if (kind === "money_full") return inr(v);
  if (kind === "dec") return dec(v);
  return v == null ? "n/a" : String(v);
}
export const riskBadge = (r) => (r ? `<span class="risk ${esc(r)}">${esc(r)}</span>` : '<span class="muted">Not scored</span>');
export const statusBadge = (s) => `<span class="status ${esc(String(s).replace(/ /g, "-"))}">${esc(s)}</span>`;
export const trendBadge = (t) => {
  if (t === "rising") return '<span class="trend-up">Rising</span>';
  if (t === "falling") return '<span class="trend-down">Falling</span>';
  return '<span class="trend-flat">Stable</span>';
};
export const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const qs = (obj) => {
  const p = new URLSearchParams();
  Object.entries(obj).forEach(([k, v]) => { if (v !== "" && v != null && v !== false) p.set(k, v); });
  const s = p.toString();
  return s ? `?${s}` : "";
};
export const initials = (n) => String(n || "?").split(/\s+/).map((x) => x[0]).slice(0, 2).join("").toUpperCase();
export const RISK_COLOR = { Low: "var(--low)", Medium: "var(--medium)", High: "var(--high)", Critical: "var(--critical)" };
