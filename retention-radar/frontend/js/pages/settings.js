import { api } from "../api.js";
import { $, confirmDialog, field, tableHtml, toast, withButton } from "../ui.js";
import { esc, pct, riskBadge, dateTime } from "../util.js";

export async function render(el, ctx) {
  const [s, m] = await Promise.all([api.get("/settings"), api.get("/model")]);
  const can = s.can_edit;
  const th = s.thresholds;
  const pctVal = (v) => Math.round(v * 100);
  el.innerHTML = `<div class="page-head"><div><h1>Settings</h1><p>Risk thresholds, the churn definition, team access and data notes. ${can ? "" : "Only retention managers can change thresholds."}</p></div></div>
  <div class="grid two">
   <section class="card"><div class="card-head"><div><h2>Risk thresholds</h2><div class="meta">Customers are placed in the highest category whose cut-off their churn probability reaches</div></div></div>
    <form class="card-body stack" id="th-form" novalidate style="gap:16px">
      <div class="grid three" style="gap:12px">${[["medium", "Medium from"], ["high", "High from"], ["critical", "Critical from"]].map(([k, l]) => field(`t-${k}`, `${l} (%)`, `<input class="input" id="t-${k}" type="number" min="1" max="99" step="1" value="${pctVal(th[k])}" ${can ? "" : "disabled"}>`)).join("")}</div>
      <span class="error" id="t-err" role="alert"></span>
      <p class="secondary">Below Medium counts as ${"Low"} risk. Changing a cut-off immediately re-labels every customer, segment and intervention queue count. Probabilities themselves do not change.</p>
      ${can ? '<div class="row"><button class="btn primary" type="submit">Save thresholds</button><button class="btn" type="button" id="t-reset">Reset to saved values</button></div>' : ""}</form></section>
   <section class="card"><div class="card-head"><div><h2>Churn definition</h2><div class="meta">Set when the model is retrained from Churn Prediction</div></div></div><div class="card-body"><dl class="kv"><dt>Prediction horizon</dt><dd>${s.horizon_days} days</dd><dt>Grace period</dt><dd>${s.grace_days} days after the expected refill date</dd><dt>Active model</dt><dd>${esc(m.algorithm)}, trained ${esc(dateTime(m.trained_at))}</dd></dl>
      <p class="secondary" style="margin-top:12px">Each product has its own supply length, so there is no single inactivity cut-off for every customer.</p><a class="btn sm" style="margin-top:12px" href="#/churn">Go to Churn Prediction</a></div></section>
   <section class="card"><div class="card-head"><div><h2>Team and access</h2><div class="meta">Demo accounts. Passwords are for the demo only</div></div></div><div class="card-body" id="users" style="margin:0;padding:0"></div></section>
   <section class="card"><div class="card-head"><div><h2>What each role can do</h2></div></div><div class="card-body" id="roles" style="margin:0;padding:0"></div></section>
   <section class="card"><div class="card-head"><div><h2>Data and integrations</h2></div></div><div class="card-body stack" style="gap:12px">
     <div class="note"><strong style="font-weight:500">Synthetic data.</strong> ${esc(ctx.meta.dataset_label)} Customer names and contact details are generated and masked. Replace the data source before using any score to contact a real person.</div>
     <dl class="kv"><dt>Data as of</dt><dd>${esc(ctx.meta.as_of)}</dd><dt>CRM</dt><dd>Simulated. No messages are sent</dd><dt>WhatsApp and email</dt><dd>Simulated. Campaign delivery figures are generated</dd><dt>Support desk</dt><dd>Simulated tickets</dd><dt>API documentation</dt><dd><a href="/docs" target="_blank" rel="noopener">Open interactive API docs</a></dd></dl></div></section>
  </div>`;
  $("#users").innerHTML = tableHtml({ columns: [{ label: "Name", render: (u) => `<strong style="font-weight:500">${esc(u.name)}</strong><span class="sub">${esc(u.email)}</span>` }, { label: "Role", key: "role_label" }, { label: "Status", render: (u) => (u.is_active ? "Active" : "Inactive") }], rows: s.users, rowKey: "id" });
  const yes = "Yes", no = "No";
  $("#roles").innerHTML = tableHtml({ columns: [{ label: "Capability", key: "c" }, { label: "Manager", key: "m" }, { label: "Analyst", key: "a" }, { label: "Executive", key: "e" }], rows: [
    { c: "View dashboards, cohorts, products, reports", m: yes, a: yes, e: yes }, { c: "See customer names", m: yes, a: "IDs only", e: yes },
    { c: "Assign interventions", m: yes, a: no, e: no }, { c: "Update and add notes to interventions", m: yes, a: no, e: "Assigned to them" },
    { c: "Change risk thresholds", m: yes, a: no, e: no }, { c: "Retrain the model", m: yes, a: no, e: no }], rowKey: "c" });
  if (!can) return;
  const f = $("#th-form"), err = $("#t-err"), ids = ["medium", "high", "critical"];
  const vals = () => Object.fromEntries(ids.map((k) => [k, Number($(`#t-${k}`).value)]));
  const check = () => { const v = vals(); err.textContent = ""; ids.forEach((k) => $(`#t-${k}`).removeAttribute("aria-invalid"));
    for (const k of ids) if (!(v[k] >= 1 && v[k] <= 99)) { err.textContent = "Enter whole percentages between 1 and 99"; $(`#t-${k}`).setAttribute("aria-invalid", "true"); return null; }
    if (!(v.medium < v.high && v.high < v.critical)) { err.textContent = "Cut-offs must rise from Medium to High to Critical"; ids.forEach((k) => $(`#t-${k}`).setAttribute("aria-invalid", "true")); return null; }
    return v; };
  ids.forEach((k) => $(`#t-${k}`).addEventListener("blur", check));
  $("#t-reset").addEventListener("click", () => { ids.forEach((k) => ($(`#t-${k}`).value = pctVal(th[k]))); err.textContent = ""; });
  f.addEventListener("submit", async (e) => { e.preventDefault(); const v = check(); if (!v) return;
    if (!(await confirmDialog({ title: "Re-label every customer?", body: `New cut-offs: Medium ${v.medium}%, High ${v.high}%, Critical ${v.critical}%. Risk categories, segments and dashboard counts update straight away.`, confirmLabel: "Save thresholds" }))) return;
    try { await withButton($("button[type=submit]", f), "Saving", () => api.put("/settings/thresholds", { medium: v.medium / 100, high: v.high / 100, critical: v.critical / 100 })); toast("Thresholds saved. Risk categories updated."); ctx.meta = await api.get("/meta"); location.reload(); }
    catch (ex) { err.textContent = ex.message; } });
}
