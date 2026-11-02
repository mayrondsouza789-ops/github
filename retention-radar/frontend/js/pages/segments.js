import { api } from "../api.js";
import { hbars } from "../charts.js";
import { $, $$, tableHtml, wireTable } from "../ui.js";
import { esc, int, inr, pct } from "../util.js";
import { customerTable } from "./customers.js";

const DESC = {
  "New Customers": "First purchase in the last 45 days.",
  "Active Customers": "Buying, but without a regular refill rhythm yet.",
  "Consistent Customers": "Three or more orders, refilled on time.",
  "At-Risk Customers": "Active, with a High or Critical churn score.",
  "Dormant Customers": "Past their refill window plus grace period.",
  "High-Value Customers": "Lifetime revenue in the top 10%, not at risk.",
  "Recovered Customers": "Came back after a gap of more than 60 days.",
};

export async function render(el, ctx) {
  const d = await api.get("/segments");
  let selected = ctx.query.segment || "";
  el.innerHTML = `<div class="page-head"><div><h1>Customer Segmentation</h1><p>Every customer belongs to exactly one segment, assigned by rules on purchase behaviour and the model's risk score. Select a segment to inspect its customers.</p></div></div>
  <div class="grid two"><section class="card"><div class="card-head"><div><h2>Segment overview</h2><div class="meta">${int(d.total)} customers</div></div></div><div class="card-body" id="seg-table"></div></section>
  <section class="card"><div class="card-head"><div><h2>Churn rate by segment</h2><div class="meta">Share of each segment that has lapsed</div></div></div><div class="card-body"><div id="seg-bars"></div><p class="note" style="margin-top:16px">${esc(d.note)}</p></div></section></div>
  <section class="card" style="margin-top:16px"><div class="card-head"><div><h2 id="seg-title">Customers in segment</h2><div class="meta" id="seg-sub"></div></div></div><div id="seg-customers"></div></section>`;
  const cols = [
    { label: "Segment", render: (r) => `<strong style="font-weight:500">${esc(r.segment)}</strong><span class="sub">${esc(DESC[r.segment] || "")}</span>` },
    { label: "Customers", num: true, render: (r) => `${int(r.customers)}<span class="sub">${pct(r.share, 1)} of base</span>` },
    { label: "Revenue", num: true, render: (r) => `${inr(r.revenue, true)}<span class="sub">${pct(r.revenue_share, 0)} of total</span>` },
    { label: "Avg lifetime value", num: true, render: (r) => inr(r.avg_ltv) },
    { label: "Retention", num: true, render: (r) => pct(r.retention_rate, 0) },
    { label: "Churn", num: true, render: (r) => pct(r.churn_rate, 0) },
  ];
  const paint = () => {
    $("#seg-table").innerHTML = tableHtml({ columns: cols, rows: d.rows, rowKey: "segment", clickable: true, selected: selected });
    wireTable($("#seg-table"), { onRow: (k) => { selected = selected === k ? "" : k; paint(); load(); ctx.setQuery("segments", null, { segment: selected }); } });
  };
  $("#seg-table").style.margin = "-12px -20px -20px";
  hbars($("#seg-bars"), [...d.rows].sort((a, b) => b.churn_rate - a.churn_rate).map((r) => ({ label: r.segment, value: r.churn_rate, detail: `${int(r.customers)} customers` })), { fmt: (v) => pct(v, 0), max: 1 });
  function load() {
    const host = $("#seg-customers");
    if (!selected) { $("#seg-title").textContent = "Customers in segment"; $("#seg-sub").textContent = ""; host.innerHTML = `<div class="state"><h3>Choose a segment</h3><p>Select a row in the overview table to list its customers here, highest churn risk first.</p></div>`; return; }
    $("#seg-title").textContent = selected; $("#seg-sub").textContent = DESC[selected] || "";
    customerTable(host, ctx, { fixed: { segment: selected, _sync: false }, pageSize: 10, showFilters: false, state: { sort: "churn_probability", order: "desc", page: 1 } });
  }
  paint(); load();
}
