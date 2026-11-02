# Retention Radar

Internal churn and retention intelligence workspace for Man Matters.
**All data is synthetic demo data (5,000 customers, 12 months of orders). It does not describe real customers.**

## Run

```bash
pip install -r backend/requirements-ml.txt --break-system-packages
export DATABASE_URL=postgresql+psycopg2://postgres@127.0.0.1:5433/retention_radar
cd backend
python run_pipeline.py                      # generate data -> train -> score -> segments -> queue (first run only)
python -m uvicorn app.main:app --port 8000  # serves API, /docs and the frontend
```

Open http://localhost:8000. API docs at /docs.

| Role | Email | Password |
|---|---|---|
| Retention Manager | manager@retentionradar.demo | demo1234 |
| Business Analyst | analyst@retentionradar.demo | demo1234 |
| Customer Success Exec | exec1@retentionradar.demo | demo1234 |

## Layout

- `backend/pipeline/` generate_data, features (point-in-time, leakage-controlled), train (chronological split, logistic baseline vs gradient boosting, calibration, SHAP), score
- `backend/app/` FastAPI (JWT auth, role-based access, validation, pagination, CSV export)
- `frontend/` dependency-free SPA (hash routing, SVG charts)
- `docs/HANDOFF.md` design handoff spec

## Integrity notes

- Churn = no repurchase within grace days after the product-specific refill date; horizon and grace are configurable.
- Lapsed customers are not scored (the outcome already happened); they are routed to win-back.
- Intervention outcomes are observational. Only a control-group campaign supports an incremental claim.

## Deploy on Vercel

Vercel serves `frontend/` as static files and runs the FastAPI app as one Python function (`api/index.py`). It cannot run Postgres, so use a hosted one.

1. Create a free Postgres database (Neon or Supabase) and copy its connection string.
2. Load the synthetic demo data into it:
   ```bash
   zcat backend/seed/retention_radar_demo.sql.gz | psql "<your connection string>"
   ```
3. In Vercel choose **Add New > Project**, import this repo, and set **Root Directory** to `retention-radar`. Framework preset: Other.
4. Add environment variables: `DATABASE_URL` (the connection string) and `RR_JWT_SECRET` (any long random string).
5. Deploy. Sign in with the demo logins above.

Limits on the hosted demo: retraining is disabled (it needs the ML stack and a long-running process); run `backend/run_pipeline.py` locally against the same database to regenerate and retrain. The demo passwords are public, so change them before sharing the link widely.
