"""Retention Radar API (FastAPI). All data served is SYNTHETIC demo data."""
import csv
import io
import threading
import traceback
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import List, Optional

import numpy as np
import pandas as pd
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import text

from . import queries as Q
from .analytics import evaluate_outcomes, get_settings, refresh_segments_and_summary
from .auth import ROLE_LABELS, current_user, make_token, require, verify_password
from .config import AS_OF, ON_VERCEL
from .db import engine

app = FastAPI(title="Retention Radar API", version="1.0.0",
              description="Internal retention intelligence API. Demo workspace: every record is synthetic.")

STATUSES = ["Pending", "Assigned", "In Progress", "Contacted", "Resolved", "Unsuccessful"]
RISKS = ["Low", "Medium", "High", "Critical"]
VALUE_BANDS = {"low": (0, 1500), "mid": (1500, 4500), "high": (4500, 10 ** 9)}
FREQ_BANDS = {"low": (0, 0.6), "regular": (0.6, 1.2), "high": (1.2, 99)}
MANAGER, ANALYST, EXEC = "retention_manager", "analyst", "success_exec"


def j(v):
    """Make pandas / numpy values JSON safe."""
    if isinstance(v, dict):
        return {k: j(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [j(x) for x in v]
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating, float)):
        return None if pd.isna(v) else float(v)
    if isinstance(v, (np.bool_,)):
        return bool(v)
    if isinstance(v, (pd.Timestamp, datetime, date)):
        return None if pd.isna(v) else v.isoformat()[:10] if not isinstance(v, datetime) or isinstance(v, pd.Timestamp) and v.hour == 0 else v.isoformat()
    if v is pd.NaT:
        return None
    return v


def records(df):
    return [j(r) for r in df.astype(object).where(df.notna(), None).to_dict("records")]


@app.exception_handler(Exception)
async def on_error(request, exc):
    if isinstance(exc, HTTPException):
        return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)
    traceback.print_exc()
    return JSONResponse({"detail": "Something went wrong on our side. Try again, and contact support if it keeps happening."},
                        status_code=500)


@app.exception_handler(RequestValidationError)
async def on_validation(request, exc):
    msgs = [f"{'.'.join(str(x) for x in e['loc'][1:])}: {e['msg']}" for e in exc.errors()]
    return JSONResponse({"detail": "Check these fields: " + "; ".join(msgs)}, status_code=422)


def name_for(user, name):
    return None if user["role"] == ANALYST else name


# ------------------------------------------------------------------ auth & meta
class Login(BaseModel):
    email: str
    password: str


@app.post("/api/auth/login", tags=["auth"])
def login(body: Login):
    with engine.connect() as cx:
        u = cx.execute(text("select id, email, name, role, password_hash, is_active from users where lower(email)=:e"),
                       {"e": body.email.strip().lower()}).mappings().first()
    if not u or not u["is_active"] or not verify_password(body.password, u["password_hash"]):
        raise HTTPException(401, "That email and password do not match. Check them and try again")
    user = dict(u)
    return {"token": make_token(user), "user": {"id": u["id"], "name": u["name"], "email": u["email"], "role": u["role"],
                                                 "role_label": ROLE_LABELS[u["role"]]}}


@app.get("/api/auth/me", tags=["auth"])
def me(user=Depends(current_user)):
    return {**user, "role_label": ROLE_LABELS[user["role"]]}


@app.get("/api/meta", tags=["meta"])
def meta(user=Depends(current_user)):
    st = get_settings(engine)
    run = pd.read_sql("select id, trained_at, algorithm, horizon_days, grace_days, metrics from model_runs where is_active "
                      "order by id desc limit 1", engine)
    model = None
    if len(run):
        r = run.iloc[0]
        t = r["metrics"]["test"]
        model = {"algorithm": r["algorithm"], "trained_at": j(r["trained_at"]), "roc_auc": t["roc_auc"], "pr_auc": t["pr_auc"],
                 "horizon_days": int(r["horizon_days"]), "grace_days": int(r["grace_days"])}
    cats = pd.read_sql("select distinct category from products order by 1", engine)["category"].tolist()
    return {"as_of": AS_OF.isoformat(), "synthetic": True,
            "dataset_label": "Synthetic demonstration data. Not real Man Matters customers.",
            "thresholds": st["thresholds"], "grace_days": st["grace_days"], "horizon_days": st["horizon_days"],
            "categories": cats, "channels": ["Instagram Ads", "Google Search", "Influencer", "Organic", "Referral", "Marketplace"],
            "lifecycle": ["Onboarding", "Establishing", "Established", "Lapsed"], "segments": ["New Customers", "Active Customers", "Consistent Customers", "At-Risk Customers",
                         "Dormant Customers", "High-Value Customers", "Recovered Customers"],
            "risks": RISKS, "statuses": STATUSES, "value_bands": VALUE_BANDS, "freq_bands": FREQ_BANDS, "model": model,
            "can": {"edit_interventions": user["role"] in (MANAGER, EXEC), "assign": user["role"] == MANAGER,
                    "settings": user["role"] == MANAGER, "see_names": user["role"] != ANALYST}}


@app.get("/api/users", tags=["meta"])
def users(user=Depends(current_user)):
    df = pd.read_sql("select id, name, role from users where is_active and role in ('success_exec','retention_manager') order by id", engine)
    return records(df)


