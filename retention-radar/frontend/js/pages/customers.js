import { api } from "../api.js";
import { barChart, lineChart } from "../charts.js";
import { $, $$, confirmDialog, emptyState, errorState, field, loadingBlock, options, pagerHtml, tableHtml, toast, withButton, wirePager, wireTable } from "../ui.js";
import { RISK_COLOR, date, debounce, esc, icon, inr, int, pct, qs, riskBadge, statusBadge, trendBadge, dec, dateTime } from "../util.js";

const FILTER_KEYS = ["q", "category", "risk", "lifecycle", "segment", "status", "channel", "frequency", "value", "last_from", "last_to"];

export async function render(el, ctx) {
  if (ctx.id) return profile(el, ctx);
  return list(el, ctx);
}

/* ---------------------------------------------------------------- list */
export function customerTable(host, ctx, { fixed = {}, pageSize = 25, showFilters = true, state }) {
  const st = state;
  const meta = ctx.meta;
  const canNames = meta.can.see_names;
  const columns = [
    { label: "Customer", sort: "customer_code", render: (r) => `<a href="#/customers/${r.id}"><strong style="font-weight:500">${esc(r.display_name || r.customer_code)}</strong></a><span class="sub nowrap">${esc(r.customer_code)}${r.age_group ? ` · ${esc(r.age_group)}` : ""}</span>` },
    { label: "Products", render: (r) => `<span class="trunc" style="display:inline-block;max-width:200px" title="${esc(r.products_purchased)}">${esc(r.products_purchased || "n/a")}</span><span class="sub">${esc(r.channel)}</span>` },
    { label: "Orders", sort: "total_orders", num: true, render: (r) => int(r.total_orders) },
    { label: "Revenue", sort: "total_revenue", num: true, render: (r) => `${inr(r.total_revenue)}<span class="sub">AOV ${inr(r.avg_order_value)}</span>` },
    { label: "Orders / month", sort: "orders_per_month", num: true, render: (r) => dec(r.orders_per_month, 2) },
    { label: "Last purchase", sort: "last_purchase_date", render: (r) => `${date(r.last_purchase_date)}<span class="sub">${r.days_since_last != null ? `${r.days_since_last} days ago` : ""}</span>` },
    { label: "Expected refill", sort: "expected_replenishment_date", render: (r) => date(r.expected_replenishment_date) },
    { label: "Engagement", sort: "engagement_score", num: true, render: (r) => dec(r.engagement_score, 0) },
    { label: "Churn probability", sort: "churn_probability", num: true, render: (r) => (r.churn_probability == null ? '<span class="muted">Not scored</span>' : `<strong style="font-weight:500">${pct(r.churn_probability, 0)}</strong>`) },
    { label: "Risk", render: (r) => (r.status === "lapsed" ? '<span class="muted">Lapsed</span>' : riskBadge(r.risk_category)) },
    { label: "Lifecycle", render: (r) => `${esc(r.lifecycle_stage)}<span class="sub">${esc(r.segment)}</span>` },
  ];
  const f = () => ({ ...fixed, ...Object.fromEntries(FILTER_KEYS.map((k) => [k, st[k] || ""]).filter(([, v]) => v)) });
  host.innerHTML = `${showFilters ? `<form class="filters" id="filters" role="search" aria-label="Filter customers">
    <div class="field search-field"><label for="f-q">Search by customer ID or name</label><div class="search">${icon("search")}<input class="input" id="f-q" type="search" value="${esc(st.q || "")}" autocomplete="off"></div></div>
    ${field("f-category", "Product category", `<select class="input" id="f-category">${options(meta.categories, st.category, "All categories")}</select>`)}
    ${field("f-risk", "Churn risk", `<select class="input" id="f-risk">${options(meta.risks, st.risk, "All risk levels")}</select>`)}
    ${field("f-lifecycle", "Lifecycle stage", `<select class="input" id="f-lifecycle">${options(meta.lifecycle, st.lifecycle, "All stages")}</select>`)}
    ${field("f-segment", "Segment", `<select class="input" id="f-segment">${options(meta.segments, st.segment, "All segments")}</select>`)}
    ${field("f-channel", "Acquisition channel", `<select class="input" id="f-channel">${options(meta.channels, st.channel, "All channels")}</select>`)}
    ${field("f-frequency", "Purchase frequency", `<select class="input" id="f-frequency">${options([{ value: "low", label: "Under 0.6 orders a month" }, { value: "regular", label: "0.6 to 1.2 orders a month" }, { value: "high", label: "Over 1.2 orders a month" }], st.frequency, "Any frequency")}</select>`)}
    ${field("f-value", "Customer value", `<select class="input" id="f-value">${options([{ value: "low", label: "Under ₹1,500" }, { value: "mid", label: "₹1,500 to ₹4,500" }, { value: "high", label: "Over ₹4,500" }], st.value, "Any value")}</select>`)}
    ${field("f-last_from", "Last purchase from", `<input class="input" id="f-last_from" type="date" value="${esc(st.last_from || "")}">`)}
    ${field("f-last_to", "Last purchase to", `<input class="input" id="f-last_to" type="date" value="${esc(st.last_to || "")}">`)}
    <div class="field"><span class="label" aria-hidden="true">&nbsp;</span><button class="btn" type="button" id="f-reset">Clear filters</button></div></form>` : ""}
    <div id="tbl" aria-live="polite"></div>`;
  const tbl = $("#tbl", host);
  async function load() {
    tbl.innerHTML = loadingBlock(320);
    try {
      const d = await api.get(`/customers${qs({ ...f(), sort: st.sort, order: st.order, page: st.page, page_size: pageSize })}`);
      host.dispatchEvent(new CustomEvent("loaded", { detail: d }));
      if (!d.items.length) {
        tbl.innerHTML = emptyState("No customers match these filters", "Widen the date range or clear a filter to see more customers.", "Clear filters");
        $("[data-empty-cta]", tbl).onclick = reset; return;
      }
      tbl.innerHTML = tableHtml({ columns, rows: d.items, sort: st.sort, order: st.order, clickable: true }) + pagerHtml({ ...d, label: "customers" });
      wireTable(tbl, { onSort: (k) => { if (st.sort === k) st.order = st.order === "asc" ? "desc" : "asc"; else { st.sort = k; st.order = k === "customer_code" ? "asc" : "desc"; } st.page = 1; sync(); load(); }, onRow: (id) => ctx.go(`#/customers/${id}`) });
      wirePager(tbl, (p) => { st.page = p; sync(); load(); $("#tbl", host).scrollIntoView({ block: "start" }); });
    } catch (e) { tbl.innerHTML = errorState(e.message); $("[data-retry]", tbl).onclick = load; }
  }
  const sync = () => ctx.setQuery && fixed._sync !== false && ctx.setQuery("customers", null, { ...Object.fromEntries(FILTER_KEYS.map((k) => [k, st[k]])), sort: st.sort !== "churn_probability" ? st.sort : "", order: st.order !== "desc" ? st.order : "", page: st.page > 1 ? st.page : "" });
  function reset() { FILTER_KEYS.forEach((k) => { st[k] = ""; $$("#filters [id^=f-]", host).forEach((c) => { if (c.id !== "f-reset") c.value = ""; }); }); st.page = 1; sync(); load(); }
  if (showFilters) {
    FILTER_KEYS.forEach((k) => { const c = $(`#f-${k}`, host); if (!c) return; const h = () => { st[k] = c.value; st.page = 1; sync(); load(); }; c.addEventListener(c.tagName === "INPUT" && c.type === "search" ? "input" : "change", c.type === "search" ? debounce(h, 300) : h); });
    $("#f-reset", host).onclick = reset;
    $("#filters", host).addEventListener("submit", (e) => e.preventDefault());
  }
  load();
  return { reload: load, filters: f };
}

