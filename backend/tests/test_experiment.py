"""Unit tests for experiment convergence-based iteration and incentive filtering."""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import time
import threading
from datetime import datetime
from unittest.mock import patch, MagicMock

import pytest

from models.profile_catalog import CanonicalProfile, ProfileCatalog
from profile_generator.experiment import (
    INCENTIVES,
    _INCENTIVE_COST_MAP,
    ProfileIncentiveEvaluation,
    ExperimentState,
    ExperimentResult,
    evaluate_incentive_bundle,
    _enforce_baseline,
    _run_experiment_thread,
    start_experiment,
    get_experiment_status,
    _experiments,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_profile(pid="P0", ltv=500.0, pop=1000) -> CanonicalProfile:
    return CanonicalProfile(
        profile_id=pid,
        label="Test Profile",
        centroid={"recency_days": 5.0, "transaction_count": 50.0},
        population_share=0.5,
        population_count=pop,
        description="A test profile",
        ltv=ltv,
        portfolio_ltv=ltv * pop,
    )


def _make_catalog(profiles=None, version="v_test_123") -> ProfileCatalog:
    if profiles is None:
        profiles = [_make_profile()]
    return ProfileCatalog(
        version=version,
        k=len(profiles),
        profiles=profiles,
        source="test",
    )


def _make_eval(profile_id="P0", net_ltv=600.0, cost=50.0, incentives=None):
    """Build a ProfileIncentiveEvaluation with given net_ltv."""
    gross = net_ltv + cost
    return ProfileIncentiveEvaluation(
        profile_id=profile_id,
        selected_incentives=incentives or ["2% flat cash back"],
        gross_ltv=gross,
        estimated_cost=cost,
        net_ltv=net_ltv,
        reasoning="test",
    )


# ---------------------------------------------------------------------------
# Incentive cost map
# ---------------------------------------------------------------------------

class TestIncentiveCostMap:
    def test_effective_cost_formula(self):
        """Effective cost = annual_cost * redemption_rate for every incentive."""
        for inc in INCENTIVES:
            name = inc["name"]
            expected = round(inc["estimated_annual_cost_per_user"] * inc["redemption_rate"], 2)
            assert _INCENTIVE_COST_MAP[name] == expected, (
                f"{name}: expected {expected}, got {_INCENTIVE_COST_MAP[name]}"
            )

    def test_all_incentives_in_map(self):
        """Every incentive must appear in the cost map."""
        for inc in INCENTIVES:
            assert inc["name"] in _INCENTIVE_COST_MAP

    def test_auto_applied_fee_waivers_full_cost(self):
        """Fee waivers with redemption_rate=1.0 should have effective cost == annual cost."""
        for inc in INCENTIVES:
            if inc["redemption_rate"] == 1.0:
                assert _INCENTIVE_COST_MAP[inc["name"]] == inc["estimated_annual_cost_per_user"]


# ---------------------------------------------------------------------------
# Programmatic filter (evaluate_incentive_bundle)
# ---------------------------------------------------------------------------

class TestEvaluateIncentiveBundle:
    """Tests for the LLM call + programmatic net-positive filter."""

    def test_no_gemini_returns_baseline(self):
        """Without a Gemini client, should return baseline LTV with no incentives."""
        profile = _make_profile(ltv=500.0)
        with patch("profile_generator.experiment._gemini", None):
            result = evaluate_incentive_bundle(profile)
        assert result.net_ltv == 500.0
        assert result.selected_incentives == []
        assert result.estimated_cost == 0.0

    def test_keeps_net_positive_incentives(self):
        """Incentives where marginal_ltv > effective cost should be kept."""
        profile = _make_profile(ltv=500.0)
        # Pick an incentive with known effective cost
        inc_name = "2% flat cash back"
        eff_cost = _INCENTIVE_COST_MAP[inc_name]  # 60 * 0.95 = 57.0

        mock_response = MagicMock()
        mock_response.text = (
            '{"selected_incentives": [{"name": "' + inc_name + '", "marginal_ltv": 100.0}], '
            '"gross_ltv": 600.0, "estimated_cost": 57.0, "net_ltv": 543.0, '
            '"reasoning": "Good match"}'
        )
        mock_client = MagicMock()
        mock_client.models.generate_content.return_value = mock_response

        with patch("profile_generator.experiment._gemini", mock_client):
            result = evaluate_incentive_bundle(profile)

        assert inc_name in result.selected_incentives
        assert result.net_ltv > profile.ltv  # must beat baseline
        assert result.estimated_cost == eff_cost

    def test_drops_net_negative_incentives(self):
        """Incentives where marginal_ltv <= effective cost should be dropped."""
        profile = _make_profile(ltv=500.0)
        inc_name = "Complimentary Airport Lounge Access"
        eff_cost = _INCENTIVE_COST_MAP[inc_name]  # 150 * 0.18 = 27.0

        # Return marginal_ltv lower than effective cost
        mock_response = MagicMock()
        mock_response.text = (
            '{"selected_incentives": [{"name": "' + inc_name + '", "marginal_ltv": 5.0}], '
            '"gross_ltv": 505.0, "estimated_cost": 27.0, "net_ltv": 478.0, '
            '"reasoning": "Low usage"}'
        )
        mock_client = MagicMock()
        mock_client.models.generate_content.return_value = mock_response

        with patch("profile_generator.experiment._gemini", mock_client):
            result = evaluate_incentive_bundle(profile)

        assert inc_name not in result.selected_incentives
        assert result.estimated_cost == 0.0
        assert result.net_ltv == profile.ltv  # back to baseline (no kept incentives)

    def test_mixed_bundle_partial_keep(self):
        """A bundle with some good and some bad incentives should keep only the good."""
        profile = _make_profile(ltv=500.0)
        good_name = "2% flat cash back"       # eff cost 57.0
        bad_name = "Complimentary CLEAR membership"  # eff cost 189*0.08 = 15.12

        mock_response = MagicMock()
        mock_response.text = (
            '{"selected_incentives": ['
            '{"name": "' + good_name + '", "marginal_ltv": 100.0},'
            '{"name": "' + bad_name + '", "marginal_ltv": 5.0}'
            '], "gross_ltv": 605.0, "estimated_cost": 72.12, "net_ltv": 532.88, '
            '"reasoning": "Mixed"}'
        )
        mock_client = MagicMock()
        mock_client.models.generate_content.return_value = mock_response

        with patch("profile_generator.experiment._gemini", mock_client):
            result = evaluate_incentive_bundle(profile)

        assert good_name in result.selected_incentives
        assert bad_name not in result.selected_incentives
        assert "Dropped net-negative" in result.reasoning


# ---------------------------------------------------------------------------
# Baseline enforcement
# ---------------------------------------------------------------------------

class TestEnforceBaseline:
    def test_keeps_positive_bundle(self):
        """If net_ltv >= baseline, bundle should be kept as-is."""
        evaluation = _make_eval(net_ltv=600.0, cost=50.0)
        result = _enforce_baseline(evaluation, baseline_ltv=500.0)
        assert result.net_ltv == 600.0
        assert result.selected_incentives == evaluation.selected_incentives

    def test_drops_negative_bundle(self):
        """If net_ltv < baseline, bundle should be replaced with empty."""
        evaluation = _make_eval(net_ltv=400.0, cost=200.0)
        result = _enforce_baseline(evaluation, baseline_ltv=500.0)
        assert result.net_ltv == 500.0
        assert result.selected_incentives == []
        assert result.estimated_cost == 0.0
        assert "Bundle dropped" in result.reasoning

    def test_exact_baseline_is_kept(self):
        """Edge case: net_ltv == baseline should keep the bundle."""
        evaluation = _make_eval(net_ltv=500.0, cost=50.0)
        result = _enforce_baseline(evaluation, baseline_ltv=500.0)
        assert result.selected_incentives == evaluation.selected_incentives


# ---------------------------------------------------------------------------
# Convergence-based iteration (_run_experiment_thread)
# ---------------------------------------------------------------------------

class TestConvergenceIteration:
    """Tests that the experiment thread uses convergence-based stopping."""

    def _run_and_wait(self, experiment_id, catalog_version, catalog,
                      eval_side_effect, max_iterations=50, patience=3):
        """Helper to mock load_catalog + evaluate_incentive_bundle, run the
        thread synchronously, and return the final ExperimentState."""
        with patch("profile_generator.experiment.load_catalog", return_value=catalog), \
             patch("profile_generator.experiment.evaluate_incentive_bundle",
                   side_effect=eval_side_effect):
            _run_experiment_thread(
                experiment_id, catalog_version,
                max_iterations=max_iterations, patience=patience,
            )
        return _experiments[experiment_id]

    def test_stops_after_patience_no_improvement(self):
        """Should stop after `patience` consecutive rounds without improvement."""
        catalog = _make_catalog()
        profile = catalog.profiles[0]

        # Always return the same net_ltv → never improves after first
        fixed_eval = _make_eval(profile_id=profile.profile_id, net_ltv=600.0)
        call_count = 0

        def side_effect(p):
            nonlocal call_count
            call_count += 1
            return fixed_eval

        experiment_id = "test_patience"
        _experiments[experiment_id] = ExperimentState(
            experiment_id=experiment_id,
            catalog_version="v_test",
            status="running",
            progress=0,
            current_step="init",
            iterations_per_profile=0,
            available_incentives=INCENTIVES,
            started_at=datetime.utcnow(),
        )

        state = self._run_and_wait(experiment_id, "v_test", catalog, side_effect,
                                   patience=3, max_iterations=50)

        # 1 initial + 3 patience = 4 total calls
        assert call_count == 4
        assert state.status == "completed"
        assert state.iterations_per_profile == 4

    def test_continues_while_improving(self):
        """Should keep iterating as long as net_ltv improves, resetting patience."""
        catalog = _make_catalog()
        profile = catalog.profiles[0]

        # Improve for 5 rounds, then plateau
        call_count = 0

        def side_effect(p):
            nonlocal call_count
            call_count += 1
            if call_count <= 5:
                # Each call returns better net_ltv
                return _make_eval(profile_id=p.profile_id, net_ltv=500.0 + call_count * 10)
            else:
                # Plateau at 550
                return _make_eval(profile_id=p.profile_id, net_ltv=550.0)

        experiment_id = "test_improving"
        _experiments[experiment_id] = ExperimentState(
            experiment_id=experiment_id,
            catalog_version="v_test",
            status="running",
            progress=0,
            current_step="init",
            iterations_per_profile=0,
            available_incentives=INCENTIVES,
            started_at=datetime.utcnow(),
        )

        state = self._run_and_wait(experiment_id, "v_test", catalog, side_effect,
                                   patience=3, max_iterations=50)

        # 5 improving + 3 patience = 8 total
        assert call_count == 8
        assert state.iterations_per_profile == 8
        assert state.status == "completed"

    def test_respects_max_iterations_cap(self):
        """Should stop at max_iterations even if still improving."""
        catalog = _make_catalog()
        call_count = 0

        def side_effect(p):
            nonlocal call_count
            call_count += 1
            # Always improving — never triggers patience
            return _make_eval(profile_id=p.profile_id, net_ltv=500.0 + call_count)

        experiment_id = "test_max_cap"
        _experiments[experiment_id] = ExperimentState(
            experiment_id=experiment_id,
            catalog_version="v_test",
            status="running",
            progress=0,
            current_step="init",
            iterations_per_profile=0,
            available_incentives=INCENTIVES,
            started_at=datetime.utcnow(),
        )

        state = self._run_and_wait(experiment_id, "v_test", catalog, side_effect,
                                   patience=3, max_iterations=10)

        assert call_count == 10
        assert state.iterations_per_profile == 10
        assert state.status == "completed"

    def test_picks_best_evaluation(self):
        """The result should reflect the best net_ltv seen across all iterations."""
        catalog = _make_catalog([_make_profile(ltv=500.0, pop=1)])
        profile = catalog.profiles[0]

        call_count = 0
        def side_effect(p):
            nonlocal call_count
            call_count += 1
            # 1: 600, 2: 700 (best), 3: 650, 4: 640, 5: 630
            values = [600, 700, 650, 640, 630]
            idx = min(call_count - 1, len(values) - 1)
            return _make_eval(profile_id=p.profile_id, net_ltv=values[idx], cost=10.0)

        experiment_id = "test_best_pick"
        _experiments[experiment_id] = ExperimentState(
            experiment_id=experiment_id,
            catalog_version="v_test",
            status="running",
            progress=0,
            current_step="init",
            iterations_per_profile=0,
            available_incentives=INCENTIVES,
            started_at=datetime.utcnow(),
        )

        state = self._run_and_wait(experiment_id, "v_test", catalog, side_effect,
                                   patience=3, max_iterations=50)

        assert len(state.results) == 1
        # Best was 700, with pop=1, so new_net_portfolio_ltv = 700 * 1
        assert state.results[0].new_net_portfolio_ltv == 700.0

    def test_multiple_profiles_independent(self):
        """Each profile should get its own convergence loop."""
        p1 = _make_profile(pid="P0", ltv=500.0, pop=100)
        p2 = _make_profile(pid="P1", ltv=300.0, pop=200)
        catalog = _make_catalog([p1, p2])

        profile_calls = {"P0": 0, "P1": 0}

        def side_effect(p):
            profile_calls[p.profile_id] += 1
            n = profile_calls[p.profile_id]
            if p.profile_id == "P0":
                # P0: improves for 2 rounds, then plateau
                if n <= 2:
                    return _make_eval(profile_id=p.profile_id, net_ltv=500.0 + n * 20)
                return _make_eval(profile_id=p.profile_id, net_ltv=540.0)
            else:
                # P1: never improves — stops after patience
                return _make_eval(profile_id=p.profile_id, net_ltv=350.0)

        experiment_id = "test_multi_profile"
        _experiments[experiment_id] = ExperimentState(
            experiment_id=experiment_id,
            catalog_version="v_test",
            status="running",
            progress=0,
            current_step="init",
            iterations_per_profile=0,
            available_incentives=INCENTIVES,
            started_at=datetime.utcnow(),
        )

        state = self._run_and_wait(experiment_id, "v_test", catalog, side_effect,
                                   patience=3, max_iterations=50)

        assert state.status == "completed"
        assert len(state.results) == 2
        # P0: 2 improving + 3 patience = 5
        assert profile_calls["P0"] == 5
        # P1: 1 initial + 3 patience = 4
        assert profile_calls["P1"] == 4

    def test_baseline_enforcement_applied(self):
        """If best net_ltv < baseline, result should fall back to baseline."""
        profile = _make_profile(ltv=500.0, pop=1)
        catalog = _make_catalog([profile])

        # Always return below baseline
        def side_effect(p):
            return _make_eval(profile_id=p.profile_id, net_ltv=400.0, cost=150.0)

        experiment_id = "test_baseline_enforce"
        _experiments[experiment_id] = ExperimentState(
            experiment_id=experiment_id,
            catalog_version="v_test",
            status="running",
            progress=0,
            current_step="init",
            iterations_per_profile=0,
            available_incentives=INCENTIVES,
            started_at=datetime.utcnow(),
        )

        state = self._run_and_wait(experiment_id, "v_test", catalog, side_effect,
                                   patience=3, max_iterations=50)

        assert len(state.results) == 1
        result = state.results[0]
        assert result.new_net_portfolio_ltv == 500.0  # baseline
        assert result.selected_incentives == ["None"]

    def test_catalog_not_found_fails(self):
        """Missing catalog should set status to 'failed'."""
        experiment_id = "test_no_catalog"
        _experiments[experiment_id] = ExperimentState(
            experiment_id=experiment_id,
            catalog_version="v_missing",
            status="running",
            progress=0,
            current_step="init",
            iterations_per_profile=0,
            available_incentives=INCENTIVES,
            started_at=datetime.utcnow(),
        )

        with patch("profile_generator.experiment.load_catalog", return_value=None):
            _run_experiment_thread(experiment_id, "v_missing")

        state = _experiments[experiment_id]
        assert state.status == "failed"
        assert "not found" in state.error

    def test_progress_reaches_100_on_completion(self):
        """Progress should reach 100 when experiment completes."""
        catalog = _make_catalog()

        def side_effect(p):
            return _make_eval(profile_id=p.profile_id, net_ltv=600.0)

        experiment_id = "test_progress"
        _experiments[experiment_id] = ExperimentState(
            experiment_id=experiment_id,
            catalog_version="v_test",
            status="running",
            progress=0,
            current_step="init",
            iterations_per_profile=0,
            available_incentives=INCENTIVES,
            started_at=datetime.utcnow(),
        )

        state = self._run_and_wait(experiment_id, "v_test", catalog, side_effect,
                                   patience=3, max_iterations=50)

        assert state.progress == 100
        assert state.completed_at is not None


# ---------------------------------------------------------------------------
# start_experiment & get_experiment_status (integration-lite)
# ---------------------------------------------------------------------------

class TestStartExperiment:
    def test_start_creates_state_and_returns_id(self):
        """start_experiment should create state and return experiment_id."""
        with patch("profile_generator.experiment.load_catalog",
                   return_value=_make_catalog()), \
             patch("profile_generator.experiment.evaluate_incentive_bundle",
                   return_value=_make_eval(net_ltv=600.0)):
            eid = start_experiment("v_test", max_iterations=5, patience=2)

        assert eid is not None
        state = get_experiment_status(eid)
        assert state is not None
        assert state.catalog_version == "v_test"

        # Wait for thread to finish
        time.sleep(1)
        state = get_experiment_status(eid)
        assert state.status in ("running", "completed")

    def test_get_nonexistent_returns_none(self):
        """get_experiment_status for unknown ID returns None."""
        assert get_experiment_status("does_not_exist_12345") is None

    def test_parameters_passed_through(self):
        """max_iterations and patience should be passed to the thread."""
        call_count = 0

        def mock_eval(p):
            nonlocal call_count
            call_count += 1
            # Always improving — will hit max_iterations
            return _make_eval(profile_id=p.profile_id, net_ltv=500.0 + call_count)

        catalog = _make_catalog()

        with patch("profile_generator.experiment.load_catalog", return_value=catalog), \
             patch("profile_generator.experiment.evaluate_incentive_bundle",
                   side_effect=mock_eval):
            eid = start_experiment("v_test", max_iterations=7, patience=2)
            # Wait for thread
            time.sleep(2)

        state = get_experiment_status(eid)
        assert state.status == "completed"
        # Always improving → should hit max_iterations=7
        assert call_count == 7


# ---------------------------------------------------------------------------
# ExperimentResult fields
# ---------------------------------------------------------------------------

class TestExperimentResultFields:
    def test_lift_calculation(self):
        """Lift should be new_net_portfolio_ltv - original_portfolio_ltv."""
        profile = _make_profile(ltv=500.0, pop=10)
        catalog = _make_catalog([profile])

        def side_effect(p):
            return _make_eval(profile_id=p.profile_id, net_ltv=600.0, cost=20.0)

        experiment_id = "test_lift"
        _experiments[experiment_id] = ExperimentState(
            experiment_id=experiment_id,
            catalog_version="v_test",
            status="running",
            progress=0,
            current_step="init",
            iterations_per_profile=0,
            available_incentives=INCENTIVES,
            started_at=datetime.utcnow(),
        )

        with patch("profile_generator.experiment.load_catalog", return_value=catalog), \
             patch("profile_generator.experiment.evaluate_incentive_bundle",
                   side_effect=side_effect):
            _run_experiment_thread(experiment_id, "v_test", patience=2)

        state = _experiments[experiment_id]
        result = state.results[0]
        expected_lift = (600.0 * 10) - (500.0 * 10)
        assert result.lift == expected_lift
        assert result.portfolio_cost == 20.0 * 10


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
