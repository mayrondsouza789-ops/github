"""Churn model training and evaluation (chronological splits, calibration, explainability).

Churn definition (configurable): a customer who is still inside their product's replenishment window
(+ grace period) at snapshot date `s` is labelled churned if they place no delivered order before
`expected refill date + grace_days`. Each product has its own replenishment window, so there is no
single inactivity threshold. `horizon_days` limits training rows to customers whose outcome resolves
within that many days of the snapshot.
"""
import json
import pickle
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sklearn.ensemble import RandomForestClassifier  # noqa: E402
from sklearn.impute import SimpleImputer  # noqa: E402
from sklearn.isotonic import IsotonicRegression  # noqa: E402
from sklearn.linear_model import LogisticRegression  # noqa: E402
from sklearn.metrics import (average_precision_score, brier_score_loss, confusion_matrix,  # noqa: E402
                             f1_score, precision_score, recall_score, roc_auc_score)
from sklearn.pipeline import make_pipeline  # noqa: E402
from sklearn.preprocessing import StandardScaler  # noqa: E402
from xgboost import XGBClassifier  # noqa: E402
import xgboost as xgb  # noqa: E402

from app.config import AS_OF, DEFAULT_SETTINGS  # noqa: E402
from app.db import engine  # noqa: E402
from pipeline.features import FEATURES, FEATURE_LABELS, FEATURE_AVAILABILITY, Snapshotter, load_frames  # noqa: E402

MODEL_PATH = Path(__file__).resolve().parents[1] / "models" / "active.pkl"
T_VAL = pd.Timestamp("2026-06-01")
T_TEST = pd.Timestamp("2026-08-01")


class PlattCalibrator:
    """Sigmoid (Platt) calibration on the model's log-odds. Smoother than isotonic on modest validation sets."""

    def fit(self, raw, y):
        z = self._logit(raw).reshape(-1, 1)
        self.lr = LogisticRegression(C=1e6, max_iter=1000).fit(z, y)
        return self

    @staticmethod
    def _logit(p):
        p = np.clip(np.asarray(p, dtype=float), 1e-4, 1 - 1e-4)
        return np.log(p / (1 - p))

    def predict(self, raw):
        return np.clip(self.lr.predict_proba(self._logit(raw).reshape(-1, 1))[:, 1], 0.01, 0.97)


def clean(o):
    if isinstance(o, dict):
        return {str(k): clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating, float)):
        return None if (isinstance(o, float) and np.isnan(o)) or (isinstance(o, np.floating) and np.isnan(o)) else float(o)
    if isinstance(o, (np.bool_,)):
        return bool(o)
    if isinstance(o, (pd.Timestamp, datetime, date)):
        return o.isoformat()
    return o


def get_settings(cx=None):
    import sqlalchemy as sa
    out = dict(DEFAULT_SETTINGS)
    try:
        rows = pd.read_sql("select key, value from app_settings", engine)
        for k, v in zip(rows["key"], rows["value"]):
            out[k] = v
    except Exception:
        pass
    return out


def build_dataset(snap, as_of, horizon):
    snaps = pd.date_range("2026-01-10", pd.Timestamp(as_of) - pd.Timedelta(days=14), freq="14D")
    parts = []
    for s in snaps:
        f = snap.labelled(s, as_of)
        f = f[f["observed"] & ((f["deadline"] - s).dt.days <= horizon)]
        parts.append(f)
    ds = pd.concat(parts)
    ds["deadline_dt"] = ds["deadline"]
    return ds.reset_index()


def split(ds):
    tr = ds[(ds.snapshot < T_VAL) & (ds.deadline_dt < T_VAL)]                       # purge rows whose label resolves later
    va = ds[(ds.snapshot >= T_VAL) & (ds.snapshot < T_TEST) & (ds.deadline_dt < T_TEST)]
    te = ds[ds.snapshot >= T_TEST]
    return tr, va, te