async function list(el, ctx) {
  const st = { sort: ctx.query.sort || "churn_probability", order: ctx.query.order || "desc", page: +ctx.query.page || 1 };
  FILTER_KEYS.forEach((k) => (st[k] = ctx.query[k] || ""));
  el.innerHTML = `<div class="page-head"><div><h1>Customer Intelligence</h1><p>Search and filter every customer, ordered by churn probability by default. Open a customer to see their full history and why the model flagged them.</p></div>
  <div class="actions"><button class="btn" type="button" id="export">${icon("download")}Export CSV</button></div></div>
  <section class="card" id="host"></section>`;
  const t = customerTable($("#host"), ctx, { state: st });
  $("#export").addEventListener("click", (e) => withButton(e.currentTarget, "Preparing file", async () => {
    try { await api.download(`/customers/export${qs({ ...t.filters(), sort: st.sort, order: st.order })}`, "retention-radar-customers-SYNTHETIC.csv"); toast("Export downloaded. The file is labelled synthetic."); }
    catch (err) { toast(err.message, "error"); }
  }));
}

/* ---------------------------------------------------------------- profile */
const sect = (title, sub, body, extra = "") => `<section class="card"><div class="card-head"><div><h2>${esc(title)}</h2>${sub ? `<div class="meta">${sub}</div>` : ""}</div>${extra}</div><div class="card-body">${body}</div></section>`;

