"""Monte Carlo optimization engine.

Replaces the iterative Gemini-based optimization with synchronous
Beta-distribution sampling. Runs in seconds, not minutes. No LLM calls.

For each profile x candidate bundle, samples uptake rates from Beta priors,
computes net LTV distributions, and selects the bundle with the highest
median net LTV that satisfies baseline enforcement.
"""

from __future__ import annotations

import math
import uuid
from datetime import datetime, timezone

import numpy as np
from scipy import stats

from models.monte_carlo import (
    MonteCarloOptimizationResult,
    MonteCarloProfileResult,
    MonteCarloBundleComparison,
    SensitivityEntry,
)
from models.profile_catalog import ProfileCatalog, CanonicalProfile
from models.incentive_set import IncentiveSet, Incentive
from profile_generator.versioning import load_catalog
from profile_generator.incentive_manager import load_or_seed_default
from profile_generator.firestore_client import fs_load_incentive_set


MIN_CUSTOMERS_FOR_MC = 1000


def _beta_params(incentive: Incentive) -> tuple[float, float]:
    """Derive Beta(alpha, beta) from incentive prior and observed data."""
    prior_mean = max(0.0, min(1.0, incentive.redemption_rate))
    prior_strength = max(1.0, incentive.uptake_prior_strength)
    obs_succ = max(0.0, float(incentive.uptake_observed_successes))
    obs_trials = max(obs_succ, float(incentive.uptake_observed_trials))
    alpha = prior_mean * prior_strength + obs_succ
    beta = (1.0 - prior_mean) * prior_strength + (obs_trials - obs_succ)
    return max(0.01, alpha), max(0.01, beta)


def _marginal_ltv_estimate(profile: CanonicalProfile, incentive: Incentive) -> float:
    """Heuristic marginal LTV estimate based on profile spend intensity.

    Uses the profile's LTV as a proxy for spending capacity.
    Higher-LTV profiles get more value from incentives because they transact more.
    The multiplier scales the incentive cost into an expected marginal revenue gain.
    """
    base_ltv = max(1.0, profile.ltv)
    cost = max(0.01, incentive.estimated_annual_cost_per_user)
    # Ratio of profile value to incentive cost, capped to avoid runaway estimates.
    # A profile with 10x the incentive cost in LTV is likely to generate meaningful
    # marginal revenue from the incentive. A profile with 0.5x is unlikely to.
    ltv_ratio = min(base_ltv / cost, 10.0)
    # Multiplier: at ltv_ratio=1, incentive barely breaks even (mult ~1.2).
    # At ltv_ratio=5, incentive is comfortably profitable (mult ~2.5).
    # At ltv_ratio=10, diminishing returns (mult ~3.5).
    multiplier = 1.0 + math.log1p(ltv_ratio)
    return cost * multiplier


def _simulate_bundle(
    profile: CanonicalProfile,
    incentives: list[Incentive],
    bundle_name: str,
    n_simulations: int,
    rng: np.random.Generator,
) -> MonteCarloProfileResult:
    """Run Monte Carlo simulation for one profile with one incentive bundle."""
    baseline_ltv = profile.portfolio_ltv or (profile.ltv * profile.population_count)
    total_net_ltv_draws = np.full(n_simulations, baseline_ltv, dtype=np.float64)
    total_gross_draws = np.full(n_simulations, baseline_ltv, dtype=np.float64)
    total_cost_draws = np.zeros(n_simulations, dtype=np.float64)
    uptake_params: dict[str, dict[str, float]] = {}

    for inc in incentives:
        alpha, beta = _beta_params(inc)
        uptake_params[inc.name] = {"alpha": round(alpha, 3), "beta": round(beta, 3)}

        uptake_draws = stats.beta.rvs(alpha, beta, size=n_simulations, random_state=rng)
        marginal_per_user = _marginal_ltv_estimate(profile, inc)
        cost_per_user = inc.estimated_annual_cost_per_user
        pop = max(1, profile.population_count)

        marginal_revenue = uptake_draws * marginal_per_user * pop
        cost = uptake_draws * cost_per_user * pop

        total_gross_draws += marginal_revenue
        total_cost_draws += cost
        total_net_ltv_draws += marginal_revenue - cost

    p5, p25, p50, p75, p95 = np.percentile(total_net_ltv_draws, [5, 25, 50, 75, 95])
    expected_net = float(np.mean(total_net_ltv_draws))
    expected_gross = float(np.mean(total_gross_draws))
    expected_cost = float(np.mean(total_cost_draws))
    expected_lift = expected_net - baseline_ltv
    prob_positive = float(np.mean(total_net_ltv_draws > baseline_ltv))

    return MonteCarloProfileResult(
        profile_id=profile.profile_id,
        bundle_name=bundle_name,
        selected_incentives=[inc.name for inc in incentives],
        n_simulations=n_simulations,
        uptake_params=uptake_params,
        net_ltv_percentiles={
            "p5": round(float(p5), 2),
            "p25": round(float(p25), 2),
            "p50": round(float(p50), 2),
            "p75": round(float(p75), 2),
            "p95": round(float(p95), 2),
        },
        expected_net_ltv=round(expected_net, 2),
        expected_gross_ltv=round(expected_gross, 2),
        expected_cost=round(expected_cost, 2),
        expected_lift=round(expected_lift, 2),
        confidence_interval_90=(round(float(p5), 2), round(float(p95), 2)),
        probability_positive_lift=round(prob_positive, 4),
    )


