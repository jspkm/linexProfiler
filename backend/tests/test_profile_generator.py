"""Unit tests for the Profile Generator engine."""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from datetime import datetime, timedelta
import numpy as np
import pandas as pd
import pytest

from models.transaction import Transaction, UserTransactions
from models.profile_catalog import (
    ScalingParams, CanonicalProfile, ProfileCatalog, TransitionMatrix,
)
from profile_generator.feature_derivation import derive_user_features, derive_batch_features
from profile_generator.feature_derivation import (
    FEATURE_NAMES, CORE_AXES, CORE_FEATURE_NAMES, AUXILIARY_FEATURE_NAMES,
)
from profile_generator.feature_transform import detect_and_transform, normalize, fit_transform
from profile_generator.trainer import train_profiles
from profile_generator.assigner import assign_profile
from profile_generator.simulator import run_simulation


def _make_txns(amounts, days_offsets, cid="test_user"):
    """Helper to create UserTransactions from amounts and day offsets."""
    base = datetime(2024, 1, 1)
    txns = []
    for amt, offset in zip(amounts, days_offsets):
        txns.append(Transaction(
            date=base + timedelta(days=offset),
            description=f"product_{offset}",
            amount=amt,
            quantity=1,
        ))
    return UserTransactions(customer_id=cid, transactions=txns)


# ---- Feature Derivation ----

class TestFeatureDerivation:
    def test_basic_features(self):
        txns = _make_txns([10.0, 20.0, 30.0], [0, 10, 20])
        fv = derive_user_features(txns)
        assert fv["total_spend"] == 60.0
        assert fv["avg_order_value"] == 20.0
        assert fv["max_order_value"] == 30.0
        assert fv["transaction_count"] == 3.0
        assert fv["unique_products"] == 3.0

    def test_cadence(self):
        txns = _make_txns([10.0, 20.0, 30.0], [0, 10, 20])
        fv = derive_user_features(txns)
        assert fv["cadence_mean"] == 10.0
        assert fv["cadence_std"] == 0.0

    def test_recency(self):
        txns = _make_txns([10.0], [0])
        eval_date = datetime(2024, 1, 31)
        fv = derive_user_features(txns, eval_date=eval_date)
        assert fv["recency_days"] == 30

    def test_cancellation_rate(self):
        txns = UserTransactions(
            customer_id="c1",
            transactions=[
                Transaction(date=datetime(2024, 1, 1), description="a", amount=10.0),
                Transaction(date=datetime(2024, 1, 2), description="b", amount=20.0),
                Transaction(date=datetime(2024, 1, 3), description="c", amount=-5.0, invoice="C123"),
            ],
        )
        fv = derive_user_features(txns)
        assert abs(fv["cancellation_rate"] - 1 / 3) < 0.01

    def test_batch_features(self):
        users = {
            "u1": _make_txns([10, 20], [0, 5]),
            "u2": _make_txns([100, 200], [0, 30]),
        }
        df = derive_batch_features(users)
        assert len(df) == 2
        assert "u1" in df.index
        assert "u2" in df.index
        assert df.loc["u2", "total_spend"] > df.loc["u1", "total_spend"]


# ---- Feature Transform ----

class TestFeatureTransform:
    def test_log_transform_applied_to_skewed(self):
        # Create a heavily skewed column
        data = {"skewed": [1] * 90 + [1000, 5000, 10000]}
        df = pd.DataFrame(data)
        transformed, params = detect_and_transform(df, skew_threshold=2.0)
        assert params[0].transform == "log1p"

    def test_normal_not_transformed(self):
        np.random.seed(42)
        data = {"normal": np.random.normal(50, 10, 100)}
        df = pd.DataFrame(data)
        transformed, params = detect_and_transform(df, skew_threshold=2.0)
        assert params[0].transform == "none"

    def test_normalize_bounds(self):
        df = pd.DataFrame({"a": [0.0, 0.5, 1.0]})
        params = [ScalingParams(feature_name="a", transform="none", p5=0.0, p95=1.0)]
        norm = normalize(df, params)
        assert norm["a"].min() >= 0.0
        assert norm["a"].max() <= 10.0

    def test_fit_transform_output_range(self):
        users = {
            f"u{i}": _make_txns([float(i * 10 + j) for j in range(5)], list(range(5)))
            for i in range(20)
        }
        df = derive_batch_features(users)
        normalized, params = fit_transform(df)
        assert normalized.min().min() >= 0.0
        assert normalized.max().max() <= 10.0


# ---- Trainer ----

class TestTrainer:
    def test_train_basic(self):
        # Create 3 distinct clusters — columns must include core feature names
        np.random.seed(42)
        cols = list(CORE_FEATURE_NAMES) + ["aux_0"]
        rows = []
        for cluster, base in enumerate([0, 50, 100]):
            for _ in range(30):
                row = {c: base + np.random.normal(0, 1) for c in cols}
                rows.append(row)
        df = pd.DataFrame(rows, index=[f"u{i}" for i in range(90)])

        catalog = train_profiles(df, k=3, source="test")
        assert catalog.k == 3
        assert len(catalog.profiles) == 3
        assert catalog.version.startswith("v_")
        assert sum(p.population_share for p in catalog.profiles) == pytest.approx(1.0, abs=0.01)

    def test_profile_ordering(self):
        """Profiles should be ordered by descending economic value."""
        users = {}
        # High value users
        for i in range(30):
            users[f"high_{i}"] = _make_txns(
                [100 + np.random.normal(0, 5) for _ in range(20)],
                list(range(20)),
            )
        # Low value users
        for i in range(30):
            users[f"low_{i}"] = _make_txns(
                [5 + np.random.normal(0, 1) for _ in range(3)],
                [0, 30, 60],
            )
        df = derive_batch_features(users)
        catalog = train_profiles(df, k=2, source="test")
        # P0 should have higher total_spend centroid than P1
        assert catalog.profiles[0].centroid.get("total_spend", 0) >= catalog.profiles[1].centroid.get("total_spend", 0)


