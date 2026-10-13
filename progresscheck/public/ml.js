/* ProgressCheck research inference. No patient image leaves this module's browser. */
(() => {
  'use strict';
  const scriptURL = document.currentScript?.src || new URL('ml.js', document.baseURI).href;
  const workerURL = new URL('ml-worker.js', scriptURL).href;
  let active = null;
  let sequence = 0;
  const modelVersion = 'MediaPipe HairSegmenter float32/v1 | tasks-vision 0.10.21';
  function fail(message, code = 'ANALYSIS_FAILED') {
    const error = new Error(message); error.code = code; return error;
  }
  function abortError() {
    const error = fail('Analysis was cancelled. Your saved photographs are unchanged; you can retry.', 'ABORTED');
    error.name = 'AbortError'; return error;
  }
  function cancel() { if (active) active.finish(abortError()); }
  async function analyze(photos, onStage = () => {}, options = {}) {
    if (active) throw fail('An analysis is already running. Wait for it to finish or cancel it before retrying.', 'BUSY');
    if (!Array.isArray(photos) || photos.length === 0) throw fail('Add at least one photograph before running analysis.', 'NO_PHOTOS');
    if (photos.length > 20) throw fail('Analyze no more than 20 photographs at a time.', 'TOO_MANY_PHOTOS');
    const seen = new Set();
    const items = photos.map((photo, index) => {
      if (!photo || !photo.id || !photo.url) throw fail(`Photograph ${index + 1} is missing its identifier or image. Add it again.`, 'INVALID_PHOTO');
      if (seen.has(String(photo.id))) throw fail('The same photograph was included twice. Remove the duplicate and retry.', 'DUPLICATE_PHOTO');
      seen.add(String(photo.id));
      const url = new URL(photo.url, document.baseURI);
      if (!['blob:', 'data:', 'http:', 'https:'].includes(url.protocol)) throw fail('This photograph URL is unsupported. Upload the image again.', 'INVALID_PHOTO');
      if (['http:', 'https:'].includes(url.protocol) && url.origin !== location.origin) throw fail('Use an uploaded photograph from this workspace, rather than an external image URL.', 'EXTERNAL_IMAGE');
      return { id: String(photo.id), view: String(photo.view || 'Unspecified'), url: url.href };
    });
    if (options.signal?.aborted) throw abortError();
    if (!window.Worker || !window.OffscreenCanvas || !window.createImageBitmap) throw fail('This browser does not support the image-analysis worker. Try a current desktop Chrome or Edge browser.', 'UNSUPPORTED_BROWSER');
    const runId = ++sequence;
    return new Promise((resolve, reject) => {
      let worker, timer, settled = false;
      const onAbort = () => finish(abortError());
      function finish(error, result) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
        worker?.terminate();
        if (active?.id === runId) active = null;
        if (error) reject(error); else resolve(result);
      }
      function armTimeout() {
        clearTimeout(timer);
        timer = setTimeout(() => finish(fail('Analysis took too long on this device. Your photographs are saved. Retry, or use smaller images or a desktop browser.', 'TIMEOUT')), 120000);
      }
      active = { id: runId, finish };
      options.signal?.addEventListener('abort', onAbort, { once: true });
      try {
        worker = new Worker(workerURL, { name: 'ProgressCheck image analysis' });
        worker.onmessage = ({ data }) => {
          if (settled || data?.runId !== runId) return;
          if (data.type === 'stage') {
            armTimeout();
            try { onStage(data.stage); } catch (error) { console.warn('ProgressCheck stage callback failed', error); }
          } else if (data.type === 'result') {
            if (!data.result?.observations?.length) finish(fail('The model did not return any observations. Your photographs are saved; retry analysis.', 'EMPTY_RESULT'));
            else finish(null, data.result);
          } else if (data.type === 'error') finish(fail(data.message || 'Image analysis failed. Please retry.', data.code));
        };
        worker.onerror = (event) => {
          event.preventDefault();
          finish(fail('The local analysis worker could not start or stopped unexpectedly. Reload the page and retry. Make sure the model and browser runtime assets are available.', 'WORKER_ERROR'));
        };
        armTimeout();
        worker.postMessage({ type: 'analyze', runId, photos: items, options: { delegate: options.delegate === 'CPU' ? 'CPU' : 'GPU', includeMask: options.includeMask !== false } });
      } catch (error) {
        finish(fail(`The analysis worker could not start. ${error.message || 'Reload the page and retry.'}`, 'WORKER_ERROR'));
      }
    });
  }
  window.ProgressML = Object.freeze({
    analyze, cancel, reset: cancel, modelVersion,
    metric: Object.freeze({
      name: 'Full-image hair mask area', unit: '%',
      definition: '100 × pixels labelled hair / all pixels in the full-image category mask. This is framing-dependent image area, not scalp density or regrowth.',
      confidenceDefinition: 'Mean model hair-class score on pixels labelled hair, from 0 to 1; null when no pixels are labelled hair. It is not calibrated clinical accuracy.'
    })
  });
})();