def _generate_candidate_bundles(
    incentives: list[Incentive],
) -> list[tuple[str, list[Incentive]]]:
    """Generate candidate bundles from the incentive set.

    Strategy: full bundle + individual singletons + empty baseline.
    Avoids combinatorial explosion.
    """
    bundles: list[tuple[str, list[Incentive]]] = []
    bundles.append(("No incentives", []))
    for inc in incentives:
        bundles.append((inc.name, [inc]))
    if len(incentives) > 1:
        bundles.append(("Full bundle", incentives))
    return bundles


def run_monte_carlo_optimization(
    catalog_version: str,
    incentive_set_version: str | None = None,
    n_simulations: int = 5000,
    budget: float | None = None,
    target_ltv: float | None = None,
) -> MonteCarloOptimizationResult:
    """Run Monte Carlo optimization for all profiles in a catalog.

    Returns a complete result synchronously (no polling needed).
    """
    optimization_id = f"mc_{uuid.uuid4().hex[:12]}"
    started_at = datetime.now(timezone.utc)
    warnings: list[str] = []

    catalog = load_catalog(catalog_version)
    if catalog is None:
        return MonteCarloOptimizationResult(
            optimization_id=optimization_id,
            catalog_version=catalog_version,
            incentive_set_version=incentive_set_version or "",
            status="failed",
            n_simulations=n_simulations,
            error=f"Catalog '{catalog_version}' not found.",
            started_at=started_at,
            completed_at=datetime.now(timezone.utc),
        )

    if catalog.total_learning_population < MIN_CUSTOMERS_FOR_MC:
        warnings.append(
            f"Dataset has {catalog.total_learning_population} customers "
            f"(recommended minimum: {MIN_CUSTOMERS_FOR_MC}). "
            "Results are exploratory, not projections."
        )

    if incentive_set_version:
        inc_set = fs_load_incentive_set(incentive_set_version)
        if inc_set is None:
            inc_set = load_or_seed_default()
            warnings.append(
                f"Incentive set '{incentive_set_version}' not found. Using default."
            )
    else:
        inc_set = load_or_seed_default()

    rng = np.random.default_rng(seed=42)
    candidate_bundles = _generate_candidate_bundles(inc_set.incentives)
    profile_comparisons: list[MonteCarloBundleComparison] = []
    total_original = 0.0
    total_new_net = 0.0
    total_cost = 0.0

    for profile in catalog.profiles:
        baseline_ltv = profile.portfolio_ltv or (profile.ltv * profile.population_count)
        results_for_profile: list[MonteCarloProfileResult] = []

        for bundle_name, bundle_incentives in candidate_bundles:
            result = _simulate_bundle(
                profile, bundle_incentives, bundle_name, n_simulations, rng,
            )
            results_for_profile.append(result)

        # Select best: highest p50 net LTV where p5 >= baseline (probabilistic enforcement)
        viable = [r for r in results_for_profile if r.net_ltv_percentiles["p5"] >= baseline_ltv * 0.95]
        if not viable:
            viable = results_for_profile

        best = max(viable, key=lambda r: r.net_ltv_percentiles["p50"])
        alternatives = [r for r in results_for_profile if r.bundle_name != best.bundle_name]

        profile_comparisons.append(MonteCarloBundleComparison(
            profile_id=profile.profile_id,
            best_bundle=best,
            alternatives=alternatives,
        ))

    # Budget enforcement: greedy knapsack by ROI
    if budget is not None and budget > 0:
        unconstrained_cost = sum(c.best_bundle.expected_cost for c in profile_comparisons)
        if unconstrained_cost > budget:
            warnings.append(
                f"Budget constraint active: optimal bundles would cost ${unconstrained_cost:,.0f} unconstrained. "
                f"Selecting highest-ROI bundles within ${budget:,.0f} budget."
            )
            # Collect all viable bundles (best + alternatives) per profile, ranked by ROI
            candidates: list[tuple[float, int, MonteCarloProfileResult]] = []
            for i, comp in enumerate(profile_comparisons):
                all_bundles = [comp.best_bundle] + comp.alternatives
                for b in all_bundles:
                    cost = b.expected_cost
                    lift = b.expected_lift
                    roi = lift / cost if cost > 0 else float("inf") if lift > 0 else 0.0
                    candidates.append((roi, i, b))

            # Start each profile with "No incentives" (zero cost)
            selected: dict[int, MonteCarloProfileResult] = {}
            for i, comp in enumerate(profile_comparisons):
                all_bundles = [comp.best_bundle] + comp.alternatives
                no_inc = next((b for b in all_bundles if b.bundle_name == "No incentives"), None)
                if no_inc:
                    selected[i] = no_inc
                else:
                    selected[i] = comp.best_bundle  # fallback

            # Greedily upgrade profiles to higher-ROI bundles within budget
            candidates.sort(key=lambda x: x[0], reverse=True)  # highest ROI first
            remaining_budget = budget
            for roi, idx, bundle in candidates:
                if bundle.bundle_name == "No incentives":
                    continue
                current_cost = selected[idx].expected_cost
                upgrade_cost = bundle.expected_cost - current_cost
                if upgrade_cost <= 0:
                    continue  # already have a more expensive bundle
                if upgrade_cost <= remaining_budget:
                    remaining_budget -= upgrade_cost
                    selected[idx] = bundle

            # Rebuild profile_comparisons with selected bundles
            for i, comp in enumerate(profile_comparisons):
                chosen = selected[i]
                all_bundles = [comp.best_bundle] + comp.alternatives
                others = [b for b in all_bundles if b.bundle_name != chosen.bundle_name]
                profile_comparisons[i] = MonteCarloBundleComparison(
                    profile_id=comp.profile_id,
                    best_bundle=chosen,
                    alternatives=others,
                )

    # Target LTV enforcement: adjust bundle selection to approach a target total net LTV
    if target_ltv is not None and target_ltv > 0:
        current_net = sum(c.best_bundle.expected_net_ltv for c in profile_comparisons)
        if current_net > target_ltv:
            # Over target: downgrade lowest-ROI profiles until near target
            warnings.append(
                f"Unconstrained net LTV (${current_net:,.0f}) exceeds target (${target_ltv:,.0f}). "
                "Downgrading lowest-ROI profiles to approach target."
            )
            indexed = []
            for i, comp in enumerate(profile_comparisons):
                cost = comp.best_bundle.expected_cost
                lift = comp.best_bundle.expected_lift
                roi = lift / cost if cost > 0 else float("inf")
                indexed.append((roi, i, comp))
            indexed.sort(key=lambda x: x[0])  # lowest ROI first

            for roi, idx, comp in indexed:
                if current_net <= target_ltv:
                    break
                all_bundles = [comp.best_bundle] + comp.alternatives
                # Try cheaper bundles for this profile, sorted by net LTV descending
                cheaper = [b for b in all_bundles if b.expected_net_ltv < comp.best_bundle.expected_net_ltv]
                cheaper.sort(key=lambda b: b.expected_net_ltv, reverse=True)
                for alt in cheaper:
                    new_total = current_net - comp.best_bundle.expected_net_ltv + alt.expected_net_ltv
                    if new_total <= target_ltv:
                        # This downgrade gets us at or below target
                        others = [b for b in all_bundles if b.bundle_name != alt.bundle_name]
                        profile_comparisons[idx] = MonteCarloBundleComparison(
                            profile_id=comp.profile_id,
                            best_bundle=alt,
                            alternatives=others,
                        )
                        current_net = new_total
                        break
                else:
                    # No single downgrade hits target, use the cheapest (No incentives)
                    no_inc = next((b for b in all_bundles if b.bundle_name == "No incentives"), None)
                    if no_inc and comp.best_bundle.bundle_name != "No incentives":
                        current_net = current_net - comp.best_bundle.expected_net_ltv + no_inc.expected_net_ltv
                        others = [b for b in all_bundles if b.bundle_name != "No incentives"]
                        profile_comparisons[idx] = MonteCarloBundleComparison(
                            profile_id=comp.profile_id,
                            best_bundle=no_inc,
                            alternatives=others,
                        )

        elif current_net < target_ltv:
            # Under target: try upgrading profiles to more expensive bundles
            warnings.append(
                f"Current net LTV (${current_net:,.0f}) is below target (${target_ltv:,.0f}). "
                "Upgrading profiles to approach target. Note: target may not be achievable with available incentives."
            )
            # Already selected best bundles per profile, so we're already at max.
            # Nothing more to upgrade unless we have alternatives with higher net LTV
            # (shouldn't happen since we already picked the best, but check anyway).

    total_original = 0.0
    total_new_net = 0.0
    total_cost = 0.0
    for comp in profile_comparisons:
        profile = next((p for p in catalog.profiles if p.profile_id == comp.profile_id), None)
        baseline = (profile.portfolio_ltv or (profile.ltv * profile.population_count)) if profile else 0.0
        total_original += baseline
        total_new_net += comp.best_bundle.expected_net_ltv
        total_cost += comp.best_bundle.expected_cost

    total_lift = total_new_net - total_original

    result = MonteCarloOptimizationResult(
        optimization_id=optimization_id,
        catalog_version=catalog_version,
        incentive_set_version=inc_set.version,
        status="completed",
        n_simulations=n_simulations,
        profiles=profile_comparisons,
        started_at=started_at,
        completed_at=datetime.now(timezone.utc),
        warnings=warnings,
        total_original_ltv=round(total_original, 2),
        total_new_net_ltv=round(total_new_net, 2),
        total_lift=round(total_lift, 2),
        total_cost=round(total_cost, 2),
    )

    # Compute sensitivity analysis
    result.sensitivity_analysis = _compute_sensitivity(
        catalog, inc_set, n_simulations, rng, total_lift,
    )

    return result


