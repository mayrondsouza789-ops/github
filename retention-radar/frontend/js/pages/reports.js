import { api } from "../api.js";
import { $, $$, emptyState, errorState, field, loadingBlock, options, tableHtml, toast, withButton } from "../ui.js";
import { date, esc, fmt, icon, qs } from "../util.js";

const HINT = {
  monthly_churn: "Uses the date range (by month).", retention_performance: "Uses the date range (by month).",
  risk_distribution: "Reflects today's scores. Date range does not apply.", product_churn: "Filters by first purchase date and channel.",
  cohort_retention: "Filters by acquisition channel and first product category.", revenue_at_risk: "Reflects today's scores. Date range does not apply.",
  intervention_effectiveness: "Filters by the date the intervention was raised.", at_risk_customers: "Lists High and Critical customers, highest risk first.",
};

export async function render(el, ctx) {
  const list = await api.get("/reports");
  const st = { name: ctx.query.name || list[0].key, date_from: ctx.query.date_from || "", date_to: ctx.query.date_to || "", channel: ctx.query.channel || "", category: ctx.query.category || "" };
  el.innerHTML = `<div class="page-head"><div><h1>Reports & Analytics</h1><p>Choose a report, narrow it with filters, preview it here, then download it as CSV or print it to PDF. All figures come from the synthetic demo dataset.</p></div>
    <div class="actions"><button class="btn" type="button" id="print">Print or save as PDF</button><button class="btn primary" type="button" id="dl">${icon("download")}Download CSV</button></div></div>
  <section class="card"><form class="filters" id="rf" aria-label="Report options">
    ${field("r-name", "Report", `<select class="input" id="r-name">${list.map((r) => `<option value="${esc(r.key)}" ${r.key === st.name ? "selected" : ""}>${esc(r.title)}</option>`).join("")}</select>`)}
    ${field("r-from", "From", `<input class="input" id="r-from" type="date" value="${esc(st.date_from)}">`)}${field("r-to", "To", `<input class="input" id="r-to" type="date" value="${esc(st.date_to)}">`)}
    ${field("r-ch", "Acquisition channel", `<select class="input" id="r-ch">${options(ctx.meta.channels, st.channel, "All channels")}</select>`)}
    ${field("r-cat", "Product category", `<select class="input" id="r-cat">${options(ctx.meta.categories, st.category, "All categories")}</select>`)}</form>
    <div class="card-body" style="padding-top:0"><p class="meta" id="hint"></p></div><div id="out" aria-live="polite"></div></section>`;
  const q = () => ({ date_from: st.date_from, date_to: st.date_to, channel: st.channel, category: st.category });
  async function load() {
    ctx.setQuery("reports", null, st); $("#hint").textContent = HINT[st.name] || "";
    const out = $("#out"); out.innerHTML = loadingBlock(240);
    try {
      const d = await api.get(`/reports/${st.name}${qs(q())}`);
      if (!d.rows.length) { out.innerHTML = emptyState("No data for these filters", "Widen the date range or clear a filter to see this report."); return; }
      out.innerHTML = `<div style="padding:0 20px 8px"><h2>${esc(d.title)}</h2><div class="meta">As of ${esc(date(d.as_of))} · ${d.rows.length} rows · ${esc(d.label)}</div></div>` + tableHtml({ columns: d.columns.map((c) => ({ label: c.label, num: ["int", "pct", "money", "num"].includes(c.format), render: (r) => esc(fmt(c.format === "num" ? "dec" : c.format === "money" ? "money_full" : c.format, r[c.key])) })), rows: d.rows.map((r, i) => ({ ...r, _i: i })), rowKey: "_i" });
    } catch (e) { out.innerHTML = errorState(e.message); $("[data-retry]", out).onclick = load; }
  }
  $("#r-name").addEventListener("change", (e) => { st.name = e.target.value; load(); });
  [["#r-from", "date_from"], ["#r-to", "date_to"], ["#r-ch", "channel"], ["#r-cat", "category"]].forEach(([s, k]) => $(s).addEventListener("change", (e) => { st[k] = e.target.value; load(); }));
  $("#rf").addEventListener("submit", (e) => e.preventDefault());
  $("#print").addEventListener("click", () => window.print());
  $("#dl").addEventListener("click", (e) => withButton(e.currentTarget, "Preparing file", async () => { try { await api.download(`/reports/${st.name}${qs({ ...q(), format: "csv" })}`, `retention-radar-${st.name}-SYNTHETIC.csv`); toast("Report downloaded. The file is labelled synthetic."); } catch (ex) { toast(ex.message, "error"); } }));
  await load();
}
