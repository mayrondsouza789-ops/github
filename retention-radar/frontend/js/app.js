// App shell: auth, navigation, routing.
import { api, tokenStore, setUnauthorizedHandler } from "./api.js";
import { esc, icon, initials } from "./util.js";
import { $, $$, errorState, loadingBlock, toast, wireTips } from "./ui.js";

const NAV = [
  ["overview", "Overview", "overview"],
  ["customers", "Customer Intelligence", "customers"],
  ["churn", "Churn Prediction", "churn"],
  ["segments", "Customer Segmentation", "segments"],
  ["campaigns", "Retention Campaigns", "campaigns"],
  ["cohorts", "Cohort Analysis", "cohorts"],
  ["products", "Product Performance", "products"],
  ["interventions", "Intervention Centre", "interventions"],
  ["reports", "Reports & Analytics", "reports"],
  ["settings", "Settings", "settings"],
];
const PAGES = {
  overview: () => import("./pages/overview.js"),
  customers: () => import("./pages/customers.js"),
  churn: () => import("./pages/churn.js"),
  segments: () => import("./pages/segments.js"),
  campaigns: () => import("./pages/campaigns.js"),
  cohorts: () => import("./pages/cohorts.js"),
  products: () => import("./pages/products.js"),
  interventions: () => import("./pages/interventions.js"),
  reports: () => import("./pages/reports.js"),
  settings: () => import("./pages/settings.js"),
};
const root = $("#root");
const ctx = { user: null, meta: null };
let shellReady = false;

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [path, query = ""] = raw.split("?");
  const parts = path.split("/").filter(Boolean);
  return { page: parts[0] || "overview", id: parts[1] || null, query: Object.fromEntries(new URLSearchParams(query)) };
}
export const go = (h) => { location.hash = h; };
export const setQuery = (page, id, q) => {
  const s = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== "" && v != null)).toString();
  history.replaceState(null, "", `#/${page}${id ? "/" + id : ""}${s ? "?" + s : ""}`);
};

function loginView(msg = "") {
  shellReady = false;
  const accounts = [
    ["manager@retentionradar.demo", "Retention Manager", "Priya Menon"],
    ["analyst@retentionradar.demo", "Business Analyst", "Sameer Rao"],
    ["exec1@retentionradar.demo", "Customer Success Executive", "Aisha Khan"],
  ];
  root.innerHTML = `<main class="login-wrap"><div class="login card"><div class="card-pad">
    <div class="row" style="gap:12px"><svg class="brand-mark" viewBox="0 0 32 32" style="width:32px;height:32px"><rect width="32" height="32" rx="7" fill="#0f1b2d"/><circle cx="16" cy="16" r="9" fill="none" stroke="#7ea2f2" stroke-width="2"/><circle cx="16" cy="16" r="4" fill="none" stroke="#7ea2f2" stroke-width="2"/><path d="M16 16L24 9" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>
    <div><h1 style="font-size:var(--t-h3)">Retention Radar</h1><div class="meta">Internal retention intelligence</div></div></div>
    <form id="login" novalidate class="stack" style="gap:16px">
      <div class="field"><label for="email">Work email</label><input class="input" id="email" type="email" autocomplete="username" required></div>
      <div class="field"><label for="pw">Password</label><input class="input" id="pw" type="password" autocomplete="current-password" required><span class="error" id="lerr" role="alert">${esc(msg)}</span></div>
      <button class="btn primary" type="submit" style="min-height:40px">Sign in</button>
    </form>
    <hr class="divider" style="margin:0">
    <div><div class="label" style="font-size:var(--t-secondary);font-weight:500;margin-bottom:8px">Demo accounts</div>
    <p class="meta" style="margin-bottom:8px">Pick a role to fill the form. Password for all demo accounts: demo1234</p>
    <div class="demo-users">${accounts.map((a) => `<button type="button" data-email="${a[0]}"><span><strong style="font-weight:500">${a[1]}</strong><br><span class="meta">${a[2]}</span></span><span class="meta">Use this account</span></button>`).join("")}</div></div>
  </div></div></main>`;
  const email = $("#email"), pw = $("#pw"), err = $("#lerr");
  $$(".demo-users button").forEach((b) => b.addEventListener("click", () => { email.value = b.dataset.email; pw.value = "demo1234"; $("#login").requestSubmit(); }));
  email.focus();
  $("#login").addEventListener("submit", async (e) => {
    e.preventDefault(); err.textContent = "";
    email.removeAttribute("aria-invalid"); pw.removeAttribute("aria-invalid");
    if (!email.value.trim()) { err.textContent = "Enter your work email to continue"; email.setAttribute("aria-invalid", "true"); email.focus(); return; }
    if (!pw.value) { err.textContent = "Enter your password to continue"; pw.setAttribute("aria-invalid", "true"); pw.focus(); return; }
    const btn = $("#login button[type=submit]"); btn.disabled = true; btn.textContent = "Signing in";
    try {
      const r = await api.post("/auth/login", { email: email.value.trim(), password: pw.value });
      tokenStore.set(r.token); ctx.user = r.user;
      if (!location.hash || location.hash === "#/login") location.hash = "#/overview";
      await boot();
    } catch (ex) { err.textContent = ex.message; pw.setAttribute("aria-invalid", "true"); btn.disabled = false; btn.textContent = "Sign in"; }
  });
}

