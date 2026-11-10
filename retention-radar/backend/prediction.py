"""Point-in-time features and shared scoring for the incident-refill model."""
from datetime import date, timedelta

import numpy as np

GRACE_DAYS = 14
FEATURE_INFO = {
    "coverage_days": ("Remaining refill coverage", "days"),
    "last_cycle_days": ("Last purchased product's refill cycle", "days"),
    "recency_ratio": ("Elapsed time since purchase / refill cycle", "cycles"),
    "order_count": ("Completed purchases", "orders"),
    "last_gap_ratio": ("Last refill interval / preceding product cycle", "cycles"),
    "mean_gap_ratio": ("Mean refill interval / preceding product cycle", "cycles"),
    "late_refill_share": ("Past refill gaps exceeding coverage", "fraction"),
    "failed_since_purchase": ("Cancelled or refunded attempts since last purchase", "orders"),
    "failed_order_fraction": ("Cancelled or refunded share of recorded orders", "fraction"),
    "purchases_90d": ("Completed purchases in the preceding 90 days", "orders"),
    "tenure_cycles": ("Time since first purchase / latest refill cycle", "cycles"),
}
FEATURES = list(FEATURE_INFO)
NULLABLE_FEATURES = {"last_gap_ratio", "mean_gap_ratio", "late_refill_share"}


def history_features(customer, when, index):
    """End of the preceding day is the information boundary. Age/channel/ID are excluded."""
    orders, _, _, products = index
    cutoff = when.isoformat()
    history = [o for o in orders[customer["id"]] if o["date"] < cutoff]
    purchases = [o for o in history if o["status"] == "completed"]
    if not purchases:
        return None, None
    last = purchases[-1]
    purchase_dates = [date.fromisoformat(o["date"]) for o in purchases]
    cycle = products[last["product"]]["cycle"]
    elapsed = (when - purchase_dates[-1]).days
    remaining = cycle + GRACE_DAYS - elapsed
    gaps = [(b - a).days for a, b in zip(purchase_dates, purchase_dates[1:])]
    prior_cycles = [products[o["product"]]["cycle"] for o in purchases[:-1]]
    ratios = [gap / duration for gap, duration in zip(gaps, prior_cycles)]
    late = [gap > duration + GRACE_DAYS for gap, duration in zip(gaps, prior_cycles)]
    since = when - timedelta(days=90)
    row = [
        remaining, cycle, elapsed / cycle, len(purchases),
        ratios[-1] if ratios else np.nan, np.mean(ratios) if ratios else np.nan,
        np.mean(late) if late else np.nan,
        sum(o["date"] > last["date"] and o["status"] != "completed" for o in history),
        1 - len(purchases) / len(history), sum(d >= since for d in purchase_dates),
        (when - purchase_dates[0]).days / cycle,
    ]
    return row, when + timedelta(days=remaining)


def lapse_observed(orders, coverage_end, when, horizon, products, observed_before):
    """Check first lapse. Records are observable strictly before observed_before."""
    end = when + timedelta(days=horizon)
    if end >= observed_before:
        raise ValueError("The complete outcome window has not matured")
    coverage = coverage_end
    for order in orders:
        if order["date"] < when.isoformat() or order["status"] != "completed":
            continue
        order_date = date.fromisoformat(order["date"])
        if order_date > end:
            break
        if order_date > coverage:
            return True
        extension = timedelta(days=products[order["product"]]["cycle"] + GRACE_DAYS)
        coverage = max(coverage, order_date + extension)
    return coverage < end


def log_odds(probabilities):
    clipped = np.clip(probabilities, 1e-6, 1 - 1e-6)
    return np.log(clipped / (1 - clipped)).reshape(-1, 1)


def predict_probabilities(artifact, X):
    """Score active purchaser feature rows in canonical order, including deterministic coverage."""
    if list(artifact["features"]) != FEATURES:
        raise ValueError("Artifact feature schema is incompatible with v3 scoring")
    matrix = np.asarray(X, dtype=float)
    if matrix.ndim != 2 or matrix.shape[1] != len(FEATURES):
        raise ValueError("Expected one feature vector per row in the published feature order")
    required = [i for i, feature in enumerate(FEATURES) if feature not in NULLABLE_FEATURES]
    if np.isinf(matrix).any() or not np.isfinite(matrix[:, required]).all():
        raise ValueError("Only past-refill interval fields allow missing values")
    remaining = matrix[:, 0]
    if np.any(remaining < 0):
        raise ValueError("Already-inactive purchasers are outside the incident-risk population")
    if (matrix < 0).any():
        raise ValueError("Refill history fields must be nonnegative")
    for name in ("late_refill_share", "failed_order_fraction"):
        if (matrix[:, FEATURES.index(name)] > 1).any():
            raise ValueError(f"{name} must be in the interval [0, 1]")
    if (matrix[:, FEATURES.index("last_cycle_days")] <= 0).any() or (matrix[:, FEATURES.index("order_count")] < 1).any():
        raise ValueError("Scored purchasers require a positive product cycle and at least one completed purchase")
    probabilities = np.zeros(len(matrix))
    possible = remaining < artifact["horizon"]
    if possible.any():
        raw = artifact["model"].predict_proba(matrix[possible])[:, 1]
        probabilities[possible] = artifact["calibrator"].predict_proba(log_odds(raw))[:, 1]
    return probabilities
