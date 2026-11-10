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

Use the same database password in `DATABASE_URL`, URL-encoded if it contains special characters. Set your own secrets; the examples are placeholders. Keep credentials out of Git and files delivered to others. Re-running the seed on matching demo histories installs the current model’s dated scores and preserves recorded interventions.

Open http://127.0.0.1:8000 and sign in with `manager@radar.demo`, `analyst@radar.demo`, or `success@radar.demo` and the password you set in `DEMO_PASSWORD`. Analysts cannot write interventions or campaigns. API documentation is at `/docs`. Tokens expire after four hours. For a real deployment, add managed identity, login rate limiting, HTTPS, tenancy controls, audit retention, database migrations, monitoring, and a customer-data governance policy.

## Refill-risk prediction

The model estimates the chance that an active purchaser’s refill coverage lapses within 30 days. Each completed purchase establishes coverage for its product cycle plus 14 days. A later purchase can extend coverage. A lapse counts even when the customer returns later in the window.

In the 1 November 2026 synthetic snapshot, 876 active purchasers have coverage that can expire within the horizon. Another 925 have enough coverage to receive a probability of zero by definition. The remaining 3,199 customers are already inactive or have no completed purchase and receive an eligibility reason.

**Evaluation.** The October 1 release test contains 359 distinct customers and 119 observed lapses. Training, selection, calibration, operating-threshold selection and release evaluation use disjoint customer groups and chronological windows. Both models use the same held-out customers and outcomes.

| Held-out measure | Previous model | Current model |
| --- | ---: | ---: |
| Average precision | 0.783 | 0.834 |
| Brier loss, lower is better | 0.128 | 0.100 |
| Lapses among the highest-risk 72 customers | 55 | 60 |
| Precision among those 72 | 76.4% | 83.3% |
| Brier loss among the 177 whose coverage could expire | 0.243 | 0.203 |

The selected model uses logistic regression with refill-history features and separately calibrated probabilities. The 95% paired bootstrap interval for the change in Brier loss is −0.046 to −0.010. For average precision the interval is −0.003 to +0.105. The test covers one date and uses simulated transactions. Real-world performance requires validation against mature customer outcomes. Measuring the impact of outreach requires a separate intervention study.

**Using the scores.** Churn Intelligence ranks eligible customers for review. Model Intelligence shows model comparisons, held-out contact-capacity results and calibration. The classification threshold optimizes F1 on a separate cohort. Queue precision depends on the number of customers a team can review. Feature explanations measure the change in score when one feature takes its training median.

**Training and serving.** Install the pinned dependencies and run from the application directory.

```powershell
python -m backend.train_v3
python -m backend.train_v3 --promote
```

The first command records a candidate run. The second requests promotion under the release checks. Each run stores its model and report in `backend/runs/`. The active workspace export and scores are in `dist/data.json`. FastAPI loads the matching versioned artifact. The public static app serves scores computed for its displayed snapshot. The report records the dataset fingerprint, feature schema, evaluation dates and artifact digest.

**Monitoring later outcomes.** Archive the published workspace JSON when the scores are issued. Once the complete outcome window has been observed, evaluate that fixed cohort against a later export containing its full transaction history.

```powershell
python -m backend.outcomes --predictions frozen-workspace.json --observations later-workspace.json
```

The audit checks customer identity, product cycles and historical purchase continuity. It reports observed versus expected lapses, Brier loss and top-20% queue precision. For the 1 November snapshot, the first complete exclusive observation date is 2 December 2026. Until then, the result is `awaiting_maturity`. Log any outreach that could have changed subsequent purchases when interpreting results.

[Historical development notes](TRANSFORMATION.md) describe the earlier models. The active run’s `report.json` gives the current definitions and metrics.

## Analytical definitions and limits

- Active/retained: last completed order is within the product cycle plus operational grace; observed churn is its complement among purchasers.
- Retention KPI is a refill-status proxy, not a causal or survival estimate. Repeat rate is the share with two or more completed orders.
- Customer value is historical completed-order revenue, not predicted lifetime value.
- Revenue at risk is historical value weighted by probability for high/critical risk customers, not a forecast of revenue loss.
- Repeat-order revenue is descriptive. It is not claimed to be saved or retained by an intervention.
- Historical model comparisons use the same held-out customers and prediction date.
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