# ------------------------------------------------------------------ overview & analytics
@app.get("/api/overview", tags=["analytics"])
def overview(user=Depends(current_user)):
    o = Q.overview()
    for a in o["alerts"]:
        a["display_name"] = name_for(user, a["display_name"])
    return j(o)


@app.get("/api/segments", tags=["analytics"])
def segments(user=Depends(current_user)):
    return j(Q.segments())


@app.get("/api/cohorts", tags=["analytics"])
def cohorts(mode: str = Query("active", pattern="^(active|cumulative)$"), channel: Optional[str] = None,
            category: Optional[str] = None, compare: Optional[str] = Query(None, pattern="^(channel|category)$"),
            user=Depends(current_user)):
    return j(Q.cohorts(mode, channel, category, compare))


@app.get("/api/products", tags=["analytics"])
def products(date_from: Optional[date] = None, date_to: Optional[date] = None, channel: Optional[str] = None,
             user=Depends(current_user)):
    return j(Q.product_metrics(date_from, date_to, channel))


@app.get("/api/campaigns", tags=["analytics"])
def campaigns(user=Depends(current_user)):
    return j(Q.campaigns())


# ------------------------------------------------------------------ customers
def customer_where(q, category, risk, lifecycle, segment, status, channel, frequency, value, last_from, last_to, user):
    w, p = ["1=1"], {}
    if q:
        w.append("(cu.customer_code ilike :q" + ("" if user["role"] == ANALYST else " or su.search_text ilike :q") + ")")
        p["q"] = f"%{q.strip().lower()}%"
    if category:
        w.append("su.products_purchased ilike :cat"); p["cat"] = f"%{category}%"
    if risk:
        rs = [r for r in risk.split(",") if r in RISKS]
        if rs:
            w.append("su.risk_category = any(:risk)"); p["risk"] = rs
    if lifecycle:
        w.append("su.lifecycle_stage = :lc"); p["lc"] = lifecycle
    if segment:
        w.append("su.segment = :seg"); p["seg"] = segment
    if status:
        w.append("su.status = :st"); p["st"] = status
    if channel:
        w.append("cu.channel = :ch"); p["ch"] = channel
    if frequency in FREQ_BANDS:
        lo, hi = FREQ_BANDS[frequency]
        w.append("su.orders_per_month >= :flo and su.orders_per_month < :fhi"); p.update(flo=lo, fhi=hi)
    if value in VALUE_BANDS:
        lo, hi = VALUE_BANDS[value]
        w.append("su.total_revenue >= :vlo and su.total_revenue < :vhi"); p.update(vlo=lo, vhi=hi)
    if last_from:
        w.append("su.last_purchase_date >= :lf"); p["lf"] = last_from
    if last_to:
        w.append("su.last_purchase_date <= :lt"); p["lt"] = last_to
    return " and ".join(w), p


SORTS = {"customer_code": "cu.customer_code", "total_revenue": "su.total_revenue", "total_orders": "su.total_orders",
         "churn_probability": "su.churn_probability", "days_since_last": "su.days_since_last",
         "engagement_score": "su.engagement_score", "avg_order_value": "su.avg_order_value",
         "last_purchase_date": "su.last_purchase_date", "orders_per_month": "su.orders_per_month",
         "expected_replenishment_date": "su.expected_replenishment_date"}

LIST_SQL = """
 select su.customer_id as id, cu.customer_code, cu.display_name, cu.age_group, cu.channel, cu.registered_at,
        cu.first_purchase_date, su.total_orders, su.total_revenue, su.avg_order_value, su.orders_per_month,
        su.last_purchase_date, su.days_since_last, su.products_purchased, su.status, su.engagement_score,
        su.churn_probability, su.risk_category, su.expected_replenishment_date, su.segment, su.lifecycle_stage
 from customer_summary su join customers cu on cu.id = su.customer_id"""


