/* Shared interaction primitives. No changes to customer calculations or API contracts. */
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
let metricSnapshot = new Map();

const mobileLayout = matchMedia('(max-width: 850px)');
const shellPaths = {
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  collapse: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16m7-11-3 3 3 3"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>'
};

function shellIcon(name) {
  return `<svg class="shell-icon" viewBox="0 0 24 24" aria-hidden="true">${shellPaths[name]}</svg>`;
}

function syncMenuAccess() {
  const open = mobileLayout.matches && document.body.classList.contains('show-menu');
  const sidebar = document.querySelector('.sidebar');
  const main = document.querySelector('.main');
  if (!sidebar || !main) return;
  sidebar.inert = mobileLayout.matches && !open;
  main.inert = open;
  document.querySelector('.mobile-menu').setAttribute('aria-expanded', String(open));
}

function toggleNavigation(force) {
  const open = force ?? !document.body.classList.contains('show-menu');
  document.body.classList.toggle('show-menu', open);
  syncMenuAccess();
  if (open) document.querySelector('.sidebar [aria-current="page"]')?.focus();
  else document.querySelector('.mobile-menu')?.focus();
}

mobileLayout.addEventListener('change', () => {
  document.body.classList.remove('show-menu');
  syncMenuAccess();
});

function toggleSidebar() {
  const collapsed = document.body.classList.toggle('collapsed');
  put('sidebar-collapsed', collapsed);
  const button = document.querySelector('.collapse-btn');
  button.setAttribute('aria-expanded', String(!collapsed));
  button.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
}

const radarMark = '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="12"/><circle cx="16" cy="16" r="7.5"/><path d="M16 16 27 5"/><circle class="radar-contact" cx="22" cy="10" r="2.4"/><circle class="radar-origin" cx="16" cy="16" r="1.7"/></svg>';

const menuGroups = [
  ['Workspace', [[0,'Overview'],[1,'Customers'],[2,'Churn intelligence'],[3,'Segments']]],
  ['Operations', [[4,'Retention actions'],[5,'Campaigns']]],
  ['Analytics', [[6,'Cohorts'],[7,'Products'],[8,'Model intelligence'],[9,'Reports']]]
];

function workspaceNavigation() {
  return menuGroups.map(([heading, items]) => `
    <div class="nav-label">${heading}</div>
    ${items.map(([index, label]) => `<button type="button" title="${navs[index]}"
        aria-label="${navs[index]}" data-route="${navs[index]}" onclick="navigate('${navs[index]}')">
      <span class="nav-icon">${navIcon(index)}</span><span class="label">${label}</span>
      ${index === 4 ? '<span class="count" aria-hidden="true"></span>' : ''}
    </button>`).join('')}`).join('');
}

function findCustomer(event) {
  event.preventDefault();
  const search = document.getElementById('workspace-search');
  const term = search.value.trim();
  // A global search starts with every customer, including after a scoped drill-down.
  query = term;
  riskFilter = segmentFilter = productFilter = channelFilter = valueFilter = lastFilter = frequencyFilter = '';
  filtersExpanded = true;
  navigate('Customer Intelligence', true);
  const listSearch = document.querySelector('.filters input');
  listSearch?.focus({preventScroll: true});
}

function mountWorkspace(app) {
  const collapsed = getStore('sidebar-collapsed', false);
  document.body.classList.toggle('collapsed', collapsed);
  const shortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K';
  app.innerHTML = `
    <a class="skip-link" href="#content" onclick="event.preventDefault();document.getElementById('content').focus()">Skip to workspace</a>
    <button class="nav-scrim" type="button" tabindex="-1" aria-label="Close navigation" onclick="toggleNavigation(false)"></button>
    <aside class="sidebar" id="workspace-sidebar" aria-label="Workspace navigation">
      <div class="brand"><span class="brand-icon">${radarMark}</span><span class="brand-text">Retention Radar</span></div>
      <button class="collapse-btn" type="button" aria-label="${collapsed ? 'Expand' : 'Collapse'} sidebar"
        aria-controls="workspace-sidebar" aria-expanded="${!collapsed}" onclick="toggleSidebar()">${shellIcon('collapse')}</button>
      <div class="workspace"><span class="mm" aria-hidden="true">m.</span>
        <div><strong>Man Matters</strong><small>Retention workspace</small></div></div>
      <nav class="nav" aria-label="Main navigation">${workspaceNavigation()}</nav>
      <div class="side-bottom">
        <button type="button" class="settings-link" title="Settings" aria-label="Settings"
          data-route="Settings" onclick="navigate('Settings')">${navIcon(10)}<span class="label">Settings</span></button>
        <div class="user"><span class="avatar">AS</span><div><strong>Ananya Sharma</strong><small class="user-role"></small></div></div>
      </div>
    </aside>
    <main class="main" data-radar-shell>
      <header class="topbar"><div class="crumb-group">
        <button class="mobile-menu" type="button" aria-label="Toggle navigation"
          aria-controls="workspace-sidebar" aria-expanded="false" onclick="toggleNavigation()">${shellIcon('menu')}</button>
        <span class="breadcrumb"><span class="crumb-workspace">Workspace</span>${shellIcon('chevron')}<b class="current-workspace"></b></span>
      </div><div class="top-actions">
        <form class="global-search" role="search" onsubmit="findCustomer(event)">${shellIcon('search')}
          <input type="search" id="workspace-search" aria-label="Global customer search" placeholder="Find a customer…" autocomplete="off">
          <kbd aria-hidden="true">${shortcut}</kbd></form>
        <span class="workspace-status" title="This workspace uses synthetic customer records"><i></i>Synthetic data</span>
      </div></header>
      <section class="content" id="content" tabindex="-1" aria-label="Workspace content"></section>
    </main>`;
}

