"""Train, evaluate and explicitly promote the 30-day synthetic incident-inactivity model."""
import argparse
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import pickle
from tempfile import NamedTemporaryFile, TemporaryDirectory

import numpy as np
import sklearn
from sklearn.ensemble import GradientBoostingClassifier, HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, f1_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from threadpoolctl import threadpool_limits

from . import train_v2
from .model_evaluation import capacities, metrics, uncertainty
from .prediction import (FEATURES, FEATURE_INFO, GRACE_DAYS, history_features, lapse_observed,
                         log_odds, predict_probabilities)

ROOT = Path(__file__).resolve().parents[1]
RUNS = ROOT / "backend/runs"
HORIZON = 30
DAY = timedelta(days=1)


@dataclass
class Sample:
    X: np.ndarray
    y: np.ndarray
    customer_ids: list
    product_ids: np.ndarray
    dates: list

    def description(self, name):
        return dict(name=name, start=str(min(self.dates)), end=str(max(self.dates)), rows=len(self.y),
                    customers=len(set(self.customer_ids)), positives=int(self.y.sum()),
                    matured_through=str(max(self.dates) + HORIZON * DAY))


def partitions(first_order, asof):
    # Customers in the release partition were also excluded from v2 fitting and calibration.
    release = asof - (HORIZON+1)*DAY
    policy = release - (HORIZON+1)*DAY
    calibration_end = policy - (HORIZON+1)*DAY
    calibration = [calibration_end - n*DAY for n in (14,7,0)]
    selection_end = calibration[0] - (HORIZON+1)*DAY
    selection = [selection_end - n*DAY for n in (14,7,0)]
    training_end = selection[0] - (HORIZON+1)*DAY
    # Anchor the weekly schedule on its most recent allowed day.
    training = []
    pointer = training_end
    while pointer >= first_order + HORIZON*DAY:
        training.append(pointer)
        pointer -= 7*DAY
    if len(training) < 4:
        raise ValueError("Insufficient history for mature training and four later evaluation stages")
    return [("Training",list(reversed(training)),{0,1,2,5}),
            ("Selection",selection,{3,6}),("Calibration",calibration,{7}),
            ("Operating threshold",[policy],{8}),("Release test",[release],{4,9})]


def make_sample(data, index, dates, groups):
    X, y, ids, products, cutoffs = [], [], [], [], []
    asof = date.fromisoformat(data["asOf"])
    for when in dates:
        for c in data["customers"]:
            if c["id"] % 10 not in groups:
                continue
            row, expiry = history_features(c,when,index)
            if row is None or expiry < when:
                continue
            X.append(row)
            y.append(lapse_observed(index[0][c["id"]],expiry,when,HORIZON,index[3],asof))
            ids.append(c["id"])
            products.append(c["product"])
            cutoffs.append(when)
    sample = Sample(np.array(X),np.asarray(y,dtype=int),ids,np.array(products),cutoffs)
    if len(set(y)) < 2:
        raise ValueError("Each stage needs observed positive and negative outcomes")
    if np.any(sample.y[sample.X[:,0]>=HORIZON]):
        raise ValueError("Observed label conflicts with known refill coverage")
    return sample


def candidate_models():
    return {
        "Refill logistic regression": make_pipeline(SimpleImputer(add_indicator=True),StandardScaler(),
            LogisticRegression(C=.4,max_iter=1500,random_state=42)),
        "Refill gradient boosting": make_pipeline(SimpleImputer(add_indicator=True),
            GradientBoostingClassifier(n_estimators=100,learning_rate=.045,max_depth=2,
                                       min_samples_leaf=40,random_state=42)),
        "Refill histogram boosting": HistGradientBoostingClassifier(max_iter=90,learning_rate=.055,
            max_leaf_nodes=7,min_samples_leaf=50,l2_regularization=8.,random_state=42),
    }


