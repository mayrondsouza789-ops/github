import { api } from "../api.js";
import { $, $$, confirmDialog, emptyState, errorState, field, loadingBlock, options, pagerHtml, slideOver, tableHtml, toast, withButton, wirePager, wireTable } from "../ui.js";
import { date, dateTime, debounce, esc, int, pct, qs, riskBadge, statusBadge } from "../util.js";

const OPEN = ["Pending", "Assigned", "In Progress", "Contacted"];

export async function render(el, ctx) {
  const [sum, users] = await Promise.all([api.get("/interventions/summary"), api.get("/users")]);
  const execs = users.filter((u) => u.role === "success_exec");
  const st = { status: ctx.query.status || "", risk: ctx.query.risk || "", assignee: ctx.query.assignee || "", scenario: ctx.query.scenario || "", q: ctx.query.q || "", overdue: ctx.query.overdue === "1", page: +ctx.query.page || 1 };
  const canEdit = ctx.meta.can.edit_interventions;
  const scenarios = sum.tracker.map((t) => t.scenario);
  const openTotal = OPEN.reduce((a, s) => a + (sum.counts[s] || 0), 0);

  el.innerHTML = `<div class="page-head"><div><h1>Intervention Centre</h1><p>Work the queue from highest risk down: assign each customer, record what happened, and see what followed. Outcomes are observational. A customer who buys after outreach may have bought anyway.</p></div></div>
  <section class="card"><div class="tabs" role="tablist" aria-label="Filter by status">
    <button type="button" role="tab" data-tab="" aria-selected="${st.status === "" && !st.overdue}">All<span class="count">${int(Object.values(sum.counts).reduce((a, b) => a + b, 0))}</span></button>
    <button type="button" role="tab" data-tab="open" aria-selected="${st.status === OPEN.join(",")}">Open<span class="count">${int(openTotal)}</span></button>
    ${["Pending", "Assigned", "In Progress", "Contacted", "Resolved", "Unsuccessful"].map((s) => `<button type="button" role="tab" data-tab="${s}" aria-selected="${st.status === s}">${s}<span class="count">${int(sum.counts[s] || 0)}</span></button>`).join("")}
    <button type="button" role="tab" data-tab="overdue" aria-selected="${st.overdue}">Overdue<span class="count">${int(sum.overdue)}</span></button></div>
    <form class="filters" id="iv-f" role="search">
      <div class="field search-field"><label for="iv-q">Search by customer ID</label><input class="input" id="iv-q" type="search" value="${esc(st.q)}" autocomplete="off"></div>
      ${field("iv-risk", "Risk level", `<select class="input" id="iv-risk">${options(ctx.meta.risks, st.risk, "All risk levels")}</select>`)}
      ${field("iv-who", "Assigned to", `<select class="input" id="iv-who">${options([{ value: "me", label: "Me" }, { value: "unassigned", label: "Unassigned" }, ...execs.map((u) => ({ value: u.id, label: u.name }))], st.assignee, "Anyone")}</select>`)}
      ${field("iv-sc", "Scenario", `<select class="input" id="iv-sc">${options(scenarios, st.scenario, "All scenarios")}</select>`)}</form>
    <div id="iv-list" aria-live="polite"></div></section>

  <section class="card" style="margin-top:16px"><div class="card-head"><div><h2>Outcome tracker</h2><div class="meta">What happened after each type of intervention. Observational only: no control group, so no claim that outreach prevented churn</div></div></div><div class="card-body" id="tracker" style="margin:0;padding:0"></div>
    <div class="card-body"><p class="note">${esc(sum.note)}</p></div></section>`;

  $("#tracker").innerHTML = tableHtml({ columns: [
    { label: "Scenario", render: (r) => `<strong style="font-weight:500">${esc(r.scenario)}</strong>` },
    { label: "Interventions", num: true, render: (r) => int(r.interventions) }, { label: "Outcome known", num: true, render: (r) => int(r.evaluated) },
    { label: "Remained active", num: true, render: (r) => int(r.remained_active) }, { label: "Resumed purchasing", num: true, render: (r) => int(r.resumed) },
    { label: "Churned", num: true, render: (r) => int(r.churned) }, { label: "Too early to tell", num: true, render: (r) => int(r.pending) },
    { label: "Bought or stayed active", num: true, render: (r) => (r.reorder_rate == null ? "n/a" : pct(r.reorder_rate, 0)) }], rows: sum.tracker, rowKey: "scenario" });

  const cols = [
    { label: "Customer", render: (r) => `<a href="#/customers/${r.customer_id}"><strong style="font-weight:500">${esc(r.display_name || r.customer_code)}</strong></a><span class="sub">${esc(r.customer_code)}</span>` },
    { label: "Risk", render: (r) => riskBadge(r.risk_category) }, { label: "Churn probability", num: true, render: (r) => (r.churn_probability == null ? "Not scored" : pct(r.churn_probability, 0)) },
    { label: "Reason", render: (r) => `<span style="white-space:normal;display:inline-block;min-width:200px;max-width:280px">${esc(r.reason)}</span><span class="sub">${esc(r.scenario)}</span>` },
    { label: "Recommended action", render: (r) => `<span style="white-space:normal;display:inline-block;min-width:220px;max-width:300px">${esc(r.recommended_action)}</span>` },
    { label: "Assigned to", render: (r) => (r.assignee ? esc(r.assignee) : '<span class="muted">Unassigned</span>') },
    { label: "Follow-up by", render: (r) => { const late = OPEN.includes(r.status) && r.due_date < ctx.meta.as_of; return `${esc(date(r.due_date))}${late ? '<span class="sub" style="color:var(--critical)">Overdue</span>' : ""}`; } },
    { label: "Status", render: (r) => statusBadge(r.status) },
  ];
  const sync = () => ctx.setQuery("interventions", null, { ...st, overdue: st.overdue ? 1 : "", page: st.page > 1 ? st.page : "" });
  async function load() {
    const host = $("#iv-list"); host.innerHTML = loadingBlock(280);
    try {
      const d = await api.get(`/interventions${qs({ status: st.status, risk: st.risk, assignee: st.assignee, scenario: st.scenario, q: st.q, overdue: st.overdue, page: st.page, page_size: 15 })}`);
      if (!d.items.length) { host.innerHTML = emptyState("Nothing in this view", "No interventions match these filters. Try another status tab or clear a filter."); return; }
      host.innerHTML = tableHtml({ columns: cols, rows: d.items, clickable: true }) + pagerHtml({ ...d, label: "interventions" });
      wireTable(host, { onRow: (id) => openDetail(id) });
      wirePager(host, (p) => { st.page = p; sync(); load(); });
    } catch (e) { host.innerHTML = errorState(e.message); $("[data-retry]", host).onclick = load; }
  }
  $$("[data-tab]").forEach((b) => b.addEventListener("click", () => {
    const t = b.dataset.tab; st.overdue = t === "overdue"; st.status = st.overdue || t === "" ? "" : t === "open" ? OPEN.join(",") : t; st.page = 1;
    $$("[data-tab]").forEach((x) => x.setAttribute("aria-selected", String(x === b))); sync(); load();
  }));
  [["#iv-risk", "risk"], ["#iv-who", "assignee"], ["#iv-sc", "scenario"]].forEach(([s, k]) => $(s).addEventListener("change", (e) => { st[k] = e.target.value; st.page = 1; sync(); load(); }));
  $("#iv-q").addEventListener("input", debounce((e) => { st.q = e.target.value.trim(); st.page = 1; sync(); load(); }, 300));
  $("#iv-f").addEventListener("submit", (e) => e.preventDefault());

  async function openDetail(id) {
    let panel;
    const paint = async () => {
      const { intervention: iv, events } = await api.get(`/interventions/${id}`);
      const edit = iv.can_edit, mgr = ctx.user.role === "retention_manager";
      const body = `
       <div class="row" style="justify-content:space-between"><div>${riskBadge(iv.risk_category)} <span class="secondary">${iv.churn_probability != null ? pct(iv.churn_probability, 0) + " churn probability" : "Not scored"}</span></div>${statusBadge(iv.status)}</div>
       <dl class="kv"><dt>Customer</dt><dd><a href="#/customers/${iv.customer_id}">${esc(iv.display_name || iv.customer_code)}</a> <span class="meta">${esc(iv.customer_code)}</span></dd><dt>Scenario</dt><dd>${esc(iv.scenario)}</dd><dt>Why</dt><dd>${esc(iv.reason)}</dd><dt>Raised</dt><dd>${esc(date(iv.created_at))} by ${esc(iv.created_by)}</dd></dl>
       <div><h3 style="margin-bottom:8px">Recommended action</h3><ul class="secondary" style="margin:0 0 8px;padding-left:20px">${iv.recommended_action.split("; ").map((a) => `<li>${esc(a)}</li>`).join("")}</ul><div class="note">${esc(iv.rationale)}</div></div>
       ${edit ? `<form id="iv-edit" class="stack" style="gap:12px"><h3>Update intervention</h3>
         <div class="grid two" style="gap:12px">${field("e-status", "Status", `<select class="input" id="e-status">${ctx.meta.statuses.map((s) => `<option ${s === iv.status ? "selected" : ""}>${s}</option>`).join("")}</select>`)}
         ${field("e-due", "Follow-up deadline", `<input class="input" id="e-due" type="date" value="${esc(iv.due_date || "")}">`)}</div>
         ${mgr ? field("e-who", "Assigned to", `<select class="input" id="e-who">${options(execs.map((u) => ({ value: u.id, label: u.name })), iv.assigned_to ?? "", "Unassigned")}</select>`) : `<div class="secondary">Assigned to ${esc(iv.assignee || "you")}</div>`}
         <div><button class="btn primary" type="submit">Save changes</button></div></form>
        <form id="iv-note" class="stack" style="gap:12px"><h3>Add to history</h3>${field("n-type", "Entry type", `<select class="input" id="n-type"><option value="note">Follow-up note</option><option value="customer_response">Customer response</option></select>`)}${field("n-text", "Details", '<textarea class="input" id="n-text" maxlength="600"></textarea>', "What was said or done. 2 to 600 characters.")}<span class="error" id="n-err" role="alert"></span><div class="row"><button class="btn" type="submit">Add entry</button><button class="btn danger" type="button" id="esc-btn">Escalate concern</button></div></form>`
       : `<p class="note">You can view this intervention. Only the assigned executive or a manager can change it.</p>`}
       <div><h3 style="margin-bottom:8px">Observed outcome</h3><p class="secondary">${esc(iv.observed_outcome)}${iv.days_to_reorder != null ? `. Reordered ${iv.days_to_reorder} days after outreach, ₹${int(iv.revenue_after_30d)} in the following 30 days` : ""}.</p><p class="meta">Observational. It does not show the outreach caused this result.</p></div>
       <div><h3 style="margin-bottom:8px">History</h3><ol class="timeline">${events.slice().reverse().map((e) => `<li class="${e.event_type === "escalated" ? "cancel" : e.event_type === "customer_response" ? "purchase" : "status"}"><div class="when">${esc(dateTime(e.event_at))} · ${esc(e.actor)}</div><div class="what">${esc(({ created: "Created", assigned: "Assigned", status_change: "Status changed", note: "Note", customer_response: "Customer response", escalated: "Escalated", follow_up_scheduled: "Follow-up scheduled" })[e.event_type] || e.event_type)}</div><div class="detail">${esc(e.detail)}</div></li>`).join("")}</ol></div>`;
      if (!panel) panel = slideOver({ title: `Intervention #${iv.id}`, subtitle: `${esc(iv.display_name || iv.customer_code)} · ${esc(iv.scenario)}`, body, onClose: () => { if (location.hash.includes("/interventions/")) ctx.setQuery("interventions", null, { ...st, overdue: st.overdue ? 1 : "" }); } });
      else panel.body.innerHTML = body;
      const root = panel.el;
      const f = $("#iv-edit", root);
      if (f) f.addEventListener("submit", async (e) => { e.preventDefault();
        const b = {}; const sv = $("#e-status", root).value, dv = $("#e-due", root).value, w = $("#e-who", root);
        if (sv !== iv.status) b.status = sv; if (dv && dv !== iv.due_date) b.due_date = dv; if (w && w.value && +w.value !== iv.assigned_to) b.assigned_to = +w.value;
        if (!Object.keys(b).length) { toast("Nothing has changed yet"); return; }
        try { await withButton($("button[type=submit]", f), "Saving", () => api.patch(`/interventions/${id}`, b)); toast("Changes saved"); await paint(); load(); } catch (ex) { toast(ex.message, "error"); } });
      const nf = $("#iv-note", root);
      if (nf) { nf.addEventListener("submit", async (e) => { e.preventDefault(); const t = $("#n-text", root).value.trim(), err = $("#n-err", root); err.textContent = "";
        if (t.length < 2) { err.textContent = "Add a few words about what happened"; $("#n-text", root).setAttribute("aria-invalid", "true"); return; }
        try { await withButton($("button[type=submit]", nf), "Adding", () => api.post(`/interventions/${id}/events`, { event_type: $("#n-type", root).value, detail: t })); toast("Added to history"); await paint(); } catch (ex) { err.textContent = ex.message; } });
        $("#esc-btn", root).addEventListener("click", async () => { if (await confirmDialog({ title: "Escalate this concern?", body: "This logs an escalation to the retention manager. For treatment-related concerns it also records a hand-off to qualified professionals. The hand-off is simulated in this demo.", confirmLabel: "Escalate concern", danger: true })) { try { await api.post(`/interventions/${id}/escalate`); toast("Escalation logged (simulated hand-off)"); await paint(); } catch (ex) { toast(ex.message, "error"); } } }); }
    };
    try { await paint(); } catch (e) { toast(e.message, "error"); }
  }
  await load();
  if (ctx.id) openDetail(ctx.id);
}
