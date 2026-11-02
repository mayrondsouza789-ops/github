"""Relational schema (PostgreSQL). Defined with SQLAlchemy Core."""
from sqlalchemy import (MetaData, Table, Column, Integer, BigInteger, String, Float, Boolean,
                        Date, DateTime, Text, ForeignKey, Index, UniqueConstraint)
from sqlalchemy.dialects.postgresql import JSONB

metadata = MetaData()

users = Table("users", metadata,
    Column("id", Integer, primary_key=True),
    Column("email", String(120), unique=True, nullable=False),
    Column("name", String(80), nullable=False),
    Column("role", String(30), nullable=False),  # retention_manager | analyst | success_exec
    Column("password_hash", String(200), nullable=False),
    Column("is_active", Boolean, default=True))

products = Table("products", metadata,
    Column("id", Integer, primary_key=True),
    Column("sku", String(20), unique=True),
    Column("name", String(120)),
    Column("category", String(40)),
    Column("price", Float),
    Column("days_supply", Integer))

customers = Table("customers", metadata,
    Column("id", Integer, primary_key=True),
    Column("customer_code", String(20), unique=True, nullable=False),
    Column("display_name", String(60)),
    Column("email_masked", String(80)),
    Column("age_group", String(10)),
    Column("channel", String(30)),
    Column("registered_at", Date),
    Column("first_purchase_date", Date),
    Column("acquisition_category", String(40)),
    Column("has_app", Boolean),
    Column("is_synthetic", Boolean, default=True))

orders = Table("orders", metadata,
    Column("id", Integer, primary_key=True),
    Column("customer_id", Integer, ForeignKey("customers.id"), nullable=False),
    Column("order_date", Date, nullable=False),
    Column("status", String(12), nullable=False),  # delivered | cancelled
    Column("gross_amount", Float),
    Column("discount_amount", Float),
    Column("net_amount", Float),
    Column("refund_amount", Float, default=0),
    Column("refund_date", Date),
    Column("coupon_used", Boolean),
    Column("window_days", Integer),
    Index("ix_orders_customer_date", "customer_id", "order_date"))

order_items = Table("order_items", metadata,
    Column("id", Integer, primary_key=True),
    Column("order_id", Integer, ForeignKey("orders.id"), nullable=False, index=True),
    Column("product_id", Integer, ForeignKey("products.id")),
    Column("quantity", Integer),
    Column("unit_price", Float),
    Column("discount_amount", Float))

customer_engagement = Table("customer_engagement", metadata,
    Column("id", Integer, primary_key=True),
    Column("customer_id", Integer, ForeignKey("customers.id"), nullable=False, index=True),
    Column("week_start", Date),
    Column("emails_sent", Integer),
    Column("emails_opened", Integer),
    Column("email_clicks", Integer),
    Column("site_visits", Integer),
    Column("app_sessions", Integer),   # NULL when customer has no app
    Column("content_views", Integer),
    Column("reviews", Integer))

support_tickets = Table("support_tickets", metadata,
    Column("id", Integer, primary_key=True),
    Column("customer_id", Integer, ForeignKey("customers.id"), nullable=False, index=True),
    Column("created_at", Date),
    Column("category", String(40)),
    Column("sentiment", String(10)),
    Column("status", String(10)),
    Column("resolved_at", Date),
    Column("medical_concern", Boolean, default=False),
    Column("summary", String(200)))

campaigns = Table("campaigns", metadata,
    Column("id", Integer, primary_key=True),
    Column("name", String(120)),
    Column("campaign_type", String(40)),
    Column("channel", String(30)),
    Column("start_date", Date),
    Column("end_date", Date),
    Column("unit_cost", Float),
    Column("description", Text),
    Column("is_simulated", Boolean, default=True))

campaign_targets = Table("campaign_targets", metadata,
    Column("id", Integer, primary_key=True),
    Column("campaign_id", Integer, ForeignKey("campaigns.id"), index=True),
    Column("customer_id", Integer, ForeignKey("customers.id"), index=True),
    Column("send_date", Date),
    Column("grp", String(10)),   # treatment | control
    Column("delivered", Boolean),
    Column("clicked", Boolean),
    Column("reordered", Boolean),
    Column("revenue_14d", Float))

