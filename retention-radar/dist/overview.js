/* Observed retention across the reporting window, using the same purchase cutoff as metrics(). */
function overviewSnapshots(list) {
  const day = 86400000;
  const end = date(D.asOf).getTime();
  const count = Math.min(period, 24);
  const snapshots = Array.from({length: count + 1}, (_, index) => {
    const time = end - (period - Math.round(period * index / count)) * day;
    return {date: new Date(time).toISOString().slice(0, 10), time, eligible: 0, active: 0};
  });
  for (const customer of list) {
    const orders = customer.completed;
    let order = 0;
    let activeUntil = -Infinity;
    for (const point of snapshots) {
      while (order < orders.length && orders[order].date < point.date) {
        activeUntil = date(orders[order].date).getTime() + (customer.cycle + settings.grace) * day;
        order++;
      }
      if (order) {
        point.eligible++;
        if (point.time <= activeUntil) point.active++;
      }
    }
  }
  return snapshots;
}

let overviewCache;
function overviewData() {
  const scope = [period, productFilter, channelFilter, settings.grace, D.asOf].join('|');
  if (overviewCache?.customers === customers && overviewCache.scope === scope) return overviewCache;
  const list = scoped();
  const current = metrics(list);
  const snapshots = overviewSnapshots(list);
  const risks = Object.fromEntries(Object.keys(colors).map(key => [key, 0]));
  const products = D.products.filter(p => !productFilter || String(p.id + 1) === productFilter)
    .map(p => ({product: p, count: 0, active: 0, exposure: 0}));
  const productMap = new Map(products.map(row => [row.product.id, row]));
  for (const customer of list) {
    risks[customer.risk]++;
    const row = productMap.get(customer.product);
    const last = customer.completed.findLast(order => order.date < D.asOf);
    if (!row || !last) continue;
    row.count++;
    row.active += days(D.asOf, last.date) <= customer.cycle + settings.grace;
    if (['High', 'Critical'].includes(customer.risk)) row.exposure += customer.revenue * customer.probability;
  }
  const priority = list.filter(c => c.probability != null)
    .sort((a, b) => b.revenue * b.probability - a.revenue * a.probability)
    .slice(0, 5);
  overviewCache = {customers, scope, list, current, snapshots, risks, products, priority};
  return overviewCache;
}

function overviewIcon(name) {
  const paths = {
    people: '<path d="M16 20v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M16 4a4 4 0 0 1 0 8m3 3a4 4 0 0 1 2 3v2"/><circle cx="10" cy="7" r="4"/>',
    risk: '<path d="M12 3 3.4 19a1 1 0 0 0 .9 1.5h15.4a1 1 0 0 0 .9-1.5L12 3ZM12 9v4m0 3h.01"/>',
    pulse: '<path d="M2 12h5l3-7 4 14 3-7h5"/>',
    value: '<path d="M5 6h14v13H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2l11-2v3m-1 6h5v4h-5z"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18"/>',
    download: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4"/>',
    filter: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Zm-8 4.5 8 4.5 8-4.5M12 12v9"/>',
    arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-9h.01"/>'
  };
  return `<svg class="ov-icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`;
}

function overviewMetric(icon, label, value, detail) {
  return `<div class="ov-metric summary-metric"><span class="ov-metric-label">${overviewIcon(icon)}${label}</span>
    <strong>${value}</strong><span class="ov-metric-detail">${detail}</span></div>`;
}

