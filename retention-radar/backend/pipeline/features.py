"""Leakage-safe feature engineering.

Every feature for a snapshot date `s` uses only rows that existed on or before `s`:
orders placed <= s, refunds dated <= s, tickets created <= s (a ticket resolved after s counts as open),
and engagement weeks that had fully ended by s.
"""
import numpy as np
import pandas as pd

CHANNELS = ["Instagram Ads", "Google Search", "Influencer", "Organic", "Referral", "Marketplace"]
CATS = ["Minoxidil Treatment", "Hair Fall Gummies", "DHT Shampoo", "Haircare Kit", "Scalp Treatment", "Other Haircare"]
AGE_ORD = {"18-24": 0, "25-34": 1, "35-44": 2, "45+": 3}

NUMERIC = [
    "days_since_last", "n_purchases", "tenure_days", "avg_gap_days", "last_gap_ratio", "overdue_days", "overdue_ratio",
    "window_days", "n_late_refills", "max_late_days", "orders_last_90", "orders_prev_90", "freq_change",
    "n_cancellations", "cancel_rate", "cancels_after_last_order", "cancels_last_60", "n_refunds", "refund_rate",
    "email_open_rate_4w", "email_clicks_4w", "site_visits_4w", "content_views_4w", "app_sessions_4w",
    "engagement_change", "reviews_total", "n_tickets", "n_negative_tickets_90", "n_open_tickets",
    "n_open_negative_tickets", "treatment_concerns", "days_since_ticket", "aov", "total_spend", "discount_share",
    "age_ord", "has_app",
]
FEATURES = NUMERIC + [f"ch_{c}" for c in CHANNELS] + [f"cat_{c}" for c in CATS]

FEATURE_LABELS = {
    "days_since_last": "Days since last purchase", "n_purchases": "Number of purchases", "tenure_days": "Customer tenure",
    "avg_gap_days": "Average days between purchases", "last_gap_ratio": "Latest gap vs expected cycle",
    "overdue_days": "Days past expected refill date", "overdue_ratio": "Time since purchase vs expected cycle",
    "window_days": "Expected replenishment cycle", "n_late_refills": "Late refills in the past",
    "max_late_days": "Longest past refill delay", "orders_last_90": "Orders in last 90 days",
    "orders_prev_90": "Orders in the 90 days before that", "freq_change": "Change in purchase frequency",
    "n_cancellations": "Cancelled order attempts", "cancel_rate": "Order cancellation rate",
    "cancels_after_last_order": "Cancellations since last delivered order", "cancels_last_60": "Cancellations in last 60 days",
    "n_refunds": "Refunds", "refund_rate": "Refund rate", "email_open_rate_4w": "Email open rate (4 weeks)",
    "email_clicks_4w": "Email clicks (4 weeks)", "site_visits_4w": "Site visits (4 weeks)",
    "content_views_4w": "Educational content views (4 weeks)", "app_sessions_4w": "App sessions (4 weeks)",
    "engagement_change": "Change in engagement vs prior 4 weeks", "reviews_total": "Product reviews written",
    "n_tickets": "Support tickets", "n_negative_tickets_90": "Negative tickets in last 90 days",
    "n_open_tickets": "Open support tickets", "n_open_negative_tickets": "Open negative tickets",
    "treatment_concerns": "Treatment-related concerns raised", "days_since_ticket": "Days since last ticket",
    "aov": "Average order value", "total_spend": "Total spend", "discount_share": "Share of spend from discounts",
    "age_ord": "Age group", "has_app": "Has the app",
}
for c in CHANNELS:
    FEATURE_LABELS[f"ch_{c}"] = f"Acquired via {c}"
for c in CATS:
    FEATURE_LABELS[f"cat_{c}"] = f"Last product category: {c}"

# What the demo dataset cannot supply (shown in the UI, never silently imputed as real values)
FEATURE_AVAILABILITY = [
    {"group": "Purchase behaviour", "feature": "Order cancellations, refunds, purchase gaps", "status": "available"},
    {"group": "Customer engagement", "feature": "Email opens and clicks, website visits, educational content views", "status": "available"},
    {"group": "Customer engagement", "feature": "App activity", "status": "partial", "note": "Only customers with the app; others are treated as missing"},
    {"group": "Customer engagement", "feature": "Product review activity", "status": "partial", "note": "Sparse; most customers never review"},
    {"group": "Customer experience", "feature": "Support tickets, unresolved tickets, treatment concerns", "status": "available"},
    {"group": "Customer experience", "feature": "Free-text customer feedback and NPS", "status": "unavailable", "note": "Not in the dataset"},
    {"group": "Customer experience", "feature": "Detailed reported difficulties following treatment", "status": "partial", "note": "Only a coarse ticket flag is available"},
    {"group": "Commercial", "feature": "Order value, total spend, discount dependency", "status": "available"},
    {"group": "Commercial", "feature": "Subscription cancellation history", "status": "unavailable", "note": "No subscription product in the dataset"},
]