shell = function () {
  const app = document.getElementById('app');
  if (!app.querySelector('[data-radar-shell]')) mountWorkspace(app);
  const active = document.activeElement;
  const returningFromMenu = mobileLayout.matches && active?.closest('.sidebar');
  for (const button of app.querySelectorAll('[data-route]')) {
    const current = button.dataset.route === view;
    button.classList.toggle('active', current);
    if (current) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  app.querySelector('.current-workspace').textContent = view;
  app.querySelector('.user-role').textContent = settings.role;
  const count = app.querySelector('.nav .count');
  const outstanding = interventions.filter(item => !['Resolved','Unsuccessful'].includes(item.status)).length;
  count.textContent = outstanding;
  count.hidden = !outstanding;
  const search = app.querySelector('#workspace-search');
  if (document.activeElement !== search) search.value = '';
  document.title = `${view} · Retention Radar`;
  syncMenuAccess();
  renderContent();
  if (returningFromMenu) app.querySelector('#content').focus({preventScroll: true});
};

document.addEventListener('keydown', event => {
  const search = document.getElementById('workspace-search');
  if (!search || document.querySelector('.drawer') || document.body.classList.contains('show-menu')) return;
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    search.focus();
    search.select();
  } else if (event.key === 'Escape' && document.activeElement === search) {
    search.value = '';
    search.blur();
  }
});

/* Horizontal Bezier tangents stay inside the endpoint range; no invented extrema. */
function trendPath(points) {
  return points.map((p,i)=>{if(!i)return `M${p.x},${p.y}`;const prev=points[i-1],mid=(prev.x+p.x)/2;return `C${mid},${prev.y} ${mid},${p.y} ${p.x},${p.y}`}).join(' ');
}
lineChart = function (data, keys, cols, percent=true) {
  if (!data.length) return '<div class="empty"><strong>No trend available</strong>Adjust the reporting filters to include more records.</div>';
  const w=600,h=240,left=57,right=582,top=20,bottom=204;
  const maximum=Math.max(...data.flatMap(d=>keys.map(k=>Number(d[k])||0)),.01)*1.16;
  const format=value=>percent?pct(value):money(value);
  const seriesMarkup=keys.map((key,j)=>{
    const points=data.map((d,i)=>({x:left+i*(right-left)/Math.max(1,data.length-1),y:bottom-(Number(d[key])||0)/maximum*(bottom-top)}));
    const path=trendPath(points),color=cols[j]||'#35654b';
    return `${keys.length===1?`<path d="${path} L${points.at(-1).x},${bottom} L${left},${bottom} Z" fill="${color}" opacity=".045"/>`:''}<path class="trend-line" d="${path}" pathLength="1" stroke="${color}"/>${points.map((p,i)=>`<g class="trend-point" tabindex="0" role="img" aria-label="${esc(data[i].label+' · '+key+': '+format(data[i][key]))}" data-label="${esc(data[i].label+' · '+key)}" data-value="${esc(format(data[i][key]))}" onpointerenter="showTrendPoint(this)" onpointerleave="hideTrendPoint(this)" onfocus="showTrendPoint(this)" onblur="hideTrendPoint(this)"><line class="point-guide" x1="${p.x}" x2="${p.x}" y1="${top}" y2="${bottom}"/><circle cx="${p.x}" cy="${p.y}" r="3" stroke="${color}"/><circle cx="${p.x}" cy="${p.y}" r="13" style="fill:transparent;stroke:none"/></g>`).join('')}`;
  }).join('');
  return `<div class="trend-chart"><svg class="trend-svg" viewBox="0 0 ${w} ${h}" role="group" aria-label="Monthly ${keys.join(' and ')} trend">${[0,1,2,3,4].map(i=>{const y=top+i*(bottom-top)/4;return `<line class="chart-grid" x1="${left}" x2="${right}" y1="${y}" y2="${y}"/><text x="${left-10}" y="${y+4}" text-anchor="end">${format(maximum*(1-i/4))}</text>`}).join('')}${seriesMarkup}${data.map((d,i)=>`<text x="${left+i*(right-left)/Math.max(1,data.length-1)}" y="232" text-anchor="middle">${esc(d.label)}</text>`).join('')}</svg><div class="chart-tooltip" aria-hidden="true"></div>${keys.length>1?`<div class="chart-legend">${keys.map((k,i)=>`<span><i style="background:${cols[i]}"></i>${esc(k)}</span>`).join('')}</div>`:''}</div>`;
};
function showTrendPoint(point) {
  const chart=point.closest('.trend-chart'),tip=chart.querySelector('.chart-tooltip'),bounds=chart.getBoundingClientRect(),dot=point.querySelector('circle').getBoundingClientRect();
  tip.innerHTML=`${esc(point.dataset.label)}<b>${esc(point.dataset.value)}</b>`;
  const half=tip.offsetWidth/2;
  tip.style.left=Math.max(half,Math.min(bounds.width-half,dot.x-bounds.x+dot.width/2))+'px';
  tip.style.top=Math.max(0,dot.y-bounds.y-tip.offsetHeight-12)+'px';
  tip.classList.add('visible');
}
function hideTrendPoint(point){point.closest('.trend-chart').querySelector('.chart-tooltip').classList.remove('visible')}