function overviewTrend(data) {
  const retention = overviewMode === 'Retention';
  const points = data.snapshots.filter(point => point.eligible).map(point => ({
    ...point, rate: retention ? point.active / point.eligible : 1 - point.active / point.eligible
  }));
  const opening = data.snapshots[0];
  const first = points[0];
  const last = points.at(-1);
  const delta = first && last ? (last.rate - first.rate) * 100 : 0;
  let plot = '<div class="ov-plot-empty">No completed purchases in this period.</div>';
  if (points.length) {
    const values = points.map(point => point.rate);
    const min = Math.min(...values), max = Math.max(...values);
    const step = [.005, .01, .025, .05, .1, .2, .25].find(size => size * 4 >= max - min) || .25;
    const low = Math.max(0, Math.min(1 - 4 * step, Math.floor(min / step) * step));
    const high = Math.min(1, Math.max(low + 4 * step, Math.ceil(max / step) * step));
    const width = 600, height = 130;
    const coordinates = points.map(point => ({
      x: (point.time - opening.time) / (period * 86400000) * width,
      y: 3 + (high - point.rate) / (high - low) * (height - 6)
    }));
    const line = trendPath(coordinates);
    const grid = Array.from({length: 5}, (_, i) => {
      const value = (high - (high - low) * i / 4) * 100;
      const top = (3 + i * (height - 6) / 4) / height * 100;
      return `<span class="ov-gridline" style="top:${top}%"><span>${Number(value.toFixed(1))}%</span></span>`;
    }).join('');
    const hits = coordinates.map((point, i) => {
      const x = point.x / width * 100, y = point.y / height * 100;
      const label = short(points[i].date);
      const value = pct(points[i].rate);
      const left = i ? (coordinates[i - 1].x + point.x) / 2 : point.x;
      const right = i < coordinates.length - 1 ? (coordinates[i + 1].x + point.x) / 2 : width;
      return `<button class="ov-hit" tabindex="${i === coordinates.length - 1 ? 0 : -1}" data-index="${i}" aria-label="${label}, ${overviewMode.toLowerCase()} ${value}" style="left:${left / width * 100}%;width:${(right - left) / width * 100}%;--dot-x:${right > left ? (point.x - left) / (right - left) * 100 : 0}%;--dot-y:${y}%">
        <span class="ov-crosshair"></span><i></i><span class="ov-tip ${x < 15 ? 'ov-tip-left' : x > 85 ? 'ov-tip-right' : ''}">${label} · ${value}</span></button>`;
    }).join('');
    const endPoint = coordinates.at(-1);
    plot = `<div class="ov-plot"><div class="ov-plot-body">${grid}
      <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
        <defs><linearGradient id="overview-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#229780" stop-opacity=".26"/><stop offset="100%" stop-color="#229780" stop-opacity=".025"/></linearGradient></defs>
        <path class="ov-area" d="${line} L${endPoint.x} ${height} L${coordinates[0].x} ${height} Z" fill="url(#overview-area)"/>
        <path class="ov-line" pathLength="1" d="${line}" fill="none" stroke="#157563" stroke-width="2.5" vector-effect="non-scaling-stroke"/>
      </svg><span class="ov-endpoint" style="left:${endPoint.x / width * 100}%;top:${endPoint.y / height * 100}%"></span>
      <div class="ov-hit-area" role="group" aria-label="Observed ${overviewMode.toLowerCase()}. Use left and right arrows to explore.">${hits}</div></div>
      <div class="ov-x-axis">${[0, 6, 12, 18, 24].map(i => `<span>${short(data.snapshots[i].date)}</span>`).join('')}</div></div>`;
  }
  return `<section class="ov-card ov-history"><div class="ov-card-heading"><div><h2>Customer health</h2><p>Observed refill behaviour</p></div>
    ${tabs(['Retention', 'Inactivity'], overviewMode, 'overviewMode')}</div>
    <div class="ov-chart-stat"><strong>${last ? pct(last.rate) : '—'}</strong>${last && opening.eligible ? `<span>${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)} pp since ${short(opening.date)}</span>` : ''}</div>
    ${plot}<div class="ov-chart-footer"><span>Repeat purchase <b>${pct(data.current.repeat)}</b></span><span>Value per purchaser <b>${money(data.current.clv)}</b></span></div></section>`;
}

const overviewRiskColors = {Low: '#3a8875', Medium: '#d8b75b', High: '#d68861', Critical: '#b46263', Unscored: '#b8c6c4'};
function overviewRisk(data) {
  const total = data.list.length;
  let start = 0;
  const segments = Object.entries(data.risks).map(([risk, count]) => {
    const length = total ? count / total * 100 : 0;
    const gap = length === 100 ? 0 : Math.min(.65, length / 3);
    const arc = length ? `<circle data-risk="${risk}" cx="80" cy="80" r="64" pathLength="100" stroke="${overviewRiskColors[risk]}" stroke-dasharray="${length - gap} ${100 - length + gap}" stroke-dashoffset="${-start}" transform="rotate(-90 80 80)"/>` : '';
    start += length;
    return arc;
  }).join('');
  const legend = Object.entries(data.risks).map(([risk, count]) =>
    `<button class="ov-risk-row" data-risk="${risk}" data-count="${fmt(count)}" onclick="riskFilter='${risk}';navigate('Customer Intelligence',true)" aria-label="Show ${fmt(count)} ${risk.toLowerCase()} customers">
      <span><i style="background:${overviewRiskColors[risk]}"></i>${risk}</span><b>${fmt(count)}</b><small>${total ? pct(count / total) : '—'}</small></button>`).join('');
  return `<aside class="ov-card ov-risk" data-total="${fmt(total)}"><div class="ov-card-heading"><div><h2>Risk composition</h2><p>Current customer distribution</p></div></div>
    <div class="ov-risk-body"><div class="ov-ring"><svg viewBox="0 0 160 160" aria-hidden="true"><circle cx="80" cy="80" r="64" stroke="#e8edec"/>${segments}</svg>
    <div><strong>${fmt(total)}</strong><small>customers</small></div></div><div class="ov-risk-legend">${legend}</div></div>
    <div class="ov-risk-note">Unscored customers fall outside the model population.</div></aside>`;
}

