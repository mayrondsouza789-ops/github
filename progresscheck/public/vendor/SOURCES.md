# ProgressCheck research-model dependencies

The application serves these files locally. User images are passed to the on-device MediaPipe worker, not to the download origins below.

## Installation and integrity

The six runtime/model assets are intentionally excluded from Git. `npm ci` runs `scripts/setup-model.mjs` through `postinstall` to fetch them before the application is built. Run `npm run setup:model` to retry or when installation used `--ignore-scripts`. Downloading requires network access to `cdn.jsdelivr.net` and `storage.googleapis.com`; inference later uses the copies served by the application.

The script verifies existing files and skips matching copies. New downloads go to a temporary file in this directory; only the exact pinned size and SHA-256 allow an atomic rename into place. Failure returns a nonzero exit status, preserves any previous target file, and removes the partial download. No unverified download is accepted. Licenses, the upstream README and this provenance document remain tracked.

| Asset | Bytes | SHA-256 |
|---|---:|---|
| `vision_bundle.mjs` | 137735 | `40f4123dfcd75cfa58add046919cc6f52fde66f009ff582997c09ba54c6ba27c` |
| `vision_wasm_internal.js` | 204284 | `4a97e2520ba506c680ecd6ba6acfb146888afa0e2746d57f205352bc6ebb82eb` |
| `vision_wasm_internal.wasm` | 9574032 | `f00ec4731faa23b3e714d00e88d4d10e2df5c0a427d3a2b4ae6e3526fdd14ef7` |
| `vision_wasm_nosimd_internal.js` | 204137 | `927def7b465c51b86e4b3060f93646aca4e27121f4b8fc0483786e407ea9cf1f` |
| `vision_wasm_nosimd_internal.wasm` | 9448638 | `3821ea9b1f7fb8c549ef2a064ef5c85750bf375c545a49fd6eea0df44a95f1f4` |
| `hair_segmenter.tflite` | 781618 | `2628cf3ce5f695f604cbea2841e00befcaa3624bf80caf3664bef2656d59bf84` |

These hashes were computed from the local assets used for the genuine inference smoke tests. The exact download URLs are listed below and pinned in the setup script.

## Pretrained model

- Model: Google MediaPipe HairSegmenter, float32, pinned version 1.
- Download: https://storage.googleapis.com/mediapipe-models/image_segmenter/hair_segmenter/float32/1/hair_segmenter.tflite
- SHA-256: `2628cf3ce5f695f604cbea2841e00befcaa3624bf80caf3664bef2656d59bf84`
- Official model documentation: https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter
- Model card and license declaration: https://storage.googleapis.com/mediapipe-assets/Model%20Card%20-%20Hair%20Segmentation.pdf
- License: Apache 2.0. See `MEDIAPIPE-LICENSE.txt`.

This model labels background and hair. Its documented use is selfie-hair segmentation for visual effects. ProgressCheck uses it solely for a research demonstration. It is not validated here for scalp progress, treatment response, diagnosis, or hair density.

## Browser runtime

Pinned package: `@mediapipe/tasks-vision@0.10.21`.

- `vision_bundle.mjs`: https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/vision_bundle.mjs
- `vision_wasm_internal.js`: https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm/vision_wasm_internal.js
- `vision_wasm_internal.wasm`: https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm/vision_wasm_internal.wasm
- `vision_wasm_nosimd_internal.js`: https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm/vision_wasm_nosimd_internal.js
- `vision_wasm_nosimd_internal.wasm`: https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm/vision_wasm_nosimd_internal.wasm
- `MEDIAPIPE-README.md`: https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/README.md
- License source: https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE
- Official browser guide: https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter/web_js

No dependency uses an unpinned runtime CDN URL. The FilesetResolver chooses the bundled SIMD or non-SIMD WASM files according to browser support. GPU inference falls back to the CPU delegate when required; graphics support can still be necessary for image preprocessing.
