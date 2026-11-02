"""Read-side analytics for the API. Everything is computed from the database tables at request time
(cached in memory until the underlying data or settings change)."""
import sys
import threading
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
from sqlalchemy import text

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import AS_OF  # noqa: E402
from app.db import engine  # noqa: E402
from app.analytics import get_settings  # noqa: E402
from pipeline.features import Snapshotter, load_frames  # noqa: E402

AS_OF_TS = pd.Timestamp(AS_OF)
_lock = threading.Lock()


class Cache:
    def __init__(self):
        self.d = None

    def get(self):
        with _lock:
            if self.d is None:
                self.d = self._load()
            return self.d

    def clear(self):
        with _lock:
            self.d = None

    def _load(self):
        st = get_settings(engine)
        frames = load_frames(engine)
        snap = Snapshotter(frames, st["grace_days"])
        D = snap.D.copy()
        D["rev"] = D["net_amount"] - D["refund_amount"]
        D["deadline"] = D["order_date"] + pd.to_timedelta(D["window_days"] + st["grace_days"], unit="D")
        D["next_date"] = D.groupby("customer_id")["order_date"].shift(-1)
        D["lapsed"] = (D["next_date"].isna() & (D["deadline"] <= AS_OF_TS)) | (D["next_date"] > D["deadline"])
        D["order_no"] = D.groupby("customer_id").cumcount() + 1
        preds = pd.read_sql("select customer_id, prediction_date, churn_probability as p, risk_category as risk, "
                            "expected_90d_revenue as rev90, prev_probability from churn_predictions", engine)
        preds["prediction_date"] = pd.to_datetime(preds["prediction_date"])
        return {"settings": st, "frames": frames, "D": D, "preds": preds, "cust": frames["customers"].set_index("id"),
                "grace": st["grace_days"]}


cache = Cache()


def covered_at(c, d):
    D = c["D"]
    x = D[D.order_date <= d].groupby("customer_id").tail(1)
    return x.loc[(d - x.order_date).dt.days <= x.window_days + c["grace"], "customer_id"]


def pct_change(cur, prev):
    if prev in (0, None) or cur is None or (isinstance(prev, float) and np.isnan(prev)):
        return None
    return float((cur - prev) / abs(prev))


# ------------------------------------------------------------------ overview
def _kpi_values(c, d):
    D, preds = c["D"], c["preds"]
    cov = covered_at(c, d)
    pr = preds[preds.prediction_date == d]
    pr = pr[pr.customer_id.isin(cov)]
    risky = pr[pr.risk.isin(["High", "Critical"])]
    first = D.groupby("customer_id")["order_date"].min()
    sub = D[D.order_date <= d]
    n_by = sub.groupby("customer_id").size()
    elig = first[first <= d - pd.Timedelta(days=45)].index
    repeat = float((n_by.reindex(elig).fillna(0) >= 2).mean()) if len(elig) else None
    rev_by = sub.groupby("customer_id")["rev"].sum()
    d0 = d - pd.Timedelta(days=29)
    rep = D[(D.order_no >= 2) & (D.order_date >= d0) & (D.order_date <= d)]
    return {"active": len(cov), "at_risk": len(risky), "pred_churn": float(pr.p.mean()) if len(pr) else None,
            "repeat": repeat, "clv": float(rev_by.mean()), "rev_at_risk": float(risky.rev90.sum()),
            "retained_rev": float(rep.rev.sum())}, set(cov)


def monthly_churn(c):
    D = c["D"]
    rows = []
    months = pd.period_range("2025-12", "2026-10", freq="M")
    for m in months:
        start, end = m.start_time, m.end_time.normalize()
        cov = covered_at(c, start)
        lap = D[D.lapsed & (D.deadline + pd.Timedelta(days=1) >= start) & (D.deadline + pd.Timedelta(days=1) <= end)
                & (D.order_date < start)]
        n_l = lap.customer_id.nunique()
        base = len(cov)
        rate = n_l / base if base else None
        rows.append({"month": str(m), "label": m.strftime("%b %y"), "active_start": int(base), "lapsed": int(n_l),
                     "churn_rate": rate, "retention_rate": None if rate is None else 1 - rate})
    return rows