function overviewProducts(rows) {
  return `<section class="ov-card ov-products"><div class="ov-card-heading"><div><h2>Product retention</h2><p>Purchasers within their expected refill window</p></div></div>
    ${rows.map(({product, count, active}) => {
      const value = count ? active / count : 0;
      return `<button class="ov-product-row" onclick="productFilter='${product.id + 1}';navigate('Customer Intelligence',true)"><span>${esc(product.name)}</span><b>${count ? pct(value) : '—'}</b><i><em style="width:${value * 100}%"></em></i></button>`;
    }).join('')}
    <button class="ov-text-link" onclick="navigate('Product Analytics')">Compare products ${overviewIcon('arrow')}</button></section>`;
}

overviewDesign = function () {
  const data = overviewData();
  const m = data.current;
  const opening = data.snapshots[0];
  const change = opening.active ? (m.active - opening.active) / opening.active * 100 : null;
  const activeContext = change == null ? 'Within expected refill window' :
    `<em class="ov-change">${change >= 0 ? '+' : '−'}${Math.abs(change).toFixed(1)}%</em> since ${short(opening.date)}`;
  return `<div class="ov-heading page-head"><div><h1>Retention overview</h1><p>Customer health and revenue exposure across your portfolio.</p></div>
    <div class="ov-tools"><label class="ov-select">${overviewIcon('filter')}<select aria-label="Overview product filter" onchange="productFilter=this.value;renderContent()"><option value="">All products</option>${D.products.map(p => `<option value="${p.id + 1}" ${productFilter === String(p.id + 1) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
    <label class="ov-select">${overviewIcon('calendar')}${dateControl()}</label><button class="ov-export" onclick="exportReport('summary')">${overviewIcon('download')}Export report</button></div></div>
    <div class="ov-metrics">${overviewMetric('people', 'Active customers', fmt(m.active), activeContext)}${overviewMetric('risk', 'Customers at risk', fmt(m.riskn), 'High and critical risk')}${overviewMetric('pulse', 'Predicted inactivity', pct(m.pred), 'Next 30 days · scored customers')}${overviewMetric('value', 'Revenue exposure', money(m.atrisk), 'Risk-weighted historical value')}</div>
    <div class="ov-analysis">${overviewTrend(data)}${overviewRisk(data)}</div>
    <div class="ov-lower">${customerTable(data.priority, 'Priority customers', 'Ranked by predicted risk × historical revenue', false, true)}${overviewProducts(data.products)}</div>
    <div class="ov-reference"><details class="ov-exposure"><summary>Revenue exposure by product</summary><div>${data.products.map(({product, exposure}) => `<button onclick="productFilter='${product.id + 1}';navigate('Customer Intelligence',true)"><span>${esc(product.name)}</span><b>${money(exposure)}</b></button>`).join('')}</div></details>
    <button class="ov-text-link" onclick="openDefinitions()">${overviewIcon('info')}Metric definitions</button></div>`;
};

function previewOverviewRisk(row, card) {
  const risk = row?.dataset.risk;
  card.querySelector('.ov-ring strong').textContent = row?.dataset.count || card.dataset.total;
  card.querySelector('.ov-ring small').textContent = risk ? (risk === 'Unscored' ? risk : risk + ' risk') : 'customers';
  for (const segment of card.querySelectorAll('circle[data-risk]')) {
    segment.classList.toggle('ov-muted-arc', Boolean(risk) && segment.dataset.risk !== risk);
  }
}
for (const eventName of ['pointerover', 'focusin']) {
  document.addEventListener(eventName, event => {
    const row = event.target.closest?.('.ov-risk-row');
    if (row) previewOverviewRisk(row, row.closest('.ov-risk'));
  });
}
for (const eventName of ['pointerout', 'focusout']) {
  document.addEventListener(eventName, event => {
    const row = event.target.closest?.('.ov-risk-row');
    if (row && !row.contains(event.relatedTarget)) previewOverviewRisk(null, row.closest('.ov-risk'));
  });
}
document.addEventListener('keydown', event => {
  const point = event.target.closest?.('.ov-hit');
  if (!point || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const points = [...point.parentElement.children];
  const index = Number(point.dataset.index);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? points.length - 1 :
    Math.max(0, Math.min(points.length - 1, index + (event.key === 'ArrowLeft' ? -1 : 1)));
  point.tabIndex = -1;
  points[next].tabIndex = 0;
  points[next].focus();
});
