/* Built-in fictional photos; all numeric report values come from ProgressML inference. */
(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const dataset = 'synthetic-crown-v1';
  const cacheKey = 'progresscheck-demo-analysis-v1';
  const samples = ['2026-09-07','2026-09-14','2026-09-21','2026-09-28'].map((date, week) => ({
    id: `demo-week-${week}`, week, date, view: `Crown · Week ${week}`, url: `/demo-samples/week-${week}.${week ? 'png' : 'jpg'}`
  }));
  let selected = 3, result = null, busy = false, controller = null, overlay = false;
  const percent = n => `${n.toFixed(2)}%`;
  const points = n => `${n > 0 ? '+' : ''}${n.toFixed(2)} pp`;
  const label = s => s.week ? `Week ${s.week}` : 'Week 0 · Baseline';
  const observation = i => result?.observations.find(o => o.photoId === samples[i].id);
  const valid = r => r?.status === 'complete' && r.modelVersion === window.ProgressML?.modelVersion && r.observations?.length === samples.length && samples.every(s => r.observations.filter(o => o.photoId === s.id && Number.isFinite(o.hairAreaPercent) && o.hairAreaPercent >= 0 && o.hairAreaPercent <= 100 && o.totalMaskPixels > 0 && Math.abs(o.hairAreaPercent - 100 * o.hairPixelCount / o.totalMaskPixels) < .001).length === 1);
  function storageNotice(text, warning = false) { $('#storage-status').textContent = text; $('#storage-status').classList.toggle('demo-storage-warning', warning); }
  function renderSamples() {
    $('#sample-timeline').innerHTML = samples.map((s,i) => `<button class="demo-week" data-week="${i}" aria-pressed="${selected===i}" aria-label="Compare ${label(s)} with baseline"><img src="${s.url}" alt="AI-generated crown sample, ${label(s)}"><span class="week-copy"><strong>${label(s)}</strong><small>${s.date} · Fictional date</small><span class="week-measure">${observation(i) ? `${percent(observation(i).hairAreaPercent)} image area classified as hair` : 'Ready for ML analysis'}</span></span></button>`).join('');
    document.querySelectorAll('[data-week]').forEach(button => button.onclick = () => {selected = Number(button.dataset.week);renderSamples();renderComparison();});
  }
  function renderComparison() {
    $('#comparison').innerHTML = [0,selected].map(i => `<figure><div class="demo-photo"><img src="${samples[i].url}" alt="Synthetic ${label(samples[i])} crown photograph">${overlay && observation(i)?.maskUrl ? `<img class="mask-image" src="${escape(observation(i).maskUrl)}" alt="Model-derived hair mask for week ${i}">` : ''}<span class="demo-photo-label">SYNTHETIC DEMO IMAGE</span></div><figcaption>${label(samples[i])}${observation(i)?` · ${percent(observation(i).hairAreaPercent)}`:''}</figcaption></figure>`).join('');
  }
  function summary() {
    const first = observation(0).hairAreaPercent, last = observation(3).hairAreaPercent, delta = last-first;
    const direction = delta > .05 ? 'increased' : delta < -.05 ? 'decreased' : 'remained approximately stable';
    return {first,last,delta,direction,heading:delta > .05 ? 'Higher hair-mask area in the final sample' : delta < -.05 ? 'Lower hair-mask area in the final sample' : 'Similar hair-mask area in the first and final samples',text:`From Week 0 to Week 3, the image area classified as hair ${direction}: ${percent(first)} → ${percent(last)} (${points(delta)}). This is a measured difference between synthetic images, not a percentage of hair regrowth.`};
  }
  function chart() {
    const values = samples.map((s,i)=>observation(i).hairAreaPercent);
    const coords = values.map((v,i)=>[70+i*180,180-v*1.4]);
    return `<svg class="demo-chart" viewBox="0 0 680 220" role="img" aria-label="Hair-classified image area over four fictional weeks. Exact values are listed in the table below."><line x1="70" x2="610" y1="180" y2="180" stroke="#bdcbbb"/><line x1="70" x2="610" y1="110" y2="110" stroke="#e0e7dc"/><line x1="70" x2="610" y1="40" y2="40" stroke="#e0e7dc"/><g fill="#5b6c60" font-size="12"><text x="20" y="184">0%</text><text x="14" y="114">50%</text><text x="8" y="44">100%</text></g><polyline points="${coords.map(p=>p.join(',')).join(' ')}" fill="none" stroke="#355d40" stroke-width="3"/>${coords.map(([x,y],i)=>`<circle cx="${x}" cy="${y}" r="5" fill="#355d40"/><text x="${x}" y="${y-13}" text-anchor="middle" fill="#244b3d" font-size="13">${percent(values[i])}</text><text x="${x}" y="207" text-anchor="middle" fill="#5b6c60" font-size="13">Week ${i}</text>`).join('')}</svg>`;
  }
  function renderReport() {
    if (!result) { $('#report').innerHTML = '<section class="panel demo-empty"><div class="eyebrow">03 / YOUR ML REPORT</div><h2>Your report starts with the images.</h2><p>Click “Run ML analysis” to measure all four samples and generate findings. No report values are prefilled.</p></section>';return; }
    const info = summary();
    $('#report').innerHTML = `<section class="panel"><div class="panel-body"><div class="demo-report-head"><div><div class="eyebrow">03 / GENERATED ML DEMO REPORT</div><h2>Weekly image analysis</h2><p>4 synthetic crown images · Week 0–3 · Actual model inference</p></div><div class="demo-report-actions"><button id="print-report" class="btn small">Print / Save PDF</button><button id="download-report" class="btn small">Download JSON</button></div></div><div class="demo-metrics"><div class="demo-metric"><span>BASELINE · HAIR-MASK IMAGE AREA</span><strong>${percent(info.first)}</strong><span>Week 0</span></div><div class="demo-metric"><span>LATEST · HAIR-MASK IMAGE AREA</span><strong>${percent(info.last)}</strong><span>Week 3</span></div><div class="demo-metric"><span>CHANGE FROM BASELINE</span><strong>${points(info.delta)}</strong><span>Percentage points of the full image</span></div></div><div class="demo-findings"><h3>${info.heading}</h3><p>${info.text}</p><p class="small">The sample artwork illustrates fuller-looking hair. The model measures hair-classified pixels; it cannot confirm biological progress or the realism of this fictional timeline.</p></div><h3>Measured weekly trend</h3>${chart()}<div class="table-wrap"><table class="demo-table"><caption class="small muted" style="text-align:left;padding:10px">All percentages use the complete image as their denominator.</caption><thead><tr><th>Sample</th><th>Hair-mask area</th><th>Since baseline</th><th>Quality notes</th></tr></thead><tbody>${samples.map((s,i)=>{const o=observation(i);return `<tr><td>${label(s)}<br><small>${s.date}</small></td><td>${percent(o.hairAreaPercent)}</td><td>${i?points(o.hairAreaPercent-info.first):'Reference'}</td><td>${escape(o.quality?.warnings?.join(' ')||'No heuristic warnings detected. This is not a clinical quality certification.')}</td></tr>`;}).join('')}</tbody></table></div><details class="demo-evidence"><summary>How this report was calculated</summary><p>For each image: 100 × pixels labeled hair ÷ all pixels in the model mask. The report subtracts Week 0 from each later value. A difference within ±0.05 percentage points is described as approximately stable; this is a display convention, not a validated clinical threshold.</p><p>Model: ${escape(result.modelVersion)}<br>Executed: ${escape(result.processedAt)}<br>Runtime: ${escape(result.delegate)} · ${Number(result.processingMs)} ms<br>Dataset: ${dataset}</p><p>The photos were AI-generated and may vary in framing, texture and lighting. No alignment is performed. Image area is not scalp density, follicle count, treatment response or medical accuracy.</p></details><div class="notice warning"><span><strong>Demo interpretation only.</strong> These outputs describe synthetic images. The model is not validated for medical progress assessment. No diagnosis or treatment recommendation is generated.</span></div></div></section>`;
    $('#print-report').onclick = () => window.print();
    $('#download-report').onclick = () => {
      const blob = new Blob([JSON.stringify({demo:true,syntheticImages:true,dataset,samples,summary:summary(),analysis:result},null,2)],{type:'application/json'});
      const url = URL.createObjectURL(blob), a = document.createElement('a');a.href=url;a.download='ProgressCheck-demo-ML-report.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
    };
  }
  function setBusy(value) {busy=value;$('#run-analysis').disabled=value;$('#run-analysis').textContent=value?'Running actual image analysis…':result?'Run ML analysis again':'Run ML analysis · 4 images';$('#cancel-analysis').hidden=!value;$('#analysis-progress').hidden=!value;}
  async function run() {
    if(busy)return;
    controller = new AbortController();setBusy(true);$('#analysis-progress').value=0;
    $('#status').textContent='Loading the model. Your first run may take a moment.';
    try {
      const output = await ProgressML.analyze(samples,stage=>{$('#status').textContent=stage.message;$('#analysis-progress').value=stage.stage==='preparing_report'?5:stage.photoIndex==null?0:stage.photoIndex+1;},{delegate:'CPU',signal:controller.signal});
      if(!valid(output))throw new Error('The model returned incomplete measurements. Retry to generate a complete report.');
      result=output;$('#show-mask').disabled=false;renderSamples();renderComparison();renderReport();
      $('#status').textContent='Analysis complete. Your report below contains measurements from all 4 images.';
      try {localStorage.setItem(cacheKey,JSON.stringify({dataset,result}));storageNotice('Demo report saved in this browser. It is separate from account records.');}catch{storageNotice('Report ready for this visit. Browser storage is unavailable or full; download the report to keep it.',true);}
      $('#report').scrollIntoView({behavior:'smooth',block:'start'});
    }catch(error){$('#status').textContent=(error.name==='AbortError'?'Analysis cancelled. You can run it again.':`Analysis could not finish: ${error.message}`)+(result?' The earlier completed report remains below.':' No findings have been invented.');}
    finally{controller=null;setBusy(false);}
  }
  $('#run-analysis').onclick=run;
  $('#cancel-analysis').onclick=()=>controller?.abort();
  $('#show-mask').onchange=e=>{overlay=e.target.checked;renderComparison();};
  $('#extra-samples').innerHTML=['front','left','right'].map(view=>`<a href="/demo-samples/${view}.jpg" download="ProgressCheck-synthetic-${view}.jpg"><img src="/demo-samples/${view}.jpg" loading="lazy" alt="Synthetic ${view} reference photograph">Download ${view} view ↓</a>`).join('');
  try {const stored=JSON.parse(localStorage.getItem(cacheKey)||'null');if(stored?.dataset===dataset && valid(stored.result)){result=stored.result;$('#status').textContent='Saved demo report restored. Run again to recompute the measurements.';$('#show-mask').disabled=false;storageNotice('Restored from this browser’s demo storage. Account records are separate.');}}catch{storageNotice('Saved demo report could not be restored. You can run a fresh analysis.',true);}
  renderSamples();renderComparison();renderReport();setBusy(false);
})();
