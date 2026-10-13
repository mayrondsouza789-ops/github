/* Classic worker: MediaPipe's WASM loader uses importScripts. */
'use strict';
const MODEL_VERSION = 'MediaPipe HairSegmenter float32/v1 | tasks-vision 0.10.21';
const MODEL_SOURCE = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/hair_segmenter/float32/1/hair_segmenter.tflite';
const BASE_LIMITATIONS = [
  'Research demonstration only. This pretrained selfie-hair model is not validated for scalp-progress analysis, diagnosis, treatment response, density, or regrowth.',
  'The metric is the percentage of the full-image mask labelled hair. Framing, pose, styling, lighting, headwear and background can change it.',
  'Views are selected by the user, not identified by the model. No region alignment is performed. Different dates cannot be treated as reliably comparable measurements.',
  'Model confidence scores are not calibrated clinical accuracy or measurement uncertainty.',
  'Brightness and sharpness warnings use experimental image-processing thresholds. They do not establish suitability for clinical comparison.',
  'Original photographs are not modified. The colored mask is a separately derived visualization.'
];
const round = (value, places = 2) => Math.round(value * 10 ** places) / 10 ** places;
const vendorURL = new URL('vendor/', self.location.href).href;

function qualityMetrics(bitmap) {
  const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(3, Math.round(bitmap.width * scale));
  const height = Math.max(3, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('The browser could not inspect the photograph. Try a different browser.');
  ctx.drawImage(bitmap, 0, 0, width, height);
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const grey = new Float32Array(width * height);
  let luminance = 0, dark = 0, light = 0;
  for (let i = 0; i < grey.length; i++) {
    const p = i * 4;
    grey[i] = 0.2126 * rgba[p] + 0.7152 * rgba[p + 1] + 0.0722 * rgba[p + 2];
    luminance += grey[i];
    if (grey[i] < 15) dark++;
    if (grey[i] > 240) light++;
  }
  let sum = 0, sumSq = 0, count = 0;
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const i = y * width + x;
    const laplacian = grey[i - 1] + grey[i + 1] + grey[i - width] + grey[i + width] - 4 * grey[i];
    sum += laplacian; sumSq += laplacian * laplacian; count++;
  }
  const brightness = luminance / grey.length;
  const sharpness = Math.max(0, sumSq / count - (sum / count) ** 2);
  const warnings = [];
  if (brightness < 45) warnings.push('The image is dark according to an experimental brightness threshold. Check whether hair and scalp are clearly visible.');
  if (brightness > 215) warnings.push('The image is bright according to an experimental threshold. Check for washed-out detail.');
  if (sharpness < 65) warnings.push('Low image detail was detected by an experimental sharpness measure. Blur or a uniform background may affect this result.');
  if (bitmap.width < 512 || bitmap.height < 512) warnings.push('At least one image dimension is below the model input size of 512 pixels. Fine detail may be limited.');
  return {
    brightness: round(brightness), brightnessUnit: 'mean luminance, 0–255',
    sharpness: round(sharpness), sharpnessUnit: 'variance of four-neighbor Laplacian at a maximum image edge of 512 px',
    darkPixelPercent: round(100 * dark / grey.length), brightPixelPercent: round(100 * light / grey.length),
    evaluatedWidth: width, evaluatedHeight: height, experimental: true, warnings
  };
}

