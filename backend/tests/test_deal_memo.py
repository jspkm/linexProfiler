"""Tests for Deal Memo PDF generation."""

from datetime import datetime, timezone
from profile_generator.deal_memo import generate_deal_memo
from models.monte_carlo import (
    MonteCarloOptimizationResult,
    MonteCarloProfileResult,
    MonteCarloBundleComparison,
    SensitivityEntry,
)
from models.profile_catalog import ProfileCatalog, CanonicalProfile
from models.incentive_set import IncentiveSet, Incentive


def _make_test_data():
    profile_result = MonteCarloProfileResult(
        profile_id="P0",
        bundle_name="Cash back",
        selected_incentives=["2% cash back"],
        n_simulations=100,
        uptake_params={"2% cash back": {"alpha": 6.0, "beta": 14.0}},
        net_ltv_percentiles={"p5": 900, "p25": 950, "p50": 1000, "p75": 1050, "p95": 1100},
        expected_net_ltv=1000.0,
        expected_gross_ltv=1200.0,
        expected_cost=200.0,
        expected_lift=100.0,
        confidence_interval_90=(900.0, 1100.0),
        probability_positive_lift=0.92,
    )
    mc_result = MonteCarloOptimizationResult(
        optimization_id="mc_test",
        catalog_version="v_test",
        incentive_set_version="is_test",
        status="completed",
        n_simulations=100,
        profiles=[MonteCarloBundleComparison(profile_id="P0", best_bundle=profile_result)],
        sensitivity_analysis=[
            SensitivityEntry(param_name="Uptake rate", base_value=100, low_delta=-20, high_delta=15),
        ],
        started_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        completed_at=datetime(2026, 1, 1, 0, 5, tzinfo=timezone.utc),
        total_original_ltv=900.0,
        total_new_net_ltv=1000.0,
        total_lift=100.0,
        total_cost=200.0,
    )
    catalog = ProfileCatalog(
        version="v_test",
        k=5,
        profiles=[CanonicalProfile(
            profile_id="P0", label="Whales", ltv=100, portfolio_ltv=900,
            population_count=9, population_share=0.45, description="High spenders",
        )],
        total_learning_population=20,
    )
    inc_set = IncentiveSet(
        version="is_test",
        name="Test Set",
        incentives=[Incentive(name="2% cash back", estimated_annual_cost_per_user=50, redemption_rate=0.3)],
    )
    return mc_result, catalog, inc_set


class TestGenerateDealMemo:
    def test_produces_pdf_bytes(self):
        mc_result, catalog, inc_set = _make_test_data()
        pdf_bytes = generate_deal_memo(mc_result, catalog, inc_set)
        assert isinstance(pdf_bytes, (bytes, bytearray))
        assert len(pdf_bytes) > 100
        assert bytes(pdf_bytes[:5]) == b"%PDF-"

    def test_pdf_is_valid_format(self):
        mc_result, catalog, inc_set = _make_test_data()
        pdf_bytes = generate_deal_memo(mc_result, catalog, inc_set)
        # PDF content is compressed (FlateDecode), so we check structure not text
        pdf_str = bytes(pdf_bytes).decode("latin-1", errors="ignore")
        assert "/Type /Pages" in pdf_str
        assert "/Type /Catalog" in pdf_str

    def test_handles_empty_profiles(self):
        mc_result, catalog, inc_set = _make_test_data()
        mc_result.profiles = []
        catalog.profiles = []
        pdf_bytes = generate_deal_memo(mc_result, catalog, inc_set)
        assert pdf_bytes[:5] == b"%PDF-"

    def test_handles_no_sensitivity(self):
        mc_result, catalog, inc_set = _make_test_data()
        mc_result.sensitivity_analysis = []
        pdf_bytes = generate_deal_memo(mc_result, catalog, inc_set)
        assert pdf_bytes[:5] == b"%PDF-"

    def test_handles_warnings(self):
        mc_result, catalog, inc_set = _make_test_data()
        mc_result.warnings = ["Test warning message"]
        pdf_bytes = generate_deal_memo(mc_result, catalog, inc_set)
        assert len(pdf_bytes) > 100