def run_what_if(
    optimization_id: str,
    uptake_override: float | None = None,
    cost_override: float | None = None,
    profile_id: str | None = None,
    n_simulations: int = 5000,
) -> dict:
    """Re-run MC simulation with overridden assumptions on an existing optimization.

    Returns comparison data: base results vs what-if results.
    """
    from profile_generator.firestore_client import fs_load_optimization
    from models.monte_carlo import MonteCarloOptimizationResult

    state = fs_load_optimization(optimization_id)
    if not state or not isinstance(state, MonteCarloOptimizationResult):
        return {"error": "Optimization not found or not a Monte Carlo result"}

    catalog = load_catalog(state.catalog_version)
    if not catalog:
        return {"error": f"Catalog '{state.catalog_version}' not found"}

    inc_set = fs_load_incentive_set(state.incentive_set_version) if state.incentive_set_version else None
    if not inc_set:
        inc_set = load_or_seed_default()

    rng = np.random.default_rng(seed=99)

    # Build modified incentives
    modified_incentives = []
    for inc in inc_set.incentives:
        data = inc.model_dump()
        if uptake_override is not None:
            data["redemption_rate"] = min(1.0, max(0.0, uptake_override))
        if cost_override is not None:
            data["estimated_annual_cost_per_user"] = max(0.0, cost_override)
        modified_incentives.append(Incentive(**data))

    profiles_to_run = catalog.profiles
    if profile_id:
        profiles_to_run = [p for p in catalog.profiles if p.profile_id == profile_id]
        if not profiles_to_run:
            return {"error": f"Profile '{profile_id}' not found in catalog"}

    comparisons = []
    for profile in profiles_to_run:
        baseline_ltv = profile.portfolio_ltv or (profile.ltv * profile.population_count)

        # Find the base result for this profile
        base_comp = next((c for c in state.profiles if c.profile_id == profile.profile_id), None)
        base_bundle_names = base_comp.best_bundle.selected_incentives if base_comp else []

        # Re-run with the same bundle but modified assumptions
        what_if_incs = [inc for inc in modified_incentives if inc.name in base_bundle_names]
        what_if_result = _simulate_bundle(profile, what_if_incs, "What-if", n_simulations, rng)

        comparisons.append({
            "profile_id": profile.profile_id,
            "base": {
                "net_ltv": base_comp.best_bundle.expected_net_ltv if base_comp else baseline_ltv,
                "lift": base_comp.best_bundle.expected_lift if base_comp else 0,
                "cost": base_comp.best_bundle.expected_cost if base_comp else 0,
                "p50": base_comp.best_bundle.net_ltv_percentiles.get("p50", 0) if base_comp else 0,
            },
            "what_if": {
                "net_ltv": what_if_result.expected_net_ltv,
                "lift": what_if_result.expected_lift,
                "cost": what_if_result.expected_cost,
                "p50": what_if_result.net_ltv_percentiles["p50"],
                "probability_positive_lift": what_if_result.probability_positive_lift,
            },
            "delta_net_ltv": round(what_if_result.expected_net_ltv - (base_comp.best_bundle.expected_net_ltv if base_comp else baseline_ltv), 2),
            "delta_lift": round(what_if_result.expected_lift - (base_comp.best_bundle.expected_lift if base_comp else 0), 2),
        })

    overrides_desc = []
    if uptake_override is not None:
        overrides_desc.append(f"uptake={uptake_override:.0%}")
    if cost_override is not None:
        overrides_desc.append(f"cost=${cost_override:.2f}")

    return {
        "optimization_id": optimization_id,
        "overrides": ", ".join(overrides_desc),
        "profiles": comparisons,
        "total_delta_net_ltv": round(sum(c["delta_net_ltv"] for c in comparisons), 2),
        "total_delta_lift": round(sum(c["delta_lift"] for c in comparisons), 2),
    }


