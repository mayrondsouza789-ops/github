"""Score customers, explain predictions, recommend interventions, seed the live work queue."""
import pickle
import sys
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
from sqlalchemy import text

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import AS_OF  # noqa: E402
from app.db import engine  # noqa: E402
from app import schema as S  # noqa: E402
from app.analytics import (classify, get_settings, refresh_segments_and_summary, evaluate_outcomes)  # noqa: E402
from app.recommend import build_recommendation  # noqa: E402
from pipeline.features import FEATURES, FEATURE_LABELS, Snapshotter, load_frames  # noqa: E402
from pipeline.train import MODEL_PATH, contributions, clean  # noqa: E402


def describe(feat, v):
    f = lambda x: "n/a" if pd.isna(x) else x
    if pd.isna(v):
        return f"{FEATURE_LABELS[feat]}: not available"
    t = {
        "overdue_days": (f"No purchase within expected replenishment window ({int(v)} days overdue)" if v > 0
                         else f"Expected refill date is {int(-v)} days away"),
        "overdue_ratio": f"{v:.2f}x the expected refill cycle has passed since last purchase",
        "days_since_last": f"{int(v)} days since last purchase",
        "last_gap_ratio": f"Latest reorder gap was {v:.2f}x the expected cycle",
        "n_late_refills": f"{int(v)} earlier refill(s) were late",
        "max_late_days": f"Longest earlier refill delay was {int(v)} days",
        "freq_change": f"Orders in last 90 days changed by {v:+.0f} versus the previous 90 days",
        "orders_last_90": f"{int(v)} order(s) in the last 90 days",
        "n_cancellations": f"{int(v)} cancelled order attempt(s)",
        "cancel_rate": f"{v:.0%} of order attempts were cancelled",
        "cancels_after_last_order": f"{int(v)} cancelled attempt(s) since the last delivered order",
        "cancels_last_60": f"{int(v)} cancelled attempt(s) in the last 60 days",
        "n_refunds": f"{int(v)} refund(s)", "refund_rate": f"{v:.0%} of orders refunded",
        "email_open_rate_4w": f"Email open rate {v:.0%} over the last 4 weeks",
        "email_clicks_4w": f"{int(v)} email click(s) in the last 4 weeks",
        "site_visits_4w": f"{int(v)} site visit(s) in the last 4 weeks",
        "content_views_4w": f"{int(v)} educational content view(s) in the last 4 weeks",
        "app_sessions_4w": f"{int(v)} app session(s) in the last 4 weeks",
        "engagement_change": f"Engagement activity changed by {v:+.0f} versus the previous 4 weeks",
        "n_tickets": f"{int(v)} support ticket(s) overall",
        "n_negative_tickets_90": f"{int(v)} negative ticket(s) in the last 90 days",
        "n_open_tickets": f"{int(v)} support ticket(s) still open",
        "n_open_negative_tickets": f"{int(v)} unresolved negative ticket(s)",
        "treatment_concerns": f"{int(v)} treatment-related concern(s) raised",
        "n_purchases": f"{int(v)} purchase(s) so far", "tenure_days": f"Customer for {int(v)} days",
        "avg_gap_days": f"Average {v:.0f} days between purchases", "aov": f"Average order value Rs {v:,.0f}",
        "total_spend": f"Total spend Rs {v:,.0f}", "discount_share": f"{v:.0%} of spend used discounts",
        "window_days": f"Expected refill cycle is {int(v)} days", "reviews_total": f"{int(v)} product review(s) written",
        "days_since_ticket": f"Last support ticket {int(v)} days ago",
    }
    return t.get(feat, f"{FEATURE_LABELS.get(feat, feat)}: {v:.2f}" if not feat.startswith(("ch_", "cat_"))
                 else FEATURE_LABELS[feat] + (": yes" if v else ": no"))


def score_dates(art, snap, dates, thr, with_factors_for=None):
    """Return {date: DataFrame(index=customer_id, p)} for covered customers."""
    out = {}
    for d in dates:
        f = snap.features(d)
        f = f[f["covered"]].copy()
        raw = art["model"].predict_proba(f[FEATURES])[:, 1]
        f["p"] = art["iso"].predict(raw)
        out[d] = f
    return out


