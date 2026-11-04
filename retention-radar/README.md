# Retention Radar — v2

Read [TRANSFORMATION.md](TRANSFORMATION.md) for the current architecture, model, acceptance audit, and outstanding requirements. The original setup guide follows; v2 supersedes its model description.

# Retention Radar

A working synthetic retention intelligence demo for Man Matters. All 5,000 customers, 11,081 orders, support interactions, and engagement events are fictional. No real communications are sent.

## Two supported modes

**Hosted demonstration:** the static `dist/` app contains all ten navigation modules, Python-generated predictions, customer search and profiles, segmentation, cohort and product analytics, CSV downloads, intervention management, and campaign simulation. Operational changes persist in browser local storage. Demo role switching illustrates access differences but is not authentication. The Vercel deployment is a public synthetic demonstration; no real customer records are included.

**Full-stack local installation:** FastAPI serves the same frontend, requires signed login tokens, reads the seeded relational database, and saves interventions, history, outcomes, and simulated campaigns through authenticated APIs. PostgreSQL is the intended database. This backend is not deployed with the static Vercel frontend.

## Start the hosted-demo frontend locally

From this directory:

```powershell
python -m http.server 8765 --bind 127.0.0.1 --directory dist
```

Open http://127.0.0.1:8765. No dependency install is required for this mode. The dataset and exported predictions are already included.

## Start FastAPI with PostgreSQL

Install Python 3.11+ and Docker with Compose. From this directory:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
$env:POSTGRES_PASSWORD = 'choose-a-local-database-password'
docker compose up -d --wait
$env:DATABASE_URL = 'postgresql+psycopg://radar:YOUR_URL_ENCODED_PASSWORD@localhost:5432/radar'
$env:JWT_SECRET = python -c "import secrets; print(secrets.token_hex(32))"
$env:DEMO_PASSWORD = 'choose-a-demo-login-password-at-least-12-characters'
python -m backend.seed
python -m uvicorn backend.api:app --host 127.0.0.1 --port 8000
```

Use the same database password in `DATABASE_URL`, URL-encoded if it contains special characters. Set your own secrets; the examples are placeholders. Keep credentials out of Git and files delivered to others. Seed is idempotent and will not replace an existing database.

Open http://127.0.0.1:8000 and sign in with `manager@radar.demo`, `analyst@radar.demo`, or `success@radar.demo` and the password you set in `DEMO_PASSWORD`. Analysts cannot write interventions or campaigns. API documentation is at `/docs`. Tokens expire after four hours. For a real deployment, add managed identity, login rate limiting, HTTPS, tenancy controls, audit retention, database migrations, monitoring, and a customer-data governance policy.

## Reproduce the ML pipeline

```powershell
python backend/generate.py
```

The deterministic seed is 42. Logistic Regression is compared against Random Forest; validation PR-AUC selects the model and validation F1 selects the intervention evaluation threshold. Test data is not used for selection. Chronological splits and disjoint customer groups prevent repeated-customer overlap; labels mature before the next split. Features use events strictly before their prediction snapshot. Missing numeric values are median-imputed inside the fitted pipeline.

Target: no completed repeat purchase by the 30-day horizon, among customers whose product-specific expected replenishment plus 14-day grace falls within that horizon. These estimates include already-overdue customers, rather than estimating incident churn alone. Scoring customers outside refill eligibility is extrapolation and should be treated cautiously. Customers with no completed orders are unscored. Six product cycles vary from 30 to 60 days.

Optional retraining: `python backend/generate.py --horizon 60 --grace 21` (horizons 30, 60, 90 are supported). Alternative horizons use earlier, non-overlapping snapshots so every label matures. Regenerate the matching database in a fresh environment when changing model definitions; the seed intentionally does not overwrite existing records. The delivered frontend copy is configured for the default 30-day/14-day model; model metadata and metrics update after a training run, but fixed explanatory labels need updating if publishing a different horizon.

Explanations use one-feature replacement sensitivity against training medians, not SHAP. Correlated features can share attribution. No explanation is a causal claim. Model calibration tables and Brier loss expose probability reliability; scores have not been calibrated on real data. Synthetic model performance does not imply production performance.

## Analytical definitions and limits

- Active/retained: last completed order is within the product cycle plus operational grace; observed churn is its complement among purchasers.
- Retention KPI is a refill-status proxy, not a causal or survival estimate. Repeat rate is the share with two or more completed orders.
- Customer value is historical completed-order revenue, not predicted lifetime value.
- Revenue at risk is historical value weighted by probability for high/critical risk customers, not a forecast of revenue loss.
- Repeat-order revenue is descriptive. It is not claimed to be saved or retained by an intervention.
- The current model risk and exposure card comparisons use historical observed overdue proxies. These differences are disclosed in the metric tooltips and dashboard note and should not be interpreted as like-for-like model movement.
- Cohorts begin at first completed purchase; each cell measures purchasing within a subsequent calendar month. Unfinished months are blank, never zero-filled.
- Product tables use customers acquired during the chosen period and their observed orders; channel filters apply. Customer-list period controls select the summary export window, while record filters govern the customer export.
- Support statuses in generated histories are fixed synthetic snapshots. Production training needs timestamped ticket-status changes.
- Risk trend is unavailable because the demo stores one current score per customer. No historical score trend is invented.
- Campaign responses and initial intervention outcomes are explicitly simulated. No control experiment exists, so incremental retention is not reported.
- Local demo changes and server database records are independent; local browser edits are not silently imported into PostgreSQL.

## Checks

```powershell
node --check dist/app.js
python -m compileall -q backend
python -m backend.check
```

The integration check uses an isolated temporary SQLite database to exercise the same ORM, authentication, role checks, customer queries, intervention writes, campaign simulation, export, and model inference. This does not verify a running PostgreSQL instance. PostgreSQL/Docker were unavailable in the build environment, so that deployment path requires a local smoke test after Compose starts.

The browser was used to verify the hosted-demo UI, customer search, profile explanation, intervention creation, navigation, and CSV download. A validation note accompanies the source.
