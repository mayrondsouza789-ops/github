/* Decision support for the published model and its held-out evaluation. */
const reviewPlan = { capacity: 50, product: '', excludeOpen: true, page: 0 };
const reviewPageSize = 10;
let validationScope = 'all';

function scoredProbability(customer) {
  return Number.isFinite(customer.probability) && customer.probability >= 0 && customer.probability <= 1;
}

function featureLabel(feature) {
  return D.model.feature_info?.[feature]?.label || labels[feature] || feature.replaceAll('_', ' ');
}

function coverageMessage(customer) {
  const model = D.model;
  if (customer.score_reason === 'covered_through_horizon') {
    return `Refill coverage extends through the ${model.horizon}-day forecast window.`;
  }
  if (customer.score_reason === 'already_inactive' || customer.commercial_status === 'Inactive') {
    return 'Refill coverage had already expired on the scoring date.';
  }
  if (customer.score_reason === 'no_purchase' || customer.commercial_status === 'No completed orders') {
    return 'A first completed purchase is required for scoring.';
  }
  if (!scoredProbability(customer)) return 'No eligible score in this snapshot.';
  if (customer.coverage_end) return `Current refill coverage ends ${customer.coverage_end}.`;
  return 'Active purchaser at the scoring date.';
}

function rankedEffects(customer) {
  return (customer.contributions || [])
    .filter(entry => Number.isFinite(entry.effect) && Math.abs(entry.effect) >= .001)
    .sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect));
}

function predictionSignal(customer) {
  if (!scoredProbability(customer) || customer.score_reason === 'covered_through_horizon') {
    return coverageMessage(customer);
  }
  const strongest = rankedEffects(customer).find(entry => entry.effect > 0);
  return strongest ? featureLabel(strongest.feature) : coverageMessage(customer);
}

function predictionFollowUp(customer) {
  if (customer.openTickets) return recommendation(customer);
  if (customer.score_reason === 'covered_through_horizon')
    return 'Review at the next scoring date as the expected refill date approaches.';
  if (customer.score_reason === 'already_inactive')
    return 'Review previous outreach and the last purchase before planning a reactivation contact.';
  if (customer.score_reason === 'no_purchase')
    return 'Review the first purchase attempt and any delivery or payment issues.';
  return recommendation(customer);
}

function scoreProfile(customer) {
  const model = D.model;
  const scored = scoredProbability(customer);
  const version = customer.model_version;
  const stamp = customer.prediction_timestamp || D.asOf;
  const sameModel = !version || version === model.version;
  const effects = scored && sameModel && customer.score_reason !== 'covered_through_horizon'
    ? rankedEffects(customer).slice(0, 4) : [];
  const explanation = effects.map(entry => {
    const unit = model.feature_info?.[entry.feature]?.unit;
    const value = Number.isFinite(entry.value) ? Number(entry.value.toFixed(2)).toLocaleString('en-IN') : null;
    const sign = entry.effect < 0 ? '−' : '+';
    return `<div class="ml-driver"><div>${esc(featureLabel(entry.feature))}
      ${value === null ? '' : `<small>Recorded value ${esc(value)}${unit ? ' '+esc(unit) : ''}</small>`}</div>
      <b class="${entry.effect > 0 ? 'ml-higher' : 'ml-lower'}">${sign}${(Math.abs(entry.effect)*100).toFixed(1)} pp</b></div>`;
  }).join('');
  const open = interventions.find(item => item.customer === customer.id && !['Resolved','Unsuccessful'].includes(item.status));
  return `<section class="panel ml-profile"><h2>Inactivity prediction</h2>
    <p>${esc(coverageMessage(customer))}</p>
    <dl class="ml-metadata"><div><dt>Score date</dt><dd>${esc(stamp)}</dd></div>
      <div><dt>Forecast window</dt><dd>${fmt(model.horizon)} days</dd></div>
      <div><dt>Model version</dt><dd>${version ? esc(version) : 'Unavailable'}</dd></div></dl>
    ${explanation ? `<h3>Score drivers</h3><p class="forecast-note">${esc(model.explanation)}</p>${explanation}` : ''}
    <div class="insight"><strong>Suggested follow-up</strong><br>${esc(predictionFollowUp(customer))}</div>
    ${settings.role === 'Business Analyst' ? '' : `<button class="primary" onclick="interventionForm(${Number(customer.id)}${open ? ','+Number(open.id) : ''})">${open ? 'Manage active follow-up' : 'Create intervention'}</button>`}</section>`;
}

function scorePercent(value) { return Number.isFinite(value) ? pct(value) : '—'; }
function scoreNumber(value, digits = 3) { return Number.isFinite(value) ? value.toFixed(digits) : '—'; }
function scoreLift(value) { return Number.isFinite(value) ? value.toFixed(2) + '×' : '—'; }

