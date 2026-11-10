"""Regression checks for cohort isolation, outcome boundaries and scoring contracts."""
from datetime import date, timedelta
from pathlib import Path
import json
import unittest

import numpy as np

from .prediction import FEATURES, history_features, lapse_observed, predict_probabilities
from .train_v3 import fresh_release_window, load_incumbent, partitions


class PredictionTest(unittest.TestCase):
    def test_changes_after_snapshot_do_not_enter_features(self):
        start = date(2026, 1, 1)
        products = {1: {"cycle": 30}}
        orders = [{"customer": 1, "product": 1, "date": "2025-12-24", "status": "completed"}]
        index = ({1: orders}, {}, {}, products)
        original, end = history_features({"id": 1}, start, index)
        orders.append({"customer": 1, "product": 1, "date": "2026-01-01", "status": "completed"})
        updated, updated_end = history_features({"id": 1}, start, index)
        np.testing.assert_allclose(original, updated, equal_nan=True)
        self.assertEqual(end, updated_end)

    def test_coverage_includes_the_entire_last_day(self):
        start, end = date(2026, 1, 1), date(2026, 1, 31)
        observed_before = date(2026, 2, 1)
        products = {1: {"cycle": 30}}
        self.assertFalse(lapse_observed([], end, start, 30, products, observed_before))
        self.assertTrue(lapse_observed([], end - timedelta(days=1), start, 30, products, observed_before))
        with self.assertRaisesRegex(ValueError, "matured"):
            lapse_observed([], end, start, 30, products, end)

    def test_partitions_have_distinct_people_and_mature_outcomes(self):
        stages = partitions(date(2025, 11, 2), date(2026, 11, 1))
        used = set()
        prior_end = date.min
        for name, dates, groups in stages:
            self.assertTrue(groups.isdisjoint(used), name)
            self.assertGreater(min(dates), prior_end, name)
            prior_end = max(dates) + timedelta(days=30)
            used.update(groups)
        self.assertEqual(stages[-1][1], [date(2026, 10, 1)])

    def test_active_v3_release_cannot_reuse_an_overlapping_holdout(self):
        prior = {"schema_version": 3, "horizon": 30, "evaluation": {"test_date": "2026-10-01"}}
        self.assertFalse(fresh_release_window(prior, date(2026, 10, 1)))
        self.assertFalse(fresh_release_window(prior, date(2026, 10, 31)))
        self.assertTrue(fresh_release_window(prior, date(2026, 11, 1)))

    def test_row_domain_and_known_zero(self):
        # The known-zero path can score this input without touching a learned estimator.
        row = np.array([30, 30, 14 / 30, 1, np.nan, np.nan, np.nan, 0, 0, 1, .5])
        metadata = {"features": FEATURES, "horizon": 30}
        np.testing.assert_equal(predict_probabilities(metadata, [row]), [0.])
        for name, invalid in [("order_count", 0), ("last_cycle_days", 0),
                              ("coverage_days", -1), ("purchases_90d", -2),
                              ("failed_order_fraction", 1.2), ("coverage_days", np.nan)]:
            bad = row.copy()
            bad[FEATURES.index(name)] = invalid
            with self.subTest(name=name), self.assertRaises(ValueError):
                predict_probabilities(metadata, [bad])

    def test_active_artifact_reproduces_published_scores(self):
        data = json.loads((Path(__file__).resolve().parents[1] / "dist/data.json").read_bytes())
        report = data["model"]
        if report.get("schema_version") != 3:
            self.skipTest("The active release uses legacy scoring")
        artifact = load_incumbent(report)
        active = [c for c in data["customers"] if c["probability"] is not None]
        matrix = [[c["features"][feature] for feature in FEATURES] for c in active]
        scores = predict_probabilities(artifact, matrix)
        np.testing.assert_allclose(scores, [c["probability"] for c in active], atol=.000000501, rtol=0.)
        self.assertEqual(len(active), report["scored"])
        self.assertTrue(all(c["model_version"] == report["version"] for c in active))


if __name__ == "__main__":
    unittest.main()