def overview():
    c = cache.get()
    d = AS_OF_TS
    prev = d - pd.Timedelta(days=30)
    cur, cov_now = _kpi_values(c, d)
    old, cov_prev = _kpi_values(c, prev)
    older, cov_older = _kpi_values(c, prev - pd.Timedelta(days=30))
    # 30-day retention: share of customers active a month ago who are still active
    ret_now = len(cov_prev & cov_now) / len(cov_prev) if cov_prev else None
    ret_prev = len(cov_older & cov_prev) / len(cov_older) if cov_older else None
    thr = c["settings"]["thresholds"]

    def k(key, label, cur_v, prev_v, fmt, good_up, tip):
        ch = pct_change(cur_v, prev_v)
        return {"key": key, "label": label, "value": cur_v, "previous": prev_v, "change": ch, "format": fmt,
                "good_when": "up" if good_up else "down", "tooltip": tip}

    kpis = [
        k("active", "Total active customers", cur["active"], old["active"], "int", True,
          "Customers whose latest order still covers their expected replenishment window plus the grace period."),
        k("at_risk", "Customers at risk", cur["at_risk"], old["at_risk"], "int", False,
          f"Active customers with High or Critical churn risk (probability of {thr['high']:.0%} or more)."),
        k("pred_churn", "Predicted churn rate", cur["pred_churn"], old["pred_churn"], "pct", False,
          "Average model probability that an active customer lapses at their next replenishment deadline."),
        k("retention", "Customer retention rate", ret_now, ret_prev, "pct", True,
          "Share of customers active 30 days ago who are still active today."),
        k("repeat", "Repeat purchase rate", cur["repeat"], old["repeat"], "pct", True,
          "Share of customers acquired at least 45 days ago who have placed two or more delivered orders."),
        k("clv", "Average customer lifetime value", cur["clv"], old["clv"], "money", True,
          "Net revenue after refunds per customer to date. Observed so far, not a forecast."),
        k("rev_at_risk", "Revenue at risk (90 days)", cur["rev_at_risk"], old["rev_at_risk"], "money", False,
          "Expected 90-day order value of High and Critical risk customers. Exposure, not a probability-weighted loss."),
        k("retained_rev", "Retained revenue (30 days)", cur["retained_rev"], old["retained_rev"], "money", True,
          "Net revenue after refunds from repeat orders in the last 30 days."),
    ]
    trend = monthly_churn(c)
    preds = c["preds"]
    now = preds[(preds.prediction_date == d) & preds.customer_id.isin(cov_now)]
    order = ["Low", "Medium", "High", "Critical"]
    dist = [{"risk": r, "count": int((now.risk == r).sum())} for r in order]
    rar = [{"risk": r, "exposure": float(now[now.risk == r].rev90.sum()),
            "weighted": float((now[now.risk == r].rev90 * now[now.risk == r].p).sum())} for r in order]
    prod = product_metrics()
    alerts = pd.read_sql(text("""
        select cp.customer_id, cu.customer_code, cu.display_name, cp.churn_probability, cp.prev_probability,
               cp.risk_category, cp.primary_reason, cp.recommendation->>'scenario' as scenario, cp.days_overdue
        from churn_predictions cp join customers cu on cu.id=cp.customer_id
        where cp.prediction_date=:d and cp.risk_category in ('High','Critical')
          and (cp.prev_probability is null or cp.prev_probability < :h)
        order by cp.churn_probability desc limit 8"""), engine, params={"d": AS_OF, "h": thr["high"]})
    return {"as_of": AS_OF.isoformat(), "kpis": kpis, "churn_trend": trend, "risk_distribution": dist,
            "revenue_at_risk": rar, "product_churn": [{"category": r["category"], "churn_rate": r["churn_rate"],
                                                       "customers": r["customers"]} for r in prod["rows"]],
            "alerts": alerts.to_dict("records"), "predicted_now": cur["pred_churn"]}


# ------------------------------------------------------------------ products
def product_metrics(date_from=None, date_to=None, channel=None):
    c = cache.get()
    D, cust, g = c["D"], c["cust"], c["grace"]
    first = D.groupby("customer_id").first()
    first = first.join(cust[["channel", "acquisition_category"]])
    first["first_date"] = first["order_date"]
    first["elig"] = first["first_date"] + pd.to_timedelta(first["window_days"] + g, unit="D") <= AS_OF_TS
    f = first
    if date_from:
        f = f[f.first_date >= pd.Timestamp(date_from)]
    if date_to:
        f = f[f.first_date <= pd.Timestamp(date_to)]
    if channel:
        f = f[f.channel == channel]
    n_by = D.groupby("customer_id").size()
    second = D[D.order_no == 2].set_index("customer_id")["order_date"]
    cov = set(covered_at(c, AS_OF_TS))
    rev = D.groupby("customer_id")["rev"].sum()
    refunds = D.assign(rf=(D.refund_amount > 0).astype(int)).groupby("customer_id")["rf"].sum()
    rows = []
    for cat, grp in f.groupby("acquisition_category"):
        ids = grp.index
        el = grp[grp.elig].index
        repeat = float((n_by.reindex(el) >= 2).mean()) if len(el) else None
        t2 = (second.reindex(ids) - grp["first_date"]).dt.days.dropna()
        retained = float(np.mean([i in cov for i in el])) if len(el) else None
        r = float(rev.reindex(ids).sum())
        orders_n = float(n_by.reindex(ids).sum())
        rows.append({"category": cat, "customers": int(len(ids)), "eligible": int(len(el)), "repeat_rate": repeat,
                     "avg_days_to_second": float(t2.mean()) if len(t2) else None,
                     "retention": retained, "churn_rate": None if retained is None else 1 - retained,
                     "revenue": r, "refund_rate": float(refunds.reindex(ids).sum() / orders_n) if orders_n else None,
                     "avg_ltv": r / len(ids) if len(ids) else None})
    tot = sum(x["revenue"] for x in rows) or 1
    for x in rows:
        x["revenue_share"] = x["revenue"] / tot
    rows.sort(key=lambda x: -x["customers"])
    return {"rows": rows, "note": "Differences between categories are descriptive. They are not proof that a product "
            "causes better or worse retention: customers who choose each product differ in channel, age and intent, and "
            "this view does not control for that. Eligible = customers whose first refill window has already elapsed."}