async function profile(el, ctx) {
  const c = await api.get(`/customers/${ctx.id}`);
  const { customer: cu, summary: su, prediction: pr } = c;
  const name = cu.display_name || cu.customer_code;
  const maxImpact = Math.max(0.01, ...(pr?.top_factors || []).map((f) => Math.abs(f.impact)));
  const openIv = c.interventions.find((i) => !["Resolved", "Unsuccessful"].includes(i.status));
  const canEdit = ctx.meta.can.edit_interventions;
  const lapsed = su.status === "lapsed";

  el.innerHTML = `
  <nav aria-label="Breadcrumb" class="meta" style="margin-bottom:8px"><a href="#/customers">Customer Intelligence</a> / ${esc(cu.customer_code)}</nav>
  <div class="page-head"><div><h1>${esc(name)}</h1><p>${esc(cu.customer_code)} · ${esc(cu.age_group)} · acquired via ${esc(cu.channel)} · registered ${esc(date(cu.registered_at))} · <span class="muted">synthetic record</span></p></div>
    <div class="actions">${canEdit ? (openIv ? `<a class="btn" href="#/interventions/${openIv.id}">Open intervention #${openIv.id}</a>` : `<button class="btn primary" type="button" id="new-iv">${icon("plus")}Create intervention</button>`) : ""}</div></div>

  <div class="grid wide-left">
   <div class="stack">
    <section class="card" aria-label="Risk summary"><div class="card-pad"><div class="row" style="gap:32px;align-items:flex-start">
      <div><div class="meta">Churn probability</div><div class="kpi-value">${pr ? pct(pr.churn_probability, 0) : "Not scored"}</div></div>
      <div><div class="meta">Risk category</div><div style="font-size:var(--t-h3);font-weight:600">${lapsed ? '<span class="muted">Lapsed</span>' : riskBadge(pr?.risk_category)}</div></div>
      <div><div class="meta">Risk trend</div><div style="font-size:var(--t-h3);font-weight:600">${pr ? trendBadge(pr.risk_trend) : "n/a"}</div>${pr?.prev_probability != null ? `<div class="meta">Was ${pct(pr.prev_probability, 0)} two weeks ago</div>` : ""}</div>
      <div><div class="meta">Expected refill</div><div style="font-size:var(--t-h3);font-weight:600">${esc(date(su.expected_replenishment_date))}</div>${pr && pr.days_overdue > 0 ? `<div class="meta">${pr.days_overdue} days past the grace deadline</div>` : ""}</div></div>
      ${lapsed ? `<p class="note" style="margin-top:16px">This customer has already lapsed (no purchase after the refill window plus grace period), so the model does not score them. They remain eligible for a manual win-back intervention.</p>` : ""}
    </div></section>

    ${pr ? sect("Why this customer is flagged", "Customer-level explanation: how each factor moved this prediction", `
      ${pr.top_factors.map((f) => `<div class="factor"><div><strong style="font-weight:500">${esc(f.label)}</strong><div class="secondary">${esc(f.detail)}</div></div><div class="impact"><span class="impact-bar" role="img" aria-label="${esc(f.direction)}, strength ${dec(Math.abs(f.impact), 2)}"><i class="${f.impact >= 0 ? "up" : "down"}" style="width:${Math.max(6, (Math.abs(f.impact) / maxImpact) * 100)}%"></i></span><span class="meta nowrap" style="min-width:64px">${f.impact >= 0 ? "Raises risk" : "Lowers risk"}</span></div></div>`).join("")}
      <p class="note" style="margin-top:12px">These factors describe what the model associates with churn for customers like this one. They are associations, not proof that any factor caused the risk.</p>`) : ""}

    ${sect("Customer journey", "From first purchase to current status", c.journey.length ? `<ol class="timeline">${c.journey.map((j) => `<li class="${esc(j.type)}"><div class="when">${esc(date(j.date))}</div><div class="what">${esc(j.title)}</div><div class="detail">${esc(j.detail)}</div></li>`).join("")}</ol>` : emptyState("No journey events", "This customer has no recorded events yet."))}

    ${sect("Purchase history", `${c.orders.length} ${c.orders.length === 1 ? "order" : "orders"}, including cancellations and refunds`, c.orders.length ? tableHtml({ columns: [
      { label: "Order", render: (o) => `#${o.id}` }, { label: "Date", render: (o) => date(o.date) },
      { label: "Items", render: (o) => `<span style="white-space:normal;display:inline-block;max-width:320px">${o.items.map(esc).join(", ")}</span>` },
      { label: "Status", render: (o) => (o.status === "cancelled" ? '<span class="risk Critical">Cancelled</span>' : o.refund > 0 ? '<span class="risk High">Refunded</span>' : "Delivered") },
      { label: "Net", num: true, render: (o) => inr(o.net) }, { label: "Discount", num: true, render: (o) => (o.discount ? inr(o.discount) : "None") }, { label: "Refund", num: true, render: (o) => (o.refund ? inr(o.refund) : "None") }], rows: c.orders, rowKey: "id" }) : emptyState("No orders", "This customer has not placed an order."))}

    ${sect("Product consumption history", "When each pack should have run out, compared with the next purchase", c.consumption.length ? tableHtml({ columns: [
      { label: "Purchased", render: (o) => date(o.order_date) }, { label: "Product", render: (o) => esc(o.product) }, { label: "Supply", num: true, render: (o) => `${o.days_supply} days` },
      { label: "Supply ends", render: (o) => date(o.supply_ends) },
      { label: "Reordered vs previous supply end", num: true, render: (o) => (o.days_vs_previous_supply_end == null ? "First order" : o.days_vs_previous_supply_end > 0 ? `${o.days_vs_previous_supply_end} days late` : o.days_vs_previous_supply_end < 0 ? `${-o.days_vs_previous_supply_end} days early` : "On time") }], rows: c.consumption, rowKey: "order_date" }) : emptyState("No consumption data", "Consumption appears after the first delivered order."))}
   </div>

   <div class="stack">
    ${sect("Overview", null, `<dl class="kv">
      <dt>Segment</dt><dd>${esc(su.segment)}</dd><dt>Lifecycle stage</dt><dd>${esc(su.lifecycle_stage)}</dd>
      <dt>Status</dt><dd>${lapsed ? "Lapsed" : "Active"}</dd><dt>Products purchased</dt><dd>${esc(su.products_purchased)}</dd>
      <dt>First purchase</dt><dd>${esc(date(cu.first_purchase_date))}</dd><dt>Last purchase</dt><dd>${esc(date(su.last_purchase_date))} (${su.days_since_last} days ago)</dd>
      <dt>Total orders</dt><dd>${int(su.total_orders)}</dd><dt>Total revenue</dt><dd>${inr(su.total_revenue)}</dd>
      <dt>Average order value</dt><dd>${inr(su.avg_order_value)}</dd><dt>Purchase frequency</dt><dd>${dec(su.orders_per_month, 2)} orders a month</dd>
      <dt>Average gap between orders</dt><dd>${su.avg_gap_days ? `${dec(su.avg_gap_days, 0)} days` : "n/a"}</dd><dt>Engagement score</dt><dd>${dec(su.engagement_score, 0)} out of 100</dd>
      <dt>Contact</dt><dd>${esc(cu.email_masked)}</dd><dt>App installed</dt><dd>${cu.has_app ? "Yes" : "No"}</dd></dl>`)}

    ${pr ? sect("Recommended retention action", `Scenario: ${esc(pr.recommendation.scenario)}`, `<ul style="margin:0 0 12px;padding-left:20px" class="secondary">${pr.recommendation.actions.map((a) => `<li>${esc(a)}</li>`).join("")}</ul><div class="note"><strong style="font-weight:500">Rationale.</strong> ${esc(pr.recommendation.rationale)}</div>`) : ""}

    ${sect("Retention interventions", "Previous outreach and what was observed afterwards", c.interventions.length ? `<ul class="list" style="margin:-12px -20px -20px">${c.interventions.map((i) => `<li><a class="item-link" href="#/interventions/${i.id}"><div class="row" style="justify-content:space-between"><strong style="font-weight:500">${esc(i.scenario)}</strong>${statusBadge(i.status)}</div><div class="secondary">${esc(i.reason)}</div><div class="meta">${esc(date(i.created_at))} · ${esc(i.assignee || "Unassigned")} · outcome so far: ${esc(i.observed_outcome || "none recorded yet")}${i.days_to_reorder != null ? ` (reordered after ${i.days_to_reorder} days)` : ""}</div></a></li>`).join("")}</ul>` : emptyState("No interventions yet", "Nobody has reached out to this customer through Retention Radar."))}

    ${sect("Orders per month", "Purchase frequency timeline over the last 12 months", '<div id="freq"></div>')}
    ${sect("Engagement history", "Weekly emails opened, site visits and content views", c.engagement.length ? '<div id="eng"></div>' : emptyState("No engagement events", "No email, site or content activity is recorded in this period."))}
    ${sect("Support interactions", "Complaints and tickets", c.tickets.length ? `<ul class="list" style="margin:-12px -20px -20px">${c.tickets.map((t) => `<li><div><div class="row" style="gap:8px"><strong style="font-weight:500">${esc(t.category)}</strong><span class="${t.sentiment === "negative" ? "risk Critical" : "muted"}">${esc(t.sentiment)}</span></div><div class="secondary">${esc(t.summary)}</div><div class="meta">${esc(date(t.created_at))} · ${t.status === "resolved" ? `resolved ${esc(date(t.resolved_at))}` : "<strong>unresolved</strong>"}${t.medical_concern ? " · treatment-related concern, route to qualified professionals" : ""}</div></div></li>`).join("")}</ul>` : emptyState("No support tickets", "This customer has not contacted support."))}
   </div>
  </div>`;

  barChart($("#freq"), { labels: c.frequency_timeline.map((m) => m.label), series: [{ name: "Orders", values: c.frequency_timeline.map((m) => m.orders), color: "var(--chart-1)" }], fmt: (v) => String(Math.round(v * 10) / 10), height: 180, label: "Orders per month" });
  if (c.engagement.length) lineChart($("#eng"), { labels: c.engagement.map((e) => date(e.week_start).slice(0, -5)), series: [{ name: "Emails opened", values: c.engagement.map((e) => e.emails_opened), color: "var(--chart-1)" }, { name: "Site visits", values: c.engagement.map((e) => e.site_visits), color: "var(--chart-4)" }, { name: "Content views", values: c.engagement.map((e) => e.content_views), color: "var(--chart-5)" }], fmt: (v) => String(Math.round(v * 10) / 10), height: 200, label: "Weekly engagement" });

  const nb = $("#new-iv");
  if (nb) nb.addEventListener("click", () => createIntervention(ctx, cu, pr));
}

export async function createIntervention(ctx, cu, pr) {
  const users = (await api.get("/users")).filter((u) => u.role === "success_exec");
  const mgr = ctx.user.role === "retention_manager";
  const due = new Date(ctx.meta.as_of + "T00:00:00"); due.setDate(due.getDate() + 3);
  const scrim = document.createElement("div"); scrim.className = "overlay-scrim";
  const d = document.createElement("form"); d.className = "dialog"; d.setAttribute("role", "dialog"); d.setAttribute("aria-modal", "true"); d.setAttribute("aria-label", "Create intervention"); d.noValidate = true;
  d.innerHTML = `<div class="d-body"><h2>Create intervention</h2><p class="secondary">${esc(cu.display_name || cu.customer_code)} · ${pr ? `${esc(pr.recommendation.scenario)}, ${pct(pr.churn_probability, 0)} churn probability` : "Lapsed customer: manual win-back"}</p>
  ${mgr ? field("iv-who", "Assign to", `<select class="input" id="iv-who">${options(users.map((u) => ({ value: u.id, label: u.name })), "", "Leave unassigned")}</select>`) : `<p class="secondary">This will be assigned to you.</p>`}
  ${field("iv-due", "Follow-up deadline", `<input class="input" id="iv-due" type="date" value="${due.toISOString().slice(0, 10)}">`)}
  ${field("iv-note", "Note for the team", `<textarea class="input" id="iv-note" maxlength="500"></textarea>`, "Optional. Up to 500 characters.")}<span class="error" id="iv-err" role="alert"></span></div>
  <footer><button class="btn" type="button" id="iv-cancel">Cancel</button><button class="btn primary" type="submit">Create intervention</button></footer>`;
  document.body.append(scrim, d);
  const close = () => { d.remove(); scrim.remove(); }; scrim.onclick = close; $("#iv-cancel", d).onclick = close;
  d.addEventListener("keydown", (e) => e.key === "Escape" && close());
  (mgr ? $("#iv-who", d) : $("#iv-due", d)).focus();
  d.addEventListener("submit", async (e) => {
    e.preventDefault(); const err = $("#iv-err", d); err.textContent = "";
    try {
      const body = { customer_id: cu.id, due_date: $("#iv-due", d).value || null, note: $("#iv-note", d).value.trim() || null };
      if (mgr && $("#iv-who", d).value) body.assigned_to = +$("#iv-who", d).value;
      const r = await withButton($("button[type=submit]", d), "Creating", () => api.post("/interventions", body));
      close(); toast("Intervention created"); ctx.go(`#/interventions/${r.id}`);
    } catch (ex) { err.textContent = ex.message; }
  });
}
