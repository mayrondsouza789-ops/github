/* Shared interaction primitives. No changes to customer calculations or API contracts. */
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
let metricSnapshot = new Map();

function toggleNavigation(force) {
  const open = force ?? !document.body.classList.contains('show-menu');
  document.body.classList.toggle('show-menu', open);
  document.querySelector('.mobile-menu')?.setAttribute('aria-expanded', String(open));
  if (open) document.querySelector('.nav .active')?.focus();
  else document.querySelector('.mobile-menu')?.focus();
}
function toggleSidebar() {
  const collapsed = document.body.classList.toggle('collapsed');
  put('sidebar-collapsed', collapsed);
  const button = document.querySelector('.collapse-btn');
  button?.setAttribute('aria-expanded', String(!collapsed));
  button?.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
}
const radarMark = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 12l6-6"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>';
shell = function () {
  const groups = [['INTELLIGENCE',[0,1,2,3,6,7]],['OPERATIONS',[4,5]],['GOVERNANCE',[8,9]]];
  const nav = groups.map(([label,ids],g) => `<div class="nav-label ${g?'nav-divider':''}">${label}</div>${ids.map(i => {const name=navs[i];return `<button title="${name}" aria-current="${view===name?'page':'false'}" class="${view===name?'active':''}" onclick="navigate('${name}')"><span class="nav-icon">${navIcon(i)}</span><span class="label">${name}</span>${i===4?`<span class="count">${interventions.filter(x=>!['Resolved','Unsuccessful'].includes(x.status)).length}</span>`:''}</button>`}).join('')}`).join('');
  document.body.classList.toggle('collapsed', getStore('sidebar-collapsed', false));
  document.getElementById('app').innerHTML = `<a class="skip-link" href="#content" onclick="event.preventDefault();document.getElementById('content').focus()">Skip to workspace</a><button class="nav-scrim" aria-label="Close navigation" onclick="toggleNavigation(false)"></button><aside class="sidebar" aria-label="Workspace navigation"><div class="brand"><span class="brand-icon">${radarMark}</span><span class="brand-text">Retention<span class="brand-second">Radar</span></span></div><button class="collapse-btn" aria-label="${document.body.classList.contains('collapsed')?'Expand':'Collapse'} sidebar" aria-expanded="${!document.body.classList.contains('collapsed')}" onclick="toggleSidebar()">‹</button><div class="workspace"><span class="mm">m.</span><div><strong>Man Matters</strong><small>Customer intelligence</small></div></div><nav class="nav">${nav}</nav><div class="side-bottom"><button class="settings-link" title="Settings" onclick="navigate('Settings')">${navIcon(10)}<span class="label">Workspace settings</span></button><div class="user"><span class="avatar">AS</span><div><strong>Ananya Sharma</strong><small>${esc(settings.role)}</small></div></div></div></aside><main class="main"><header class="topbar"><div class="crumb-group"><button class="mobile-menu" aria-label="Toggle navigation" aria-expanded="false" onclick="toggleNavigation()">☰</button><span class="breadcrumb">Workspace <span class="slash">/</span> <b>${view}</b></span></div><div class="top-actions"><input aria-label="Global customer search" placeholder="Find a customer…" onkeydown="if(event.key==='Enter'){query=this.value;navigate('Customer Intelligence',true)}"><span class="workspace-status"><i></i> Demo workspace</span></div></header><div class="demo"><span class="demo-label">SYNTHETIC DATA</span><span>A demonstration. No actual Man Matters customer records.</span><span>Snapshot · 01 Nov 2026</span></div><section class="content" id="content" tabindex="-1"></section></main>`;
  renderContent();
};

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