def load_frames(engine):
    q = lambda sql: pd.read_sql(sql, engine)
    orders = q("select * from orders")
    for c in ["order_date", "refund_date"]:
        orders[c] = pd.to_datetime(orders[c])
    items = q("select oi.order_id, oi.product_id, oi.quantity, p.category, p.name, p.days_supply "
              "from order_items oi join products p on p.id=oi.product_id order by oi.id")
    first_item = items.groupby("order_id").first()
    orders = orders.merge(first_item[["category"]], left_on="id", right_index=True, how="left")
    cust = q("select * from customers")
    cust["first_purchase_date"] = pd.to_datetime(cust["first_purchase_date"])
    tickets = q("select * from support_tickets")
    for c in ["created_at", "resolved_at"]:
        tickets[c] = pd.to_datetime(tickets[c])
    eng = q("select * from customer_engagement")
    eng["week_start"] = pd.to_datetime(eng["week_start"])
    eng["week_end"] = eng["week_start"] + pd.Timedelta(days=6)
    return {"orders": orders, "items": items, "customers": cust, "tickets": tickets, "engagement": eng}


class Snapshotter:
    def __init__(self, frames, grace_days):
        self.grace = grace_days
        o = frames["orders"]
        D = o[o.status == "delivered"].sort_values(["customer_id", "order_date", "id"]).copy()
        D["gap_prev"] = D.groupby("customer_id")["order_date"].diff().dt.days
        D["prev_window"] = D.groupby("customer_id")["window_days"].shift(1)
        D["late"] = D["gap_prev"] - D["prev_window"]
        self.D = D
        self.C = o[o.status == "cancelled"][["customer_id", "order_date"]]
        self.T = frames["tickets"]
        self.E = frames["engagement"]
        self.cust = frames["customers"].set_index("id")

    def features(self, s):
        s = pd.Timestamp(s)
        g = self.grace
        d = self.D[self.D.order_date <= s]
        rk = d["refund_amount"].where(d["refund_date"].notna() & (d["refund_date"] <= s), 0.0)
        d = d.assign(refund_known=rk, rk_flag=(rk > 0).astype(int), late_flag=(d["late"] > 5).astype(int),
                     in90=(d["order_date"] > s - pd.Timedelta(days=90)).astype(int),
                     p90=((d["order_date"] <= s - pd.Timedelta(days=90)) & (d["order_date"] > s - pd.Timedelta(days=180))).astype(int))
        grp = d.groupby("customer_id")
        f = pd.DataFrame({
            "n_purchases": grp.size(), "first": grp["order_date"].min(), "last": grp["order_date"].max(),
            "avg_gap_days": grp["gap_prev"].mean(), "n_late_refills": grp["late_flag"].sum(),
            "max_late_days": grp["late"].max().clip(lower=0), "orders_last_90": grp["in90"].sum(),
            "orders_prev_90": grp["p90"].sum(), "n_refunds": grp["rk_flag"].sum(),
            "gross": grp["gross_amount"].sum(), "disc": grp["discount_amount"].sum(), "net": grp["net_amount"].sum(),
            "refund_sum": grp["refund_known"].sum(),
        })
        lastrow = grp.tail(1).set_index("customer_id")
        f["window_days"] = lastrow["window_days"]
        f["last_gap"] = lastrow["gap_prev"]
        f["last_prev_window"] = lastrow["prev_window"]
        f["last_category"] = lastrow["category"]
        f["last_gap_ratio"] = f["last_gap"] / f["last_prev_window"]
        f["days_since_last"] = (s - f["last"]).dt.days
        f["tenure_days"] = (s - f["first"]).dt.days
        f["overdue_days"] = f["days_since_last"] - f["window_days"]
        f["overdue_ratio"] = f["days_since_last"] / f["window_days"]
        f["deadline"] = f["last"] + pd.to_timedelta(f["window_days"] + g, unit="D")
        f["covered"] = f["days_since_last"] <= f["window_days"] + g
        f["freq_change"] = (f["orders_last_90"] - f["orders_prev_90"]).where(f["tenure_days"] > 120, np.nan)
        f["total_spend"] = f["net"] - f["refund_sum"]
        f["aov"] = f["net"] / f["n_purchases"]
        f["discount_share"] = f["disc"] / f["gross"].replace(0, np.nan)
        f["refund_rate"] = f["n_refunds"] / f["n_purchases"]

        c = self.C[self.C.order_date <= s].merge(f[["last"]], left_on="customer_id", right_index=True, how="left")
        c["after_last"] = (c["order_date"] > c["last"]).astype(int)
        c["l60"] = (c["order_date"] > s - pd.Timedelta(days=60)).astype(int)
        cg = c.groupby("customer_id")
        f["n_cancellations"] = cg.size().reindex(f.index).fillna(0)
        f["cancels_after_last_order"] = cg["after_last"].sum().reindex(f.index).fillna(0)
        f["cancels_last_60"] = cg["l60"].sum().reindex(f.index).fillna(0)
        f["cancel_rate"] = f["n_cancellations"] / (f["n_cancellations"] + f["n_purchases"])

        e = self.E[self.E.week_end <= s]
        r4 = e[e.week_end > s - pd.Timedelta(days=28)].groupby("customer_id")[
            ["emails_sent", "emails_opened", "email_clicks", "site_visits", "app_sessions", "content_views"]].sum(min_count=1)
        p4 = e[(e.week_end <= s - pd.Timedelta(days=28)) & (e.week_end > s - pd.Timedelta(days=56))].groupby("customer_id")[
            ["email_clicks", "site_visits", "content_views"]].sum()
        r4 = r4.reindex(f.index)
        p4 = p4.reindex(f.index).fillna(0)
        f["email_open_rate_4w"] = (r4["emails_opened"] / r4["emails_sent"].replace(0, np.nan))
        f["email_clicks_4w"] = r4["email_clicks"].fillna(0)
        f["site_visits_4w"] = r4["site_visits"].fillna(0)
        f["content_views_4w"] = r4["content_views"].fillna(0)
        has_app = self.cust["has_app"].reindex(f.index).astype(bool)
        f["has_app"] = has_app.astype(int)
        f["app_sessions_4w"] = r4["app_sessions"].fillna(0).where(has_app, np.nan)
        cur = f["email_clicks_4w"] + f["site_visits_4w"] + f["content_views_4w"]
        prior = p4["email_clicks"] + p4["site_visits"] + p4["content_views"]
        f["engagement_change"] = cur - prior
        f["reviews_total"] = e.groupby("customer_id")["reviews"].sum().reindex(f.index).fillna(0)
        f["engagement_score"] = (100 * (0.35 * np.minimum(f["site_visits_4w"] / 4, 1)
                                        + 0.25 * f["email_open_rate_4w"].fillna(0)
                                        + 0.20 * np.minimum(f["email_clicks_4w"] / 2, 1)
                                        + 0.20 * np.minimum(f["content_views_4w"] / 3, 1))).round(1)

        t = self.T[self.T.created_at <= s].copy()
        t["open_at_s"] = t["resolved_at"].isna() | (t["resolved_at"] > s)
        t["neg"] = t["sentiment"] == "negative"
        t["neg90"] = t["neg"] & (t["created_at"] > s - pd.Timedelta(days=90))
        t["open_neg"] = t["open_at_s"] & t["neg"]
        tg = t.groupby("customer_id")
        f["n_tickets"] = tg.size().reindex(f.index).fillna(0)
        f["n_negative_tickets_90"] = tg["neg90"].sum().reindex(f.index).fillna(0)
        f["n_open_tickets"] = tg["open_at_s"].sum().reindex(f.index).fillna(0)
        f["n_open_negative_tickets"] = tg["open_neg"].sum().reindex(f.index).fillna(0)
        f["treatment_concerns"] = tg["medical_concern"].sum().reindex(f.index).fillna(0)
        f["days_since_ticket"] = (s - tg["created_at"].max()).dt.days.reindex(f.index)

        f["age_ord"] = self.cust["age_group"].map(AGE_ORD).reindex(f.index)
        ch = self.cust["channel"].reindex(f.index)
        for c_ in CHANNELS:
            f[f"ch_{c_}"] = (ch == c_).astype(int)
        for c_ in CATS:
            f[f"cat_{c_}"] = (f["last_category"] == c_).astype(int)
        f.index.name = "customer_id"
        return f

    def labelled(self, s, as_of):
        """Features for covered customers at s plus the churn label and its observation date."""
        s = pd.Timestamp(s)
        f = self.features(s)
        f = f[f["covered"]].copy()
        nxt = self.D[self.D.order_date > s].groupby("customer_id")["order_date"].min()
        f["next_order"] = nxt.reindex(f.index)
        renewed = f["next_order"].notna() & (f["next_order"] <= f["deadline"])
        f["label"] = (~renewed).astype(int)
        f["observed"] = f["deadline"] <= pd.Timestamp(as_of)
        f["snapshot"] = s
        return f
