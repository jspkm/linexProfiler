from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class MonteCarloProfileResult(BaseModel):
    """Per-profile, per-bundle Monte Carlo simulation result."""

    profile_id: str
    bundle_name: str
    selected_incentives: list[str]
    n_simulations: int
    uptake_params: dict[str, dict[str, float]]  # incentive_name -> {alpha, beta}
    net_ltv_percentiles: dict[str, float]  # p5, p25, p50, p75, p95
    expected_net_ltv: float
    expected_gross_ltv: float
    expected_cost: float
    expected_lift: float
    confidence_interval_90: tuple[float, float]  # (p5, p95)
    probability_positive_lift: float  # fraction of draws where lift > 0


class MonteCarloBundleComparison(BaseModel):
    """Per-profile comparison: winning bundle vs alternatives."""

    profile_id: str
    best_bundle: MonteCarloProfileResult
    alternatives: list[MonteCarloProfileResult] = []


class SensitivityEntry(BaseModel):
    """Sensitivity of total portfolio lift to one assumption."""

    param_name: str
    base_value: float
    low_delta: float  # change in total lift when param is -20%
    high_delta: float  # change in total lift when param is +20%


class MonteCarloOptimizationResult(BaseModel):
    """Top-level result of a Monte Carlo optimization run."""

    optimization_id: str
    catalog_version: str
    incentive_set_version: str
    status: str  # "completed" or "failed"
    engine: str = "monte_carlo"
    n_simulations: int
    profiles: list[MonteCarloBundleComparison] = []
    sensitivity_analysis: list[SensitivityEntry] = []
    error: Optional[str] = None
    started_at: datetime
    completed_at: Optional[datetime] = None
    warnings: list[str] = []

    # Backward-compatible summary fields (computed from p50 values)
    total_original_ltv: float = 0.0
    total_new_net_ltv: float = 0.0
    total_lift: float = 0.0
    total_cost: float = 0.0

    def to_legacy_results(self) -> list[dict]:
        """Convert to the format the frontend results table expects."""
        results = []
        for comp in self.profiles:
            b = comp.best_bundle
            results.append({
                "profile_id": b.profile_id,
                "selected_incentives": b.selected_incentives,
                "original_portfolio_ltv": round(b.expected_net_ltv - b.expected_lift, 2),
                "new_gross_portfolio_ltv": round(b.expected_gross_ltv, 2),
                "portfolio_cost": round(b.expected_cost, 2),
                "new_net_portfolio_ltv": round(b.expected_net_ltv, 2),
                "lift": round(b.expected_lift, 2),
                "reasoning": f"Monte Carlo ({b.n_simulations} draws). "
                             f"90% CI: [${b.confidence_interval_90[0]:.2f}, ${b.confidence_interval_90[1]:.2f}]. "
                             f"P(lift>0): {b.probability_positive_lift:.0%}.",
                # MC-specific fields
                "percentiles": b.net_ltv_percentiles,
                "probability_positive_lift": b.probability_positive_lift,
                "confidence_interval_90": list(b.confidence_interval_90),
            })
        return results