def run(run_id, verbose=True):
    art = pickle.load(open(MODEL_PATH, "rb"))
    st = get_settings(engine)
    thr = st["thresholds"]
    grace = art["grace"]
    frames = load_frames(engine)
    snap = Snapshotter(frames, grace)
    prev_date = pd.Timestamp(AS_OF) - pd.Timedelta(days=30)
    scored = score_dates(art, snap, [pd.Timestamp(AS_OF), prev_date], thr)
    cur, prev = scored[pd.Timestamp(AS_OF)], scored[prev_date]
    cur["prev_p"] = prev["p"].reindex(cur.index)

    contrib = contributions(art["name"], art["model"], cur[FEATURES])
    p80 = frames["orders"].query("status=='delivered'").groupby("customer_id")["net_amount"].sum().quantile(0.80)

    rows = []
    feats = np.array(FEATURES)
    for i, (cid, r) in enumerate(cur.iterrows()):
        c = contrib[i]
        # skip one-hot context features when explaining a single customer; they describe who, not what changed
        order = np.argsort(-np.abs(c))
        factors = []
        for j in order:
            fn = feats[j]
            if fn.startswith(("ch_", "cat_")) or fn in ("overdue_ratio", "window_days"):
                continue
            if abs(c[j]) < 0.02:
                break
            factors.append({"feature": fn, "label": FEATURE_LABELS[fn], "detail": describe(fn, r[fn]),
                            "impact": round(float(c[j]), 3), "direction": "raises risk" if c[j] > 0 else "lowers risk"})
            if len(factors) == 6:
                break
        p = float(r["p"])
        risk = classify(p, thr)
        prevp = None if pd.isna(r["prev_p"]) else float(r["prev_p"])
        trend = "new" if prevp is None else ("rising" if p - prevp >= 0.07 else "falling" if p - prevp <= -0.07 else "stable")
        facts = {"risk_category": risk, "days_overdue": float(r["overdue_days"]), "cancels_recent": float(r["cancels_last_60"]),
                 "cancel_rate": float(r["cancel_rate"]), "open_negative_tickets": float(r["n_open_negative_tickets"]),
                 "treatment_concerns": float(r["treatment_concerns"]), "open_tickets": float(r["n_open_tickets"]),
                 "engagement_score": float(r["engagement_score"]), "engagement_drop": bool(r["engagement_change"] <= -2),
                 "high_value": bool(r["total_spend"] >= p80), "ltv": float(r["total_spend"])}
        rec = build_recommendation(facts)
        pos = [x for x in factors if x["impact"] > 0]
        primary = (pos[0]["detail"] if pos else (factors[0]["detail"] if factors else "No strong indicators"))[:78]
        rows.append({
            "customer_id": int(cid), "prediction_date": AS_OF, "model_run_id": run_id, "churn_probability": round(p, 4),
            "risk_category": risk, "prev_probability": None if prevp is None else round(prevp, 4), "risk_trend": trend,
            "expected_replenishment_date": (r["last"] + pd.Timedelta(days=int(r["window_days"]))).date(),
            "deadline_date": r["deadline"].date(), "days_overdue": int(r["overdue_days"]),
            "engagement_score": float(r["engagement_score"]), "expected_90d_revenue": round(float(r["aov"]) * 90 / float(r["window_days"]), 2),
            "top_factors": clean(factors), "primary_reason": primary, "recommendation": clean(rec)})
    pred = pd.DataFrame(rows)
    pr = prev.reset_index()
    prev_rows = pd.DataFrame({
        "customer_id": pr["customer_id"].astype(int), "prediction_date": prev_date.date(), "model_run_id": run_id,
        "churn_probability": pr["p"].round(4), "risk_category": [classify(x, thr) for x in pr["p"]],
        "expected_replenishment_date": (pr["last"] + pd.to_timedelta(pr["window_days"], unit="D")).dt.date,
        "deadline_date": pr["deadline"].dt.date, "days_overdue": pr["overdue_days"].astype(int),
        "engagement_score": pr["engagement_score"], "expected_90d_revenue": (pr["aov"] * 90 / pr["window_days"]).round(2)})
    with engine.begin() as cx:
        cx.execute(text("truncate churn_predictions restart identity"))
    kw = dict(if_exists="append", index=False, method="multi", chunksize=1500)
    from sqlalchemy.dialects.postgresql import JSONB
    jt = {"top_factors": JSONB, "recommendation": JSONB}
    pred.to_sql("churn_predictions", engine, dtype=jt, **kw)
    prev_rows.to_sql("churn_predictions", engine, **kw)
    if verbose:
        print("predictions:", len(pred), "current,", len(prev_rows), "previous period")
        print(pred["risk_category"].value_counts().to_dict())

    retro_score_history(art, snap, thr)
    n = refresh_segments_and_summary(engine)
    if verbose:
        print("summary rows", n)
    seed_queue(pred)
    m = evaluate_outcomes(engine)
    if verbose:
        print("outcomes evaluated", m)