# ------------------------------------------------------------------ cohorts
def cohorts(mode="active", channel=None, category=None, compare=None):
    c = cache.get()
    D, cust = c["D"], c["cust"]
    first = D.groupby("customer_id")["order_date"].min().rename("first")
    info = cust[["channel", "acquisition_category"]].join(first, how="inner")
    if channel:
        info = info[info.channel == channel]
    if category:
        info = info[info.acquisition_category == category]
    info["cohort"] = info["first"].dt.to_period("M")
    d = D[D.customer_id.isin(info.index)].merge(info[["cohort"]], left_on="customer_id", right_index=True)
    d["off"] = (d.order_date.dt.to_period("M") - d.cohort).apply(lambda x: x.n)
    last_m = pd.Period(AS_OF_TS, "M")
    months = pd.period_range("2025-11", "2026-10", freq="M")

    def table(infoX, dX):
        act = dX.groupby(["customer_id", "off"]).size().reset_index()[["customer_id", "off"]]
        out = []
        for m in months:
            ids = infoX[infoX.cohort == m].index
            size = len(ids)
            row = {"cohort": str(m), "label": m.strftime("%b %y"), "size": int(size), "values": []}
            for n in range(7):
                if (m + n) > last_m or size == 0:
                    row["values"].append(None)
                    continue
                if n == 0:
                    row["values"].append(1.0)
                    continue
                a = act[act.customer_id.isin(ids)]
                if mode == "cumulative":
                    k = a[(a.off >= 1) & (a.off <= n)].customer_id.nunique()
                else:
                    k = a[a.off == n].customer_id.nunique()
                row["values"].append(float(k / size))
            out.append(row)
        return out

    rows = table(info, d)
    avg = []
    for n in range(7):
        num = den = 0
        for r in rows:
            if r["values"][n] is not None:
                num += r["values"][n] * r["size"]
                den += r["size"]
        avg.append(num / den if den else None)
    drops = [(n, avg[n - 1] - avg[n]) for n in range(1, 7) if avg[n] is not None and avg[n - 1] is not None]
    biggest = max(drops, key=lambda x: x[1])[0] if (mode == "active" and drops) else None
    curves = []
    if compare in ("channel", "category"):
        col = "channel" if compare == "channel" else "acquisition_category"
        for v, sub in info.groupby(col):
            rr = table(sub, d[d.customer_id.isin(sub.index)])
            vals = []
            for n in range(1, 7):
                num = sum((r["values"][n] or 0) * r["size"] for r in rr if r["values"][n] is not None)
                den = sum(r["size"] for r in rr if r["values"][n] is not None)
                vals.append(num / den if den else None)
            curves.append({"group": v, "customers": int(len(sub)), "values": [1.0] + vals})
    return {"mode": mode, "rows": rows, "average": avg, "biggest_drop_month": biggest, "curves": curves,
            "note": "Cells are blank where the cohort has not yet had enough time to be observed. "
                    "Multi-month packs mean some healthy customers legitimately skip months."}


