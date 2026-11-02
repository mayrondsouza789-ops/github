import { api } from "../api.js";
import { hbars, lineChart } from "../charts.js";
import { $, $$, confirmDialog, emptyState, field, tableHtml, tip, toast, withButton } from "../ui.js";
import { RISK_COLOR, dateTime, dec, esc, icon, int, pct, riskBadge, date } from "../util.js";

const DEFS = {
  Low: "Consistent purchasing and healthy engagement.",
  Medium: "Early signs of reduced engagement or a changing purchase rhythm.",
  High: "Several indicators of possible discontinuation.",
  Critical: "Strong disengagement signals: missed refills, repeated cancellations or unresolved complaints.",
};

export async function render(el, ctx) {
  const m = await api.get("/model");
  const t = m.metrics.test, th = ctx.meta.thresholds, manager = ctx.user.role === "retention_manager";
  const best = m.metrics.test.at_high;
  el.innerHTML = `
  <div class="page-head"><div><h1>Churn Prediction</h1><p>How the model works, how well it performs on data it has not seen, and why it flags a given customer. Trained on synthetic data, so these scores illustrate the method and do not describe real customers.</p></div>
    <div class="actions">${manager ? '<button class="btn" type="button" id="retrain">Retrain model</button>' : ""}</div></div>
  <div id="retrain-status"></div>
  <section class="grid kpis" aria-label="Model summary">
    ${[["Algorithm", esc(m.algorithm), "Chosen on validation PR-AUC from XGBoost, Random Forest and a Logistic Regression baseline."],
       ["Last trained", esc(dateTime(m.trained_at)), "Date and time of the training run that produced the scores in this workspace."],
       ["ROC-AUC (test)", dec(t.roc_auc, 3), "Chance that a customer who churned scores higher than one who did not. 0.5 is a coin flip."],
       ["PR-AUC (test)", dec(t.pr_auc, 3), `Precision and recall balance for finding churners. The base rate is ${pct(t.positive_rate, 0)}, so a useless model would score about ${dec(t.positive_rate, 2)}.`]]
      .map(([l, v, tp]) => `<article class="card kpi"><div class="kpi-top"><span class="kpi-label">${l}</span>${tip(tp)}</div><div class="kpi-value" style="font-size:var(--t-h3)">${v}</div></article>`).join("")}
  </section>

  <div class="grid two" style="margin-top:16px">
    <section class="card"><div class="card-head"><div><h2>How churn is defined</h2></div></div><div class="card-body stack" style="gap:12px">
      <p class="secondary">A customer has churned when they have not bought again within <strong style="font-weight:500">${m.grace_days} days</strong> after their product's expected refill date. Each product has its own supply length, so a 30-day gummy pack and a 3-month minoxidil kit are judged on different clocks.</p>
      <p class="secondary">The model predicts the probability of that happening within the next <strong style="font-weight:500">${m.horizon_days} days</strong>. Both numbers can be changed when the model is retrained.</p>
      <dl class="kv"><dt>Training rows</dt><dd>${int(m.split_info.rows.train)} (${esc(m.split_info.train)})</dd><dt>Validation rows</dt><dd>${int(m.split_info.rows.validation)} (${esc(m.split_info.validation)})</dd><dt>Test rows</dt><dd>${int(m.split_info.rows.test)} (${esc(m.split_info.test)})</dd><dt>Snapshots</dt><dd>Every ${m.split_info.snapshot_cadence_days} days, split by time, never at random</dd></dl>
      <div><h4 style="margin-bottom:4px">Leakage controls</h4><ul class="secondary" style="margin:0;padding-left:20px">${m.split_info.leakage_controls.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div></div></section>
    <section class="card"><div class="card-head"><div><h2>Risk categories</h2><div class="meta">Business thresholds on the calibrated probability. Managers can change them in Settings</div></div></div><div class="card-body">
      <table class="data"><thead><tr><th>Category</th><th class="num">From</th><th>Meaning</th></tr></thead><tbody>
      ${[["Low", 0], ["Medium", th.medium], ["High", th.high], ["Critical", th.critical]].map(([r, v]) => `<tr><td>${riskBadge(r)}</td><td class="num">${pct(v, 0)}</td><td class="secondary">${esc(DEFS[r])}</td></tr>`).join("")}</tbody></table></div></section>
  </div>

  <section class="card" style="margin-top:16px"><div class="card-head"><div><h2>Model comparison</h2><div class="meta">Held-out test period. Threshold for precision, recall and F1 is the High risk cut-off (${pct(th.high, 0)})</div></div></div><div class="card-body" id="cmp"></div></section>

  <div class="grid two" style="margin-top:16px">
    <section class="card"><div class="card-head"><div><h2>Confusion matrix</h2><div class="meta">${esc(m.algorithm)}, test period, flagged at ${pct(best.threshold, 0)}</div></div></div><div class="card-body" id="cm"></div></section>
    <section class="card"><div class="card-head"><div><h2>Calibration</h2><div class="meta">When the model says 30%, about 30% should churn. Expected calibration error ${dec(m.calibration.calibrated.ece, 3)}</div></div></div><div class="card-body"><div id="cal"></div></div></section>
    <section class="card"><div class="card-head"><div><h2>Choosing a threshold</h2><div class="meta">Lower cut-offs find more churners but contact more customers who would have stayed</div></div></div><div class="card-body" id="ops"></div></section>
    <section class="card"><div class="card-head"><div><h2>What the model relies on</h2><div class="meta">Share of total importance by feature. Importance is not causation</div></div></div><div class="card-body"><div id="fi"></div></div></section>
  </div>

  <section class="card" style="margin-top:16px"><div class="card-head"><div><h2>Explain a customer</h2><div class="meta">See which factors pushed one customer's score up or down</div></div></div><div class="card-body stack" id="explain-host">
    <form id="ex-form" class="row" style="align-items:flex-end" role="search">${field("ex-q", "Customer ID", '<input class="input" id="ex-q" type="search" placeholder="For example SYN-1125" style="min-width:240px">')}<button class="btn" type="submit">Find customer</button></form><div id="ex-out"></div></div></section>

  <section class="card" style="margin-top:16px"><div class="card-head"><div><h2>Data availability</h2><div class="meta">Features the model uses, and where data is partial or missing</div></div></div><div class="card-body" id="avail"></div></section>`;

  // comparison
  const names = Object.keys(m.comparison);
  $("#cmp").innerHTML = tableHtml({ columns: [
    { label: "Model", render: (r) => `${esc(r.name)}${r.name === m.algorithm ? ' <span class="meta">(active)</span>' : ""}` },
    { label: "ROC-AUC", num: true, render: (r) => dec(r.t.roc_auc, 3) }, { label: "PR-AUC", num: true, render: (r) => dec(r.t.pr_auc, 3) },
    { label: "Precision", num: true, render: (r) => pct(r.t.at_high.precision, 0) }, { label: "Recall", num: true, render: (r) => pct(r.t.at_high.recall, 0) },
    { label: "F1", num: true, render: (r) => dec(r.t.at_high.f1, 3) }, { label: "Top 10% lift", num: true, render: (r) => `${dec(r.t.top10.lift, 1)}x` },
    { label: "Calibration error", num: true, render: (r) => dec(r.t.ece, 3) }, { label: "Brier score", num: true, render: (r) => dec(r.t.brier, 3) }],
    rows: names.map((n) => ({ name: n, t: m.comparison[n].test })), rowKey: "name" });
  // confusion matrix
  const cm = best;
  $("#cm").innerHTML = `<table class="data" aria-label="Confusion matrix"><thead><tr><th></th><th class="num">Predicted to stay</th><th class="num">Predicted to churn</th></tr></thead><tbody>
    <tr><th scope="row" style="text-align:left;background:none">Actually stayed</th><td class="num">${int(cm.tn)}<span class="sub">correctly left alone</span></td><td class="num">${int(cm.fp)}<span class="sub">contacted unnecessarily</span></td></tr>
    <tr><th scope="row" style="text-align:left;background:none">Actually churned</th><td class="num">${int(cm.fn)}<span class="sub">missed</span></td><td class="num">${int(cm.tp)}<span class="sub">correctly flagged</span></td></tr></tbody></table>
    <p class="secondary" style="margin-top:12px">Of the customers flagged, ${pct(cm.precision, 0)} really churned. The model finds ${pct(cm.recall, 0)} of all churners at this cut-off.</p>`;
  // calibration
  const cb = m.calibration.calibrated.bins, ub = m.calibration.uncalibrated.bins;
  lineChart($("#cal"), { labels: cb.map((b) => pct(b.pred, 0)), series: [{ name: "Observed (calibrated)", values: cb.map((b) => b.obs), color: "var(--chart-1)" }, { name: "Observed (raw model)", values: ub.map((b) => b.obs), color: "var(--chart-3)", dash: true }, { name: "Perfect calibration", values: cb.map((b) => b.pred), color: "var(--chart-4)", dash: true }], fmt: (v) => pct(v, 0), yMin: 0, yMax: 1, height: 240, label: "Calibration curve" });
  // operating points
  const ops = t.operating_points;
  $("#ops").innerHTML = tableHtml({ columns: [
    { label: "Flag at or above", num: true, render: (r) => pct(r.threshold, 0) }, { label: "Customers flagged", num: true, render: (r) => pct(r.flagged_share, 0) },
    { label: "Precision", num: true, render: (r) => pct(r.precision, 0) }, { label: "Recall", num: true, render: (r) => pct(r.recall, 0) }, { label: "F1", num: true, render: (r) => dec(r.f1, 2) }], rows: ops, rowKey: "threshold" });
  hbars($("#fi"), m.feature_importance.slice(0, 10).map((f) => ({ label: f.label, value: f.share })), { fmt: (v) => pct(v, 0) });
  $("#avail").innerHTML = tableHtml({ columns: [{ label: "Feature group", key: "group" }, { label: "Signals", key: "feature" },
    { label: "Status", render: (r) => `<span class="${r.status === "available" ? "risk Low" : r.status === "partial" ? "risk Medium" : "risk Critical"}">${r.status === "available" ? "Available" : r.status === "partial" ? "Partial" : "Not available"}</span>` },
    { label: "How it is handled", render: (r) => esc(r.note || (r.status === "available" ? "Used directly" : "Left out of the model")) }], rows: m.feature_availability, rowKey: "feature" });

  // explain
  async function showExplain(id) {
    const c = await api.get(`/customers/${id}`), pr = c.prediction;
    if (!pr) { $("#ex-out").innerHTML = emptyState("This customer is not scored", "Lapsed customers have already churned under the current definition, so the model does not score them."); return; }
    const mx = Math.max(0.01, ...pr.top_factors.map((f) => Math.abs(f.impact)));
    $("#ex-out").innerHTML = `<div class="card card-pad"><div class="row" style="justify-content:space-between"><div><strong style="font-weight:500">${esc(c.customer.display_name || c.customer.customer_code)}</strong> <span class="meta">${esc(c.customer.customer_code)}</span></div><a class="btn sm" href="#/customers/${c.customer.id}">Open full profile</a></div>
      <div class="row" style="gap:24px;margin:12px 0"><div><div class="meta">Churn probability</div><div class="kpi-value">${pct(pr.churn_probability, 0)}</div></div><div><div class="meta">Risk</div><div style="margin-top:8px">${riskBadge(pr.risk_category)}</div></div></div>
      ${pr.top_factors.map((f) => `<div class="factor"><div><strong style="font-weight:500">${esc(f.label)}</strong><div class="secondary">${esc(f.detail)}</div></div><div class="impact"><span class="impact-bar"><i class="${f.impact >= 0 ? "up" : "down"}" style="width:${Math.max(6, (Math.abs(f.impact) / mx) * 100)}%"></i></span><span class="meta nowrap" style="min-width:64px">${f.impact >= 0 ? "Raises risk" : "Lowers risk"}</span></div></div>`).join("")}
      <p class="note" style="margin-top:12px">Bars show how strongly each factor moved this score (SHAP values from the model). They show association with churn in the training data, not proof of cause.</p></div>`;
  }
  async function find(q) {
    const d = await api.get(`/customers?q=${encodeURIComponent(q)}&page_size=5&status=active`);
    if (!d.items.length) { $("#ex-out").innerHTML = emptyState("No active customer found", "Check the ID and try again. Customer IDs look like SYN-1125."); return; }
    if (d.items.length === 1 || d.items[0].customer_code.toLowerCase() === q.toLowerCase()) return showExplain(d.items[0].id);
    $("#ex-out").innerHTML = `<p class="secondary">Several customers match. Choose one:</p><div class="row" style="margin-top:8px">${d.items.map((i) => `<button class="btn sm" type="button" data-id="${i.id}">${esc(i.display_name || i.customer_code)} · ${esc(i.customer_code)}</button>`).join("")}</div>`;
    $$("#ex-out [data-id]").forEach((b) => (b.onclick = () => showExplain(b.dataset.id)));
  }
  $("#ex-form").addEventListener("submit", (e) => { e.preventDefault(); const q = $("#ex-q").value.trim(); if (q) find(q).catch((x) => toast(x.message, "error")); });
  api.get("/customers?page_size=5&status=active").then((d) => d.items[0] && showExplain(d.items[0].id)).catch(() => {});

  // retrain
  const rt = $("#retrain");
  if (rt) {
    const paint = (s) => { $("#retrain-status").innerHTML = s.state === "running" ? `<div class="note" role="status" style="margin-bottom:16px"><span class="inline-load"><span class="spinner"></span>Retraining: ${esc(s.message || "working")}. This takes a minute or two.</span></div>` : s.state === "error" ? `<div class="note" role="alert" style="margin-bottom:16px;border-color:var(--critical)">${esc(s.message)}. The previous model is still active.</div>` : ""; };
    const poll = async () => { const s = await api.get("/model/retrain/status"); paint(s); if (s.state === "running") setTimeout(() => poll().catch(() => {}), 2500); else if (s.state === "done" && s.finished) { toast("Model retrained and scores refreshed"); ctx.go("#/churn"); window.dispatchEvent(new HashChangeEvent("hashchange")); } };
    api.get("/model/retrain/status").then((s) => { paint(s); if (s.state === "running") poll(); }).catch(() => {});
    rt.addEventListener("click", () => {
      const scrim = document.createElement("div"); scrim.className = "overlay-scrim";
      const d = document.createElement("form"); d.className = "dialog"; d.setAttribute("role", "dialog"); d.setAttribute("aria-modal", "true"); d.setAttribute("aria-label", "Retrain model");
      d.innerHTML = `<div class="d-body"><h2>Retrain model</h2><p class="secondary">Retraining rebuilds features, compares the three models and rescores every active customer. Segments and risk categories update when it finishes.</p>
        ${field("rt-h", "Prediction horizon", `<select class="input" id="rt-h">${[30, 60, 90].map((h) => `<option value="${h}" ${h === m.horizon_days ? "selected" : ""}>${h} days</option>`).join("")}</select>`)}
        ${field("rt-g", "Grace period after expected refill", `<input class="input" id="rt-g" type="number" min="0" max="45" value="${m.grace_days}">`, "Days a customer may be late before counting as churned. 0 to 45.")}<span class="error" id="rt-err" role="alert"></span></div>
        <footer><button class="btn" type="button" id="rt-c">Cancel</button><button class="btn primary" type="submit">Start retraining</button></footer>`;
      document.body.append(scrim, d); $("#rt-h", d).focus();
      const close = () => { d.remove(); scrim.remove(); rt.focus(); }; scrim.onclick = close; $("#rt-c", d).onclick = close; d.addEventListener("keydown", (e) => e.key === "Escape" && close());
      d.addEventListener("submit", async (e) => { e.preventDefault(); const g = +$("#rt-g", d).value; if (!(g >= 0 && g <= 45)) { $("#rt-err", d).textContent = "Enter a grace period between 0 and 45 days"; return; }
        try { const s = await api.post("/model/retrain", { horizon_days: +$("#rt-h", d).value, grace_days: g }); close(); paint(s); setTimeout(() => poll().catch(() => {}), 2500); } catch (ex) { $("#rt-err", d).textContent = ex.message; } });
    });
  }
}