def metrics_at(y, p, thr):
    pred = (p >= thr).astype(int)
    tn, fp, fn, tp = confusion_matrix(y, pred, labels=[0, 1]).ravel()
    return {"threshold": thr, "precision": float(precision_score(y, pred, zero_division=0)),
            "recall": float(recall_score(y, pred, zero_division=0)), "f1": float(f1_score(y, pred, zero_division=0)),
            "flagged_share": float(pred.mean()), "tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)}


def full_metrics(y, p, high_thr):
    y = np.asarray(y)
    order = np.argsort(-p)
    k = max(1, int(0.10 * len(y)))
    top = y[order][:k]
    base = y.mean()
    ece = calibration_table(y, p)["ece"]
    return {"n": int(len(y)), "positive_rate": float(base), "roc_auc": float(roc_auc_score(y, p)),
            "pr_auc": float(average_precision_score(y, p)), "brier": float(brier_score_loss(y, p)), "ece": float(ece),
            "at_0.5": metrics_at(y, p, 0.5), "at_high": metrics_at(y, p, high_thr),
            "top10": {"precision": float(top.mean()), "recall": float(top.sum() / max(y.sum(), 1)),
                      "lift": float(top.mean() / base) if base > 0 else None},
            "operating_points": [metrics_at(y, p, t) for t in (0.30, 0.45, 0.55, 0.65, 0.75)]}


def calibration_table(y, p, bins=10):
    y = np.asarray(y)
    q = pd.qcut(pd.Series(p).rank(method="first"), bins, labels=False)
    df = pd.DataFrame({"p": p, "y": y, "b": q.values})
    g = df.groupby("b").agg(pred=("p", "mean"), obs=("y", "mean"), n=("y", "size")).reset_index()
    ece = float((g["n"] * (g["pred"] - g["obs"]).abs()).sum() / g["n"].sum())
    return {"bins": g[["pred", "obs", "n"]].to_dict("records"), "ece": ece}


def make_models():
    return {
        "Logistic Regression": make_pipeline(SimpleImputer(strategy="median", add_indicator=True), StandardScaler(),
                                             LogisticRegression(C=0.5, max_iter=3000)),
        "Random Forest": make_pipeline(SimpleImputer(strategy="median", add_indicator=True),
                                       RandomForestClassifier(n_estimators=300, min_samples_leaf=25, max_depth=12,
                                                              n_jobs=-1, random_state=7)),
        "XGBoost": XGBClassifier(n_estimators=700, max_depth=4, learning_rate=0.04, subsample=0.8, colsample_bytree=0.8,
                                 min_child_weight=10, reg_lambda=2.0, eval_metric="aucpr", early_stopping_rounds=40,
                                 tree_method="hist", random_state=7, n_jobs=4),
    }


def contributions(name, model, X):
    """Per-row feature contributions to the model's log-odds (SHAP for trees, coef*value for logistic)."""
    if name == "XGBoost":
        booster = model.get_booster()
        c = booster.predict(xgb.DMatrix(X, feature_names=list(X.columns)), pred_contribs=True)
        return c[:, :-1]
    if name == "Random Forest":
        import shap
        imp = model.steps[0][1]
        Xi = imp.transform(X)
        sv = shap.TreeExplainer(model.steps[-1][1]).shap_values(Xi[:, :len(X.columns)])
        sv = sv[1] if isinstance(sv, list) else (sv[..., 1] if sv.ndim == 3 else sv)
        return np.asarray(sv)
    imp, sc, lr = model.steps[0][1], model.steps[1][1], model.steps[2][1]
    Z = sc.transform(imp.transform(X))
    return Z[:, :len(X.columns)] * lr.coef_[0][:len(X.columns)]


def predict_raw(name, model, X):
    return model.predict_proba(X)[:, 1]


def train(horizon=None, grace=None, as_of=AS_OF, verbose=True):
    settings = get_settings()
    horizon = horizon or settings["horizon_days"]
    grace = grace or settings["grace_days"]
    high_thr = settings["thresholds"]["high"]
    frames = load_frames(engine)
    snap = Snapshotter(frames, grace)
    ds = build_dataset(snap, as_of, horizon)
    tr, va, te = split(ds)
    if verbose:
        print(f"rows train={len(tr)} val={len(va)} test={len(te)}  positive rate "
              f"{tr.label.mean():.3f}/{va.label.mean():.3f}/{te.label.mean():.3f}")
    Xtr, ytr = tr[FEATURES], tr["label"].values
    Xva, yva = va[FEATURES], va["label"].values
    Xte, yte = te[FEATURES], te["label"].values

    results, fitted = {}, {}
    for name, m in make_models().items():
        if name == "XGBoost":
            m.fit(Xtr, ytr, eval_set=[(Xva, yva)], verbose=False)
        else:
            m.fit(Xtr, ytr)
        pv = predict_raw(name, m, Xva)
        pt = predict_raw(name, m, Xte)
        results[name] = {"val": full_metrics(yva, pv, high_thr), "test_raw": full_metrics(yte, pt, high_thr)}
        fitted[name] = m
        if verbose:
            print(f"{name:20s} val PR-AUC {results[name]['val']['pr_auc']:.3f} ROC {results[name]['val']['roc_auc']:.3f} | "
                  f"test PR-AUC {results[name]['test_raw']['pr_auc']:.3f} ROC {results[name]['test_raw']['roc_auc']:.3f}")

    best = max(results, key=lambda n: results[n]["val"]["pr_auc"])
    model = fitted[best]
    iso = PlattCalibrator()
    pv_raw = predict_raw(best, model, Xva)
    iso.fit(pv_raw, yva)
    pt = iso.predict(predict_raw(best, model, Xte))
    test_cal = full_metrics(yte, pt, high_thr)
    cal = calibration_table(yte, pt)
    cal_raw = calibration_table(yte, predict_raw(best, model, Xte))

    sample = te.sample(min(3000, len(te)), random_state=1)
    c = contributions(best, model, sample[FEATURES])
    imp = pd.DataFrame({"feature": FEATURES, "importance": np.abs(c).mean(axis=0)}).sort_values("importance", ascending=False)
    imp["label"] = imp["feature"].map(FEATURE_LABELS)
    importance = imp.head(15).to_dict("records")
    imp_total = float(imp["importance"].sum())
    for r in importance:
        r["share"] = float(r["importance"] / imp_total)

    comparison = {n: {"validation": results[n]["val"], "test": results[n]["test_raw"]} for n in results}
    now = datetime(2026, 11, 1, 21, 0)
    run = {"trained_at": now, "horizon_days": horizon, "grace_days": grace, "algorithm": best,
           "metrics": clean({"test": test_cal, "validation_raw": results[best]["val"],
                             "n_features": len(FEATURES), "notes": "Test metrics use sigmoid (Platt) calibrated probabilities. "
                             "Calibration was fitted on the validation period only."}),
           "comparison": clean(comparison),
           "calibration": clean({"calibrated": cal, "uncalibrated": cal_raw}),
           "feature_importance": clean(importance), "feature_availability": FEATURE_AVAILABILITY,
           "split_info": clean({"snapshot_cadence_days": 14, "train": f"snapshots before {T_VAL.date()} (rows whose label resolves after that are purged)",
                                "validation": f"{T_VAL.date()} to {(T_TEST - pd.Timedelta(days=1)).date()}",
                                "test": f"{T_TEST.date()} onward", "rows": {"train": len(tr), "validation": len(va), "test": len(te)},
                                "positive_rate": {"train": float(tr.label.mean()), "validation": float(va.label.mean()), "test": float(te.label.mean())},
                                "leakage_controls": ["Features use only data dated on or before the snapshot",
                                                     "Refunds count only once their refund date has passed",
                                                     "Tickets resolved after the snapshot count as open",
                                                     "Engagement weeks must have fully ended by the snapshot",
                                                     "Chronological split with purging; no random shuffle"]})}
    MODEL_PATH.parent.mkdir(exist_ok=True)
    pickle.dump({"name": best, "model": model, "iso": iso, "features": FEATURES, "grace": grace, "horizon": horizon},
                open(MODEL_PATH, "wb"))
    if verbose:
        print(f"selected {best}: test ROC {test_cal['roc_auc']:.3f} PR {test_cal['pr_auc']:.3f} brier {test_cal['brier']:.3f} "
              f"ECE {test_cal['ece']:.3f} top10 prec {test_cal['top10']['precision']:.2f} lift {test_cal['top10']['lift']:.2f}")
    return run


def save_run(run):
    from sqlalchemy import text
    from app import schema as S
    with engine.begin() as cx:
        cx.execute(text("update model_runs set is_active=false"))
        res = cx.execute(S.model_runs.insert().values(**run, is_active=True).returning(S.model_runs.c.id))
        return res.scalar()


if __name__ == "__main__":
    r = train()
    print(json.dumps(clean(r["metrics"]["test"]["top10"])))