@app.get("/api/customers", tags=["customers"])
def customers(q: Optional[str] = None, category: Optional[str] = None, risk: Optional[str] = None,
              lifecycle: Optional[str] = None, segment: Optional[str] = None, status: Optional[str] = None,
              channel: Optional[str] = None, frequency: Optional[str] = None, value: Optional[str] = None,
              last_from: Optional[date] = None, last_to: Optional[date] = None,
              sort: str = "churn_probability", order: str = Query("desc", pattern="^(asc|desc)$"),
              page: int = Query(1, ge=1), page_size: int = Query(25, ge=5, le=100), user=Depends(current_user)):
    if sort not in SORTS:
        raise HTTPException(422, f"Cannot sort by {sort}")
    where, p = customer_where(q, category, risk, lifecycle, segment, status, channel, frequency, value, last_from, last_to, user)
    with engine.connect() as cx:
        total = cx.execute(text(f"select count(*) from customer_summary su join customers cu on cu.id=su.customer_id where {where}"), p).scalar()
        rows = cx.execute(text(f"{LIST_SQL} where {where} order by {SORTS[sort]} {order} nulls last, su.customer_id "
                               f"limit :lim offset :off"), {**p, "lim": page_size, "off": (page - 1) * page_size}).mappings().all()
    out = [j(dict(r)) for r in rows]
    for r in out:
        r["display_name"] = name_for(user, r["display_name"])
    return {"items": out, "total": total, "page": page, "page_size": page_size, "pages": max(1, -(-total // page_size))}


def csv_response(columns, rows, filename):
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([c["label"] for c in columns])
    for r in rows:
        w.writerow([r.get(c["key"]) if r.get(c["key"]) is not None else "" for c in columns])
    return Response(buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"',
                             "X-Data-Label": "synthetic-demo-data"})


@app.get("/api/customers/export", tags=["customers"])
def customers_export(q: Optional[str] = None, category: Optional[str] = None, risk: Optional[str] = None,
                     lifecycle: Optional[str] = None, segment: Optional[str] = None, status: Optional[str] = None,
                     channel: Optional[str] = None, frequency: Optional[str] = None, value: Optional[str] = None,
                     last_from: Optional[date] = None, last_to: Optional[date] = None,
                     sort: str = "churn_probability", order: str = "desc", user=Depends(current_user)):
    if sort not in SORTS:
        sort = "churn_probability"
    where, p = customer_where(q, category, risk, lifecycle, segment, status, channel, frequency, value, last_from, last_to, user)
    with engine.connect() as cx:
        rows = [j(dict(r)) for r in cx.execute(text(f"{LIST_SQL} where {where} order by {SORTS[sort]} {'asc' if order == 'asc' else 'desc'} nulls last"), p).mappings()]
    for r in rows:
        r["display_name"] = name_for(user, r["display_name"]) or "(hidden for your role)"
    cols = [dict(key=k, label=l) for k, l in [
        ("customer_code", "Customer ID (synthetic)"), ("display_name", "Name (synthetic)"), ("age_group", "Age group"),
        ("channel", "Acquisition channel"), ("first_purchase_date", "First purchase"), ("last_purchase_date", "Last purchase"),
        ("total_orders", "Orders"), ("total_revenue", "Total revenue (INR)"), ("avg_order_value", "Average order value (INR)"),
        ("orders_per_month", "Orders per month"), ("expected_replenishment_date", "Expected replenishment"),
        ("engagement_score", "Engagement score"), ("churn_probability", "Churn probability"),
        ("risk_category", "Risk category"), ("segment", "Segment"), ("lifecycle_stage", "Lifecycle stage"),
        ("products_purchased", "Product categories")]]
    return csv_response(cols, rows, "retention-radar-customers-SYNTHETIC.csv")


@app.get("/api/customers/{cid}", tags=["customers"])
def customer_profile(cid: int, user=Depends(current_user)):
    with engine.connect() as cx:
        c = cx.execute(text("select * from customers where id=:i"), {"i": cid}).mappings().first()
        if not c:
            raise HTTPException(404, "We could not find that customer")
        su = cx.execute(text("select * from customer_summary where customer_id=:i"), {"i": cid}).mappings().first()
    cache = Q.cache.get()
    D, frames = cache["D"], cache["frames"]
    od = frames["orders"][frames["orders"].customer_id == cid].sort_values(["order_date", "id"])
    items = frames["items"]
    prod_names = pd.read_sql("select id, name, category, days_supply from products", engine).set_index("id")
    oi = pd.read_sql(text("select order_id, product_id, quantity from order_items where order_id = any(:ids)"), engine,
                     params={"ids": od["id"].astype(int).tolist()})
    orders_out, consumption = [], []
    prev_cover = None
    deliv = od[od.status == "delivered"]
    for r in od.itertuples():
        its = oi[oi.order_id == r.id]
        names = [prod_names.at[pid, "name"] for pid in its.product_id]
        orders_out.append({"id": int(r.id), "date": j(r.order_date), "status": r.status, "items": names,
                           "gross": float(r.gross_amount), "discount": float(r.discount_amount), "net": float(r.net_amount),
                           "refund": float(r.refund_amount or 0), "refund_date": j(r.refund_date)})
    for r in deliv.itertuples():
        its = oi[oi.order_id == r.id]
        main = its.iloc[0].product_id if len(its) else None
        covers = r.order_date + pd.Timedelta(days=int(r.window_days))
        gap = None if prev_cover is None else int((r.order_date - prev_cover).days)
        consumption.append({"order_date": j(r.order_date), "product": prod_names.at[main, "name"] if main else None,
                            "category": prod_names.at[main, "category"] if main else None, "days_supply": int(r.window_days),
                            "supply_ends": j(covers), "days_vs_previous_supply_end": gap})
        prev_cover = covers
    pred = pd.read_sql(text("select * from churn_predictions where customer_id=:c and prediction_date=:d"), engine,
                       params={"c": cid, "d": AS_OF})
    prediction = records(pred)[0] if len(pred) else None
    tk = pd.read_sql(text("select created_at, category, sentiment, status, resolved_at, medical_concern, summary "
                          "from support_tickets where customer_id=:c order by created_at"), engine, params={"c": cid})
    eng = pd.read_sql(text("select week_start, emails_sent, emails_opened, email_clicks, site_visits, app_sessions, content_views, reviews "
                           "from customer_engagement where customer_id=:c order by week_start"), engine, params={"c": cid})
    ivs = pd.read_sql(text("""select ri.id, ri.created_at, ri.scenario, ri.reason, ri.status, ri.source, u.name as assignee,
                                     io.observed_outcome, io.days_to_reorder, io.revenue_after_30d
                              from retention_interventions ri left join users u on u.id=ri.assigned_to
                              left join intervention_outcomes io on io.intervention_id=ri.id
                              where ri.customer_id=:c order by ri.created_at"""), engine, params={"c": cid})
    # monthly purchase frequency timeline
    months = pd.period_range("2025-11", "2026-10", freq="M")
    cnt = deliv.groupby(deliv.order_date.dt.to_period("M")).size()
    freq = [{"month": str(m), "label": m.strftime("%b %y"), "orders": int(cnt.get(m, 0))} for m in months]
    # journey timeline
    ev = []
    first = True
    for o in orders_out:
        if o["status"] == "delivered":
            ev.append({"date": o["date"], "type": "purchase", "title": "First purchase" if first else "Reorder",
                       "detail": f"{', '.join(o['items'])}. Rs {o['net']:,.0f}"})
            first = False
        else:
            ev.append({"date": o["date"], "type": "cancel", "title": "Order cancelled", "detail": ", ".join(o["items"])})
        if o["refund"] > 0:
            ev.append({"date": o["refund_date"], "type": "refund", "title": "Refund issued", "detail": f"Rs {o['refund']:,.0f}"})
    for t in records(tk):
        ev.append({"date": t["created_at"], "type": "ticket", "title": f"Support: {t['category']}",
                   "detail": t["summary"] + ("" if t["status"] == "resolved" else " (still open)")})
        if t["resolved_at"]:
            ev.append({"date": t["resolved_at"], "type": "ticket", "title": "Ticket resolved", "detail": t["category"]})
    for i in records(ivs):
        ev.append({"date": i["created_at"], "type": "intervention", "title": f"Intervention: {i['scenario']}",
                   "detail": f"{i['status']}" + (f". Observed: {i['observed_outcome']}" if i["observed_outcome"] else "")})
    if su and su["status"] == "lapsed" and len(deliv):
        lastr = deliv.iloc[-1]
        dl = lastr.order_date + pd.Timedelta(days=int(lastr.window_days + cache["grace"]))
        ev.append({"date": j(dl), "type": "lapse", "title": "Passed replenishment deadline", "detail": "No reorder within the grace period"})
    ev.sort(key=lambda e: e["date"])
    cdict = j(dict(c))
    cdict["display_name"] = name_for(user, cdict["display_name"])
    cdict["email_masked"] = None if user["role"] == ANALYST else cdict["email_masked"]
    return {"customer": cdict, "summary": j(dict(su)) if su else None, "prediction": prediction, "orders": orders_out[::-1],
            "consumption": consumption, "frequency_timeline": freq, "tickets": records(tk)[::-1],
            "engagement": records(eng.tail(26)), "interventions": records(ivs)[::-1], "journey": ev}


# ------------------------------------------------------------------ model & settings
@app.get("/api/model", tags=["model"])
def model(user=Depends(current_user)):
    r = pd.read_sql("select * from model_runs where is_active order by id desc limit 1", engine)
    if r.empty:
        raise HTTPException(404, "No trained model yet")
    out = records(r)[0]
    out["retrain"] = RETRAIN
    return out


RETRAIN = {"state": "idle", "message": None, "started": None, "finished": None}


class RetrainBody(BaseModel):
    horizon_days: int = Field(90, ge=30, le=90)
    grace_days: int = Field(15, ge=0, le=45)


def _retrain(h, g):
    RETRAIN.update(state="running", message="Training and comparing models", started=datetime.now().isoformat(), finished=None)
    try:
        from pipeline import train as T, score
        with engine.begin() as cx:
            for k, v in (("horizon_days", h), ("grace_days", g)):
                cx.execute(text("insert into app_settings(key,value) values(:k, cast(:v as jsonb)) "
                                "on conflict (key) do update set value=excluded.value"), {"k": k, "v": str(v)})
        run = T.train(horizon=h, grace=g, verbose=False)
        rid = T.save_run(run)
        RETRAIN["message"] = "Scoring customers"
        score.run(rid, verbose=False)
        Q.cache.clear()
        RETRAIN.update(state="done", message=f"Retrained with a {h}-day horizon and {g}-day grace period",
                       finished=datetime.now().isoformat())
    except Exception as e:  # noqa
        traceback.print_exc()
        RETRAIN.update(state="error", message=f"Retraining failed: {e}", finished=datetime.now().isoformat())


@app.post("/api/model/retrain", tags=["model"], status_code=202)
def retrain(body: RetrainBody, user=Depends(require(MANAGER))):
    if ON_VERCEL:
        raise HTTPException(501, "Retraining is not available on this hosted demo. Run backend/run_pipeline.py locally against the same database to retrain.")
    if RETRAIN["state"] == "running":
        raise HTTPException(409, "A retraining run is already in progress")
    threading.Thread(target=_retrain, args=(body.horizon_days, body.grace_days), daemon=True).start()
    RETRAIN.update(state="running", message="Starting", started=datetime.now().isoformat(), finished=None)
    return RETRAIN


@app.get("/api/model/retrain/status", tags=["model"])
def retrain_status(user=Depends(current_user)):
    return RETRAIN


class Thresholds(BaseModel):
    medium: float = Field(gt=0, lt=1)
    high: float = Field(gt=0, lt=1)
    critical: float = Field(gt=0, lt=1)


@app.get("/api/settings", tags=["settings"])
def settings(user=Depends(current_user)):
    st = get_settings(engine)
    users_df = pd.read_sql("select id, name, email, role, is_active from users order by id", engine)
    out = records(users_df)
    for u in out:
        u["role_label"] = ROLE_LABELS[u["role"]]
    return {"thresholds": st["thresholds"], "grace_days": st["grace_days"], "horizon_days": st["horizon_days"],
            "users": out, "can_edit": user["role"] == MANAGER}


@app.put("/api/settings/thresholds", tags=["settings"])
def set_thresholds(body: Thresholds, user=Depends(require(MANAGER))):
    if not (body.medium < body.high < body.critical):
        raise HTTPException(422, "Thresholds must increase from Medium to High to Critical")
    with engine.begin() as cx:
        cx.execute(text("insert into app_settings(key,value) values('thresholds', cast(:v as jsonb)) "
                        "on conflict (key) do update set value=excluded.value"),
                   {"v": '{"medium": %s, "high": %s, "critical": %s}' % (body.medium, body.high, body.critical)})
    refresh_segments_and_summary(engine)
    Q.cache.clear()
    return {"ok": True, "thresholds": body.model_dump()}


# ------------------------------------------------------------------ interventions
IV_SQL = """
 select ri.id, ri.customer_id, cu.customer_code, cu.display_name, ri.created_at, ri.created_by, ri.risk_category,
        ri.churn_probability, ri.reason, ri.scenario, ri.recommended_action, ri.rationale, ri.assigned_to,
        u.name as assignee, ri.due_date, ri.status, ri.source, io.observed_outcome, io.days_to_reorder,
        io.revenue_after_30d
 from retention_interventions ri join customers cu on cu.id=ri.customer_id
 left join users u on u.id=ri.assigned_to left join intervention_outcomes io on io.intervention_id=ri.id"""


@app.get("/api/interventions", tags=["interventions"])
def interventions(status: Optional[str] = None, risk: Optional[str] = None, assignee: Optional[str] = None,
                  scenario: Optional[str] = None, source: Optional[str] = None, q: Optional[str] = None,
                  overdue: bool = False, page: int = Query(1, ge=1), page_size: int = Query(25, ge=5, le=100),
                  user=Depends(current_user)):
    w, p = ["1=1"], {}
    if status:
        w.append("ri.status = any(:st)"); p["st"] = [s for s in status.split(",") if s in STATUSES]
    if risk:
        w.append("ri.risk_category = any(:rk)"); p["rk"] = [s for s in risk.split(",") if s in RISKS]
    if assignee == "unassigned":
        w.append("ri.assigned_to is null")
    elif assignee == "me":
        w.append("ri.assigned_to = :me"); p["me"] = user["id"]
    elif assignee and assignee.isdigit():
        w.append("ri.assigned_to = :a"); p["a"] = int(assignee)
    if scenario:
        w.append("ri.scenario = :sc"); p["sc"] = scenario
    if source:
        w.append("ri.source = :src"); p["src"] = source
    if q:
        w.append("cu.customer_code ilike :q"); p["q"] = f"%{q.strip()}%"
    if overdue:
        w.append("ri.due_date < :today and ri.status in ('Pending','Assigned','In Progress','Contacted')"); p["today"] = AS_OF
    where = " and ".join(w)
    with engine.connect() as cx:
        total = cx.execute(text(f"select count(*) from retention_interventions ri join customers cu on cu.id=ri.customer_id where {where}"), p).scalar()
        rows = cx.execute(text(f"""{IV_SQL} where {where}
            order by (ri.status in ('Resolved','Unsuccessful')), case ri.risk_category when 'Critical' then 0 when 'High' then 1
                     when 'Medium' then 2 else 3 end, ri.churn_probability desc nulls last, ri.created_at desc
            limit :lim offset :off"""), {**p, "lim": page_size, "off": (page - 1) * page_size}).mappings().all()
    out = [j(dict(r)) for r in rows]
    for r in out:
        r["display_name"] = name_for(user, r["display_name"])
        r["can_edit"] = user["role"] == MANAGER or (user["role"] == EXEC and r["assigned_to"] == user["id"])
    return {"items": out, "total": total, "page": page, "page_size": page_size, "pages": max(1, -(-total // page_size))}


@app.get("/api/interventions/summary", tags=["interventions"])
def interventions_summary(user=Depends(current_user)):
    st = pd.read_sql("select status, count(*) n from retention_interventions group by 1", engine)
    counts = {s: int(st.loc[st.status == s, "n"].sum()) for s in STATUSES}
    out = pd.read_sql("""select ri.scenario, io.observed_outcome o, count(*) n, avg(io.days_to_reorder) d
                         from retention_interventions ri join intervention_outcomes io on io.intervention_id=ri.id
                         group by 1,2""", engine)
    tracker = []
    for sc, g in out.groupby("scenario"):
        tot = int(g.n.sum())
        evald = int(g[g.o != "Pending"].n.sum())
        get = lambda k: int(g.loc[g.o == k, "n"].sum())
        tracker.append({"scenario": sc, "interventions": tot, "evaluated": evald, "remained_active": get("Remained active"),
                        "resumed": get("Resumed purchasing"), "churned": get("Churned"), "pending": get("Pending"),
                        "reorder_rate": (get("Remained active") + get("Resumed purchasing")) / evald if evald else None})
    ov = out.groupby("o").n.sum()
    od = pd.read_sql(text("select count(*) from retention_interventions where due_date < :t and status in "
                          "('Pending','Assigned','In Progress','Contacted')"), engine, params={"t": AS_OF}).iloc[0, 0]
    return {"counts": counts, "overdue": int(od), "tracker": tracker,
            "outcomes": {k: int(v) for k, v in ov.items()},
            "note": "Outcomes are observational. A customer who buys after outreach may have bought anyway, so these rates "
                    "do not show that an intervention prevented churn. Only a controlled experiment, such as the campaign "
                    "control groups, can show incremental impact."}


@app.get("/api/interventions/{iid}", tags=["interventions"])
def intervention_detail(iid: int, user=Depends(current_user)):
    with engine.connect() as cx:
        r = cx.execute(text(f"{IV_SQL} where ri.id=:i"), {"i": iid}).mappings().first()
        if not r:
            raise HTTPException(404, "We could not find that intervention")
        ev = cx.execute(text("select event_at, actor, event_type, detail from intervention_events where intervention_id=:i order by event_at, id"),
                        {"i": iid}).mappings().all()
    d = j(dict(r))
    d["display_name"] = name_for(user, d["display_name"])
    d["can_edit"] = user["role"] == MANAGER or (user["role"] == EXEC and d["assigned_to"] == user["id"])
    return {"intervention": d, "events": [j(dict(e)) for e in ev]}


class NewIntervention(BaseModel):
    customer_id: int
    assigned_to: Optional[int] = None
    due_date: Optional[date] = None
    note: Optional[str] = Field(None, max_length=500)


def log(cx, iid, actor, etype, detail):
    cx.execute(text("insert into intervention_events(intervention_id,event_at,actor,event_type,detail) values(:i,:t,:a,:e,:d)"),
               {"i": iid, "t": datetime.combine(AS_OF, datetime.now().time()), "a": actor, "e": etype, "d": detail})


@app.post("/api/interventions", tags=["interventions"], status_code=201)
def create_intervention(body: NewIntervention, user=Depends(require(MANAGER, EXEC))):
    with engine.begin() as cx:
        if not cx.execute(text("select 1 from customers where id=:i"), {"i": body.customer_id}).first():
            raise HTTPException(404, "We could not find that customer")
        open_ = cx.execute(text("select id from retention_interventions where customer_id=:c and status in "
                                "('Pending','Assigned','In Progress','Contacted')"), {"c": body.customer_id}).first()
        if open_:
            raise HTTPException(409, f"This customer already has an open intervention (#{open_[0]})")
        pred = cx.execute(text("select churn_probability, risk_category, primary_reason, recommendation from churn_predictions "
                               "where customer_id=:c and prediction_date=:d"), {"c": body.customer_id, "d": AS_OF}).mappings().first()
        assignee = body.assigned_to if user["role"] == MANAGER else user["id"]
        if pred:
            rec = pred["recommendation"]
            vals = dict(risk=pred["risk_category"], p=pred["churn_probability"], reason=pred["primary_reason"],
                        sc=rec["scenario"], act="; ".join(rec["actions"][:2]), rat=rec["rationale"])
        else:
            vals = dict(risk=None, p=None, reason="Lapsed customer: manual win-back", sc="Missed replenishment",
                        act="Send a personalised replenishment reminder; Ask whether the customer needs help",
                        rat="Customer is past their replenishment deadline and is not scored by the model.")
        due = body.due_date or AS_OF + timedelta(days=5)
        iid = cx.execute(text("""insert into retention_interventions(customer_id, created_at, created_by, risk_category,
                churn_probability, reason, scenario, recommended_action, rationale, assigned_to, due_date, status, source)
                values(:c,:ca,:cb,:r,:p,:rs,:sc,:act,:rat,:a,:due,:st,'manual') returning id"""),
                         {"c": body.customer_id, "ca": AS_OF, "cb": user["name"], "r": vals["risk"], "p": vals["p"],
                          "rs": vals["reason"], "sc": vals["sc"], "act": vals["act"], "rat": vals["rat"], "a": assignee,
                          "due": due, "st": "Assigned" if assignee else "Pending"}).scalar()
        log(cx, iid, user["name"], "created", "Intervention created manually")
        if assignee:
            nm = cx.execute(text("select name from users where id=:i"), {"i": assignee}).scalar()
            log(cx, iid, user["name"], "assigned", f"Assigned to {nm}")
        if body.note:
            log(cx, iid, user["name"], "note", body.note)
    return {"id": iid}


class PatchIntervention(BaseModel):
    status: Optional[str] = None
    assigned_to: Optional[int] = None
    due_date: Optional[date] = None


def can_edit(user, row):
    return user["role"] == MANAGER or (user["role"] == EXEC and row["assigned_to"] == user["id"])


@app.patch("/api/interventions/{iid}", tags=["interventions"])
def patch_intervention(iid: int, body: PatchIntervention, user=Depends(require(MANAGER, EXEC))):
    finished = False
    with engine.begin() as cx:
        row = cx.execute(text("select assigned_to, status from retention_interventions where id=:i"), {"i": iid}).mappings().first()
        if not row:
            raise HTTPException(404, "We could not find that intervention")
        if not can_edit(user, row):
            raise HTTPException(403, "Only the assigned executive or a manager can change this intervention")
        sets, p = [], {"i": iid}
        if body.assigned_to is not None:
            if user["role"] != MANAGER:
                raise HTTPException(403, "Only a retention manager can assign interventions")
            nm = cx.execute(text("select name from users where id=:i and is_active"), {"i": body.assigned_to}).scalar()
            if not nm:
                raise HTTPException(422, "That assignee does not exist")
            sets.append("assigned_to=:a"); p["a"] = body.assigned_to
            log(cx, iid, user["name"], "assigned", f"Assigned to {nm}")
            if row["status"] == "Pending" and not body.status:
                sets.append("status='Assigned'")
        if body.status:
            if body.status not in STATUSES:
                raise HTTPException(422, f"Status must be one of: {', '.join(STATUSES)}")
            if body.status == "Assigned" and row["assigned_to"] is None and body.assigned_to is None:
                raise HTTPException(422, "Choose an assignee before setting the status to Assigned")
            sets.append("status=:s"); p["s"] = body.status
            log(cx, iid, user["name"], "status_change", f"Status set to {body.status}")
            finished = body.status in ("Resolved", "Unsuccessful")
        if body.due_date:
            sets.append("due_date=:d"); p["d"] = body.due_date
            log(cx, iid, user["name"], "follow_up_scheduled", f"Follow-up scheduled for {body.due_date.isoformat()}")
        if not sets:
            raise HTTPException(422, "Nothing to change")
        cx.execute(text(f"update retention_interventions set {', '.join(sets)} where id=:i"), p)
    if finished:
        evaluate_outcomes(engine)
    return {"ok": True}


class NewEvent(BaseModel):
    event_type: str = Field(pattern="^(note|customer_response)$")
    detail: str = Field(min_length=2, max_length=600)


@app.post("/api/interventions/{iid}/events", tags=["interventions"], status_code=201)
def add_event(iid: int, body: NewEvent, user=Depends(require(MANAGER, EXEC))):
    with engine.begin() as cx:
        row = cx.execute(text("select assigned_to from retention_interventions where id=:i"), {"i": iid}).mappings().first()
        if not row:
            raise HTTPException(404, "We could not find that intervention")
        if not can_edit(user, row):
            raise HTTPException(403, "Only the assigned executive or a manager can add notes here")
        log(cx, iid, user["name"], body.event_type, body.detail)
    return {"ok": True}


@app.post("/api/interventions/{iid}/escalate", tags=["interventions"])
def escalate(iid: int, user=Depends(require(MANAGER, EXEC))):
    with engine.begin() as cx:
        row = cx.execute(text("select assigned_to, scenario from retention_interventions where id=:i"), {"i": iid}).mappings().first()
        if not row:
            raise HTTPException(404, "We could not find that intervention")
        if not can_edit(user, row):
            raise HTTPException(403, "Only the assigned executive or a manager can escalate this")
        log(cx, iid, user["name"], "escalated",
            "Escalated to the retention manager and, for treatment-related concerns, to qualified professionals (simulated hand-off)")
    return {"ok": True, "simulated": True}


# ------------------------------------------------------------------ reports
REPORTS = {
    "monthly_churn": "Monthly churn summary", "retention_performance": "Retention performance",
    "risk_distribution": "At-risk customer distribution", "product_churn": "Product-wise churn",
    "cohort_retention": "Cohort retention", "revenue_at_risk": "Revenue at risk",
    "intervention_effectiveness": "Intervention effectiveness (observational)", "at_risk_customers": "At-risk customer list",
}


def _rep(name, d_from, d_to, channel, category, user):
    c = lambda k, l, f="text": {"key": k, "label": l, "format": f}
    if name in ("monthly_churn", "retention_performance"):
        rows = Q.monthly_churn(Q.cache.get())
        rows = [r for r in rows if (not d_from or r["month"] >= d_from.strftime("%Y-%m")) and (not d_to or r["month"] <= d_to.strftime("%Y-%m"))]
        if name == "monthly_churn":
            cols = [c("label", "Month"), c("active_start", "Active at month start", "int"), c("lapsed", "Customers lapsed", "int"), c("churn_rate", "Churn rate", "pct")]
        else:
            cols = [c("label", "Month"), c("active_start", "Active at month start", "int"), c("retention_rate", "Retention rate", "pct")]
        return cols, rows
    if name == "risk_distribution":
        df = pd.read_sql(text("""select cp.risk_category as risk, count(*) customers, avg(cp.churn_probability) avg_probability,
                  sum(cp.expected_90d_revenue) exposure from churn_predictions cp
                  where cp.prediction_date=:d group by 1"""), engine, params={"d": AS_OF})
        df["o"] = df.risk.map({r: i for i, r in enumerate(RISKS)})
        rows = records(df.sort_values("o").drop(columns="o"))
        return [c("risk", "Risk category"), c("customers", "Customers", "int"), c("avg_probability", "Average churn probability", "pct"),
                c("exposure", "90-day revenue exposure (INR)", "money")], rows
    if name == "product_churn":
        res = Q.product_metrics(d_from, d_to, channel)["rows"]
        return [c("category", "Acquisition product"), c("customers", "Customers", "int"), c("eligible", "Eligible", "int"),
                c("repeat_rate", "Repeat purchase rate", "pct"), c("avg_days_to_second", "Days to second purchase", "num"),
                c("retention", "Retention", "pct"), c("churn_rate", "Churn rate", "pct"), c("revenue", "Revenue (INR)", "money"),
                c("refund_rate", "Refund rate", "pct"), c("avg_ltv", "Average LTV (INR)", "money")], res
    if name == "cohort_retention":
        res = Q.cohorts("active", channel, category)
        rows = [{"label": r["label"], "size": r["size"], **{f"m{i}": v for i, v in enumerate(r["values"])}} for r in res["rows"]]
        return [c("label", "Cohort (first purchase month)"), c("size", "Customers", "int")] + [c(f"m{i}", f"Month {i}", "pct") for i in range(7)], rows
    if name == "revenue_at_risk":
        df = pd.read_sql(text("""select su.primary_category as category, cp.risk_category as risk, count(*) customers,
                  sum(cp.expected_90d_revenue) exposure, sum(cp.expected_90d_revenue*cp.churn_probability) weighted
                  from churn_predictions cp join customer_summary su on su.customer_id=cp.customer_id
                  where cp.prediction_date=:d and cp.risk_category in ('High','Critical') group by 1,2 order by 1,2"""), engine, params={"d": AS_OF})
        return [c("category", "Primary product category"), c("risk", "Risk"), c("customers", "Customers", "int"),
                c("exposure", "90-day exposure (INR)", "money"), c("weighted", "Probability-weighted (INR)", "money")], records(df)
    if name == "intervention_effectiveness":
        w, p = ["1=1"], {}
        if d_from:
            w.append("ri.created_at >= :f"); p["f"] = d_from
        if d_to:
            w.append("ri.created_at <= :t"); p["t"] = d_to
        df = pd.read_sql(text(f"""select ri.scenario, count(*) interventions,
                sum((io.observed_outcome='Remained active')::int) remained_active,
                sum((io.observed_outcome='Resumed purchasing')::int) resumed,
                sum((io.observed_outcome='Churned')::int) churned, sum((io.observed_outcome='Pending')::int) pending
                from retention_interventions ri left join intervention_outcomes io on io.intervention_id=ri.id
                where {' and '.join(w)} group by 1 order by 2 desc"""), engine, params=p)
        df["reorder_rate"] = (df.remained_active + df.resumed) / (df.remained_active + df.resumed + df.churned).replace(0, np.nan)
        return [c("scenario", "Scenario"), c("interventions", "Interventions", "int"), c("remained_active", "Remained active", "int"),
                c("resumed", "Resumed purchasing", "int"), c("churned", "Churned", "int"), c("pending", "Pending", "int"),
                c("reorder_rate", "Reordered after outreach (observational)", "pct")], records(df)
    if name == "at_risk_customers":
        df = pd.read_sql("""select cu.customer_code, cu.display_name, su.risk_category, su.churn_probability, cp.primary_reason,
                  cp.recommendation->>'scenario' as scenario, su.total_revenue, su.expected_replenishment_date, su.segment
                  from customer_summary su join customers cu on cu.id=su.customer_id
                  join churn_predictions cp on cp.customer_id=su.customer_id and cp.prediction_date=%(d)s
                  where su.risk_category in ('High','Critical') order by su.churn_probability desc""", engine, params={"d": AS_OF})
        rows = records(df)
        for r in rows:
            r["display_name"] = name_for(user, r["display_name"]) or "(hidden for your role)"
        return [c("customer_code", "Customer ID (synthetic)"), c("display_name", "Name (synthetic)"), c("risk_category", "Risk"),
                c("churn_probability", "Churn probability", "pct"), c("primary_reason", "Main risk indicator"),
                c("scenario", "Recommended scenario"), c("total_revenue", "Total revenue (INR)", "money"),
                c("expected_replenishment_date", "Expected replenishment"), c("segment", "Segment")], rows
    raise HTTPException(404, "Unknown report")


@app.get("/api/reports", tags=["reports"])
def report_list(user=Depends(current_user)):
    return [{"key": k, "title": v} for k, v in REPORTS.items()]


@app.get("/api/reports/{name}", tags=["reports"])
def report(name: str, date_from: Optional[date] = None, date_to: Optional[date] = None, channel: Optional[str] = None,
           category: Optional[str] = None, format: str = Query("json", pattern="^(json|csv)$"), user=Depends(current_user)):
    cols, rows = _rep(name, date_from, date_to, channel, category, user)
    rows = [j(r) for r in rows]
    if format == "csv":
        return csv_response(cols, rows, f"retention-radar-{name}-SYNTHETIC.csv")
    return {"key": name, "title": REPORTS[name], "columns": cols, "rows": rows, "as_of": AS_OF.isoformat(),
            "filters": {"date_from": j(date_from), "date_to": j(date_to), "channel": channel, "category": category},
            "label": "Synthetic demonstration data. Not real Man Matters customers."}


# ------------------------------------------------------------------ static frontend
FRONT = Path(__file__).resolve().parents[2] / "frontend"
if FRONT.exists():
    app.mount("/", StaticFiles(directory=str(FRONT), html=True), name="frontend")
