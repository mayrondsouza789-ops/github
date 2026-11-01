(function (root) {
  'use strict';
  const regions = [
    { view: 'Front', name: 'Frontal hairline' }, { view: 'Left', name: 'Left temple' },
    { view: 'Right', name: 'Right temple' }, { view: 'Top', name: 'Mid-scalp' }, { view: 'Crown', name: 'Crown' }
  ];
  const finite = n => typeof n === 'number' && Number.isFinite(n);
  const number = n => finite(n) ? n.toFixed(2) : 'Not measured';
  const validDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
  const days = (a, b) => validDate(a) && validDate(b) ? Math.round((Date.parse(b) - Date.parse(a)) / 86400000) : null;
  const observation = (s, p) => p && s?.analysis?.observations?.find(o => o.photoId === p.id);
  const measurement = o => finite(o?.hairAreaPercent) && o.hairAreaPercent >= 0 && o.hairAreaPercent <= 100 ? o.hairAreaPercent : null;
  function quality(o, p) {
    const q = o?.quality || p?.captureQuality;
    if (!q) return { available: false, warnings: ['Image quality has not been measured.'] };
    const warnings = [...(Array.isArray(q.warnings) ? q.warnings.filter(x => typeof x === 'string') : [])];
    if (finite(q.brightness) && (q.brightness < 45 || q.brightness > 215)) warnings.push('Lighting falls outside the experimental brightness range (45-215 / 255). Retake in even light.');
    if (finite(q.sharpness) && q.sharpness < 65) warnings.push('Low detail: hold the camera steady, focus on the hair and retake.');
    return { ...q, available: finite(q.brightness) && finite(q.sharpness), warnings: [...new Set(warnings)] };
  }
  function compare(a, b, pa, pb, oa, ob) {
    const reasons = [];
    if (!pa || !pb) return { level: 'Unavailable', reasons: ['Both selected dates need this view.'], delta: null };
    if (a.id === b.id) return { level: 'Baseline only', reasons: ['There is no earlier assessment in this selection.'], delta: null };
    if (oa?.sourceHash && oa.sourceHash === ob?.sourceHash) return { level: 'Repeated source', reasons: ['These files have the same SHA-256 fingerprint. A reused photograph is not an independent follow-up.'], delta: null, repeated: true };
    const qa = quality(oa, pa), qb = quality(ob, pb);
    let blocked = !qa.available || !qb.available || qa.warnings.length > 0 || qb.warnings.length > 0;
    if (!qa.available || !qb.available) reasons.push('Quality checks are incomplete.');
    if (qa.warnings.length || qb.warnings.length) reasons.push('One or both images have capture warnings.');
    if (qa.available && qb.available && Math.abs(qa.brightness - qb.brightness) > 25) { blocked = true; reasons.push('Lighting differs by more than 25 mean-luminance units.'); }
    if (oa?.width && ob?.width && Math.abs(oa.width / oa.height - ob.width / ob.height) > .05) { blocked = true; reasons.push('Image aspect ratios differ by more than 0.05.'); }
    const unknown = [];
    for (const key of ['hairState', 'styling', 'lighting', 'position', 'distance']) {
      const x = a.capture?.[key], y = b.capture?.[key];
      if (!x || !y || x === 'unknown' || y === 'unknown') unknown.push(key);
      else if (x !== y || (key !== 'hairState' && (x === 'changed' || y === 'changed'))) { blocked = true; reasons.push('User-reported ' + key + ' differs or was changed.'); }
    }
    if (unknown.length) reasons.push('Capture conditions not recorded: ' + unknown.join(', ') + '.');
    reasons.push('Camera pose, distance, scalp visibility and anatomical alignment are not automatically verified.');
    const x = measurement(oa), y = measurement(ob);
    if (x === null || y === null) { blocked = true; reasons.push('Both photographs need completed model measurements.'); }
    return { level: blocked || unknown.length ? 'Low' : 'Moderate', reasons, delta: blocked || x === null || y === null ? null : Math.round((y - x) * 1000) / 1000 };
  }
  function build(state, opts = {}) {
    const scope = opts.scope === 'sample' ? 'sample' : 'real';
    const sessions = (state.sessions || []).filter(s => (scope === 'sample') === !!s.sample && validDate(s.date) && s.status !== 'Draft').slice().sort((a,b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    const latest = sessions.find(s => s.id === opts.latestId) || sessions.at(-1) || null;
    const eligible = latest ? sessions.filter(s => s.date <= latest.date) : [];
    const checkedReference = eligible.find(s => s.photos?.some(p => { const q = quality(observation(s,p),p); return q.available && !q.warnings.length; }));
    const base = eligible.find(s => s.id === opts.baseId) || checkedReference || eligible.find(s => s.photos?.length) || eligible[0] || null;
    const previous = latest ? eligible.filter(s => s.id !== latest.id && s.date <= latest.date).at(-1) : null;
    const data = state.monitoring?.[scope] || {};
    const cutoff = latest?.date || opts.today || new Date().toISOString().slice(0,10);
    const routines = Array.isArray(data.routines) ? data.routines : [];
    const logs = Array.isArray(data.logs) ? data.logs : [];
    const timeline = sessions.map(s => ({ id:s.id, date:s.date, sample:!!s.sample, notes:s.notes || '', answers:s.answers || {}, capture:s.capture || {}, status:s.status, model:s.analysis?.modelVersion || 'Not run', processedAt:s.analysis?.processedAt || null,
      photos:(s.photos || []).map(p => { const o = observation(s,p); return { ...p, observation:o || null, value:measurement(o), quality:quality(o,p) }; }),
      missing:regions.filter(r => !s.photos?.some(p => p.view === r.view)).map(r => r.name)
    }));
    const findings = regions.map(r => {
      const pa = base?.photos?.find(p => p.view === r.view), pb = latest?.photos?.find(p => p.view === r.view);
      const oa = observation(base,pa), ob = observation(latest,pb), a = measurement(oa), b = measurement(ob);
      const comparison = compare(base,latest,pa,pb,oa,ob);
      const describe = (p,n) => !p ? 'No photograph recorded for this view.' : n === null ? 'Photograph available; no completed hair-mask measurement.' : number(n) + '% of the entire image classified as hair. This is not regional scalp coverage.';
      const change = comparison.repeated ? 'The same source file is reused at both dates. There is no independent follow-up evidence for this view.' : comparison.delta === null ? 'No defensible numerical comparison is available for this pair.' : Math.abs(comparison.delta) < .01 ? 'Full-image hair-mask area is unchanged at displayed precision; this does not establish unchanged hair condition.' : 'Full-image hair-mask area is ' + (comparison.delta > 0 ? 'higher' : 'lower') + ' by ' + number(Math.abs(comparison.delta)) + ' percentage points. Framing and appearance can explain this difference; it is not growth or loss.';
      return { ...r, baselinePhoto:pa || null, latestPhoto:pb || null, baselineObservation:oa || null, latestObservation:ob || null, baselineValue:a, latestValue:b, baseline:describe(pa,a), latest:describe(pb,b), change, comparison,
        trace: [pa && base.date + ' / ' + base.id + ' / ' + pa.id, pb && latest.date + ' / ' + latest.id + ' / ' + pb.id].filter(Boolean),
        clinical:'Hairline position, recession, follicle density and true scalp visibility are not measured by this model. Professional examination is needed for clinical interpretation.' };
    });
    const photoCount = timeline.reduce((n,s) => n + s.photos.length,0), measured = timeline.reduce((n,s) => n + s.photos.filter(p => p.value !== null).length,0);
    const insights = [];
    if (!latest) insights.push('No ' + (scope === 'sample' ? 'sample' : 'uploaded') + ' assessments are recorded. Add your baseline photographs to begin.');
    else {
      insights.push(sessions.length + ' assessments contain ' + photoCount + ' source photographs; ' + measured + ' have completed model measurements.');
      if (scope === 'sample') insights.push('These are existing synthetic demonstration photographs with fictional dates. They cannot establish patient progress.');
      for (const f of findings) insights.push(f.name + ': ' + f.change + ' Evidence: ' + (f.trace.join(' -> ') || 'No source photographs.'));
      const missing = findings.filter(f => !f.latestPhoto).map(f => f.name);
      if (missing.length) insights.push('Next capture is missing evidence for: ' + missing.join(', ') + '.');
      const previousCompared = previous && previous.id !== base?.id;
      if (previousCompared) insights.push('An earlier follow-up exists on ' + previous.date + '. Select Previous check-in to compare that pair separately.');
    }
    const completed = logs.reduce((n,l) => n + (Number.isInteger(l.completed) ? l.completed : 0),0);
    const planned = logs.reduce((n,l) => n + (Number.isInteger(l.planned) ? l.planned : 0),0);
    const adherence = { completed, planned, missed:Math.max(0,planned-completed), percent:planned ? Math.round(completed / planned * 100) : null, definition:'Completed / planned applications on logged days only. Unlogged days are unknown, not missed. Self-reported; not linked causally to photo findings.' };
    const suggested = latest ? new Date(Date.parse(latest.date) + 28 * 86400000).toISOString().slice(0,10) : null;
    const nextDate = validDate(data.nextDate) ? data.nextDate : suggested;
    const outlook = sessions.length < 3 ? 'Fewer than three assessments are available. Build a series with consistent capture conditions before describing a pattern.' : 'A chronological series is available, but unregistered photographs cannot establish a biological growth trend. Review each view and its capture conditions across dates.';
    const assessment = root.ProgressStory?.assessment({findings,baseline:base,latest,photoCount,measured}) || null;
    const growthStory = root.ProgressStory?.simulation({enabled:scope==='sample' && latest?.id==='sample-3' && base?.id==='sample-0' && sessions.length===4 && sessions.every(s=>/^sample-[0-3]$/.test(s.id)) && photoCount>0 && measured===photoCount,dates:timeline.map(s=>s.date),quality:timeline.map(s=>{const p=s.photos.find(p=>p.view==='Crown');return p?.quality?.warnings?.length?p.quality.warnings.join(' '):'No tested capture warning; alignment is not verified.';})}) || null;
    return { assessment, growthStory, version:1, scope, sample:scope==='sample', generatedAt:new Date().toISOString(), today:opts.today || new Date().toISOString().slice(0,10), planNote:data.planNote || '', reportedRoutine:scope === 'real' ? state.profile?.routine || '' : '', profile:{ name:state.profile?.name || 'Not recorded', goal:state.profile?.goal || 'Not recorded', demographics:'Not recorded in this workspace' }, reportId:'PC-' + (latest?.id || 'empty') + '-' + (base?.id || 'empty'), sessions, baseline:base, baselineReason:opts.baseId && base?.id === opts.baseId ? 'User-selected reference.' : checkedReference ? 'Earliest assessment with at least one photograph passing the available heuristic checks. Check each region separately; clinical suitability is not established.' : 'Provisional earliest photo reference. Quality checks are not complete; clinical suitability is not established.', latest, previous, findings, timeline, photoCount, measured, insights, routines, logs, adherence, nextDate, nextDateSource:data.nextDate?'User scheduled':'Suggested 28-day capture interval, not a treatment timeline', outlook, reviews:data.reviews || [], cutoff,
      limitations:['Research demonstration; not a validated clinical hair-growth assessment.', 'Hair segmentation measures full-image pixels, not follicles, scalp area, density or treatment effectiveness.', 'Five anatomical labels follow the view selected by the user. The model does not locate scalp regions or register photographs.', 'Confidence describes capture evidence only. It is not a calibrated probability of medical accuracy.', 'No authenticated professional review or consultation service is connected. All in-app reviewer roles are simulations.'] };
  }
  function validateRoutine(value,today) {
    if (!value.name?.trim() || value.name.length > 120) throw Error('Enter a product or routine name (up to 120 characters).');
    if (!validDate(value.startDate) || value.startDate > today) throw Error('Enter an actual start date, no later than today.');
    if (!['daily','weekly','as-needed'].includes(value.frequency)) throw Error('Select a frequency.');
    if (!['Treatment','Haircare','Other'].includes(value.type)) throw Error('Select a routine type.');
    return {name:value.name.trim(),type:value.type,startDate:value.startDate,frequency:value.frequency,notes:String(value.notes||'').slice(0,2000)};
  }
  function validateLog(value,today,routines) {
    if (!routines.some(r => r.id === value.routineId)) throw Error('Choose a recorded routine.');
    if (!validDate(value.date) || value.date > today) throw Error('Choose an actual log date, no later than today.');
    const routine = routines.find(r => r.id === value.routineId);
    if (value.date < routine.startDate) throw Error('Log date must be on or after the routine start date.');
    const planned = Number(value.planned), completed = Number(value.completed);
    if (!Number.isInteger(planned) || !Number.isInteger(completed) || planned < 0 || planned > 20 || completed < 0 || completed > planned) throw Error('Use whole counts from 0 to 20. Completed cannot exceed planned.');
    return {routineId:value.routineId,date:value.date,planned,completed,experience:String(value.experience||'').slice(0,2000),sideEffects:String(value.sideEffects||'').slice(0,2000)};
  }
  root.MonitoringCore = { regions, build, compare, quality, measurement, observation, validDate, days, number, validateRoutine, validateLog };
})(typeof window === 'undefined' ? globalThis : window);