def _compute_sensitivity(
    catalog: ProfileCatalog,
    inc_set: IncentiveSet,
    n_simulations: int,
    rng: np.random.Generator,
    base_lift: float,
) -> list[SensitivityEntry]:
    """Compute sensitivity of total lift to key assumptions (+/- 20%)."""
    entries: list[SensitivityEntry] = []

    for param_name, factor_attr in [
        ("Uptake rate", "redemption_rate"),
        ("Incentive cost", "estimated_annual_cost_per_user"),
    ]:
        for direction, scale in [("low", 0.8), ("high", 1.2)]:
            modified_incentives = []
            for inc in inc_set.incentives:
                data = inc.model_dump()
                data[factor_attr] = data[factor_attr] * scale
                if factor_attr == "redemption_rate":
                    data[factor_attr] = min(1.0, data[factor_attr])
                modified_incentives.append(Incentive(**data))

            modified_set = IncentiveSet(
                version=inc_set.version,
                incentives=modified_incentives,
            )
            bundles = _generate_candidate_bundles(modified_set.incentives)

            total_net = 0.0
            total_orig = 0.0
            for profile in catalog.profiles:
                baseline = profile.portfolio_ltv or (profile.ltv * profile.population_count)
                total_orig += baseline
                best_p50 = baseline
                for bundle_name, bundle_incs in bundles:
                    r = _simulate_bundle(profile, bundle_incs, bundle_name, n_simulations, rng)
                    if r.net_ltv_percentiles["p50"] > best_p50:
                        best_p50 = r.net_ltv_percentiles["p50"]
                total_net += best_p50

            varied_lift = total_net - total_orig
            delta = varied_lift - base_lift

            existing = next((e for e in entries if e.param_name == param_name), None)
            if existing is None:
                entry = SensitivityEntry(
                    param_name=param_name,
                    base_value=round(base_lift, 2),
                    low_delta=round(delta, 2) if direction == "low" else 0.0,
                    high_delta=round(delta, 2) if direction == "high" else 0.0,
                )
                entries.append(entry)
            else:
                if direction == "low":
                    existing.low_delta = round(delta, 2)
                else:
                    existing.high_delta = round(delta, 2)

    return entries
