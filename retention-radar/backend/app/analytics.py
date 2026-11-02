"""Shared analytics used by both the pipeline and the API: risk classification, segments, summary table,
intervention outcome evaluation."""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sqlalchemy import text

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import AS_OF, DEFAULT_SETTINGS  # noqa: E402
from app import schema as S  # noqa: E402

SEGMENTS = ["New Customers", "Active Customers", "Consistent Customers", "At-Risk Customers",
            "Dormant Customers", "High-Value Customers", "Recovered Customers"]


def get_settings(engine):
    out = {k: (dict(v) if isinstance(v, dict) else v) for k, v in DEFAULT_SETTINGS.items()}
    rows = pd.read_sql("select key, value from app_settings", engine)
    for k, v in zip(rows["key"], rows["value"]):
        out[k] = v
    return out


def classify(p, thr):
    if p is None or (isinstance(p, float) and np.isnan(p)):
        return None
    if p >= thr["critical"]:
        return "Critical"
    if p >= thr["high"]:
        return "High"
    if p >= thr["medium"]:
        return "Medium"
    return "Low"


def reclassify_predictions(engine, thr):
    """Apply configurable business thresholds to stored probabilities."""
    sql = text("""
        update churn_predictions set risk_category = case
            when churn_probability >= :c then 'Critical'
            when churn_probability >= :h then 'High'
            when churn_probability >= :m then 'Medium' else 'Low' end""")
    with engine.begin() as cx:
        cx.execute(sql, {"c": thr["critical"], "h": thr["high"], "m": thr["medium"]})
        # keep open-queue interventions aligned with the current definition of risk
        cx.execute(text("""
            update retention_interventions ri set risk_category = cp.risk_category
            from churn_predictions cp
            where cp.customer_id = ri.customer_id and cp.prediction_date = :d and ri.source = 'model_queue'
              and ri.status not in ('Resolved','Unsuccessful')"""), {"d": AS_OF})


def refresh_segments_and_summary(engine, as_of=AS_OF):
    from pipeline.features import Snapshotter, load_frames
    st = get_settings(engine)
    grace = st["grace_days"]
    reclassify_predictions(engine, st["thresholds"])
    frames = load_frames(engine)
    snap = Snapshotter(frames, grace)
    f = snap.features(as_of)
    cust = frames["customers"].set_index("id")
    pred = pd.read_sql(text("select customer_id, churn_probability, risk_category, expected_replenishment_date, engagement_score "
                            "from churn_predictions where prediction_date=:d"), engine, params={"d": as_of}).set_index("customer_id")
    D = snap.D
    lapse_gap = (D["gap_prev"] > D["prev_window"] + grace)
    D2 = D.assign(lapse_gap=lapse_gap)
    had_lapse = D2.groupby("customer_id")["lapse_gap"].any()
    last_return = D2[D2.lapse_gap].groupby("customer_id")["order_date"].max()
    items = frames["items"].merge(frames["orders"][["id", "customer_id", "status"]], left_on="order_id", right_on="id")
    items = items[items.status == "delivered"]
    cats = items.groupby("customer_id")["category"].agg(lambda s: ", ".join(pd.Series(s).value_counts().index.tolist()))
    prim = items.groupby("customer_id")["category"].agg(lambda s: pd.Series(s).value_counts().index[0])

    f = f.join(pred[["churn_probability", "risk_category"]], how="left")
    status = np.where(f["covered"], "active", "lapsed")
    f["status"] = status
    f["had_lapse"] = had_lapse.reindex(f.index).fillna(False)
    f["last_return"] = last_return.reindex(f.index)
    p80 = f["total_spend"].quantile(0.80)
    recovered = f["covered"] & f["had_lapse"] & (f["last_return"] >= pd.Timestamp(as_of) - pd.Timedelta(days=150))
    atrisk = f["covered"] & f["risk_category"].isin(["High", "Critical"])
    highv = f["covered"] & (f["total_spend"] >= p80)
    newc = f["covered"] & (f["n_purchases"] == 1) & (f["tenure_days"] <= 45)
    consistent = f["covered"] & (f["n_purchases"] >= 3) & (f["n_late_refills"] == 0) & (~f["had_lapse"])
    seg = np.select([~f["covered"], recovered, atrisk, highv, newc, consistent],
                    ["Dormant Customers", "Recovered Customers", "At-Risk Customers", "High-Value Customers",
                     "New Customers", "Consistent Customers"], default="Active Customers")
    f["segment"] = seg
    f["lifecycle_stage"] = np.select(
        [~f["covered"], f["n_purchases"] <= 1, f["n_purchases"] <= 3],
        ["Lapsed", "Onboarding", "Establishing"], default="Established")

    months = np.maximum(f["tenure_days"] / 30.4, 1.0)
    summ = pd.DataFrame({
        "customer_id": f.index, "total_orders": f["n_purchases"].astype(int).values,
        "total_revenue": f["total_spend"].round(2).values, "avg_order_value": f["aov"].round(2).values,
        "orders_per_month": (f["n_purchases"] / months).round(2).values, "avg_gap_days": f["avg_gap_days"].round(1).values,
        "last_purchase_date": f["last"].dt.date.values, "days_since_last": f["days_since_last"].astype(int).values,
        "products_purchased": cats.reindex(f.index).fillna("").values, "primary_category": prim.reindex(f.index).values,
        "status": f["status"].values, "engagement_score": f["engagement_score"].values,
        "churn_probability": f["churn_probability"].values, "risk_category": f["risk_category"].values,
        "expected_replenishment_date": (f["last"] + pd.to_timedelta(f["window_days"], unit="D")).dt.date.values,
        "segment": f["segment"].values, "lifecycle_stage": f["lifecycle_stage"].values,
    })
    summ["search_text"] = [f"{cust.at[i, 'customer_code']} {cust.at[i, 'display_name']}".lower() for i in summ["customer_id"]]
    summ = summ.astype(object).where(summ.notna(), None)
    segs = pd.DataFrame({"customer_id": f.index, "segment": f["segment"].values,
                         "lifecycle_stage": f["lifecycle_stage"].values, "assigned_on": as_of})
    with engine.begin() as cx:
        cx.execute(text("truncate customer_segments, customer_summary"))
    kw = dict(if_exists="append", index=False, method="multi", chunksize=3000)
    segs.to_sql("customer_segments", engine, **kw)
    summ.to_sql("customer_summary", engine, **kw)
    return len(summ)