def retro_score_history(art, snap, thr):
    """Score each historical intervention using the most recent weekly snapshot on or before its creation date."""
    iv = pd.read_sql("select id, customer_id, created_at from retention_interventions where source='history'", engine)
    iv["created_at"] = pd.to_datetime(iv["created_at"])
    iv["snap"] = iv["created_at"] - pd.to_timedelta(iv["created_at"].dt.weekday, unit="D")
    updates = []
    for sd, g in iv.groupby("snap"):
        f = snap.features(sd)
        f = f[f["covered"]]
        p = pd.Series(art["iso"].predict(art["model"].predict_proba(f[FEATURES])[:, 1]), index=f.index)
        for r in g.itertuples():
            if r.customer_id in p.index:
                updates.append({"i": int(r.id), "p": float(p[r.customer_id]), "c": classify(float(p[r.customer_id]), thr)})
    with engine.begin() as cx:
        cx.execute(text("update retention_interventions set churn_probability=:p, risk_category=:c where id=:i"), updates)


def seed_queue(pred):
    """Open the live work queue from today's model output (all Critical plus the top High-risk customers)."""
    rng = np.random.default_rng(99)
    with engine.begin() as cx:   # re-scoring replaces untouched queue items; worked items are kept
        cx.execute(text("""delete from intervention_events where intervention_id in
                           (select id from retention_interventions where source='model_queue' and status='Pending')"""))
        cx.execute(text("""delete from intervention_outcomes where intervention_id in
                           (select id from retention_interventions where source='model_queue' and status='Pending')"""))
        cx.execute(text("delete from retention_interventions where source='model_queue' and status='Pending'"))
    busy = pd.read_sql("select customer_id from retention_interventions where status in "
                       "('Pending','Assigned','In Progress','Contacted')", engine)["customer_id"].tolist()
    q = pred[pred["risk_category"].isin(["High", "Critical"]) & ~pred["customer_id"].isin(busy)].copy()
    q["score"] = q["churn_probability"] * q["expected_90d_revenue"]
    crit = q[q.risk_category == "Critical"]
    high = q[q.risk_category == "High"].sort_values("score", ascending=False).head(140)
    q = pd.concat([crit, high]).sort_values("churn_probability", ascending=False)
    execs = pd.read_sql("select id, name from users where role='success_exec' order by id", engine)
    names = dict(zip(execs["id"], execs["name"]))
    ids = execs["id"].tolist()
    start = int(pd.read_sql("select coalesce(max(id),0) m from retention_interventions", engine)["m"][0])
    ivs, evs = [], []
    for i, r in enumerate(q.itertuples(), start=start + 1):
        rec = r.recommendation
        roll = rng.random()
        status = "Pending" if roll < 0.55 else "Assigned" if roll < 0.75 else "In Progress" if roll < 0.88 else "Contacted"
        assignee = int(ids[(i - start) % len(ids)]) if status != "Pending" else None
        created = AS_OF - timedelta(days=int(rng.integers(0, 6)))
        due = created + timedelta(days=2 if r.risk_category == "Critical" else 5)
        ivs.append({"id": i, "customer_id": r.customer_id, "created_at": created, "created_by": "Retention Radar (model queue)",
                    "risk_category": r.risk_category, "churn_probability": r.churn_probability,
                    "reason": r.primary_reason, "scenario": rec["scenario"], "recommended_action": "; ".join(rec["actions"][:2]),
                    "rationale": rec["rationale"], "assigned_to": assignee, "due_date": due, "status": status,
                    "source": "model_queue", "campaign_id": None})
        t0 = datetime(created.year, created.month, created.day, 8, 30)
        evs.append({"intervention_id": i, "event_at": t0, "actor": "System", "event_type": "created",
                    "detail": f"Added to queue: {r.risk_category} risk ({r.churn_probability:.0%})"})
        if assignee:
            evs.append({"intervention_id": i, "event_at": t0 + timedelta(hours=2), "actor": "Priya Menon",
                        "event_type": "assigned", "detail": f"Assigned to {names[assignee]}"})
        if status in ("In Progress", "Contacted"):
            evs.append({"intervention_id": i, "event_at": t0 + timedelta(hours=26), "actor": names[assignee],
                        "event_type": "status_change", "detail": f"Status set to {status}"})
    kw = dict(if_exists="append", index=False, method="multi", chunksize=1000)
    pd.DataFrame(ivs).to_sql("retention_interventions", engine, **kw)
    pd.DataFrame(evs).to_sql("intervention_events", engine, **kw)
    with engine.begin() as cx:
        cx.execute(text("select setval(pg_get_serial_sequence('retention_interventions','id'), (select max(id) from retention_interventions))"))
        cx.execute(text("select setval(pg_get_serial_sequence('intervention_events','id'), (select max(id) from intervention_events))"))
    print("queue seeded:", len(ivs))
