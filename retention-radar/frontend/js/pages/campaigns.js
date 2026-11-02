import { api } from "../api.js";
import { barChart } from "../charts.js";
import { $, tableHtml, tip } from "../ui.js";
import { date, dec, esc, inr, int, pct } from "../util.js";

const lift = (r) => {
  if (!r.control_sufficient) return '<span class="muted">Control group too small</span>';
  const [lo, hi] = r.lift_ci, sig = lo > 0 || hi < 0;
  return `<strong style="font-weight:500">${r.lift_pp >= 0 ? "+" : ""}${(r.lift_pp * 100).toFixed(1)} pts</strong><span class="sub">95% range ${(lo * 100).toFixed(1)} to ${(hi * 100).toFixed(1)}${sig ? "" : ", not clearly different from zero"}</span>`;
};

export async function render(el) {
  const d = await api.get("/campaigns");
  const tot = d.campaigns.reduce((a, c) => ({ t: a.t + c.targeted, r: a.r + c.attributed_revenue, c: a.c + c.cost, i: a.i + (c.incremental_recovered || 0) }), { t: 0, r: 0, c: 0, i: 0 });
  el.innerHTML = `<div class="page-head"><div><h1>Retention Campaigns</h1><p>Compare outreach strategies. Message delivery and cost are simulated in this demo. Where a control group was held back, the table shows the extra reorders the campaign created, which is the number to trust.</p></div></div>
  <section class="grid kpis" aria-label="Campaign totals">
    ${[["Customers targeted", int(tot.t), "Customers selected for a campaign, treatment and control combined."], ["Attributed revenue", inr(tot.r, true), "Revenue from reorders by contacted customers after the message. Includes customers who would have reordered anyway, so it overstates impact."], ["Total spend", inr(tot.c, true), "Simulated delivery cost at a per-message rate by channel."], ["Incremental reorders", int(tot.i), "Extra reorders compared with control groups. Only counted where a control group was large enough."]]
      .map(([l, v, t]) => `<article class="card kpi"><div class="kpi-top"><span class="kpi-label">${l}</span>${tip(t)}</div><div class="kpi-value">${v}</div></article>`).join("")}</section>
  <div class="grid two" style="margin-top:16px">
    <section class="card"><div class="card-head"><div><h2>Reorder rate by strategy</h2><div class="meta">Contacted customers against customers held out as a control</div></div></div><div class="card-body"><div id="c-type"></div></div></section>
    <section class="card"><div class="card-head"><div><h2>How to read this</h2></div></div><div class="card-body stack" style="gap:12px"><p class="secondary">A reorder after a message does not prove the message caused it. Control customers were not contacted, so the gap between the two reorder rates estimates the campaign's own effect.</p><p class="secondary">Small control groups produce wide ranges. When the range includes zero, treat the result as unproven rather than as failure or success.</p><p class="note">${esc(d.note)}</p></div></section>
  </div>
  <section class="card" style="margin-top:16px"><div class="card-head"><div><h2>Strategy comparison</h2><div class="meta">Grouped by campaign type</div></div></div><div class="card-body" id="by-type" style="margin:0;padding:0"></div></section>
  <section class="card" style="margin-top:16px"><div class="card-head"><div><h2>All campaigns</h2><div class="meta">Delivery and click rates are simulated</div></div></div><div class="card-body" id="all" style="margin:0;padding:0"></div></section>`;
  barChart($("#c-type"), { labels: d.by_type.map((t) => t.type.replace(" campaign", "").replace(" follow-up", " follow-up")), series: [{ name: "Contacted", values: d.by_type.map((t) => t.reorder_rate), color: "var(--chart-1)" }, { name: "Control (not contacted)", values: d.by_type.map((t) => t.control_reorder_rate || 0), color: "var(--chart-3)" }], fmt: (v) => pct(v, 0), height: 280, label: "Reorder rate for contacted and control customers" });
  $("#by-type").innerHTML = tableHtml({ columns: [
    { label: "Campaign type", key: "type" }, { label: "Campaigns", num: true, key: "campaigns" }, { label: "Contacted", num: true, render: (r) => int(r.treatment) }, { label: "Control", num: true, render: (r) => int(r.control) },
    { label: "Reorder rate", num: true, render: (r) => pct(r.reorder_rate, 1) }, { label: "Control reorder rate", num: true, render: (r) => (r.control ? pct(r.control_reorder_rate, 1) : "No control") },
    { label: "Lift over control", num: true, render: (r) => (r.control ? `${r.lift_pp >= 0 ? "+" : ""}${(r.lift_pp * 100).toFixed(1)} pts` : "n/a") },
    { label: "Attributed revenue", num: true, render: (r) => inr(r.attributed_revenue, true) }, { label: "Cost per recovered", num: true, render: (r) => inr(r.cost_per_attributed) }], rows: d.by_type, rowKey: "type" });
  $("#all").innerHTML = tableHtml({ columns: [
    { label: "Campaign", render: (r) => `<strong style="font-weight:500">${esc(r.name)}</strong><span class="sub">${esc(r.type)} · ${esc(r.channel)} · ${esc(date(r.start))} to ${esc(date(r.end))}</span>` },
    { label: "Targeted", num: true, render: (r) => `${int(r.targeted)}<span class="sub">${int(r.control)} control</span>` },
    { label: "Delivered", num: true, render: (r) => `${pct(r.delivery_rate, 0)}<span class="sub">${int(r.delivered)} of ${int(r.contacted)}</span>` },
    { label: "Click rate", num: true, render: (r) => pct(r.ctr, 0) }, { label: "Reorder rate", num: true, render: (r) => `${pct(r.reorder_rate, 0)}<span class="sub">control ${r.control_sufficient ? pct(r.control_reorder_rate, 0) : "n/a"}</span>` },
    { label: "Incremental lift", num: true, render: lift },
    { label: "Attributed revenue", num: true, render: (r) => inr(r.attributed_revenue, true) },
    { label: "Cost per recovered customer", num: true, render: (r) => `${inr(r.cost_per_attributed)}<span class="sub">${r.incremental_recovered > 0 ? `${inr(r.cost_per_incremental)} per incremental` : "no clear increment"}</span>` }], rows: d.campaigns, rowKey: "id" });
}
