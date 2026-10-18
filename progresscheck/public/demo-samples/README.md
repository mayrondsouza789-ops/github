# ProgressCheck synthetic demo samples

These files are fictional demonstration material, not photographs documenting a patient's treatment. Week labels do not imply realistic biological change over that interval.

- `week-0.jpg`: existing synthetic crown sample from the earlier ProgressCheck demo image set.
- `week-1.png`, `week-2.png`, `week-3.png`: generated variations using the built-in image-generation tool on 16 October 2026.
- `front.jpg`, `left.jpg`, `right.jpg`: existing synthetic reference views. These are the same reference views across the workspace's fictional check-ins, not longitudinal evidence.

Generation prompt set: preserve the fictional adult's posture, head outline, crop, background, clothing, face and lighting; change only the crown hair, with the visible scalp gap approximately one-third smaller (Week 1), two-thirds smaller (Week 2), and nearly covered (Week 3). Photorealistic hair, no text, overlays or panels. Images are illustrative variations; invariants and simulated change are not clinically validated.

## Analysis

`/demo.html` uses the existing pinned MediaPipe HairSegmenter through `/ml.js` and `/ml-worker.js`. All four sample images are processed on demand using the CPU delegate. No report measurements are seeded or forced to increase. A larger hair mask is not equivalent to fuller hair: this model may classify exposed scalp within the hairstyle as hair.

The report's change is an arithmetic difference in **full-image hair-mask area**, in percentage points. It is not density, regrowth, accuracy, treatment success, or a longitudinal clinical finding. The synthetic sequence visually illustrates fuller hair independently of what the model measures.

Demo reports use a separate browser-storage key, `progresscheck-demo-v2-<scenario>`. They do not write to Supabase, modify account records, or require sign-in. Export includes the model version, measured counts, quality notes, provenance and masks. A three-page PDF downloads directly with source images, measurements, capture checks, mock review status and traceability.

Model weights and WASM assets are verified by SHA-256 through `scripts/setup-model.mjs`. Production uses the existing Vercel Git deployment configuration.

## Guided demo and comparison checks (18 October 2026)

Three scenarios are available: generated appearance variations, an unchanged control repeating the exact baseline file, and a poor-lighting example. `low-light.png` was made with the built-in image-generation tool using the baseline reference. Prompt: preserve the same fictional man, hair, head pose, framing, shirt and background; make the photograph strongly underexposed (approximately three stops); no text or hair changes. This remains generated artwork, so identity/pose preservation is not guaranteed.

`demo-compare.js` implements experimental capture thresholds and a fixed elliptical crown guide. Photographs are resampled to 256 x 192; anatomical registration is NOT implemented. A mean absolute RGB difference is reported inside the guide, distinct from the ML hair mask and from clinical progress. Failed pairs suppress this score and the difference overlay. The appearance series' Week 2 currently fails the relative-sharpness check; this is retained rather than changing a threshold to force success.

The exact unchanged control, low-light fixture, and synthetic perturbations in automated checks verify expected software behavior, not clinical accuracy. Clinical validation and anatomical alignment remain future work.

PDF library: jsPDF 4.2.1, vendored from https://cdn.jsdelivr.net/npm/jspdf@4.2.1/dist/jspdf.umd.min.js with its MIT license. SHA-256: e6551fcdc32f09d6853b2c5126d18d01d9447e0da618a41a11ebeee0f6c20d54. No browser CDN dependency is required at runtime.