function reviewSelection() {
  const matching = customers.filter(customer =>
    scoredProbability(customer) && (reviewPlan.product === '' || customer.product === Number(reviewPlan.product)));
  const open = new Set(interventions.filter(item => !['Resolved','Unsuccessful'].includes(item.status)).map(item => item.customer));
  const candidates = matching.filter(customer => customer.probability > 0 && (!reviewPlan.excludeOpen || !open.has(customer.id)));
  candidates.sort((a,b) => b.probability - a.probability || a.id - b.id);
  return { scored: matching.length, available: candidates.length, open, selected: candidates.slice(0, reviewPlan.capacity) };
}

function applyReviewCapacity(event) {
  event.preventDefault();
  const input = event.currentTarget.elements.capacity;
  if (!input.reportValidity()) return;
  reviewPlan.capacity = input.valueAsNumber;
  reviewPlan.page = 0;
  renderContent();
  document.getElementById('review-capacity')?.focus({preventScroll: true});
}

function exportReviewQueue() {
  const {selected, open} = reviewSelection();
  download('retention-radar-review-' + D.asOf, selected.map((customer, index) => ({
    rank: index + 1, synthetic: D.synthetic, customer_id: customer.code, name: customer.name,
    product: D.products[customer.product].name, probability: customer.probability,
    horizon_days: D.model.horizon, model_version: customer.model_version || D.model.version,
    scored_at: customer.prediction_timestamp || D.asOf, coverage_end: customer.coverage_end || '',
    model_signal: predictionSignal(customer), open_follow_up: open.has(customer.id)
  })));
}

