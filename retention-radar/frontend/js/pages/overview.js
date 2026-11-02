import { api } from "../api.js";
import { barChart, donut, hbars, lineChart } from "../charts.js";
import { $, emptyState, tip } from "../ui.js";
import { RISK_COLOR, date, esc, fmt, icon, inr, int, pct, riskBadge } from "../util.js";

function kpiCard(k) {
  const up = k.change > 0.00049, down = k.change < -0.00049;
  const good = (up && k.good_when === "up") || (down && k.good_when === "down");
  const cls = !up && !down ? "flat" : good ? "good" : "bad";
  const arrow = up ? '<path d="M7 14l5-5 5 5"/>' : down ? '<path d="M7 10l5 5 5-5"/>' : '<path d="M5 12h14"/>';
  const word = !up && !down ? "No change" : `${up ? "Up" : "Down"} ${Math.abs(k.change * 100).toFixed(1)}%`;
  return `<article class="card kpi" aria-label="${esc(k.label)}">
    <div class="kpi-top"><span class="kpi-label">${esc(k.label)}</span>${tip(k.tooltip)}</div>
    <div class="kpi-value">${esc(fmt(k.format, k.value))}</div>
    <div class="kpi-delta ${cls}"><svg class="arrow icon" viewBox="0 0 24 24" aria-hidden="true">${arrow}</svg><span>${word}</span><span class="vs">vs ${esc(fmt(k.format, k.previous))} last period</span></div></article>`;
}

export async function render(el, { user }) {
  const o = await api.get("/overview");
  const names = !!o.alerts.find((a) => a.display_name);
  el.innerHTML = `
  <div class="page-head"><div><h1>Overview</h1><p>Detect who is drifting away, then open a customer to understand why. Figures are calculated from the synthetic dataset as of ${esc(date(o.as_of))}.</p></div>
    <div class="actions"><a class="btn primary" href="#/interventions">Open intervention queue</a></div></div>
  <section class="grid kpis" aria-label="Key metrics">${o.kpis.map(kpiCard).join("")}</section>
  <div class="grid two" style="margin-top:16px">
    <section class="card"><div class="card-head"><div><h2>Customer churn trend</h2><div class="meta">Share of customers active at the start of each month who lapsed during it</div></div></div><div class="card-body"><div id="c-churn"></div></div></section>
    <section class="card"><div class="card-head"><div><h2>Customer risk distribution</h2><div class="meta">Model-scored customers today, by risk category</div></div></div><div class="card-body"><div id="c-risk"></div></div></section>
    <section class="card"><div class="card-head"><div><h2>Revenue at risk</h2><div class="meta">Expected 90-day revenue from Medium, High and Critical customers</div></div></div><div class="card-body"><div id="c-rev"></div></div></section>
    <section class="card"><div class="card-head"><div><h2>Customer retention trend</h2><div class="meta">Share of customers kept from one month to the next</div></div></div><div class="card-body"><div id="c-ret"></div></div></section>
    <section class="card"><div class="card-head"><div><h2>Product-wise churn</h2><div class="meta">Share of each category's customers who have lapsed. Descriptive, not causal</div></div></div><div class="card-body"><div id="c-prod"></div></div></section>
    <section class="card"><div class="card-head"><div><h2>Recent risk alerts</h2><div class="meta">Customers who just moved into High or Critical risk</div></div><a class="btn sm" href="#/customers?risk=Critical">View all critical</a></div>
      <div style="padding-top:8px" id="alerts"></div></section>
  </div>`;
  const trend = o.churn_trend;
  lineChart($("#c-churn"), { labels: trend.map((t) => t.label), series: [{ name: "Monthly churn rate", values: trend.map((t) => t.churn_rate), color: "var(--chart-4)" }], fmt: (v, axis) => pct(v, axis ? 0 : 1), label: "Monthly churn rate" });
  lineChart($("#c-ret"), { labels: trend.map((t) => t.label), series: [{ name: "Monthly retention rate", values: trend.map((t) => t.retention_rate), color: "var(--chart-1)" }], fmt: (v, axis) => pct(v, axis ? 0 : 1), yMin: 0.6, yMax: 1, label: "Monthly retention rate" });
  donut($("#c-risk"), o.risk_distribution.map((r) => ({ name: r.risk, value: r.count, color: RISK_COLOR[r.risk] })), { center: "scored" });
  const atRisk = o.revenue_at_risk.filter((r) => r.risk !== "Low");
  barChart($("#c-rev"), { labels: atRisk.map((r) => r.risk), series: [{ name: "Revenue exposed", values: atRisk.map((r) => r.exposure), color: "var(--chart-2)" }, { name: "Probability-weighted", values: atRisk.map((r) => r.weighted), color: "var(--chart-1)" }], fmt: (v) => inr(v, true), label: "Revenue at risk by risk category" });
  const pc = [...o.product_churn].sort((a, b) => b.churn_rate - a.churn_rate);
  hbars($("#c-prod"), pc.map((p) => ({ label: p.category, value: p.churn_rate, detail: `${int(p.customers)} customers` })), { fmt: (v) => pct(v, 0), max: 1 });
  $("#alerts").innerHTML = o.alerts.length ? `<ul class="list">${o.alerts.map((a) => `<li><a class="item-link" href="#/customers/${a.customer_id}"><div class="row" style="justify-content:space-between;gap:8px"><strong style="font-weight:500">${esc(a.display_name || a.customer_code)} <span class="meta">${names ? esc(a.customer_code) : ""}</span></strong>${riskBadge(a.risk_category)}</div><div class="secondary">${esc(a.primary_reason)}</div><div class="meta">${esc(a.scenario)} · probability ${pct(a.prev_probability, 0)} to ${pct(a.churn_probability, 0)}${a.days_overdue > 0 ? ` · ${a.days_overdue} days past refill date` : ""}</div></a></li>`).join("")}</ul>` : emptyState("No new high-risk customers", "Nobody has moved into High or Critical risk recently.");
}