function shell() {
  const collapsed = lsGet("rr_collapsed") === "1";
  root.innerHTML = `<div class="app ${collapsed ? "collapsed" : ""}" id="app">
  <aside class="sidebar" id="sidebar" aria-label="Primary">
    <div class="brand"><svg class="brand-mark" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#17263b"/><circle cx="16" cy="16" r="9" fill="none" stroke="#7ea2f2" stroke-width="2"/><circle cx="16" cy="16" r="4" fill="none" stroke="#7ea2f2" stroke-width="2"/><path d="M16 16L24 9" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>
      <div class="brand-text"><div class="brand-name">Retention Radar</div><div class="brand-sub">Man Matters · demo data</div></div></div>
    <ul class="nav">${NAV.map(([k, label, ic]) => `<li><a href="#/${k}" data-nav="${k}" title="${esc(label)}">${icon(ic)}<span class="label">${esc(label)}</span></a></li>`).join("")}</ul>
    <div class="sidebar-foot"><button type="button" class="collapse-toggle" id="collapse" aria-pressed="${collapsed}" title="Collapse sidebar">${icon(collapsed ? "expand" : "collapse")}<span class="label">Collapse sidebar</span></button></div>
  </aside>
  <div class="scrim" id="scrim"></div>
  <div class="main">
    <header class="topbar"><button class="btn ghost icon-btn menu-btn" id="menu" type="button" aria-label="Open navigation" title="Open navigation">${icon("menu")}</button>
      <div><div class="meta" id="crumb"></div></div><div class="spacer"></div>
      <div class="user-box"><div class="who"><div class="name">${esc(ctx.user.name)}</div><div class="meta">${esc(ctx.user.role_label || ctx.user.role)}</div></div><div class="avatar" aria-hidden="true">${esc(initials(ctx.user.name))}</div>
      <button class="btn ghost icon-btn" id="logout" type="button" aria-label="Sign out" title="Sign out">${icon("logout")}</button></div></header>
    <main class="content" id="page" tabindex="-1"></main>
  </div></div>`;
  const app = $("#app");
  $("#collapse").addEventListener("click", (e) => { app.classList.toggle("collapsed"); const c = app.classList.contains("collapsed"); lsSet("rr_collapsed", c ? "1" : "0"); e.currentTarget.setAttribute("aria-pressed", String(c)); e.currentTarget.innerHTML = `${icon(c ? "expand" : "collapse")}<span class="label">Collapse sidebar</span>`; window.dispatchEvent(new Event("resize")); });
  $("#menu").addEventListener("click", () => app.classList.add("nav-open"));
  $("#scrim").addEventListener("click", () => app.classList.remove("nav-open"));
  $("#logout").addEventListener("click", () => logout());
  shellReady = true;
}

function logout(msg) { tokenStore.clear(); ctx.user = null; history.replaceState(null, "", "#/login"); loginView(msg || ""); }
setUnauthorizedHandler(() => logout("Your session ended. Sign in again to continue"));

let token = 0;
async function route() {
  if (!ctx.user) return;
  if (!shellReady) shell();
  const { page, id, query } = parseHash();
  const key = PAGES[page] ? page : "overview";
  $$("[data-nav]").forEach((a) => (a.dataset.nav === key ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  const label = NAV.find((n) => n[0] === key)[1];
  $("#crumb").textContent = `Retention Radar / ${label}`;
  document.title = `${label} · Retention Radar`;
  $("#app").classList.remove("nav-open");
  const el = $("#page"), my = ++token;
  el.innerHTML = loadingBlock(280);
  try {
    const mod = await PAGES[key]();
    if (my !== token) return;
    el.innerHTML = "";
    await mod.render(el, { ...ctx, id, query, go, setQuery });
    if (my !== token) return;
    wireTips(el);
    el.focus({ preventScroll: true }); window.scrollTo(0, 0);
  } catch (e) {
    if (my !== token) return;
    el.innerHTML = errorState(e.message || "Unexpected error");
    $("[data-retry]", el).addEventListener("click", route);
  }
}
window.addEventListener("hashchange", route);

async function boot() {
  try {
    if (!ctx.user) ctx.user = await api.get("/auth/me");
    ctx.meta = await api.get("/meta");
  } catch (e) { if (e.status === 401 || !tokenStore.get()) { loginView(); return; } root.innerHTML = `<div class="login-wrap"><div class="card login">${errorState(e.message)}</div></div>`; $("[data-retry]").addEventListener("click", boot); return; }
  shellReady = false; await route();
}
if (tokenStore.get()) boot(); else loginView();