function reviewQueueView() {
  const m = D.model;
  const {scored, available, selected, open} = reviewSelection();
  const size = selected.length;
  const expected = selected.reduce((total, customer) => total + customer.probability, 0);
  const lastPage = Math.max(0, Math.ceil(size / reviewPageSize) - 1);
  reviewPlan.page = Math.min(reviewPlan.page, lastPage);
  const offset = reviewPlan.page * reviewPageSize;
  const rows = selected.slice(offset, offset + reviewPageSize).map((customer, i) => `<tr>
    <td>${fmt(offset + i + 1)}</td><td><button class="ml-customer" onclick="profile(${customer.id})">${esc(customer.name)}</button>
      <small class="cell-meta">${esc(customer.code)} · ${esc(D.products[customer.product].name)}</small></td>
    <td class="ml-risk"><b>${pct(customer.probability)}</b><span><i style="width:${customer.probability * 100}%"></i></span></td>
    <td>${esc(predictionSignal(customer))}</td><td>${open.has(customer.id) ? 'Open follow-up' : 'Available'}</td></tr>`).join('');
  const headings = header('Churn intelligence', 'Plan customer follow-up using predicted commercial inactivity.', false) +
    tabs(['Review queue','Analysis','Signals'], churnTab, 'churnTab');
  return headings + `<section class="ml-review" aria-label="Capacity planning">
    <div class="ml-section-head"><div><h2>Review queue</h2><p>Highest predicted ${m.horizon}-day risk first · scored ${esc(D.asOf)}</p></div>
    <button onclick="exportReviewQueue()" ${size?'':'disabled'}>Export queue</button></div>
    <div class="ml-controls"><form onsubmit="applyReviewCapacity(event)">
      <label for="review-capacity">Contact capacity</label><div><input id="review-capacity" name="capacity" type="number" required
      min="1" max="${Math.max(customers.length, reviewPlan.capacity)}" step="1" value="${reviewPlan.capacity}"><button>Apply</button></div></form>
      <label class="ml-product-filter">Product<select aria-label="Review product" onchange="reviewPlan.product=this.value;reviewPlan.page=0;renderContent()">
      <option value="">All products</option>${D.products.map(p=>`<option value="${p.id}" ${String(p.id) === reviewPlan.product ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
      <label class="ml-checkbox"><input type="checkbox" aria-label="Exclude active follow-ups" ${reviewPlan.excludeOpen ? 'checked' : ''}
      onchange="reviewPlan.excludeOpen=this.checked;reviewPlan.page=0;renderContent()">Exclude active follow-ups</label></div>
    <div class="ml-numbers"><div><small>Selected for review</small><strong>${fmt(size)}</strong><span>of ${fmt(available)} available</span></div>
      <div><small>Average risk in queue</small><strong>${size ? pct(expected / size) : '—'}</strong><span>${m.horizon}-day horizon</span></div>
      <div><small>Expected inactivity cases</small><strong>${size ? expected.toFixed(1) : '—'}</strong><span>sum of selected probabilities</span></div></div>
    ${size ? `<div class="table-wrap"><table class="ml-queue-table"><thead><tr><th>Rank</th><th>Customer</th><th>Inactivity risk</th>
      <th>Model signal</th><th>Follow-up</th></tr></thead><tbody>${rows}</tbody></table></div>` :
      '<div class="empty"><strong>No customers qualify for this queue</strong>Choose another product or include existing follow-ups.</div>'}
    <div class="ml-table-foot"><span>${size ? `${offset + 1}–${Math.min(size, offset + reviewPageSize)} of ${fmt(size)} selected` : '0 selected'} · ${fmt(scored)} scored in scope</span>
      ${size > reviewPageSize ? `<div><button aria-label="Previous queue page" onclick="reviewPlan.page--;renderContent()" ${reviewPlan.page===0?'disabled':''}>Previous</button>
      <button aria-label="Next queue page" onclick="reviewPlan.page++;renderContent()" ${reviewPlan.page>=lastPage?'disabled':''}>Next</button></div>` : ''}</div>
    </section><p class="ml-footnote">Queue eligibility requires a positive inactivity score. Outreach effectiveness requires measured follow-up outcomes.</p>`;
}

function validationPartitionTable(evaluation) {
  return recordTable(evaluation.splits.map(split => ({
    Partition: split.name, 'Snapshot window': split.start === split.end ? split.start : `${split.start} – ${split.end}`,
    Customers: fmt(split.customers), Snapshots: fmt(split.rows), 'Positive snapshots': fmt(split.positives),
    'Outcomes through': split.matured_through
  })));
}

function validationPerformance(model) {
  const evaluation = model.evaluation;
  const subset = validationScope === 'actionable' && evaluation?.actionable;
  const score = subset?.current || model.metrics[model.selected];
  const capacity = subset ? [{fraction:.2,count:score.capacity,precision:score.precision_at_k,
    hits:Math.round(score.precision_at_k*score.capacity),recall:score.recall_at_k,lift:score.lift}] : evaluation?.capacity || [];
  const comparisons = evaluation
    ? [[model.selected, score], ['Previous model', (subset || evaluation).incumbent], [evaluation.baseline_name, (subset || evaluation).baseline]]
    : Object.entries(model.metrics);
  const interval = (subset || evaluation)?.confidence?.pr_auc;
  const deltaInterval = (subset || evaluation)?.confidence?.pr_auc_delta_vs_incumbent;
  const target = model.target;
  const baseline = score.prevalence ?? evaluation?.prevalence;
  const scopeChooser = evaluation?.actionable ? `<div class="ml-eval-scope">
    <label>Evaluation population <select aria-label="Evaluation population" onchange="validationScope=this.value;renderContent()">
    <option value="all" ${subset?'':'selected'}>All active purchasers</option>
    <option value="actionable" ${subset?'selected':''}>Coverage expires within ${model.horizon} days</option></select></label>
    <span>Held-out synthetic outcomes through ${esc(evaluation.splits.at(-1).matured_through)}</span></div>` : '';
  return scopeChooser + `<div class="metric-band">
    ${summaryMetric('Average precision', scorePercent(score.pr_auc), interval ? `95% interval ${pct(interval[0])}–${pct(interval[1])}` : 'Precision–recall ranking')}
    ${summaryMetric('ROC AUC', scoreNumber(score.roc_auc), 'Held-out ranking quality')}
    ${summaryMetric('Brier loss', scoreNumber(score.brier), 'Probability error · lower is better')}
    ${summaryMetric('Evaluation customers', fmt(score.population), baseline != null ? `${pct(baseline)} developed inactivity` : 'Held-out customers')}
    </div>
    <section class="ml-section"><div class="ml-section-head"><div><h2>Held-out comparison</h2>
    <p>${evaluation ? 'All three methods scored these '+fmt(score.population)+' customers on '+esc(evaluation.test_date)+'.' : 'Metrics from the recorded test population.'}</p></div></div>
    ${recordTable(comparisons.filter(([,value])=>value).map(([name, value])=>({
      Model:name, 'Average precision':scorePercent(value.pr_auc), 'ROC AUC':scoreNumber(value.roc_auc),
      'Brier loss':scoreNumber(value.brier), 'Top 20% precision':scorePercent(value.precision_at_k)
    })))}${deltaInterval ? `<p class="ml-inset-note">Change in average precision versus the previous model · paired 95% bootstrap interval ${(100*deltaInterval[0]).toFixed(1)} to ${(100*deltaInterval[1]).toFixed(1)} percentage points.</p>` : ''}</section>
    ${capacity.length ? `<section class="ml-section"><div class="ml-section-head"><div><h2>Ranking by contact capacity</h2>
    <p>Observed inactivity among the highest-scoring held-out customers.</p></div></div>
    ${recordTable(capacity.map(row=>({'Top share':pct(row.fraction),'Reviewed':fmt(row.count),'Observed cases':fmt(row.hits),
      'Precision':scorePercent(row.precision),...(row.precision_ci95 ? {'95% precision interval':row.precision_ci95.map(scorePercent).join('–')} : {}),
      'Recall':scorePercent(row.recall),'Lift':scoreLift(row.lift)})))}</section>` : ''}
    <div class="two-grid ml-performance">
      ${panel('Classification threshold', `Risk cutoff ${pct(model.threshold)} · precision ${scorePercent(score.precision)} · recall ${scorePercent(score.recall)}`,
        recordTable([{Actual:'Stayed active','Predicted active':score.confusion[0][0],'Predicted inactive':score.confusion[0][1]},
          {Actual:'Became inactive','Predicted active':score.confusion[1][0],'Predicted inactive':score.confusion[1][1]}])+
        `<p class="ml-footnote">${esc(evaluation?.threshold_policy || 'Recorded operating point. Workspace risk bands use the cutoffs in Settings.')}</p>`)}
      ${panel('Probability calibration','Within each score bin, compare mean predictions with observed inactivity.',recordTable(score.calibration.map(([p,o])=>({
        'Predicted':scorePercent(p),'Observed':scorePercent(o),'Difference':((p-o)*100).toFixed(1)+' pp'
      }))))}</div><div class="method-note"><b>Prediction target</b><p>${esc(target)}</p>
      <small>All measured performance comes from synthetic customer histories.</small></div>`;
}

function modelDesign() {
  const model = D.model, evaluation = model.evaluation;
  let body;
  if (modelTab === 'Performance') {
    body = validationPerformance(model);
  } else if (modelTab === 'Monitoring') {
    const counts = model.population_counts;
    body = `${counts ? `<section class="ml-section"><div class="ml-section-head"><div><h2>Scoring coverage</h2><p>Customer eligibility on ${esc(D.asOf)}</p></div></div>${recordTable([
      {'Customer group':'Coverage can expire within the forecast window',Customers:fmt(counts.model),Score:'Calibrated probability'},
      {'Customer group':'Covered through the forecast window',Customers:fmt(counts.covered_through_horizon),Score:'0% under the refill rule'},
      {'Customer group':'Already inactive',Customers:fmt(counts.already_inactive),Score:'Unscored'},
      {'Customer group':'No completed purchase',Customers:fmt(counts.no_purchase),Score:'Unscored'}
    ])}</section>` : ''}<div class="ml-section-head"><div><h2>Feature drift and completeness</h2><p>Current eligible customers compared with training.</p></div></div>
      ${recordTable(model.monitoring.map(r=>({Feature:featureLabel(r.feature),Missing:scorePercent(r.missing_rate),
        'Mean shift / training σ':scoreNumber(r.standardised_shift,2),'Review':r.standardised_shift>1?'Investigate':'Within threshold'})))}
      <div class="section-heading spaced"><h2>Current risk distribution</h2></div>${compactDistribution(customers)}
      <p class="ml-footnote">A later evaluation requires matching these scores to observed outcomes after the forecast window.</p>`;
  } else {
    body = `<div class="ml-section-head"><div><h2>Model record</h2><p>${esc(model.selected)} · ${esc(model.version)}</p></div>
      <button onclick="trainingInfo()">Training controls</button></div>
      ${recordTable([{Field:'Data snapshot',Value:model.dataset_version},{Field:'Trained',Value:model.trained},
        {Field:'Features',Value:model.features.length},{Field:'Scored customers',Value:fmt(model.scored)},
        {Field:'Refill grace',Value:model.grace+' days'}, {Field:'Release checks',Value:model.accepted?'Passed':'Review required'}])}
      ${evaluation?.splits?.length ? `<section class="ml-section"><div class="ml-section-head"><div><h2>Evaluation partitions</h2>
        <p>Customers and observation dates used during development and final evaluation.</p></div></div>${validationPartitionTable(evaluation)}</section>` : ''}
      <section class="ml-section"><div class="ml-section-head"><h2>Performance by product</h2></div>
      ${recordTable(model.subgroups.map(row=>({Product:row.product,Customers:fmt(row.population),Precision:scorePercent(row.precision),
        Recall:scorePercent(row.recall),'Average precision':scorePercent(row.pr_auc),'Brier loss':scoreNumber(row.brier)})))}</section>
      <div class="method-note"><b>Evidence available</b><p>${esc(model.explanation)}</p>
      <small>Missing data sources include ${esc(model.unavailable.join(', '))}.</small></div>`;
  }
  return header('Model intelligence','Evaluate commercial inactivity predictions against observed outcomes.',false) +
    `<div class="model-status"><span class="badge">Active model</span><code>${esc(model.version)}</code>
    <span>${esc(model.selected)}</span><span>${fmt(model.horizon)}-day horizon</span></div>`+
    tabs(['Performance','Monitoring','Model record'], modelTab, 'modelTab') + body;
}
