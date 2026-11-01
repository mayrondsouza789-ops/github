# ProgressCheck continuous monitoring

## Data and persistence

The monitoring workspace reads the existing `sessions`, photograph IDs, model observations, profile and mock guidance. It never seeds additional patient history. Existing sample dates and files remain unchanged. The `sample` flag separates synthetic and uploaded collections.

Additional user-entered state lives in `state.monitoring.real` or `state.monitoring.sample`:

- `routines[]`: ID, name, type, actual start date, frequency, notes and creation time.
- `logs[]`: routine ID, date, planned/completed applications, experience and concerns. One entry per routine/day. Unlogged days are unknown.
- `reviews[]`: private handoff preparation, linked assessment, questions and optional consultation date. Status is always `prepared_not_sent`.
- `nextDate` and `planNote`: user-selected capture milestone.

This is an additive JSON document extension. No SQL migration or destructive data operation is needed: the existing Supabase `pc_workspaces.state` JSONB column, owner RLS and optimistic revision RPC persist it. Source photographs and actual derived masks retain the existing owner-scoped photo storage. Both backend implementations validate the new document shape and limits. Guest storage stays local; sign-in does not migrate guest records.

## Evidence rules

`monitoring-core.js` produces the same snapshot used by every dashboard section, evidence JSON and PDF. Reference selection prefers the earliest assessment with at least one unflagged measured photo; each region still carries its own limitations. Users can select an earlier reference or previous assessment.

The MediaPipe model measures full-image hair-classified mask pixels. User-selected Front/Left/Right/Top/Crown views label the five regions; no anatomical localization, follicle counting, registration, clinical confidence calibration or treatment-response model is claimed. Mask overlays are actual model outputs. SHA-256 source fingerprints flag identical files reused on different dates as non-independent evidence.

Quality thresholds are experimental: mean luminance outside 45–215, Laplacian variance below 65 at maximum edge 512 px, pair brightness difference above 25 or aspect-ratio difference above 0.05. Wet/dry hair, styling, lighting setup, angle and distance are self-reported. Missing context lowers capture confidence; problematic pairs suppress numeric differences. A raw mask-area difference is never called growth, density or loss.

Routine records are displayed alongside photographs, without causal attribution. Insights are deterministic summaries of model measurements and evidence coverage, not generative medical advice. The suggested 28-day capture interval is an organizational default. Calendar files require manual import; no email/push service is connected.

## Professional review

Review preparation stays private until the user separately exports and shares it. No message is sent. Existing mock review roles remain available and explicitly simulated. There is no authenticated clinician, appointment booking or actual medical review service.

## Verification

Run `node --test tests/monitoring.test.mjs tests/backend.test.mjs tests/setup-model.test.mjs` and `node scripts/test-demo-checks.cjs`.

Browser checks cover the complete sample analysis, duplicate-source detection, missing Top evidence, a Top upload with pre-analysis quality checks, saved capture metadata, routine/log persistence, selected-pair controls, milestone and handoff preparation, PDF/JSON downloads, and mobile section widths. Tests use labelled local sample data. Production verification and final deployment identifiers are recorded in the task handoff.

This is a functional research demonstration, not a clinically validated healthcare product. Clinical validation and an authenticated professional service remain separate prerequisites for real clinical use.

## Report narratives

The appearance demo and fully measured built-in baseline-to-final sample collection include a clearly labelled, authored positive crown-growth story with four dated check-ins. It is separate from actual segmentation and capture findings. Other scenarios, incomplete collections, earlier selected dates and uploaded records never receive this scripted outcome. Uploaded-photo assessments explain each available view, missing or repeated sources, capture limits and practical next steps. The same narratives are included in PDF and JSON exports.
