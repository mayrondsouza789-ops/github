(function () {
  'use strict';
  const views = ['Front', 'Crown', 'Left', 'Right'];
  const guidance = {
    Front: 'Face the camera and include the hairline. Keep the camera at the same height for each session.',
    Crown: 'Photograph the top and crown with the camera above your head. Ask someone to help if needed.',
    Left: 'Turn to show the left side of your scalp. Keep the ear and hairline in the frame.',
    Right: 'Turn to show the right side of your scalp. Match the distance used for the left side.'
  };
  const ui = { view: 'Front', busy: false, error: '', earlier: true, submitting: false };
  const css = `<style>.cf-head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:20px}.cf-head h2{margin:0}.cf-count{font-size:12px;color:#687761}.cf-frame{min-height:300px;background:#f3f5f0;border:1px solid #dce2dc;border-radius:5px;display:grid;place-items:center;overflow:hidden;position:relative}.cf-frame>img{width:100%;height:340px;object-fit:contain}.cf-frame>svg{width:100%;height:300px}.cf-previous .cf-frame{min-height:240px}.cf-previous .cf-frame img{height:240px}.cf-previous .cf-frame svg{height:240px}.cf-caption{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:#687761;margin:10px 0 16px}.cf-photo-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.cf-photo-grid .cf-frame{min-height:130px;height:150px}.cf-photo-grid .cf-frame img,.cf-photo-grid .cf-frame svg{height:150px}.cf-photo-grid .cf-caption{margin-bottom:0}.cf-question{padding:19px 0;border-bottom:1px solid #e4e8df}.cf-question:first-child{padding-top:0}.cf-question:last-child{border:0}.cf-question .field{margin-bottom:12px}.cf-question .field:last-child{margin:0}.cf-review-list{display:grid;gap:18px;margin:0}.cf-review-list dt{font-size:12px;color:#72806b;margin-bottom:5px}.cf-review-list dd{margin:0;font-size:14px;white-space:pre-wrap;overflow-wrap:anywhere}.cf-bottom-note{font-size:12px;color:#73806c;line-height:1.6;margin:18px 0 0}.cf-error{font-size:13px;color:#a02f2f;padding:12px 0;line-height:1.6}.cf-guide-list{padding-left:19px;margin:0;color:#62705d;font-size:13px;line-height:1.7}.cf-guide-list li+li{margin-top:9px}.cf-guide-note{font-size:12px;color:#77816e;line-height:1.6;margin:18px 0 0;padding-top:16px;border-top:1px solid #e4e9de}.cf-stage{border:1px solid #dce2dc;padding:18px;border-radius:5px;background:#f5f8f2;margin-bottom:20px}.cf-stage h3{margin:0 0 7px}.cf-stage p{font-size:13px;color:#62705d;margin:0}.cf-stage small{display:block;color:#72816a;margin-top:9px;font-size:12px}.cf-stage-list{list-style:none;margin:0;padding:0}.cf-stage-list li{display:flex;gap:12px;align-items:flex-start;padding:17px 0;border-bottom:1px solid #e5eade;font-size:14px}.cf-stage-list li:last-child{border:0}.cf-stage-list p{font-size:12px;color:#6d7b65;margin:4px 0 0}.cf-stage-list svg{color:#6d8662;flex-shrink:0;margin-top:1px}.cf-status-row{display:flex;justify-content:space-between;align-items:center;gap:15px;margin:20px 0}.cf-saved-grid{display:grid;grid-template-columns:1fr 310px;gap:24px}.cf-toggle{display:flex;align-items:center;gap:8px;font-size:12px;color:#65765d;cursor:pointer}.cf-request{margin-bottom:22px}.cf-process-note{font-size:13px;color:#65735e;line-height:1.65}.cf-step-button{padding:0;display:inline-flex}.cf-share{border-top:1px solid #e1e7dc;padding-top:20px;margin-top:22px}.cf-date-row{max-width:300px;margin-top:22px}.cf-empty-view{padding:24px;text-align:center;color:#7c8973;font-size:12px}.cf-empty-view svg{display:block;margin:0 auto 10px}.cf-guide-panel .panel-body{padding-top:18px}.cf-hidden{display:none!important}@media(max-width:1020px){.cf-saved-grid{grid-template-columns:1fr}.cf-guide-panel{order:0}}@media(max-width:650px){.cf-photo-grid{grid-template-columns:1fr 1fr}.cf-frame>img{height:270px}.cf-frame{min-height:250px}.cf-head{align-items:flex-start}.cf-head h2{font-size:19px}.cf-status-row{flex-direction:column;align-items:flex-start}.cf-date-row{max-width:none}.form-footer{flex-wrap:wrap}.form-footer .actions{width:100%}.form-footer .actions .btn{flex:1}.cf-guide-list{font-size:12px}}
  .cf-frame .illustration-label{position:absolute;bottom:8px;left:8px;font-size:10px;background:#ffffffd9;padding:3px 5px;color:#64765d}
  </style>`;
  const e = (PC, value) => PC.esc(String(value == null ? '' : value));
  const localToday = PC => new Intl.DateTimeFormat('en-CA', { timeZone: PC.state.profile?.timezone || 'Asia/Calcutta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const go = (route, label, primary) => `<button class="btn${primary ? ' primary' : ''}" data-go="${route}">${label}</button>`;
  const audit = (PC, event) => (PC.state.audit || (PC.state.audit = [])).push({ date: new Date().toISOString(), event });
  async function save(PC) { try { if (await PC.save() === false) throw new Error('Save failed'); return true; } catch (error) { ui.error = 'Your changes could not be saved. Please try again; the current draft is still open.'; PC.toast(ui.error); return false; } }
  function draft(PC) {
    if (!PC.state.draft) PC.state.draft = { id: 'session-' + Date.now(), date: localToday(PC), photos: [], answers: { routine: '', difficulty: '', concern: '', appearance: '' }, notes: '', step: 1 };
    PC.state.draft.photos ||= [];
    PC.state.draft.answers ||= {};
    PC.state.draft.step ||= 1;
    return PC.state.draft;
  }
  const panel = (title, subtitle, content) => `<section class="panel"><div class="panel-head"><div><h2>${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ''}</div></div><div class="panel-body">${content}</div></section>`;
  const photo = (PC, d, view) => {
    const p = (d.photos || []).find(p => p.view === view);
    if (!p) return `<div class="cf-empty-view">${PC.icon('camera', 30)}<span>${e(PC, view)} photograph not added</span></div>`;
    return PC.sessionPhoto(d, view);
  };
  const baseline = PC => (PC.state.sessions || []).filter(s => !s.sample && s.photos?.length && s.status !== 'Draft').sort((a, b) => new Date(a.date) - new Date(b.date))[0];

  function steps(current) { return `<div class="stepper" aria-label="Check-in progress">${['Photographs', 'Check-in', 'Review'].map((label, index) => `<span${current === index + 1 ? ' class="active" aria-current="step"' : ''}><b>${index + 1}</b>${label}</span>`).join('')}</div>`; }
  function heading(PC, title, subtitle) { return `<div class="page-heading"><div><div class="eyebrow">YOUR WEEKLY RECORD</div><h1>${title}</h1><p>${subtitle}</p></div><button class="btn" id="cf-save-draft">${PC.icon('save', 16)} Save draft</button></div>`; }
  function footer(step) { return `<div class="form-footer"><span class="muted small">Step ${step} of 3</span><div class="actions">${step > 1 ? '<button type="button" class="btn" id="cf-back">Back</button>' : '<button class="btn" data-go="/overview">Return to overview</button>'}${step < 3 ? `<button type="button" class="btn primary" id="cf-next"${ui.busy ? ' disabled' : ''}>${step === 1 ? 'Continue to check-in' : 'Review check-in'}</button>` : '<button class="btn primary" id="cf-submit">Save & submit check-in</button>'}</div></div>`; }
  function requiredInfo(PC) {
    const request = (PC.state.sessions || []).flatMap(s => (s.requests || (s.request ? [s.request] : [])).map(r => ({ ...r, session: s }))).filter(r => r.status !== 'resolved').slice(-1)[0];
    return request ? `<div class="notice cf-request">${PC.icon('message-circle', 19)}<div><strong>Open demonstration request</strong><p>${e(PC, request.message)}</p><p class="small">Your new check-in can include the requested photograph or information. The earlier record will remain in your history.</p></div></div>` : '';
  }

  function photoStep(PC, d) {
    const current = d.photos.find(p => p.view === ui.view);
    const previous = baseline(PC);
    return `<div class="capture-layout"><section class="panel"><div class="panel-body"><div class="upload-view-tabs" aria-label="Photograph view">${views.map(view => `<button data-cf-view="${view}" class="${ui.view === view ? 'active' : ''}" aria-pressed="${ui.view === view}">${view}${d.photos.some(p => p.view === view) ? ' · Added' : ''}</button>`).join('')}</div><div class="cf-head"><div><h2>${ui.view} view</h2><p class="muted small" style="margin:7px 0 0">${guidance[ui.view]}</p></div><span class="cf-count">${d.photos.length} of 4 views</span></div>${current ? `<div class="cf-frame">${photo(PC, d, ui.view)}</div><div class="cf-caption"><span>${e(PC, current.name)}</span><span>${current.width} × ${current.height} px</span></div>` : `<div class="capture-area">${PC.icon('camera', 52)}<h3>Add your ${ui.view.toLowerCase()} photograph</h3><p>Keep your head and camera position consistent. The original photograph is preserved.</p></div>`}<div class="upload-actions"><button class="btn primary" id="cf-choose-file"${ui.busy ? ' disabled' : ''}>${PC.icon('upload', 17)} ${ui.busy ? 'Saving photograph…' : current ? 'Replace photograph' : 'Choose photograph'}</button><button class="btn" id="cf-camera"${ui.busy ? ' disabled' : ''}>${PC.icon('camera', 17)} Use camera</button>${current ? `<button class="btn" id="cf-remove"${ui.busy ? ' disabled' : ''}>Remove</button>` : ''}</div><input class="file-input" type="file" id="cf-file" accept="image/jpeg,image/png,image/webp" aria-label="Choose photograph"><input class="file-input" type="file" id="cf-camera-file" accept="image/jpeg,image/png,image/webp" capture="environment" aria-label="Take photograph"><p class="cf-bottom-note">JPEG, PNG or WebP · Up to 12 MB · At least 512 × 512 pixels. File checks do not establish clinical image quality.</p><div id="cf-error" class="cf-error" role="alert">${e(PC, ui.error)}</div><div class="field cf-date-row"><label for="cf-date">When were these photographs taken?</label><input type="date" id="cf-date" value="${e(PC, d.date)}" max="${localToday(PC)}" required><span class="hint">Use the actual capture date, including for a late check-in.</span></div>${footer(1)}</div></section><aside class="stack cf-guide-panel">${panel('Make each session comparable', 'A simple capture routine for this demonstration.', `<ul class="cf-guide-list"><li>Use even light and the same place each week.</li><li>Match camera distance and head position.</li><li>Keep your hair arranged consistently. Record any styling or haircut changes.</li><li>Keep the original image. Avoid filters and retouching.</li></ul><p class="cf-guide-note">This four-view guide demonstrates the workflow. A real clinical capture protocol has not been established.</p>`)}${previous ? panel('Your earlier reference', PC.date(previous.date) + ' · ' + e(PC, ui.view), `<label class="cf-toggle"><input type="checkbox" id="cf-earlier-toggle"${ui.earlier ? ' checked' : ''}> Show earlier photograph</label><div class="cf-previous${ui.earlier ? '' : ' cf-hidden'}" id="cf-earlier" style="margin-top:15px"><div class="cf-frame">${photo(PC, previous, ui.view)}</div><p class="cf-bottom-note">Use this as a positioning reference. It has not been aligned or altered.</p></div>`) : panel('Your starting record', 'No earlier uploaded photographs.', `<p class="small muted">Your first photo session becomes a starting reference. It cannot establish improvement without earlier comparable evidence.</p>`)}${panel('A concern can come first', '', `<p class="small muted">You can submit a concern without all four photographs. The record will show which views are missing.</p><button class="btn text" id="cf-concern-only">Continue to your check-in ${PC.icon('arrow-right', 15)}</button>`)}</aside></div>`;
  }

  function question(PC, key, label, normal, changed, value, placeholder) {
    const val = String(value || '');
    const choice = !val ? '' : val === normal ? normal : changed;
    const detail = choice === changed ? val.replace(new RegExp('^' + changed + ':?\\s*'), '') : '';
    return `<div class="cf-question"><div class="field"><label for="cf-q-${key}">${label}</label><select id="cf-q-${key}" data-cf-question="${key}" name="${key}" required><option value=""${!choice ? ' selected' : ''}>Choose an answer</option><option value="${e(PC, normal)}"${choice === normal ? ' selected' : ''}>${normal}</option><option value="${e(PC, changed)}"${choice === changed ? ' selected' : ''}>${changed}</option></select></div><div class="field${choice === changed ? '' : ' cf-hidden'}" id="cf-detail-wrap-${key}"><label for="cf-detail-${key}">${key === 'routine' ? 'What changed in your routine?' : key === 'difficulty' ? 'What made the routine difficult?' : 'What changed in your appearance?'}</label><textarea id="cf-detail-${key}" name="${key}Detail" placeholder="${e(PC, placeholder)}">${e(PC, detail)}</textarea></div></div>`;
  }
  function questionsStep(PC, d) {
    return `<div class="capture-layout">${panel('How has this week been?', 'Your answers are recorded separately from the image analysis.', `<form id="cf-questions">${question(PC, 'routine', 'Has your routine changed?', 'No change', 'Changed', d.answers.routine, 'Products, frequency or other routine changes.')}${question(PC, 'difficulty', 'Any difficulty following your routine?', 'No difficulty', 'Some difficulty', d.answers.difficulty, 'Add context you want included in the record.')}${question(PC, 'appearance', 'Any haircut, colouring or styling changes?', 'No appearance changes', 'Appearance changed', d.answers.appearance, 'Describe a change that could affect image comparisons.')}<div class="cf-question"><div class="field"><label for="cf-concern">Is there anything you want reviewed?</label><textarea id="cf-concern" name="concern" placeholder="Describe a concern or discomfort, or leave this blank.">${e(PC, d.answers.concern)}</textarea><span class="hint">A reported concern is preserved even if image analysis cannot finish.</span></div></div><div class="cf-question"><div class="field"><label for="cf-notes">Anything else to add? <span class="muted">(optional)</span></label><textarea id="cf-notes" name="notes" placeholder="Additional context for this check-in.">${e(PC, d.notes)}</textarea></div></div></form><div id="cf-error" class="cf-error" role="alert">${e(PC, ui.error)}</div>${footer(2)}`)}<aside class="stack cf-guide-panel">${panel('A record in your own words', '', `<ul class="cf-guide-list"><li>Describe what you noticed without needing to interpret the images.</li><li>Missed weeks stay as gaps. They do not indicate treatment failure.</li><li>Only the information you choose to share appears in the demonstration review queue.</li></ul><p class="cf-guide-note">The sample clinician is part of the demonstration. This workspace does not provide medical advice or live monitoring.</p>`)}</aside></div>`;
  }
  function reviewStep(PC, d) {
    const missing = views.filter(v => !d.photos.some(p => p.view === v));
    const assigned = PC.state.profile.assigned;
    const sharing = PC.state.consents.sharing;
    return `${panel('Your check-in, ready to save', 'Review the capture date, photographs and answers before submitting.', `<div class="cf-status-row"><div><strong>${PC.date(d.date)}</strong><p class="muted small" style="margin:4px 0 0">Actual capture date · ${d.photos.length} photographs</p></div><button class="btn small" data-cf-step="1">Edit photographs</button></div><div class="cf-photo-grid">${views.map(view => `<div><div class="cf-frame">${photo(PC, d, view)}</div><div class="cf-caption"><strong>${view}</strong><span>${d.photos.some(p => p.view === view) ? 'Added' : 'Missing'}</span></div></div>`).join('')}</div>${missing.length ? `<div class="notice warning" style="margin-top:20px"><div><strong>Incomplete photo set</strong><p>${missing.join(', ')} ${missing.length === 1 ? 'view is' : 'views are'} missing. You can still save this check-in${d.answers.concern ? ' and your concern' : ''}; no missing observations will be invented.</p></div></div>` : ''}<div class="section-heading"><h2 style="font-size:18px">Customer reported</h2><button class="btn small" data-cf-step="2">Edit answers</button></div><dl class="cf-review-list">${[['Routine',d.answers.routine],['Difficulty following the routine',d.answers.difficulty],['Appearance changes',d.answers.appearance],['Concern for review',d.answers.concern || 'None added'],['Additional notes',d.notes || 'None added']].map(([label,value]) => `<div><dt>${label}</dt><dd>${e(PC,value || 'Not answered')}</dd></div>`).join('')}</dl><div class="cf-share"><h3>What happens when you submit</h3><ul class="cf-guide-list"><li>The original photographs and check-in are saved together.</li><li>${PC.state.consents.analysis ? 'Experimental image segmentation can run on the saved photographs. It is a research output, not a diagnosis.' : 'AI analysis permission is off. Your check-in is saved without running the model.'}</li><li>${sharing && assigned ? 'This record enters the assigned sample clinician’s demonstration queue.' : sharing ? 'This record is shared for review but awaits a sample clinician assignment.' : 'This record is not shared with the demonstration reviewer.'}</li></ul><p class="cf-bottom-note">You can change sharing and analysis permissions in account settings. Submission does not mean a medical professional has reviewed your record.</p></div><div id="cf-error" class="cf-error" role="alert">${e(PC, ui.error)}</div>${footer(3)}`)}`;
  }

  function checkIn(PC) {
    if (!PC.state.consents.storage) return `<div class="page-heading"><div><div class="eyebrow">PHOTO PERMISSIONS</div><h1>Choose how your record is stored.</h1><p>Storage permission is needed before photographs or check-ins can be saved.</p></div></div><div class="panel empty">${PC.icon('shield', 35)}<h2>Review your permissions</h2><p>Photo storage, AI analysis, doctor sharing and research use are separate choices.</p>${go('/onboarding', 'Review permissions', true)}</div>`;
    const d = draft(PC);
    const first = !baseline(PC);
    return heading(PC, first ? 'Add your starting record.' : 'Add this week’s check-in.', 'Consistent photographs and a short update build a useful record over time.') + steps(d.step) + requiredInfo(PC) + (d.step === 1 ? photoStep(PC, d) : d.step === 2 ? questionsStep(PC, d) : reviewStep(PC, d));
  }

  function analysis(PC, id) {
    const s = (PC.state.sessions || []).find(s => String(s.id) === String(id));
    if (!s) return `<div class="panel empty"><h2>This check-in is not available.</h2><p>It may have been removed or may not have finished saving.</p>${go('/overview', 'Back to overview', true)}</div>`;
    const processing = String(PC.processingId || '') === String(id);
    const progress = PC.analysisProgress || {};
    const hasOutput = !!s.analysis?.observations?.length;
    const shared = s.shared && PC.state.consents.sharing;
    const assigned = PC.state.profile.assigned;
    const missing = views.filter(v => !s.photos?.some(p => p.view === v));
    const statusText = processing ? 'Experimental analysis is running.' : hasOutput && s.status !== 'Analysis failed' ? 'Your research output is ready.' : 'Your check-in is saved.';
    const stageLabels = {loading:'Loading the image model',loading_model:'Loading the image model',cpu_fallback:'Using this device’s processor',checking_image:'Reading the photograph',segmenting:'Analysing image pixels',preparing_report:'Preparing the research report'};
    const stage = progress.message || stageLabels[progress.stage] || 'Waiting for the next processing update.';
    return `<div class="page-heading"><div><div class="eyebrow">CHECK-IN STATUS</div><h1>${statusText}</h1><p>${PC.date(s.date)} · ${e(PC, s.title || 'Progress check-in')}</p></div>${go('/report/' + encodeURIComponent(id), 'Open report', true)}</div><div class="cf-saved-grid"><div class="stack">${panel('A clear record of what happened', 'The status below reflects the saved record and current model run.', `${processing ? `<div class="cf-stage" role="status" aria-live="polite"><h3>${e(PC, stageLabels[progress.stage] || 'Processing photographs')}</h3><p>${e(PC, stage)}</p>${progress.total && Number.isInteger(progress.photoIndex) ? `<small>Photograph ${Math.min(progress.photoIndex + 1, progress.total)} of ${progress.total}</small>` : ''}</div>` : `<div class="cf-status-row"><strong>Current status</strong>${PC.badge(s.status)}</div>`}<ul class="cf-stage-list"><li>${PC.icon('check', 20)}<div><strong>Check-in saved</strong><p>${s.photos?.length || 0} original photographs and your customer update are attached to this record.</p></div></li><li>${PC.icon(hasOutput ? 'check' : 'info', 20)}<div><strong>${hasOutput && s.status === 'Analysis failed' ? 'Earlier research output preserved' : hasOutput ? 'Research output attached' : processing ? 'Image segmentation in progress' : !PC.state.consents.analysis ? 'Analysis permission is off' : 'Analysis not completed'}</strong><p>${hasOutput && s.status === 'Analysis failed' ? e(PC, 'The latest run failed. ' + (s.analysisError || '') + ' Your earlier output remains available in the report.') : hasOutput ? 'Experimental hair-pixel segmentation is available in the report. It is not a validated scalp measurement.' : processing ? 'Actual model updates appear above. No clinical interpretation is being generated.' : !PC.state.consents.analysis ? 'You can allow analysis in account settings and return to run it.' : e(PC, s.analysisError || s.analysis?.error || (s.photos?.length ? 'No completed model output is attached. Your original files remain saved.' : 'This check-in has no photographs. Your notes and reported concern are preserved.'))}</p></div></li><li>${PC.icon('clipboard', 20)}<div><strong>Structured record available</strong><p>The report includes the submitted photographs, customer update and any unavailable or incomplete analysis.</p></div></li><li>${PC.icon('users', 20)}<div><strong>${shared && assigned ? 'Available in the demonstration review queue' : shared ? 'Awaiting sample clinician assignment' : 'Record is not shared'}</strong><p>${shared && assigned ? 'The assigned sample clinician role can review it. This does not mean a medical professional has read it.' : shared ? 'No report has been delivered to a clinician. Assignment is needed for the demonstration queue.' : 'Doctor sharing is off for this record. The review queue cannot access it.'}</p></div></li></ul>${!processing && s.photos?.length ? `<div class="actions" style="margin-top:20px"><button class="btn" id="cf-retry"${!PC.state.consents.analysis ? ' disabled' : ''}>${hasOutput ? 'Run analysis again' : 'Retry experimental analysis'}</button>${!PC.state.consents.analysis ? go('/settings', 'Review permissions') : ''}</div>` : ''}<p class="cf-bottom-note">You can leave this page and return to your saved record. The prototype’s model runs on this device while the website is open.</p>`)}${panel('Saved original photographs', missing.length ? 'Missing views: ' + missing.join(', ') + '. No observations are added for missing images.' : 'All four capture views are present.', `<div class="cf-photo-grid">${views.map(view => `<div><div class="cf-frame">${photo(PC,s,view)}</div><div class="cf-caption"><strong>${view}</strong></div></div>`).join('')}</div>`)}</div><aside class="stack">${panel('Continue your journey', 'The saved record is ready to explore.', `<div class="stack">${go('/report/' + encodeURIComponent(id), 'Read the progress report', true)}${shared && assigned ? go('/doctor/review/' + encodeURIComponent(id), 'Try the demonstration review') : shared ? go('/admin/accounts', 'View sample assignment') : go('/settings', 'Manage sharing')}${go('/history', 'View progress history')}</div>`)}${panel('What this analysis means', '', `<p class="cf-process-note">The model identifies pixels that resemble hair in the image. Camera angle, framing and lighting affect the result.</p><p class="cf-process-note">It cannot establish a diagnosis, treatment success, true hair density or percentage regrowth.</p>`)}</aside></div>`;
  }

  function readFields(PC) {
    const d = draft(PC);
    const date = document.getElementById('cf-date');
    if (date) d.date = date.value;
    const form = document.getElementById('cf-questions');
    if (form) {
      const data = Object.fromEntries(new FormData(form).entries());
      for (const key of ['routine', 'difficulty', 'appearance']) { const detail = data[key + 'Detail']?.trim(); d.answers[key] = data[key] ? data[key] + (detail && ['Changed', 'Some difficulty', 'Appearance changed'].includes(data[key]) ? ': ' + detail : '') : ''; }
      d.answers.concern = data.concern || ''; d.notes = data.notes || '';
    }
    return d;
  }
  function showError(PC, message) { ui.error = message; const el = document.getElementById('cf-error'); if (el) el.textContent = message; PC.toast(message); }
  function validDate(PC, d) { return /^\d{4}-\d{2}-\d{2}$/.test(d.date || '') && d.date <= localToday(PC); }

  async function submit(PC) {
    if (ui.submitting) return;
    const d = readFields(PC);
    if (!PC.state.consents.storage) { showError(PC, 'Storage permission is required to save this check-in.'); return; }
    if (!validDate(PC,d)) { showError(PC,'Choose the actual capture date. It cannot be in the future.'); return; }
    if (!d.photos.length && !d.answers.concern?.trim()) { showError(PC, 'Add a photograph or describe a concern before submitting.'); return; }
    ui.submitting = true;
    const button = document.getElementById('cf-submit'); if (button) { button.disabled = true; button.textContent = 'Saving check-in…'; }
    const first = !(PC.state.sessions || []).some(s => !s.sample && s.photos?.length && s.status !== 'Draft');
    const session = { id: d.id, date: d.date, title: first && d.photos.length ? 'Baseline session' : d.photos.length ? 'Weekly check-in' : 'Concern check-in', isBaseline: first && !!d.photos.length, sample: false, status: 'Uploaded', notes: d.notes || '', answers: { ...d.answers }, photos: [...d.photos], shared: !!PC.state.consents.sharing, uploadedAt: new Date().toISOString(), modelVersion: null, missingViews: views.filter(v => !d.photos.some(p => p.view === v)) };
    const previousSessions = [...(PC.state.sessions || [])];
    const previousAudit = [...(PC.state.audit || [])];
    PC.state.sessions = [...previousSessions.filter(s => s.id !== session.id), session];
    PC.state.draft = null;
    audit(PC, 'Check-in ' + session.id + ' saved with ' + session.photos.length + ' original photographs');
    if (!await save(PC)) { PC.state.sessions = previousSessions; PC.state.audit = previousAudit; PC.state.draft = d; ui.submitting = false; if (button) { button.disabled = false; button.textContent = 'Save & submit check-in'; } return; }
    ui.submitting = false; ui.error = ''; ui.view = 'Front';
    PC.navigate('/analysis/' + encodeURIComponent(session.id));
    try { await PC.runAnalysis(session.id); } catch (error) { PC.toast('Analysis could not finish. Your saved check-in is preserved.'); PC.render(); }
  }

  function bindCheckIn(PC) {
    if (!PC.state.consents.storage) return;
    const on = (id,event,fn) => document.getElementById(id)?.addEventListener(event,fn);
    const changeStep = async (step, validate) => {
      if (ui.busy) { PC.toast('Wait for the photograph to finish saving.'); return; }
      const d = readFields(PC);
      if (validate && d.step === 1 && !validDate(PC,d)) { document.getElementById('cf-date')?.reportValidity(); showError(PC, 'Choose the actual capture date. It cannot be in the future.'); return; }
      if (validate && d.step === 2 && !document.getElementById('cf-questions').reportValidity()) return;
      const previousStep = d.step; d.step = step;
      if (await save(PC)) { ui.error = ''; PC.render(); window.scrollTo({ top: 0, behavior: 'instant' }); } else d.step = previousStep;
    };
    on('cf-save-draft','click',async () => { if (ui.busy) { PC.toast('Wait for the photograph to finish saving.'); return; } readFields(PC); if (await save(PC)) { ui.error = ''; PC.toast('Your check-in draft is saved.'); } });
    on('cf-next','click',() => changeStep(draft(PC).step + 1, true));
    on('cf-back','click',() => changeStep(draft(PC).step - 1, false));
    on('cf-concern-only','click',() => changeStep(2, true));
    document.querySelectorAll('[data-cf-step]').forEach(button => button.addEventListener('click',() => changeStep(Number(button.dataset.cfStep), false)));
    document.querySelectorAll('[data-cf-view]').forEach(button => button.addEventListener('click',async () => { if (ui.busy) return; readFields(PC); if (!await save(PC)) return; ui.view = button.dataset.cfView; ui.error = ''; PC.render(); }));
    on('cf-choose-file','click',() => document.getElementById('cf-file').click());
    on('cf-camera','click',() => document.getElementById('cf-camera-file').click());
    on('cf-earlier-toggle','change',event => { ui.earlier = event.target.checked; document.getElementById('cf-earlier').classList.toggle('cf-hidden',!ui.earlier); });
    const upload = async event => {
      const file = event.target.files?.[0]; if (!file || ui.busy) return;
      const d = readFields(PC); const view = ui.view; const previous = d.photos.find(p => p.view === view);
      ui.busy = true; ui.error = ''; PC.render();
      try {
        const result = await PC.storePhoto(file, view);
        const before = [...d.photos]; d.photos = before.filter(p => p.view !== view).concat(result);
        if (!await save(PC)) { d.photos = before; try { await PC.removePhoto(result.id); } catch (_) {} return; }
        if (previous && previous.id !== result.id) {
          try { await PC.removePhoto(previous.id); }
          catch (error) {
            d.photos = before;
            const restored = await save(PC);
            if (restored) try { await PC.removePhoto(result.id); } catch (_) {}
            ui.error = restored ? 'The replacement could not be completed. Your earlier photograph is restored; please try again.' : 'The old photograph could not be removed. The earlier view is restored in this draft, but saving the restoration also failed. Retry saving before leaving.';
            return;
          }
        }
        PC.toast(view + ' photograph saved.');
      } catch (error) { ui.error = error.message || 'This photograph could not be added. Choose a supported image and try again.'; }
      finally { ui.busy = false; PC.render(); }
    };
    on('cf-file','change',upload); on('cf-camera-file','change',upload);
    on('cf-remove','click',async () => {
      const d = readFields(PC); const previous = d.photos.find(p => p.view === ui.view); if (!previous || ui.busy) return;
      const before = [...d.photos]; d.photos = before.filter(p => p.id !== previous.id);
      if (!await save(PC)) { d.photos = before; return; }
      try { await PC.removePhoto(previous.id); }
      catch (error) {
        d.photos = before;
        const restored = await save(PC);
        ui.error = restored ? 'The photograph could not be removed. It has been restored to your draft; please try again.' : 'The photograph could not be removed. It remains in this draft, but saving the restoration also failed. Retry saving before leaving.';
        PC.render();
        return;
      }
      ui.error = ''; PC.render();
    });
    document.querySelectorAll('[data-cf-question]').forEach(select => select.addEventListener('change',() => { const show = ['Changed','Some difficulty','Appearance changed'].includes(select.value); document.getElementById('cf-detail-wrap-' + select.dataset.cfQuestion).classList.toggle('cf-hidden',!show); }));
    on('cf-submit','click',() => submit(PC));
  }
  window.CaptureFlow = {
    render(route,PC) { if (route === '/check-in') return css + checkIn(PC); if (route.startsWith('/analysis/')) return css + analysis(PC,decodeURIComponent(route.split('/')[2] || '')); return null; },
    bind(route,PC) { if (route === '/check-in') bindCheckIn(PC); if (route.startsWith('/analysis/')) document.getElementById('cf-retry')?.addEventListener('click',async event => { const id = decodeURIComponent(route.split('/')[2] || ''); if (!PC.state.consents.analysis) { PC.toast('Enable analysis permission before running the model.'); return; } event.currentTarget.disabled = true; try { await PC.runAnalysis(id); } catch (error) { PC.toast('Analysis could not finish. Your saved check-in is preserved.'); PC.render(); } }); }
  };
})();
