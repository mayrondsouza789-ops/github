// Shared UI primitives: states, tables, pagination, tooltips, slide-over, dialogs, toasts.
import { esc, icon } from "./util.js";

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function toast(msg, kind = "info", action) {
  let box = $(".toasts");
  if (!box) { box = document.createElement("div"); box.className = "toasts"; box.setAttribute("role", "status"); box.setAttribute("aria-live", "polite"); document.body.appendChild(box); }
  const t = document.createElement("div");
  t.className = `toast ${kind === "error" ? "error" : ""}`;
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ""}`;
  if (action) t.querySelector("button").onclick = () => { action.run(); t.remove(); };
  box.appendChild(t);
  setTimeout(() => t.remove(), kind === "error" ? 8000 : 4500);
}

export const skeleton = (h = 120, n = 1) => Array.from({ length: n }, () => `<div class="skel" style="height:${h}px;margin-bottom:8px" aria-hidden="true"></div>`).join("");
export const loadingBlock = (h = 200) => `<div role="status" aria-label="Loading">${skeleton(h)}</div>`;
export const emptyState = (title, body, cta) => `<div class="state">${icon("empty")}<h3>${esc(title)}</h3><p>${esc(body)}</p>${cta ? `<button class="btn" type="button" data-empty-cta>${esc(cta)}</button>` : ""}</div>`;
export const errorState = (msg, retryLabel = "Try again") => `<div class="state error" role="alert">${icon("alert")}<h3>This section did not load</h3><p>${esc(msg)}</p><button class="btn" type="button" data-retry>${esc(retryLabel)}</button></div>`;

export function tip(text) {
  return `<span class="tip"><button type="button" class="tip-btn" aria-label="What is this metric?" aria-describedby="">${icon("info")}</button><span class="tip-pop" role="tooltip">${esc(text)}</span></span>`;
}
export function wireTips(root) {
  $$(".tip", root).forEach((t) => {
    const btn = $(".tip-btn", t);
    btn.addEventListener("click", (e) => { e.stopPropagation(); const was = t.classList.contains("open"); $$(".tip.open").forEach((x) => x.classList.remove("open")); if (!was) t.classList.add("open"); });
    btn.addEventListener("keydown", (e) => { if (e.key === "Escape") t.classList.remove("open"); });
  });
}
document.addEventListener("click", () => $$(".tip.open").forEach((x) => x.classList.remove("open")));

// Table. columns: [{key,label,num,sort,render(row)}]. Returns html; wire with wireTable.
export function tableHtml({ columns, rows, sort, order, rowKey = "id", clickable = false, selected }) {
  const head = columns.map((c) => {
    const cls = c.num ? "num" : "";
    if (!c.sort) return `<th class="${cls}" scope="col">${esc(c.label)}</th>`;
    const active = sort === c.sort;
    const aria = active ? (order === "asc" ? "ascending" : "descending") : "none";
    return `<th class="${cls}" scope="col" aria-sort="${aria}"><button type="button" data-sort="${esc(c.sort)}">${esc(c.label)}<svg class="sort" viewBox="0 0 24 24" aria-hidden="true">${active ? (order === "asc" ? '<path d="M7 14l5-5 5 5"/>' : '<path d="M7 10l5 5 5-5"/>') : '<path d="M8 9l4-4 4 4M8 15l4 4 4-4"/>'}</svg></button></th>`;
  }).join("");
  const body = rows.map((r) => `<tr ${clickable ? `class="clickable ${selected != null && selected == r[rowKey] ? "selected" : ""}" tabindex="0" data-key="${esc(r[rowKey])}"` : ""}>${columns.map((c) => `<td class="${c.num ? "num" : ""}">${c.render ? c.render(r) : esc(r[c.key] ?? "n/a")}</td>`).join("")}</tr>`).join("");
  return `<div class="table-wrap"><table class="data"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}
