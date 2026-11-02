import { api } from "../api.js";
import { lineChart, heatStyle } from "../charts.js";
import { $, $$, field, options, tableHtml } from "../ui.js";
import { esc, int, pct, qs } from "../util.js";

const COLORS = ["var(--chart-1)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)", "var(--chart-2)", "var(--chart-3)"];

export async function render(el, ctx) {
  const st = { mode: ctx.query.mode || "active", channel: ctx.query.channel || "", category: ctx.query.category || "", compare: ctx.query.compare || "" };
  el.innerHTML = `<div class="page-head"><div><h1>Cohort Analysis</h1><p>Customers grouped by the month of their first purchase, and the share still buying in each month after. Blank cells mean the cohort is too young to be observed yet.</p></div></div>
  <section class="card"><form class="filters" id="cf" aria-label="Cohort options">
    <div class="field"><span class="label" id="mode-l">Measure</span><div class="seg" role="group" aria-labelledby="mode-l"><button type="button" data-mode="active" aria-pressed="${st.mode === "active"}">Still buying</button><button type="button" data-mode="cumulative" aria-pressed="${st.mode === "cumulative"}">Repeat purchase</button></div></div>
    ${field("cf-channel", "Acquisition channel", `<select class="input" id="cf-channel">${options(ctx.meta.channels, st.channel, "All channels")}</select>`)}
    ${field("cf-category", "First product category", `<select class="input" id="cf-category">${options(ctx.meta.categories, st.category, "All categories")}</select>`)}
    ${field("cf-compare", "Compare curves by", `<select class="input" id="cf-compare">${options([{ value: "channel", label: "Acquisition channel" }, { value: "category", label: "First product category" }], st.compare, "No comparison")}</select>`)}</form>
    <div class="card-body" id="out" aria-live="polite"></div></section>`;
  async function load() {
    ctx.setQuery("cohorts", null, st);
    const d = await api.get(`/cohorts${qs(st)}`);
    const rows = d.rows;
    $("#out").innerHTML = `<h2 style="margin-bottom:4px">Retention heatmap</h2><p class="meta" style="margin-bottom:12px">${st.mode === "active" ? "Share of the cohort that bought in that month, or whose last pack still covered it." : "Share of the cohort that has placed at least one repeat order by that month."}</p>
      ${rows.length ? `<div class="table-wrap"><table class="heat" aria-label="Cohort retention"><thead><tr><th class="rowh">First purchase</th><th>Size</th>${[0, 1, 2, 3, 4, 5, 6].map((i) => `<th>Month ${i}</th>`).join("")}</tr></thead><tbody>
      ${rows.map((r) => `<tr><th class="rowh" scope="row">${esc(r.label)}</th><td class="rowsize">${int(r.size)}</td>${r.values.map((v) => (v == null ? '<td class="empty" aria-label="Not yet observed">·</td>' : `<td style="${heatStyle(v, 0, 1)}">${pct(v, 0)}</td>`)).join("")}</tr>`).join("")}
      <tr><th class="rowh" scope="row">Average</th><td class="rowsize"></td>${d.average.map((v) => `<td style="font-weight:600;background:var(--bg)">${v == null ? "·" : pct(v, 0)}</td>`).join("")}</tr></tbody></table></div>
      <p class="note" style="margin-top:12px">${esc(d.note)} ${d.biggest_drop_month != null ? `The biggest average drop happens between month ${d.biggest_drop_month - 1} and month ${d.biggest_drop_month}.` : ""}</p>` : '<div class="state"><h3>No cohorts match</h3><p>Try another channel or product category.</p></div>'}
      ${d.curves && d.curves.length ? `<hr class="divider"><h2 style="margin-bottom:4px">Curves by ${st.compare === "channel" ? "acquisition channel" : "first product category"}</h2><p class="meta" style="margin-bottom:8px">Average across cohorts. Groups differ in size and customer mix, so differences are descriptive.</p><div id="cmp"></div>` : ""}`;
    if (d.curves && d.curves.length) lineChart($("#cmp"), { labels: [0, 1, 2, 3, 4, 5, 6].map((i) => `Month ${i}`), series: d.curves.map((c, i) => ({ name: `${c.group} (${int(c.customers)})`, values: c.values, color: COLORS[i % COLORS.length] })), fmt: (v) => pct(v, 0), yMin: 0, yMax: 1, height: 300, label: "Retention curves" });
  }
  $$("[data-mode]").forEach((b) => b.addEventListener("click", () => { st.mode = b.dataset.mode; $$("[data-mode]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); load(); }));
  ["channel", "category", "compare"].forEach((k) => $(`#cf-${k}`).addEventListener("change", (e) => { st[k] = e.target.value; load(); }));
  $("#cf").addEventListener("submit", (e) => e.preventDefault());
  await load();
}
