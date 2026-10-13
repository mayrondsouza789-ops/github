import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const MODEL_ASSETS = Object.freeze([
  {
    name: 'vision_bundle.mjs',
    url: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/vision_bundle.mjs',
    sha256: '40f4123dfcd75cfa58add046919cc6f52fde66f009ff582997c09ba54c6ba27c',
    bytes: 137735,
  },
  {
    name: 'vision_wasm_internal.js',
    url: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm/vision_wasm_internal.js',
    sha256: '4a97e2520ba506c680ecd6ba6acfb146888afa0e2746d57f205352bc6ebb82eb',
    bytes: 204284,
  },
  {
    name: 'vision_wasm_internal.wasm',
    url: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm/vision_wasm_internal.wasm',
    sha256: 'f00ec4731faa23b3e714d00e88d4d10e2df5c0a427d3a2b4ae6e3526fdd14ef7',
    bytes: 9574032,
  },
  {
    name: 'vision_wasm_nosimd_internal.js',
    url: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm/vision_wasm_nosimd_internal.js',
    sha256: '927def7b465c51b86e4b3060f93646aca4e27121f4b8fc0483786e407ea9cf1f',
    bytes: 204137,
  },
  {
    name: 'vision_wasm_nosimd_internal.wasm',
    url: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm/vision_wasm_nosimd_internal.wasm',
    sha256: '3821ea9b1f7fb8c549ef2a064ef5c85750bf375c545a49fd6eea0df44a95f1f4',
    bytes: 9448638,
  },
  {
    name: 'hair_segmenter.tflite',
    url: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/hair_segmenter/float32/1/hair_segmenter.tflite',
    sha256: '2628cf3ce5f695f604cbea2841e00befcaa3624bf80caf3664bef2656d59bf84',
    bytes: 781618,
  },
].map(asset => Object.freeze(asset)));

export const DEFAULT_DESTINATION = fileURLToPath(new URL('../public/vendor/', import.meta.url));

async function existingDigest(file) {
  const hash = createHash('sha256');
  let bytes = 0;
  try {
    for await (const chunk of createReadStream(file)) {
      bytes += chunk.length;
      hash.update(chunk);
    }
    return { sha256: hash.digest('hex'), bytes };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/** Download only missing/mismatched assets. Destination override supports isolated verification. */
export async function setupModel(destination = DEFAULT_DESTINATION, options = {}) {
  const { assets = MODEL_ASSETS, fetchImpl = globalThis.fetch, log = console.log, timeoutMs = 120000 } = options;
  const directory = resolve(destination);
  await mkdir(directory, { recursive: true });
  const results = [];

  for (const asset of assets) {
    if (asset.name !== basename(asset.name) || !/^[a-z0-9_.-]+$/i.test(asset.name) || !/^[a-f0-9]{64}$/.test(asset.sha256) || !Number.isSafeInteger(asset.bytes) || asset.bytes < 1) {
      throw new Error('Invalid model-asset manifest. Restore scripts/setup-model.mjs from the repository.');
    }
    if (new URL(asset.url).protocol !== 'https:') throw new Error(`Asset ${asset.name} must use HTTPS.`);
    const target = resolve(directory, asset.name);
    const prior = await existingDigest(target);
    if (prior?.sha256 === asset.sha256 && prior.bytes === asset.bytes) {
      log(`[model] Verified ${asset.name}; download skipped.`);
      results.push({ name: asset.name, status: 'verified', sha256: prior.sha256, bytes: prior.bytes });
      continue;
    }

    const temporary = resolve(directory, `.${asset.name}.partial-${randomUUID()}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error(`Download timed out after ${timeoutMs / 1000} seconds.`)), timeoutMs);
    try {
      log(`[model] Downloading pinned ${asset.name}${prior ? ' to replace a checksum mismatch' : ''}.`);
      const response = await fetchImpl(asset.url, { signal: controller.signal, redirect: 'follow' });
      if (!response.ok || !response.body) throw new Error(`Download returned HTTP ${response.status}; no usable asset was received.`);
      const hash = createHash('sha256');
      let bytes = 0;
      const verifier = new Transform({
        transform(chunk, encoding, callback) {
          bytes += chunk.length;
          if (bytes > asset.bytes) return callback(new Error(`Size mismatch: downloaded data exceeds the pinned ${asset.bytes} bytes.`));
          hash.update(chunk);
          callback(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(response.body), verifier, createWriteStream(temporary, { flags: 'wx', mode: 0o644 }), { signal: controller.signal });
      const digest = hash.digest('hex');
      if (bytes !== asset.bytes || digest !== asset.sha256) {
        throw new Error(`Integrity check failed: expected SHA-256 ${asset.sha256} and ${asset.bytes} bytes; received ${digest} and ${bytes} bytes. The existing asset was preserved.`);
      }
      // Same-directory rename exposes only a completely downloaded and verified file.
      await rename(temporary, target);
      log(`[model] Installed verified ${asset.name}.`);
      results.push({ name: asset.name, status: 'downloaded', sha256: digest, bytes });
    } catch (error) {
      throw new Error(`Could not prepare ${asset.name}: ${error.message}. Retry with npm run setup:model.`, { cause: error });
    } finally {
      clearTimeout(timeout);
      await rm(temporary, { force: true });
    }
  }
  log(`[model] Ready: ${results.length} pinned assets verified.`);
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  setupModel().catch(error => {
    console.error(`[model] ${error.message}`);
    process.exitCode = 1;
  });
}