def raw_scores(model, X):
    scores = np.zeros(len(X))
    possible = X[:,0] < HORIZON
    if possible.any():
        scores[possible] = model.predict_proba(X[possible])[:,1]
    return scores


def tune_threshold(y, probabilities):
    # Broad F1 is a classification policy. The outreach queue is ranked independently.
    candidates = np.linspace(.10,.90,81)
    return float(max(candidates, key=lambda threshold:
                     (f1_score(y,probabilities>=threshold,zero_division=0),threshold)))


def coverage_baseline(train, X):
    """A weekly days-to-deadline lookup with prior smoothing, trained on historical snapshots."""
    exposed = train.X[:,0] < HORIZON
    rate = float(train.y[exposed].mean())
    scores = np.zeros(len(X))
    for left in range(0,HORIZON,7):
        right = min(left+7,HORIZON)
        past = (train.X[:,0]>=left) & (train.X[:,0]<right)
        group = (X[:,0]>=left) & (X[:,0]<right)
        scores[group] = (train.y[past].sum()+10*rate)/(past.sum()+10)
    return scores


def load_incumbent(report):
    version = report.get("version", "")
    if Path(version).name != version or not version.startswith(("rr2-", "rr3-")):
        raise ValueError("The active report does not identify a supported registry version.")
    if report.get("horizon") != HORIZON or report.get("grace") != GRACE_DAYS:
        raise ValueError("Incumbent and candidate must use identical forecast horizons and grace periods.")
    model_path = RUNS / version / "model.pkl"
    if not model_path.is_file():
        raise ValueError(f"Active model artifact is missing: {version}")
    blob = model_path.read_bytes()
    if report.get("artifact_sha256") and hashlib.sha256(blob).hexdigest() != report["artifact_sha256"]:
        raise ValueError("Active model artifact failed the recorded integrity check.")
    incumbent = pickle.loads(blob)
    if (incumbent.get("version") != version or incumbent.get("horizon") != HORIZON or
            incumbent.get("features") != report.get("features")):
        raise ValueError("Active model artifact and published report disagree.")
    expected_features = FEATURES if version.startswith("rr3-") else train_v2.FEATURES
    if incumbent["features"] != expected_features:
        raise ValueError(f"Unsupported incumbent feature schema for {version}.")
    return incumbent


def fresh_release_window(report, release):
    if report.get("schema_version") == 3:
        prior = report["evaluation"]
        last = date.fromisoformat(prior["test_date"]) + timedelta(days=report["horizon"])
        return release > last
    # V2 recorded a single evaluation cutoff with a different reporting schema.
    return release > date.fromisoformat(report["splitDates"][-1])


def incumbent_scores(data, index, sample, incumbent):
    if incumbent.get("schema_version") == 3:
        return predict_probabilities(incumbent, sample.X)
    customers = {c["id"]:c for c in data["customers"]}
    rows = [train_v2.snapshot(customers[cid],when,index)[0] for cid,when in zip(sample.customer_ids,sample.dates)]
    raw = incumbent["model"].predict_proba(rows)[:,1,None]
    return incumbent["calibrator"].predict_proba(raw)[:,1]


def dataset_id(data):
    # Exclude prediction outputs so re-scoring the same raw records preserves provenance.
    source = {key:data[key] for key in ("asOf","products","orders","engagements","tickets")}
    source["customers"] = sorted((c["id"],c["product"]) for c in data["customers"])
    encoded = json.dumps(source,sort_keys=True,separators=(",",":"),allow_nan=False).encode()
    return hashlib.sha256(encoded).hexdigest()


def validate(data):
    issues = train_v2.validate(data)
    asof = date.fromisoformat(data["asOf"])
    ids = {c["id"] for c in data["customers"]}
    products = {p["id"] for p in data["products"]}
    if len(products) != len(data["products"]) or any(c["product"] not in products for c in data["customers"]):
        issues.append("Invalid customer/product catalog")
    for kind in ("tickets","engagements"):
        if any(row["customer"] not in ids or date.fromisoformat(row["date"]) >= asof for row in data[kind]):
            issues.append(f"Invalid customer or observation date in {kind}")
    if any(not np.isfinite(o["amount"]) for o in data["orders"]):
        issues.append("Non-finite order amount")
    if issues:
        raise ValueError("Source quality check failed: "+", ".join(issues))


