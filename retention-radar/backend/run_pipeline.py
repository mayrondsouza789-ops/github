"""End to end: generate synthetic data -> train churn model -> score -> segments -> intervention queue.

Usage (from the backend directory):  python run_pipeline.py
Set DATABASE_URL to point at your PostgreSQL database first.
"""
import json
from sqlalchemy import text

from pipeline import generate_data, train as T, score
from app.db import engine
from app.config import DEFAULT_SETTINGS
from app import schema as S


def main():
    data = generate_data.build_all()
    generate_data.write_db(data)
    with engine.begin() as cx:
        for k, v in DEFAULT_SETTINGS.items():
            cx.execute(S.app_settings.insert().values(key=k, value=v))
    run = T.train()
    run_id = T.save_run(run)
    score.run(run_id)
    print("pipeline complete")


if __name__ == "__main__":
    main()
