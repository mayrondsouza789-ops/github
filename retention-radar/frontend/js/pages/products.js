import { api } from "../api.js";
import { barChart } from "../charts.js";
import { $, field, options, tableHtml } from "../ui.js";
import { dec, esc, inr, int, pct, qs } from "../util.js";

export async function render(el, ctx) {
  const st = { date_from: ctx.query.date_from || "", date_to: ctx.query.date_to || "", channel: ctx.query.channel || "" };
  el.innerHTML = `<div class="page-head"><div><h1>Product Performance</h1><p>How customers behave after buying each haircare category. Filters apply to the date of the first purchase.</p></div></div>
  <section class="card"><form class="filters" id="pf">${field("pf-from", "First purchase from", `<input class="input" id="pf-from" type="date" value="${esc(st.date_from)}">`)}${field("pf-to", "First purchase to", `<input class="input" id="pf-to" type="date" value="${esc(st.date_to)}">`)}${field("pf-ch", "Acquisition channel", `<select class="input" id="pf-ch">${options(ctx.meta.channels, st.channel, "All channels")}</select>`)}<div class="field"><span class="label" aria-hidden="true">&nbsp;</span><button class="btn" type="button" id="pf-reset">Clear filters</button></div></form><div id="out" aria-live="polite"></div></section>`;
  async function load() {
    ctx.setQuery("products", null, st);
    const d = await api.get(`/products${qs(st)}`);
    if (!d.rows.length) { $("#out").innerHTML = `<div class="state"><h3>No customers in this range</h3><p>Widen the date range or choose another channel.</p></div>`; return; }
    $("#out").innerHTML = `<div class="card-body"><h2 style="margin-bottom:12px">Repeat purchase and churn by category</h2><div id="chart"></div></div><div style="border-top:1px solid var(--border)" id="tbl"></div><div class="card-body" style="padding-top:0"><p class="note">${esc(d.note)}</p></div>`;
    barChart($("#chart"), { labels: d.rows.map((r) => r.category), series: [{ name: "Repeat purchase rate", values: d.rows.map((r) => r.repeat_rate), color: "var(--chart-1)" }, { name: "Churn rate", values: d.rows.map((r) => r.churn_rate), color: "var(--chart-4)" }], fmt: (v) => pct(v, 0), height: 260, label: "Repeat purchase and churn rate by category" });
    $("#tbl").innerHTML = tableHtml({ columns: [
      { label: "Category", render: (r) => `<strong style="font-weight:500">${esc(r.category)}</strong>` },
      { label: "Customers acquired", num: true, render: (r) => int(r.customers) }, { label: "Repeat purchase rate", num: true, render: (r) => `${pct(r.repeat_rate, 1)}<span class="sub">of ${int(r.eligible)} eligible</span>` },
      { label: "Days to second purchase", num: true, render: (r) => (r.avg_days_to_second == null ? "n/a" : dec(r.avg_days_to_second, 0)) },
      { label: "Retention", num: true, render: (r) => pct(r.retention, 1) }, { label: "Churn rate", num: true, render: (r) => pct(r.churn_rate, 1) },
      { label: "Revenue", num: true, render: (r) => `${inr(r.revenue, true)}<span class="sub">${pct(r.revenue_share, 0)} of total</span>` },
      { label: "Refund rate", num: true, render: (r) => pct(r.refund_rate, 1) }, { label: "Avg lifetime value", num: true, render: (r) => inr(r.avg_ltv) }], rows: d.rows, rowKey: "category" });
  }
  const bind = (id, k) => $(id).addEventListener("change", (e) => { st[k] = e.target.value; load(); });
  bind("#pf-from", "date_from"); bind("#pf-to", "date_to"); bind("#pf-ch", "channel");
  $("#pf-reset").addEventListener("click", () => { st.date_from = st.date_to = st.channel = ""; ["#pf-from", "#pf-to", "#pf-ch"].forEach((i) => ($(i).value = "")); load(); });
  $("#pf").addEventListener("submit", (e) => e.preventDefault());
  await load();
}
