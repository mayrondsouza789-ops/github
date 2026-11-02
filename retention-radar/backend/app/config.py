"""Central configuration for Retention Radar (all data is SYNTHETIC demo data)."""
import os
from datetime import date

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql+psycopg2://postgres@127.0.0.1:5433/retention_radar"
)
# Hosted providers (Neon, Supabase, Vercel Postgres) hand out postgres:// or postgresql:// URLs.
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = "postgresql://" + DATABASE_URL[len("postgres://"):]
if DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = "postgresql+psycopg2://" + DATABASE_URL[len("postgresql://"):]
ON_VERCEL = bool(os.environ.get("VERCEL"))
JWT_SECRET = os.environ.get("RR_JWT_SECRET", "dev-only-change-me-in-production")
JWT_HOURS = 8

# Demo "today". The synthetic dataset covers 12 months of orders ending here.
AS_OF = date(2026, 10, 31)
DATA_START = date(2025, 11, 1)

SEED = 20261101
N_CUSTOMERS = 5000

DEFAULT_SETTINGS = {
    "thresholds": {"medium": 0.30, "high": 0.55, "critical": 0.75},
    "grace_days": 15,
    "horizon_days": 90,
}

RISK_ORDER = ["Low", "Medium", "High", "Critical"]