export function wireTable(root, { onSort, onRow }) {
  $$("th button[data-sort]", root).forEach((b) => b.addEventListener("click", () => onSort && onSort(b.dataset.sort)));
  if (onRow) $$("tbody tr.clickable", root).forEach((tr) => {
    const go = () => onRow(tr.dataset.key, tr);
    tr.addEventListener("click", (e) => { if (e.target.closest("a,button,select,input")) return; go(); });
    tr.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.target.closest("a,button,select,input")) go(); });
  });
}
export function pagerHtml({ page, pages, total, page_size, label = "results" }) {
  const from = total ? (page - 1) * page_size + 1 : 0, to = Math.min(total, page * page_size);
  return `<div class="table-foot"><span class="secondary">${from.toLocaleString("en-IN")} to ${to.toLocaleString("en-IN")} of ${total.toLocaleString("en-IN")} ${esc(label)}</span>
  <div class="pager"><button class="btn sm" type="button" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>${icon("chevleft")}Previous</button><span class="secondary">Page ${page} of ${pages}</span><button class="btn sm" type="button" data-page="${page + 1}" ${page >= pages ? "disabled" : ""}>Next${icon("chevright")}</button></div></div>`;
}
export const wirePager = (root, fn) => $$("[data-page]", root).forEach((b) => b.addEventListener("click", () => !b.disabled && fn(+b.dataset.page)));

export const options = (list, current, all = "All") =>
  `<option value="">${esc(all)}</option>` + list.map((o) => { const v = typeof o === "object" ? o.value : o, l = typeof o === "object" ? o.label : o; return `<option value="${esc(v)}" ${String(current) === String(v) ? "selected" : ""}>${esc(l)}</option>`; }).join("");
export const field = (id, label, control, hint) => `<div class="field"><label for="${id}">${esc(label)}</label>${control}${hint ? `<span class="hint">${esc(hint)}</span>` : ""}</div>`;

// Focus management shared by slide-over and dialog.
function trap(container, onClose) {
  const prev = document.activeElement;
  const sel = 'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])';
  const key = (e) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    if (e.key !== "Tab") return;
    const f = $$(sel, container).filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  document.addEventListener("keydown", key);
  const first = $$(sel, container).find((x) => x.offsetParent !== null);
  (first || container).focus();
  return () => { document.removeEventListener("keydown", key); prev && prev.focus && prev.focus(); };
}

export function slideOver({ title, subtitle, body, footer, onClose }) {
  const scrim = document.createElement("div"); scrim.className = "overlay-scrim";
  const el = document.createElement("aside");
  el.className = "slideover"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", title); el.tabIndex = -1;
  el.innerHTML = `<header><div style="min-width:0"><h2>${esc(title)}</h2>${subtitle ? `<div class="meta">${subtitle}</div>` : ""}</div><button class="btn ghost icon-btn" type="button" data-close aria-label="Close panel" title="Close (Esc)">${icon("close")}</button></header><div class="so-body">${body || ""}</div>${footer ? `<footer>${footer}</footer>` : ""}`;
  document.body.append(scrim, el);
  let release;
  const close = () => { release && release(); el.remove(); scrim.remove(); onClose && onClose(); };
  scrim.onclick = close; $("[data-close]", el).onclick = close;
  release = trap(el, close);
  return { el, close, body: $(".so-body", el) };
}

export function confirmDialog({ title, body, confirmLabel, danger }) {
  return new Promise((resolve) => {
    const scrim = document.createElement("div"); scrim.className = "overlay-scrim";
    const d = document.createElement("div");
    d.className = "dialog"; d.setAttribute("role", "alertdialog"); d.setAttribute("aria-modal", "true"); d.setAttribute("aria-label", title); d.tabIndex = -1;
    d.innerHTML = `<div class="d-body"><h2>${esc(title)}</h2><p class="secondary">${esc(body)}</p></div><footer><button class="btn" type="button" data-no>Cancel</button><button class="btn ${danger ? "danger" : "primary"}" type="button" data-yes>${esc(confirmLabel)}</button></footer>`;
    document.body.append(scrim, d);
    const done = (v) => { rel(); d.remove(); scrim.remove(); resolve(v); };
    const rel = trap(d, () => done(false));
    $("[data-no]", d).onclick = () => done(false); $("[data-yes]", d).onclick = () => done(true); scrim.onclick = () => done(false);
  });
}

export async function withButton(btn, label, fn) {
  const old = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spinner" aria-hidden="true"></span>${esc(label)}`;
  try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = old; }
}