# ---- Assigner ----

class TestAssigner:
    def test_assign_known_cluster(self):
        """A user matching a cluster should get assigned to it with high confidence."""
        # Train profiles first
        np.random.seed(42)
        cols = list(CORE_FEATURE_NAMES) + ["aux_0"]
        rows = []
        for base in [0, 100]:
            for _ in range(30):
                rows.append({c: base + np.random.normal(0, 1) for c in cols})
        df = pd.DataFrame(rows, index=[f"u{i}" for i in range(60)])
        catalog = train_profiles(df, k=2, source="test")

        # Create a user that clearly belongs to one cluster
        high_txns = _make_txns([200] * 20, list(range(20)), cid="test_high")
        assignment = assign_profile(high_txns, catalog)
        assert assignment.profile_id in ["P0", "P1"]
        assert assignment.confidence > 0
        assert len(assignment.alternates) > 0


# ---- Transition Matrix ----

class TestTransitionMatrix:
    def test_rows_sum_to_one(self):
        """All rows in the transition matrix must sum to 1.0."""
        tm = TransitionMatrix(
            profile_ids=["P0", "P1", "P2"],
            matrix=[
                [0.5, 0.3, 0.2],
                [0.1, 0.7, 0.2],
                [0.3, 0.3, 0.4],
            ],
        )
        for row in tm.matrix:
            assert sum(row) == pytest.approx(1.0, abs=0.001)


# ---- Simulator ----

class TestSimulator:
    def test_identity_matrix(self):
        """With identity transition matrix, population should not change."""
        tm = TransitionMatrix(
            profile_ids=["P0", "P1", "P2"],
            matrix=[
                [1.0, 0.0, 0.0],
                [0.0, 1.0, 0.0],
                [0.0, 0.0, 1.0],
            ],
        )
        result = run_simulation([0.5, 0.3, 0.2], tm, periods=5)
        assert result.periods == 5
        # Check all periods have same population
        for vec in result.population_vectors:
            assert vec[0] == pytest.approx(0.5, abs=0.001)
            assert vec[1] == pytest.approx(0.3, abs=0.001)
            assert vec[2] == pytest.approx(0.2, abs=0.001)

    def test_convergence(self):
        """Population should converge toward steady state."""
        tm = TransitionMatrix(
            profile_ids=["P0", "P1"],
            matrix=[
                [0.9, 0.1],
                [0.2, 0.8],
            ],
        )
        result = run_simulation([1.0, 0.0], tm, periods=50)
        final = result.population_vectors[-1]
        # Should converge to [2/3, 1/3]
        assert final[0] == pytest.approx(2 / 3, abs=0.01)
        assert final[1] == pytest.approx(1 / 3, abs=0.01)

    def test_deterministic(self):
        """Simulation should produce deterministic results."""
        tm = TransitionMatrix(
            profile_ids=["P0", "P1"],
            matrix=[[0.7, 0.3], [0.4, 0.6]],
        )
        r1 = run_simulation([0.6, 0.4], tm, periods=3)
        r2 = run_simulation([0.6, 0.4], tm, periods=3)
        assert r1.population_vectors == r2.population_vectors

# ---- FR-2A: Behavioral Axes ----

class TestBehavioralAxes:
    def test_core_axes_count(self):
        """CORE_AXES must have exactly 4 dimensions."""
        assert len(CORE_AXES) == 4
        assert set(CORE_AXES.keys()) == {
            "activity_recency", "purchase_frequency",
            "spend_intensity", "refund_return",
        }

    def test_all_features_categorized(self):
        """Every feature in FEATURE_NAMES must appear in exactly one axis."""
        all_axis_features = []
        for features in CORE_AXES.values():
            all_axis_features.extend(features)
        assert set(all_axis_features) == set(FEATURE_NAMES)
        # No duplicates
        assert len(all_axis_features) == len(set(all_axis_features))

    def test_core_features_are_primary(self):
        """CORE_FEATURE_NAMES must be the first (primary) feature of each axis."""
        for axis_name, features in CORE_AXES.items():
            assert features[0] in CORE_FEATURE_NAMES, (
                f"Primary feature of {axis_name} not in CORE_FEATURE_NAMES"
            )

    def test_catalog_records_core_features(self):
        """Trained ProfileCatalog.core_feature_names must match CORE_FEATURE_NAMES."""
        users = {
            f"u{i}": _make_txns(
                [float(i * 10 + j) for j in range(5)], list(range(5))
            )
            for i in range(40)
        }
        df = derive_batch_features(users)
        catalog = train_profiles(df, k=3, source="test")
        assert set(catalog.core_feature_names) == set(CORE_FEATURE_NAMES)

    def test_centroids_contain_all_features(self):
        """Centroids must contain both core and auxiliary features."""
        users = {
            f"u{i}": _make_txns(
                [float(i * 10 + j) for j in range(5)], list(range(5))
            )
            for i in range(40)
        }
        df = derive_batch_features(users)
        catalog = train_profiles(df, k=3, source="test")
        for p in catalog.profiles:
            for feat in FEATURE_NAMES:
                assert feat in p.centroid, f"Profile {p.profile_id} missing {feat}"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
