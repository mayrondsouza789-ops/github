"""Outcome maturity, later-order reconciliation and capacity checks."""
import copy
import unittest

from .outcomes import audit


class OutcomeAuditTest(unittest.TestCase):
    def setUp(self):
        self.frozen = {
            "asOf": "2026-01-01", "synthetic": True,
            "model": {"version": "fixture", "horizon": 30, "grace": 14},
            "products": [{"id": 0, "cycle": 30}],
            "orders": [{"id": 9, "customer": 1, "product": 0, "date": "2025-12-02", "status": "completed"}],
            "customers": [
                {"id": i, "code": str(i), "probability": p, "model_version": "fixture",
                 "prediction_timestamp": "2026-01-01", "coverage_end": deadline}
                for i, p, deadline in [(1, .8, "2026-01-15"), (2, .4, "2026-01-07"), (3, 0, "2026-01-31")]
            ],
        }
        self.later = copy.deepcopy(self.frozen)
        self.later["asOf"] = "2026-02-01"
        self.later["orders"].extend([
            {"id": 10, "customer": 2, "product": 0, "date": "2026-01-07", "status": "completed"},
            {"id": 11, "customer": 1, "product": 0, "date": "2026-01-20", "status": "completed"},
        ])

    def test_mature_scores_and_recovery_after_lapse(self):
        result = audit(self.frozen, self.later)
        self.assertEqual(result["all_scored"]["observed_lapses"], 1)
        self.assertEqual(result["coverage_expires_in_window"]["customers"], 2)
        self.assertEqual(result["all_scored"]["top_20_percent"]["precision"], 1.0)
        self.assertAlmostEqual(result["all_scored"]["expected_lapses"], 1.2)

    def test_maturity_includes_the_last_observation_day(self):
        self.later["asOf"] = "2026-01-31"
        result = audit(self.frozen, self.later)
        self.assertEqual(result["first_complete_as_of"], "2026-02-01")
        self.assertNotIn("all_scored", result)

    def test_partial_extract_cannot_count_as_a_lapse(self):
        self.later["orders"].pop(0)
        with self.assertRaisesRegex(ValueError, "reconcile|Reconcile"):
            audit(self.frozen, self.later)

    def test_scores_keep_their_model_version(self):
        self.frozen["customers"][0]["model_version"] = "other"
        with self.assertRaisesRegex(ValueError, "version"):
            audit(self.frozen, self.later)


if __name__ == "__main__":
    unittest.main()
