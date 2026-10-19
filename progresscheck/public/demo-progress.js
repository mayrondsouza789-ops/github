/* Show actual processing events separately from optional demo presentation pacing. */
(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const labels = ['Load image model', 'Measure four photographs', 'Check capture conditions', 'Prepare demo report'];
  let started = 0, timer = null, phase = 0;

  function tick() { $('#analysis-elapsed').textContent = ((performance.now() - started) / 1000).toFixed(1) + 's elapsed'; }
  function setPhase(value) {
    phase = value;
    document.querySelectorAll('.analysis-stage').forEach((item, i) => {
      item.dataset.state = i < value ? 'done' : i === value ? 'active' : 'waiting';
      item.querySelector('.stage-state').textContent = i < value ? 'Complete' : i === value ? 'In progress' : 'Waiting';
      item.querySelector('.stage-number').textContent = i < value ? '✓' : String(i + 1);
    });
  }
  function photo(index, state, text) {
    const item = document.querySelector(`[data-analysis-photo="${index}"]`);
    if (!item) return;
    item.dataset.state = state;
    item.querySelector('.photo-state').textContent = text;
  }
  function stop() { clearInterval(timer); timer = null; }
  function reset() { stop(); $('#analysis-detail').hidden = true; $('#analysis-panel').dataset.state = 'idle'; }
  function begin(samples) {
    stop(); started = performance.now();
    $('#analysis-detail').hidden = false;
    $('#analysis-panel').dataset.state = 'running';
    $('#analysis-stages').innerHTML = labels.map((name, i) => `<li class="analysis-stage"><span class="stage-number">${i + 1}</span><div><strong>${name}</strong><span class="stage-state">Waiting</span></div></li>`).join('');
    $('#analysis-photos').replaceChildren(...samples.map((sample, i) => {
      const card = document.createElement('div'); card.className = 'analysis-photo'; card.dataset.analysisPhoto = i; card.dataset.state = 'waiting';
      const frame = document.createElement('div'); frame.className = 'analysis-photo-frame';
      const image = document.createElement('img'); image.src = sample.url; image.alt = `Synthetic Week ${sample.week} sample`;
      frame.append(image);
      const title = document.createElement('strong'); title.textContent = i ? `Week ${sample.week}` : 'Baseline';
      const state = document.createElement('span'); state.className = 'photo-state'; state.textContent = 'Queued';
      card.append(frame, title, state); return card;
    }));
    $('#analysis-detail-note').textContent = 'Four synthetic photographs · On-device processing · No uploads';
    $('#analysis-progress').value = 0;
    setPhase(0); tick(); timer = setInterval(tick, 100);
  }
  function stage(event) {
    $('#status').textContent = event.message;
    if (Number.isInteger(event.photoIndex)) {
      setPhase(1);
      for (let i = 0; i < event.photoIndex; i++) photo(i, 'done', 'Measured');
      photo(event.photoIndex, 'active', event.stage === 'segmenting' ? 'Measuring hair pixels' : 'Checking image');
      $('#analysis-progress').value = event.photoIndex + 1;
    }
    if (event.stage === 'preparing_report') for (let i = 0; i < 4; i++) photo(i, 'done', 'Measured');
  }
  function checks() {
    setPhase(2); $('#analysis-progress').value = 5;
    $('#status').textContent = 'Checking lighting, focus and framing; comparing the crown guide…';
  }
  async function ready(output, signal, minimumMs) {
    setPhase(3); $('#analysis-progress').value = 6;
    output.observations.forEach((observation, i) => {
      const check = output.comparison.comparisons.find(item => item.photoId === observation.photoId);
      photo(i, check.status === 'retake' ? 'warning' : 'done', check.status === 'retake' ? 'Measured · Retake needed' : 'Measured · Checks complete');
    });
    $('#analysis-panel').dataset.state = 'preparing';
    $('#status').textContent = 'Measurements ready. Preparing your demo report…';
    const remaining = Math.max(0, minimumMs - (performance.now() - started));
    $('#analysis-detail-note').textContent = `Actual model runtime: ${(output.processingMs / 1000).toFixed(2)}s. ` + (remaining > 0 ? 'Presentation pacing is on: the report appears after at least 8 seconds total.' : 'Image measurements and capture checks are ready.');
    signal.throwIfAborted();
    if (remaining > 0) await new Promise((resolve, reject) => {
      const finish = () => { signal.removeEventListener('abort', abort); resolve(); };
      const timeout = setTimeout(finish, remaining);
      const abort = () => { clearTimeout(timeout); signal.removeEventListener('abort', abort); reject(new DOMException('Analysis cancelled', 'AbortError')); };
      signal.addEventListener('abort', abort, {once: true});
    });
    signal.throwIfAborted();
    return {minimumDurationMs: minimumMs, elapsedMs: Math.round(performance.now() - started)};
  }
  function end(success) {
    tick(); stop();
    $('#analysis-panel').dataset.state = success ? 'complete' : 'stopped';
    if (success) { setPhase(4); $('#analysis-progress').value = 7; }
    else {
      const active = document.querySelectorAll('.analysis-stage')[phase];
      if (active) { active.dataset.state = 'stopped'; active.querySelector('.stage-state').textContent = 'Stopped'; }
      document.querySelectorAll('.analysis-photo[data-state="active"]').forEach(item => { item.dataset.state = 'stopped'; item.querySelector('.photo-state').textContent = 'Stopped'; });
      $('#analysis-detail-note').textContent = 'This run was not saved. Any earlier completed report is kept.';
    }
  }
  window.DemoProgress = {reset, begin, stage, checks, ready, end};
})();
