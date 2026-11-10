"""Held-out probability, decision and outreach-capacity diagnostics."""
from math import ceil, sqrt

import numpy as np
from sklearn.metrics import (average_precision_score, brier_score_loss, confusion_matrix,
                             f1_score, precision_score, recall_score, roc_auc_score)


def wilson(hits, n):
    z = 1.96
    estimate = hits / n
    denominator = 1 + z*z/n
    centre = (estimate + z*z/(2*n)) / denominator
    half = z * sqrt(estimate*(1-estimate)/n + z*z/(4*n*n)) / denominator
    return [max(0., centre-half), min(1., centre+half)]


def capacities(y, p):
    ordering = np.argsort(-p, kind="stable")
    results = []
    for share in (.05, .10, .20):
        count = max(1, ceil(len(y)*share))
        hits = int(y[ordering[:count]].sum())
        precision = hits / count
        results.append(dict(fraction=share, count=count, hits=hits, precision=precision,
                            recall=hits/max(1, int(y.sum())),
                            lift=precision/float(y.mean()) if y.sum() else None,
                            precision_ci95=wilson(hits, count)))
    return results


def metrics(y, p, threshold):
    decision = p >= threshold
    queue = capacities(y, p)[-1]
    buckets = np.minimum((p*10).astype(int), 9)
    calibration = []
    for bucket in np.unique(buckets):
        mask = buckets == bucket
        calibration.append(dict(lower=bucket/10, upper=(bucket+1)/10, count=int(mask.sum()),
                                predicted=float(p[mask].mean()), observed=float(y[mask].mean())))
    return dict(population=len(y), positives=int(y.sum()), prevalence=float(y.mean()),
                threshold=float(threshold), accuracy=float(np.mean(decision == y)),
                brier=float(brier_score_loss(y,p)), pr_auc=float(average_precision_score(y,p)) if y.sum() else 0.,
                roc_auc=float(roc_auc_score(y,p)) if len(np.unique(y)) == 2 else None,
                precision=float(precision_score(y,decision,zero_division=0)),
                recall=float(recall_score(y,decision,zero_division=0)),
                f1=float(f1_score(y,decision,zero_division=0)),
                confusion=confusion_matrix(y,decision,labels=[0,1]).tolist(),
                calibration=[[b["predicted"],b["observed"]] for b in calibration],
                calibration_bins=calibration, lift=queue["lift"], capacity=queue["count"],
                precision_at_k=queue["precision"], recall_at_k=queue["recall"])


def uncertainty(y, current, challenger_baseline, draws=700):
    """One test snapshot per customer. Paired resampling preserves the model comparison."""
    rng = np.random.default_rng(42)
    records = []
    for _ in range(draws):
        indices = rng.integers(len(y), size=len(y))
        actual = y[indices]
        if np.unique(actual).size < 2:
            continue
        p, old = current[indices], challenger_baseline[indices]
        ap = average_precision_score(actual,p)
        brier = np.mean((actual-p)**2)
        records.append((ap,brier,ap-average_precision_score(actual,old),brier-np.mean((actual-old)**2)))
    if not records:
        return {}
    return dict(zip(("pr_auc","brier","pr_auc_delta_vs_incumbent","brier_delta_vs_incumbent"),
                    np.quantile(records,[.025,.975],axis=0).T.tolist()))