async function maskPreview(category, width, height) {
  const scale = Math.min(1, 768 / Math.max(width, height));
  const outWidth = Math.max(1, Math.round(width * scale));
  const outHeight = Math.max(1, Math.round(height * scale));
  const canvas = new OffscreenCanvas(outWidth, outHeight);
  const ctx = canvas.getContext('2d');
  const pixels = ctx.createImageData(outWidth, outHeight);
  for (let y = 0; y < outHeight; y++) for (let x = 0; x < outWidth; x++) {
    const source = Math.min(height - 1, Math.floor(y * height / outHeight)) * width + Math.min(width - 1, Math.floor(x * width / outWidth));
    const offset = (y * outWidth + x) * 4;
    if (category[source] === 1) {
      pixels.data[offset] = 36; pixels.data[offset + 1] = 110; pixels.data[offset + 2] = 80; pixels.data[offset + 3] = 190;
    }
  }
  ctx.putImageData(pixels, 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return { maskUrl: `data:image/png;base64,${btoa(binary)}`, maskWidth: outWidth, maskHeight: outHeight };
}

async function analyze({ runId, photos, options }) {
  let segmenter = null;
  const startedAt = performance.now();
  let delegateUsed = options.delegate;
  const stage = (name, message, photoIndex = null) => self.postMessage({ type: 'stage', runId, stage: { stage: name, message, photoIndex, total: photos.length } });
  try {
    stage('loading_model', 'Loading the local hair-segmentation model.');
    const { FilesetResolver, ImageSegmenter } = await import(new URL('vision_bundle.mjs', vendorURL).href);
    const fileset = await FilesetResolver.forVisionTasks(vendorURL.replace(/\/$/, ''));
    const create = (delegate) => ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: new URL('hair_segmenter.tflite', vendorURL).href, delegate },
      canvas: new OffscreenCanvas(1, 1), runningMode: 'IMAGE',
      outputCategoryMask: true, outputConfidenceMasks: true
    });
    try { segmenter = await create(delegateUsed); }
    catch (error) {
      if (delegateUsed === 'CPU') throw error;
      delegateUsed = 'CPU';
      stage('cpu_fallback', 'Graphics acceleration is unavailable. Loading the CPU model.');
      segmenter = await create('CPU');
    }
    const observations = [];
    for (let index = 0; index < photos.length; index++) {
      const photo = photos[index];
      let bitmap = null, result = null;
      try {
        stage('checking_image', `Reading photograph ${index + 1} of ${photos.length}.`, index);
        const response = await fetch(photo.url);
        if (!response.ok) throw new Error('The saved photograph could not be read. Re-add it and retry.');
        bitmap = await createImageBitmap(await response.blob());
        if (bitmap.width < 16 || bitmap.height < 16) throw new Error('The photograph is too small to analyze. Upload an image at least 16 by 16 pixels.');
        if (bitmap.width * bitmap.height > 20000000) throw new Error('This photograph exceeds the demo limit of 20 megapixels. Add a smaller copy and retry; the original is unchanged.');
        const quality = qualityMetrics(bitmap);
        stage('segmenting', `Running the hair model on photograph ${index + 1} of ${photos.length}.`, index);
        try { result = segmenter.segment(bitmap); }
        catch (error) {
          if (delegateUsed === 'CPU') throw error;
          segmenter.close(); segmenter = null;
          delegateUsed = 'CPU';
          stage('cpu_fallback', 'Graphics inference failed. Retrying the current photograph on the CPU.', index);
          segmenter = await create('CPU');
          result = segmenter.segment(bitmap);
        }
        if (!result.categoryMask || !result.confidenceMasks?.[1]) throw new Error('The model returned no usable hair mask. No measurement was generated.');
        const category = result.categoryMask.getAsUint8Array();
        const confidence = result.confidenceMasks[1].getAsFloat32Array();
        const maskWidth = result.categoryMask.width;
        const maskHeight = result.categoryMask.height;
        if (!category.length || category.length !== maskWidth * maskHeight || confidence.length !== category.length) throw new Error('The model returned an incomplete mask. No measurement was generated.');
        let hairPixels = 0, confidenceSum = 0;
        for (let i = 0; i < category.length; i++) {
          if (!Number.isFinite(confidence[i])) throw new Error('The model returned an invalid confidence value. No measurement was generated.');
          if (category[i] === 1) { hairPixels++; confidenceSum += confidence[i]; }
        }
        if (!hairPixels) quality.warnings.push('The model labelled no pixels as hair. This does not establish absence of hair.');
        const preview = options.includeMask ? await maskPreview(category, maskWidth, maskHeight) : {};
        observations.push({
          photoId: photo.id, view: photo.view,
          hairAreaPercent: round(100 * hairPixels / category.length, 3),
          meanConfidence: hairPixels ? round(confidenceSum / hairPixels, 5) : null,
          width: bitmap.width, height: bitmap.height,
          hairPixelCount: hairPixels, totalMaskPixels: category.length,
          inferenceMaskWidth: maskWidth, inferenceMaskHeight: maskHeight,
          quality, ...preview,
          comparableAcrossDates: false, viewSource: 'user_selected',
          measurementDefinition: 'Percentage of the full-image category mask labelled hair. Not scalp density, follicle count, or regrowth.',
          confidenceDefinition: 'Mean hair-class score on pixels labelled hair; null when none are labelled hair. Not calibrated clinical accuracy.'
        });
      } catch (error) {
        throw new Error(`Photograph ${index + 1} (${photo.view}): ${error.message || 'The image could not be analyzed.'}`);
      } finally { result?.close(); bitmap?.close(); }
    }
    if (!observations.length) throw new Error('The model returned no observations. Add photographs and retry.');
    stage('preparing_report', 'Preparing the measured research observations.');
    const output = {
      status: 'complete', researchOnly: true, modelVersion: MODEL_VERSION, modelSource: MODEL_SOURCE,
      processedAt: new Date().toISOString(), processingMs: Math.round(performance.now() - startedAt),
      delegate: delegateUsed, metricName: 'Full-image hair mask area', metricUnit: '%',
      observations, limitations: BASE_LIMITATIONS,
      longitudinalOutcome: 'Images are not established as reliably comparable. No longitudinal change or treatment conclusion is calculated.'
    };
    self.postMessage({ type: 'result', runId, result: output });
  } catch (error) {
    self.postMessage({ type: 'error', runId, code: 'INFERENCE_FAILED', message: `Real image analysis could not be completed. ${error.message || 'The model or its runtime could not load.'} Your saved photographs are unchanged. You can retry.` });
  } finally { segmenter?.close(); }
}
self.onmessage = ({ data }) => { if (data?.type === 'analyze') analyze(data); };
