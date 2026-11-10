"""Evaluate a frozen workspace score snapshot once subsequent orders are observable."""
import argparse
import json
import math
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

import numpy as np
from sklearn.metrics import average_precision_score, brier_score_loss

from .prediction import GRACE_DAYS, lapse_observed


def performance(rows):
    if not rows:
        return {"customers": 0}
    probabilities = np.array([row[0] for row in rows])
    labels = np.array([row[1] for row in rows], dtype=int)
    # IDs only break exact probability ties. They never enter a prediction.
    rank = np.lexsort(([row[2] for row in rows], -probabilities))
    capacity = max(1, math.ceil(len(rows) * 0.2))
    reviewed = labels[rank[:capacity]]
    return {
        "customers": len(rows), "observed_lapses": int(labels.sum()),
        "expected_lapses": float(probabilities.sum()),
        "observed_rate": float(labels.mean()), "mean_probability": float(probabilities.mean()),
        "brier": float(brier_score_loss(labels, probabilities)),
        "average_precision": float(average_precision_score(labels, probabilities)) if labels.any() else None,
        "top_20_percent": {
            "customers": capacity, "observed_lapses": int(reviewed.sum()),
            "precision": float(reviewed.mean()),
            "recall": float(reviewed.sum() / labels.sum()) if labels.any() else None,
        },
    }


def audit(frozen, observed):
    report = frozen["model"]
    when = date.fromisoformat(frozen["asOf"])
    horizon = int(report["horizon"])
    if horizon <= 0 or report["grace"] != GRACE_DAYS:
        raise ValueError("The archived outcome definition must use a positive horizon and the recorded 14-day grace.")
    end = when + timedelta(days=horizon)
    watermark = date.fromisoformat(observed["asOf"])
    result = {"version": report["version"], "scored_as_of": str(when), "through": str(end),
              "observations_before": str(watermark), "synthetic": bool(frozen.get("synthetic"))}
    if watermark <= end:
        return {**result, "status": "awaiting_maturity", "first_complete_as_of": str(end + timedelta(days=1))}

    archive = {c["id"]: c for c in frozen["customers"] if c["probability"] is not None}
    if len(archive) != sum(c["probability"] is not None for c in frozen["customers"]):
        raise ValueError("Duplicate customer IDs in the scored cohort.")
    identities = {c["id"]: c["code"] for c in observed["customers"]}
    if any(identities.get(cid) != c["code"] for cid, c in archive.items()):
        raise ValueError("The later extract must contain the same scored customer identities.")
    products = {p["id"]: p for p in observed["products"]}
    if any(products.get(p["id"], {}).get("cycle") != p["cycle"] for p in frozen["products"]):
        raise ValueError("Refill-cycle definitions differ between snapshots.")

    # A later partial extract could make missing purchases look like lapses.
    # Match completed history through the prediction cutoff before evaluating outcomes.
    def history(data):
        return sorted((o["id"], o["customer"], o["product"], o["date"])
                      for o in data["orders"] if o["customer"] in archive and
                      o["date"] < frozen["asOf"] and o["status"] == "completed")
    if history(frozen) != history(observed):
        raise ValueError("Historical purchases changed. Reconcile the two extracts before evaluating scores.")

    future = defaultdict(list)
    for order in observed["orders"]:
        if order["customer"] in archive and str(when) <= order["date"] <= str(end):
            future[order["customer"]].append(order)
    rows, actionable = [], []
    for cid, customer in archive.items():
        p = customer["probability"]
        if not math.isfinite(p) or not 0 <= p <= 1:
            raise ValueError("The archive contains a probability outside [0, 1].")
        if customer.get("model_version") != report["version"] or customer.get("prediction_timestamp") != str(when):
            raise ValueError("Score version or timestamp differs from its frozen report.")
        coverage = date.fromisoformat(customer["coverage_end"])
        if coverage < when:
            raise ValueError("A scored customer was already inactive at the prediction cutoff.")
        orders = sorted(future[cid], key=lambda order: order["date"])
        event = lapse_observed(orders, coverage, when, horizon, products, watermark)
        row = (p, event, cid)
        rows.append(row)
        if coverage < end:
            actionable.append(row)
    return {**result, "status": "evaluated", "all_scored": performance(rows),
            "coverage_expires_in_window": performance(actionable)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--predictions", required=True, type=Path, help="Frozen v3 workspace JSON")
    parser.add_argument("--observations", required=True, type=Path, help="Later, complete workspace JSON")
    args = parser.parse_args()
    print(json.dumps(audit(json.loads(args.predictions.read_text(encoding="utf-8")),
                           json.loads(args.observations.read_text(encoding="utf-8"))), indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
