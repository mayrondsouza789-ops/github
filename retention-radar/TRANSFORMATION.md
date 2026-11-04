# Retention Radar v2 — implementation and acceptance audit

This is a substantial tested iteration, not a claim that every production requirement in the transformation brief is complete.

## Audit findings addressed

The prior app was buildless JavaScript and CSS, with a FastAPI/SQLAlchemy backend and PostgreSQL deployment configuration. It was not React. It used real scikit-learn inference, but its target included customers already inactive, used current support statuses in historical features, and compared model estimates against incompatible historical proxies. The frontend was a monolithic renderer with repetitive metric cards, two fonts, decorative Unicode navigation, and no reduced-motion treatment.

The existing customer records, exports, APIs, and operational forms were retained. `intelligence.js` adds analytical workspaces independently; `refined.css` supplies the new design tokens and overrides. This retains working functionality but does not constitute the requested React/TypeScript migration.

## Implemented

- Inter-based typography, compact grouped metrics, neutral sidebar, consistent SVG navigation, restrained teal accents, compact table hierarchy, and reduced card rounding.
- Motion durations of 150/220/300ms, chart reveal, drawer entrance, row/control states, and reduced-motion overrides.
- Separate Churn Intelligence and Model Intelligence workspaces; saved customer filters, secondary sorting, selection, bulk follow-up creation, optional columns, and an intervention board/table switch.
- Approved natural-language metric routing with population, window, definition, evidence, and workspace drill-down. Unsupported questions are rejected. This is deterministic query routing, not an LLM conversation.
- Grounded product/support observations; matched-weekday daily-order anomaly flags with low-volume suppression.
- Incident-inactivity model target restricted to currently active purchasers. Already-inactive customers and customers without completed orders remain unscored. Missing SKU, pack-size, subscription, and multi-item data are disclosed rather than invented.
- Fourteen features derived from recorded events. Historical support features use ticket creation counts, excluding unresolved status because resolution history is absent.
- Logistic Regression, Random Forest, and Gradient Boosting compared on validation PR-AUC. Platt calibration fitted on validation predictions; customer-disjoint chronological held-out test. Signed feature-replacement sensitivity, capacity metrics, product subgroup evaluation, Brier loss, calibration bins, current feature missingness, and standardised mean shifts.
- Candidate registry containing model artifacts and reports. Explicit promotion guarded by baseline PR-AUC and Brier checks. Training does not auto-promote. These gates use a test evaluation, so repeated tuning against this test set would require a new untouched release holdout.
- Conditional count forecast from calibrated active-customer probabilities, with a simulated 95% interval and explicit independence/model-uncertainty limitations.
- Authenticated backend approved-metric query API and background candidate-training endpoint. Training status is represented by candidate reports; this in-process background task is not a durable queue.
- Data validation before training blocks duplicate identifiers, invalid timestamps/statuses, broken order references, negative amounts, and invalid product cycles.
- Removed incompatible percentage comparisons from current model risk/exposure cards; the interface explicitly states that comparable historical predictions are unavailable.

## Still outstanding against the full brief

- React/TypeScript migration, typed frontend contracts, a component-level architecture, and comprehensive frontend tests.
- Database schema migrations, live PostgreSQL verification, and production backend deployment. Static Sites continues to use browser-local operational changes; backend tests use isolated SQLite.
- Pack-size/SKU coverage accounting and concurrent multi-product replenishment. Current synthetic records contain a single category per customer. No clinical treatment discontinuation inference is made.
- Longitudinal model score snapshots, prediction-distribution drift, delayed-label performance monitoring, and fully independent calibration/selection/release partitions.
- Durable job orchestration, scheduled analytics, a complete training-run status UI, and controlled server-side model promotion with database prediction refresh.
- Anomaly detection beyond daily completed-order volume, revenue/repeat forecasting, and uncertainty including model error or shared market shocks.
- Full revenue-retention cohort modes, cohort record drill-down, geography filters, opt-out suppression in campaign simulations, contact-attempt records as independent entities, and controlled campaign experiments.
- Keyboard access to every existing clickable customer table row, modal exit transitions, and production-scale server pagination throughout the frontend.

The current 30-day model was selected as Logistic Regression. Held-out test: precision 71.1%, recall 61.1%, ROC-AUC 89.1%, PR-AUC 71.0%, Brier 0.132; top-20% capacity precision 69.4%, recall 44.2%, lift 2.21×. These are synthetic-data results. Calibration bins show residual miscalibration and should be examined before any real use.

## Reproduction

`python -m backend.train_v2` writes a candidate run. `--promote` explicitly promotes only if gates pass. The legacy `backend/generate.py` regenerates the original demonstration dataset and model; run v2 training afterward to restore the new target. Changing the published dataset requires refreshing an existing server database through an explicit data migration; seed does not overwrite existing data.

Run `node --check dist/app.js`, `node --check dist/intelligence.js`, `node analytics-check.cjs`, and `python -m backend.check`. The existing README describes installation. Its old model metrics and nine-feature description are superseded by this document and the current run registry.