# ------------------------------------------------------------------ segments
def segments():
    s = pd.read_sql("select cs.customer_id, cs.segment, su.total_revenue, su.total_orders, su.churn_probability, su.status "
                    "from customer_segments cs join customer_summary su on su.customer_id=cs.customer_id", engine)
    tot_rev = s.total_revenue.sum()
    rows = []
    for seg, g in s.groupby("segment"):
        pc = 1.0 if seg == "Dormant Customers" else float(g.churn_probability.mean())
        rows.append({"segment": seg, "customers": int(len(g)), "share": len(g) / len(s),
                     "revenue": float(g.total_revenue.sum()), "revenue_share": float(g.total_revenue.sum() / tot_rev),
                     "avg_ltv": float(g.total_revenue.mean()), "repeat_rate": float((g.total_orders >= 2).mean()),
                     "churn_rate": pc, "retention_rate": 1 - pc})
    order = ["New Customers", "Active Customers", "Consistent Customers", "At-Risk Customers", "Dormant Customers",
             "High-Value Customers", "Recovered Customers"]
    rows.sort(key=lambda r: order.index(r["segment"]))
    return {"rows": rows, "total": int(len(s)),
            "note": "Each customer belongs to exactly one segment, chosen in priority order: Dormant, Recovered, At-Risk, "
                    "High-Value, New, Consistent, Active. Churn rate is the model's predicted probability for active "
                    "customers and 100% (already lapsed) for Dormant ones."}


# ------------------------------------------------------------------ campaigns
def campaigns():
    cp = pd.read_sql("select * from campaigns order by id", engine)
    t = pd.read_sql("select * from campaign_targets", engine)
    rows = []
    for r in cp.itertuples():
        g = t[t.campaign_id == r.id]
        tr, ct = g[g.grp == "treatment"], g[g.grp == "control"]
        n_t, n_c = len(tr), len(ct)
        rt = float(tr.reordered.mean()) if n_t else None
        rc = float(ct.reordered.mean()) if n_c else None
        lift = (rt - rc) if (rt is not None and rc is not None) else None
        se = np.sqrt((rt * (1 - rt) / n_t if n_t else 0) + (rc * (1 - rc) / n_c if n_c else 0)) if lift is not None else None
        sufficient = n_c >= 30
        delivered = int(tr.delivered.sum())
        cost = n_t * r.unit_cost
        attributed = int(tr.reordered.sum())
        inc = n_t * lift if (lift is not None and sufficient) else None
        rows.append({
            "id": int(r.id), "name": r.name, "type": r.campaign_type, "channel": r.channel,
            "start": r.start_date.isoformat(), "end": r.end_date.isoformat(), "description": r.description,
            "targeted": int(len(g)), "treatment": int(n_t), "control": int(n_c), "contacted": int(n_t), "delivered": delivered,
            "delivery_rate": delivered / n_t if n_t else None, "ctr": float(tr.clicked.sum() / delivered) if delivered else None,
            "reorder_rate": rt, "control_reorder_rate": rc, "lift_pp": lift,
            "lift_ci": None if se is None else [lift - 1.96 * se, lift + 1.96 * se],
            "control_sufficient": bool(sufficient), "attributed_revenue": float(tr.revenue_14d.sum()),
            "cost": float(cost), "attributed_recovered": attributed,
            "cost_per_attributed": cost / attributed if attributed else None,
            "incremental_recovered": inc, "cost_per_incremental": cost / inc if (inc and inc > 0) else None,
            "unit_cost": float(r.unit_cost)})
    by_type = {}
    for r in rows:
        b = by_type.setdefault(r["type"], {"type": r["type"], "campaigns": 0, "treatment": 0, "control": 0, "cost": 0.0,
                                           "attr": 0, "t_re": 0, "c_re": 0, "revenue": 0.0})
        b["campaigns"] += 1
        b["treatment"] += r["treatment"]
        b["control"] += r["control"]
        b["cost"] += r["cost"]
        b["attr"] += r["attributed_recovered"]
        b["revenue"] += r["attributed_revenue"]
        b["t_re"] += (r["reorder_rate"] or 0) * r["treatment"]
        b["c_re"] += (r["control_reorder_rate"] or 0) * r["control"]
    types = []
    for b in by_type.values():
        rt = b["t_re"] / b["treatment"] if b["treatment"] else None
        rc = b["c_re"] / b["control"] if b["control"] else None
        types.append({"type": b["type"], "campaigns": b["campaigns"], "treatment": b["treatment"], "control": b["control"],
                      "reorder_rate": rt, "control_reorder_rate": rc,
                      "lift_pp": (rt - rc) if (rt is not None and rc is not None and b["control"] >= 30) else None,
                      "attributed_revenue": b["revenue"], "cost": b["cost"],
                      "cost_per_attributed": b["cost"] / b["attr"] if b["attr"] else None})
    return {"campaigns": rows, "by_type": types,
            "note": "Campaign execution is simulated in this demo; the architecture is ready for CRM or messaging adapters. "
                    "Attributed revenue counts every reorder within 14 days of a send, including customers who would have "
                    "reordered anyway. Only the lift against the 10% control group measures incremental retention, and "
                    "controls under 30 customers are too small to trust."}