model_runs = Table("model_runs", metadata,
    Column("id", Integer, primary_key=True),
    Column("trained_at", DateTime),
    Column("horizon_days", Integer),
    Column("grace_days", Integer),
    Column("algorithm", String(40)),
    Column("metrics", JSONB),
    Column("comparison", JSONB),
    Column("calibration", JSONB),
    Column("feature_importance", JSONB),
    Column("feature_availability", JSONB),
    Column("split_info", JSONB),
    Column("is_active", Boolean, default=True))

churn_predictions = Table("churn_predictions", metadata,
    Column("id", Integer, primary_key=True),
    Column("customer_id", Integer, ForeignKey("customers.id"), nullable=False),
    Column("prediction_date", Date, nullable=False),
    Column("model_run_id", Integer, ForeignKey("model_runs.id")),
    Column("churn_probability", Float),
    Column("risk_category", String(10)),
    Column("prev_probability", Float),
    Column("risk_trend", String(10)),
    Column("expected_replenishment_date", Date),
    Column("deadline_date", Date),
    Column("days_overdue", Integer),
    Column("engagement_score", Float),
    Column("expected_90d_revenue", Float),
    Column("top_factors", JSONB),
    Column("primary_reason", String(80)),
    Column("recommendation", JSONB),
    UniqueConstraint("customer_id", "prediction_date", name="uq_pred_customer_date"),
    Index("ix_pred_date_risk", "prediction_date", "risk_category"))

customer_segments = Table("customer_segments", metadata,
    Column("customer_id", Integer, ForeignKey("customers.id"), primary_key=True),
    Column("segment", String(30)),
    Column("lifecycle_stage", String(30)),
    Column("assigned_on", Date))

customer_summary = Table("customer_summary", metadata,
    Column("customer_id", Integer, ForeignKey("customers.id"), primary_key=True),
    Column("total_orders", Integer),
    Column("total_revenue", Float),
    Column("avg_order_value", Float),
    Column("orders_per_month", Float),
    Column("avg_gap_days", Float),
    Column("last_purchase_date", Date),
    Column("days_since_last", Integer),
    Column("products_purchased", Text),
    Column("primary_category", String(40)),
    Column("status", String(12)),   # active | lapsed
    Column("engagement_score", Float),
    Column("churn_probability", Float),
    Column("risk_category", String(10)),
    Column("expected_replenishment_date", Date),
    Column("segment", String(30)),
    Column("lifecycle_stage", String(30)),
    Column("search_text", Text))

retention_interventions = Table("retention_interventions", metadata,
    Column("id", Integer, primary_key=True),
    Column("customer_id", Integer, ForeignKey("customers.id"), nullable=False, index=True),
    Column("created_at", Date),
    Column("created_by", String(60)),
    Column("risk_category", String(10)),
    Column("churn_probability", Float),
    Column("reason", String(120)),
    Column("scenario", String(40)),
    Column("recommended_action", Text),
    Column("rationale", Text),
    Column("assigned_to", Integer, ForeignKey("users.id")),
    Column("due_date", Date),
    Column("status", String(20)),
    Column("source", String(20)),   # history | model_queue | manual
    Column("campaign_id", Integer))

intervention_events = Table("intervention_events", metadata,
    Column("id", Integer, primary_key=True),
    Column("intervention_id", Integer, ForeignKey("retention_interventions.id"), index=True),
    Column("event_at", DateTime),
    Column("actor", String(60)),
    Column("event_type", String(30)),
    Column("detail", Text))

intervention_outcomes = Table("intervention_outcomes", metadata,
    Column("intervention_id", Integer, ForeignKey("retention_interventions.id"), primary_key=True),
    Column("evaluated_on", Date),
    Column("observed_outcome", String(30)),   # Resumed purchasing | Remained active | Churned | Pending
    Column("days_to_reorder", Integer),
    Column("revenue_after_30d", Float))

app_settings = Table("app_settings", metadata,
    Column("key", String(40), primary_key=True),
    Column("value", JSONB))