def evaluate_outcomes(engine, as_of=AS_OF):
    """Observational outcomes of interventions. NOT causal: customers may have reordered anyway."""
    st = get_settings(engine)
    grace = st["grace_days"]
    iv = pd.read_sql("select id, customer_id, created_at from retention_interventions", engine)
    if iv.empty:
        return 0
    o = pd.read_sql("select customer_id, order_date, net_amount, refund_amount, window_days from orders where status='delivered'", engine)
    o["order_date"] = pd.to_datetime(o["order_date"])
    by = {k: g.sort_values("order_date") for k, g in o.groupby("customer_id")}
    rows = []
    for r in iv.itertuples():
        d = pd.Timestamp(r.created_at)
        g = by.get(r.customer_id)
        if g is None:
            continue
        before = g[g.order_date <= d]
        after = g[g.order_date > d]
        if before.empty:
            deadline = d + pd.Timedelta(days=grace)
        else:
            lb = before.iloc[-1]
            deadline = lb.order_date + pd.Timedelta(days=int(lb.window_days) + grace)
        nd = after.order_date.min() if not after.empty else None
        w30 = after[after.order_date <= d + pd.Timedelta(days=30)]
        if nd is not None and (nd - d).days <= 30:
            outcome = "Remained active" if nd <= deadline else "Resumed purchasing"
            dtr = int((nd - d).days)
        elif (pd.Timestamp(as_of) - d).days >= 30 and pd.Timestamp(as_of) >= deadline:
            outcome, dtr = "Churned", None
        else:
            outcome, dtr = "Pending", None
        rows.append({"intervention_id": r.id, "evaluated_on": as_of, "observed_outcome": outcome,
                     "days_to_reorder": dtr,
                     "revenue_after_30d": float((w30.net_amount - w30.refund_amount).sum()) if len(w30) else 0.0})
    df = pd.DataFrame(rows)
    with engine.begin() as cx:
        cx.execute(text("truncate intervention_outcomes"))
    df.to_sql("intervention_outcomes", engine, if_exists="append", index=False, method="multi", chunksize=3000)
    return len(df)
