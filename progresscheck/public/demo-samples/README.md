# ProgressCheck synthetic demo samples

These files are fictional demonstration material, not photographs documenting a patient's treatment. Week labels do not imply realistic biological change over that interval.

- `week-0.jpg`: existing synthetic crown sample from the earlier ProgressCheck demo image set.
- `week-1.png`, `week-2.png`, `week-3.png`: generated variations using the built-in image-generation tool on 16 October 2026.
- `front.jpg`, `left.jpg`, `right.jpg`: existing synthetic reference views. These are the same reference views across the workspace's fictional check-ins, not longitudinal evidence.

Generation prompt set: preserve the fictional adult's posture, head outline, crop, background, clothing, face and lighting; change only the crown hair, with the visible scalp gap approximately one-third smaller (Week 1), two-thirds smaller (Week 2), and nearly covered (Week 3). Photorealistic hair, no text, overlays or panels. Images are illustrative variations; invariants and simulated change are not clinically validated.

## Analysis

`/demo.html` uses the existing pinned MediaPipe HairSegmenter through `/ml.js` and `/ml-worker.js`. All four sample images are processed on demand using the CPU delegate. No report measurements are seeded or forced to increase. A larger hair mask is not equivalent to fuller hair: this model may classify exposed scalp within the hairstyle as hair.

The report's change is an arithmetic difference in **full-image hair-mask area**, in percentage points. It is not density, regrowth, accuracy, treatment success, or a longitudinal clinical finding. The synthetic sequence visually illustrates fuller hair independently of what the model measures.

Demo reports use a separate browser-storage key, `progresscheck-demo-analysis-v1`. They do not write to Supabase, modify account records, or require sign-in. Export includes the model version, measured counts, quality notes, provenance and masks. The print dialog supports saving a PDF where available.

Model weights and WASM assets are verified by SHA-256 through `scripts/setup-model.mjs`. Production uses the existing Vercel Git deployment configuration.