function animateMetrics() {
  const nodes=document.querySelectorAll('.summary-metric strong');
  nodes.forEach((node,index)=>{
    const final=node.textContent, key=view+':'+index, numeric=Number(final.replace(/[^0-9.-]/g,'')),previous=metricSnapshot.get(key);
    metricSnapshot.set(key,final);
    if(reducedMotion()||!Number.isFinite(numeric)||previous===final)return;
    // Stable accessible value while the visible numeral settles into place.
    node.setAttribute('aria-label',final);
    const from=previous&&previous.replace(/[0-9.,-]/g,'')===final.replace(/[0-9.,-]/g,'')?Number(previous.replace(/[^0-9.-]/g,'')):numeric*.94;
    const decimals=(final.match(/\.(\d+)/)?.[1].length)||0,start=performance.now();
    function frame(now){if(!node.isConnected)return;const t=Math.min(1,(now-start)/420),value=from+(numeric-from)*(1-Math.pow(1-t,3));node.textContent=t===1?final:final.replace(/[0-9][0-9,.]*/,value.toLocaleString('en-IN',{minimumFractionDigits:decimals,maximumFractionDigits:decimals}));if(t<1)requestAnimationFrame(frame)}
    requestAnimationFrame(frame);
  });
}
const renderWorkspace=renderContent;
renderContent=function(){
  const focused=document.activeElement,focusLabel=focused?.getAttribute('aria-label'),selectedTab=focused?.getAttribute('role')==='tab';
  renderWorkspace();
  document.querySelectorAll('.section-tabs[role=tablist] button').forEach(button=>{button.tabIndex=button.getAttribute('aria-selected')==='true'?0:-1});
  document.querySelectorAll('.heat td[style]').forEach(cell=>{const match=cell.style.background.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/);if(match&&Number(match[1])>.5)cell.style.color='#fff'});
  const empty=document.querySelector('[data-view="Customer Intelligence"] .empty');
  if(empty)empty.innerHTML='<strong>No customers match these filters</strong>Try a broader search or return to the full customer list.<button onclick="navigate(\'Customer Intelligence\')">Clear filters</button>';
  if(selectedTab)document.querySelector('[role=tab][aria-selected=true]')?.focus();
  else if(focusLabel)Array.from(document.querySelectorAll('[aria-label]')).find(el=>el.getAttribute('aria-label')===focusLabel)?.focus();
  document.querySelectorAll('tr[tabindex]').forEach(row=>row.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();event.stopImmediatePropagation();row.click()}},{capture:true}));
  animateMetrics();
};
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&document.body.classList.contains('show-menu'))toggleNavigation(false);
  if(event.key==='Tab'&&document.body.classList.contains('show-menu')){const buttons=[...document.querySelectorAll('.sidebar button')].filter(el=>el.offsetParent!==null);const first=buttons[0],last=buttons.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}}
});