def score_current(data, index, artifact, train, report):
    when = date.fromisoformat(data["asOf"])
    eligible, rows = [], []
    for customer in data["customers"]:
        row, end = history_features(customer,when,index)
        remaining = (end-when).days if end is not None else None
        customer.update(commercial_status="No completed orders" if end is None else "Inactive" if remaining<0 else "Active",
                        probability=None,risk="Unscored",features=None,contributions=[],
                        coverage_days=remaining,coverage_end=str(end) if end else None,
                        prediction_timestamp=str(when),model_version=artifact["version"])
        if remaining is None:
            customer["score_reason"] = "no_purchase"
        elif remaining < 0:
            customer["score_reason"] = "already_inactive"
        else:
            customer["score_reason"] = "covered_through_horizon" if remaining>=HORIZON else "model"
            eligible.append(customer)
            rows.append(row)
    X = np.asarray(rows,dtype=float).reshape(-1,len(FEATURES))
    probabilities = predict_probabilities(artifact,X)
    effects = np.zeros((len(X),len(FEATURES)))
    for j, median in enumerate(artifact["median"]):
        changed = X.copy()
        changed[:,j] = median
        effects[:,j] = probabilities-predict_probabilities(artifact,changed)
    for i, customer in enumerate(eligible):
        score = round(float(probabilities[i]),6)
        customer["probability"] = score
        customer["risk"] = "Critical" if score>=.8 else "High" if score>=.6 else "Medium" if score>=.35 else "Low"
        values = {feature:None if np.isnan(X[i,j]) else float(X[i,j]) for j,feature in enumerate(FEATURES)}
        customer["features"] = values
        if customer["score_reason"] == "model":
            ranked = np.argsort(-np.abs(effects[i]),kind="stable")
            customer["contributions"] = [dict(feature=FEATURES[j],effect=round(float(effects[i,j]),6),
                                                  value=values[FEATURES[j]]) for j in ranked[:3]
                                             if abs(effects[i,j])>=.0005]
    report["scored"] = len(eligible)
    counts = {reason:sum(c["score_reason"]==reason for c in data["customers"])
              for reason in ("model","covered_through_horizon","already_inactive","no_purchase")}
    report["population_counts"] = counts
    report["monitoring"] = []
    for j, feature in enumerate(FEATURES):
        observed = X[:,j][np.isfinite(X[:,j])]
        historic = train.X[:,j][np.isfinite(train.X[:,j])]
        shift = (float(abs(observed.mean()-historic.mean())/max(.01,historic.std()))
                 if len(observed) and len(historic) else 0.)
        report["monitoring"].append(dict(feature=feature,missing_rate=float(1-len(observed)/max(1,len(X))),
                                         standardised_shift=shift))
    rng = np.random.default_rng(42)
    totals = [rng.binomial(1,probabilities,size=(100,len(X))).sum(axis=1) for _ in range(20)]
    lower, upper = np.quantile(np.concatenate(totals),[.025,.975])
    report["forecast"] = dict(expected=float(probabilities.sum()),lower=float(lower),upper=float(upper),
                              method="95% interval over independent customer outcomes conditional on these scores. Shared shocks, parameter uncertainty and domain shift are outside the interval.")


@contextmanager
def promotion_lock():
    # OS locks are released on process exit, including after an interrupted promotion.
    path = ROOT / "backend" / ".promotion.lock"
    with path.open("a+b") as handle:
        if os.name == "nt":
            import msvcrt
            if handle.tell() == 0:
                handle.write(b"0")
                handle.flush()
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
            try:
                yield
            finally:
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def write_promoted(data, previous_digest):
    # This one document atomically switches the public scores, report and serving artifact pointer.
    destination = ROOT/"dist/data.json"
    with NamedTemporaryFile("w",encoding="utf8",dir=destination.parent,delete=False) as handle:
        temporary = Path(handle.name)
        try:
            json.dump(data,handle,separators=(",",":"),allow_nan=False)
            handle.flush()
            os.fsync(handle.fileno())
        except Exception:
            handle.close()
            temporary.unlink(missing_ok=True)
            raise
    try:
        with promotion_lock():
            if hashlib.sha256(destination.read_bytes()).digest() != previous_digest:
                raise RuntimeError("The active workspace changed during training. Evaluate against the new release.")
            os.replace(temporary,destination)
    finally:
        temporary.unlink(missing_ok=True)


def train_and_evaluate(promote=False):
    original = (ROOT/"dist/data.json").read_bytes()
    previous_digest = hashlib.sha256(original).digest()
    data = json.loads(original)
    validate(data)
    incumbent_report = data["model"]
    incumbent_artifact = load_incumbent(incumbent_report)
    source_id = dataset_id(data)
    index = train_v2.build(data)
    asof = date.fromisoformat(data["asOf"])
    oldest = date.fromisoformat(min(o["date"] for o in data["orders"]))
    plans = partitions(oldest,asof)
    fresh_window = fresh_release_window(incumbent_report, plans[-1][1][0])
    if promote and not fresh_window:
        raise RuntimeError("The release evaluation overlaps a previously evaluated outcome window. "
                           "Use a later fully observed snapshot for promotion, or omit --promote to replay the benchmark.")
    train, select, calibrate, operate = [make_sample(data,index,dates,groups) for _,dates,groups in plans[:-1]]
    exposed = train.X[:,0] < HORIZON
    models = candidate_models()
    selection = {}
    with threadpool_limits(limits=1):
        for name,model in models.items():
            model.fit(train.X[exposed],train.y[exposed])
            probability = raw_scores(model,select.X)
            selection[name] = float(average_precision_score(select.y,probability))
    best = max(selection,key=selection.get)
    model = models[best]
    possible = calibrate.X[:,0]<HORIZON
    # Calibrate only uncertain outcomes; the coverage rule remains exactly zero.
    calibrator = LogisticRegression(C=1.,random_state=42).fit(
        log_odds(raw_scores(model,calibrate.X[possible])),calibrate.y[possible])
    if calibrator.coef_[0,0] <= 0:
        raise ValueError("Calibration reverses risk ranking; investigate the training data")
    timestamp = datetime.now(timezone.utc)
    version = "rr3-"+timestamp.strftime("%Y%m%dT%H%M%S%fZ")
    artifact = dict(schema_version=3,version=version,features=FEATURES,model=model,calibrator=calibrator,
                    median=np.nanmedian(train.X[exposed],axis=0),horizon=HORIZON,grace=GRACE_DAYS)
    threshold = tune_threshold(operate.y,predict_probabilities(artifact,operate.X))
    artifact["threshold"] = threshold
    # Candidate, coefficients and threshold are frozen before release labels are opened.
    test = make_sample(data,index,plans[-1][1],plans[-1][2])
    p = predict_probabilities(artifact,test.X)
    old = incumbent_scores(data,index,test,incumbent_artifact)
    baseline = coverage_baseline(train,test.X)
    y = test.y
    result = metrics(y,p,threshold)
    incumbent_threshold = incumbent_report["threshold"]
    incumbent = metrics(y,old,incumbent_threshold)
    baseline_threshold = tune_threshold(operate.y,coverage_baseline(train,operate.X))
    rule = metrics(y,baseline,baseline_threshold)
    actionable = test.X[:,0]<HORIZON
    gate = {
        "fresh_release_window": fresh_window,
        "pr_auc_vs_incumbent": result["pr_auc"] >= incumbent["pr_auc"],
        "brier_vs_incumbent": result["brier"] <= incumbent["brier"],
        "pr_auc_vs_coverage_baseline": result["pr_auc"] >= rule["pr_auc"],
        "brier_vs_coverage_baseline": result["brier"] <= rule["brier"],
    }
    splits = [sample.description(plan[0]) for sample,plan in zip(
        (train,select,calibrate,operate,test),plans)]
    threshold_policy = "Maximum F1 on the separate operating-threshold cohort. Ties prefer higher precision via the higher threshold. Outreach lists use ranked capacity."
    evaluation = dict(test_date=str(test.dates[0]),prevalence=float(y.mean()),incumbent=incumbent,
                      incumbent_version=incumbent_report["version"],baseline=rule,
                      baseline_name="Historical rate by week of remaining coverage",
                      capacity=capacities(y,p),confidence=uncertainty(y,p,old),splits=splits,
                      threshold_policy=threshold_policy,gate=gate,
                      actionable=dict(current=metrics(y[actionable],p[actionable],threshold),
                                      incumbent=metrics(y[actionable],old[actionable],incumbent_threshold),
                                      baseline=metrics(y[actionable],baseline[actionable],baseline_threshold),
                                      confidence=uncertainty(y[actionable],p[actionable],old[actionable])),
                      capacity_ties="Stable source customer order",bootstrap_draws=700)
    report = dict(schema_version=3,version=version,selected=best,trained=timestamp.isoformat(),
                  dataset_version=source_id,horizon=HORIZON,grace=GRACE_DAYS,threshold=threshold,
                  features=FEATURES,feature_info={f:dict(label=v[0],unit=v[1]) for f,v in FEATURE_INFO.items()},
                  metrics={best:result},validation=selection,evaluation=evaluation,
                  splitDates=[s["end"] for s in splits],splitCounts=[s["rows"] for s in splits],
                  target="First refill-coverage lapse within 30 days among active purchasers, using the last completed product’s cycle plus 14 days of grace.",
                  explanation="Each effect is the score difference when one feature is replaced by its training median. Related refill features can share information. These are model sensitivities.",
                  unavailable=["Real customer outcomes","Intervention lift","SKU and pack size","Concurrent treatment coverage","Subscription status"],
                  accepted=all(gate.values()),quality=dict(issues=[],orders=len(data["orders"]),customers=len(data["customers"])),
                  sklearn_version=sklearn.__version__,subgroups=[])
    for product in data["products"]:
        mask = test.product_ids == product["id"]
        if mask.any():
            report["subgroups"].append(dict(product=product["name"],**metrics(y[mask],p[mask],threshold)))
    score_current(data,index,artifact,train,report)
    run = RUNS / version
    # Stage on the same filesystem outside the list-runs glob, then expose both files at once.
    with TemporaryDirectory(dir=RUNS.parent, prefix=".candidate-") as staging:
        pending = Path(staging)
        model_blob = pickle.dumps(artifact, protocol=5)
        (pending / "model.pkl").write_bytes(model_blob)
        report["artifact_sha256"] = hashlib.sha256(model_blob).hexdigest()
        (pending / "report.json").write_text(json.dumps(report,indent=2,allow_nan=False),encoding="utf8")
        pending.rename(run)
    if promote:
        if not report["accepted"]:
            raise RuntimeError(f"Release gate failed. Current deployment retained. Inspect {run}/report.json")
        data["model"] = report
        write_promoted(data,previous_digest)
    print(json.dumps(dict(version=version,selected=best,accepted=report["accepted"],promoted=promote,
                          gates=gate,pr_auc=result["pr_auc"],previous_ap=incumbent["pr_auc"],
                          brier=result["brier"],previous_brier=incumbent["brier"])))
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--promote",action="store_true",help="Publish this candidate only if all release gates pass")
    with threadpool_limits(limits=1):
        train_and_evaluate(parser.parse_args().promote)
