"""Train canonical behavioral profiles using K-Means clustering.

Profiles are ordered by descending expected economic value and
annotated with human-readable descriptions.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans

from models.profile_catalog import CanonicalProfile, ProfileCatalog, ScalingParams
from profile_generator.feature_derivation import FEATURE_NAMES, CORE_FEATURE_NAMES
from profile_generator.feature_transform import fit_transform


# Features where higher = more valuable (used for ordering)
_VALUE_POSITIVE_FEATURES = {"total_spend", "avg_order_value", "frequency_per_month", "temporal_spread", "cancellation_rate", "cancellation_count"}
# Features where higher = less valuable
_VALUE_NEGATIVE_FEATURES = {"recency_days"}

def _to_0_1(val: float, inverted: bool = False) -> float:
    """Helper to convert 0-10 scale back to 0-1 for threshold heuristics."""
    v = val / 10.0
    return 1.0 - v if inverted else v


def _compute_value_score(centroid: dict[str, float]) -> float:
    """Composite value score for ordering profiles (higher = better)."""
    score = 0.0
    for feat in _VALUE_POSITIVE_FEATURES:
        score += centroid.get(feat, 0.0)
    for feat in _VALUE_NEGATIVE_FEATURES:
        score -= centroid.get(feat, 0.0)
    return score


def _is_return_heavy(centroid: dict[str, float]) -> bool:
    """Check if a profile is return-heavy."""
    return _to_0_1(centroid.get("cancellation_rate", 10.0), inverted=True) > 0.5


def _describe_profile(centroid: dict[str, float], rank: int, k: int) -> str:
    """Generate human-readable description based on centroid position."""
    parts: list[str] = []

    spend = _to_0_1(centroid.get("total_spend", 0.0))
    freq = _to_0_1(centroid.get("frequency_per_month", 0.0))
    recency = _to_0_1(centroid.get("recency_days", 0.0))
    cancel_rate = _to_0_1(centroid.get("cancellation_rate", 10.0), inverted=True)
    diversity = _to_0_1(centroid.get("product_diversity", 0.0))

    # Spend intensity
    if spend > 0.7:
        parts.append("high spender")
    elif spend > 0.4:
        parts.append("mid spender")
    else:
        parts.append("low spender")

    # Frequency
    if freq > 0.7:
        parts.append("frequent buyer")
    elif freq > 0.4:
        parts.append("regular buyer")
    else:
        parts.append("occasional buyer")

    # Recency
    if recency > 0.7:
        parts.append("dormant")
    elif recency > 0.4:
        parts.append("cooling")
    else:
        parts.append("active")

    # Cancellation
    if cancel_rate > 0.5:
        parts.append("return-heavy")

    # Diversity
    if diversity > 0.7:
        parts.append("diverse explorer")

    return ", ".join(parts).capitalize()


def _label_profile(centroid: dict[str, float]) -> str:
    """Generate a short descriptive label for a profile (e.g. 'Whales')."""
    spend = _to_0_1(centroid.get("total_spend", 0.0))
    freq = _to_0_1(centroid.get("frequency_per_month", 0.0))
    recency = _to_0_1(centroid.get("recency_days", 0.0))
    cancel_rate = _to_0_1(centroid.get("cancellation_rate", 10.0), inverted=True)
    diversity = _to_0_1(centroid.get("product_diversity", 0.0))

    is_dormant = recency > 0.7
    is_cooling = recency > 0.4
    is_return_heavy = cancel_rate > 0.5

    # Base label from spend × frequency
    if spend > 0.7 and freq > 0.7:
        base = "Whales"
    elif spend > 0.7:
        base = "Power Buyers"
    elif spend > 0.4 and freq > 0.7:
        base = "Loyal Regulars"
    elif spend > 0.4:
        base = "Active Mid-Value"
    elif freq > 0.7 and diversity > 0.7:
        base = "Bargain Explorers"
    elif freq > 0.4:
        base = "Casual Shoppers"
    else:
        base = "Light Browsers"

    # Suffix modifiers
    if is_return_heavy:
        base += " ⚠️"
    if is_dormant:
        base += " (Drifting)"
    elif is_cooling:
        base += " (Cooling)"

    return base


def _denormalize_feature(
    feat_name: str, normalized_val: float, scaling_params: list,
) -> float:
    """Reverse the percentile-based normalization to recover raw feature value."""
    for sp in scaling_params:
        if sp.feature_name == feat_name:
            val_0_1 = normalized_val / 10.0
            if feat_name in ["cancellation_rate", "cancellation_count"]:
                val_0_1 = 1.0 - val_0_1
                
            raw_transformed = val_0_1 * (sp.p95 - sp.p5) + sp.p5
            if sp.transform == "log1p":
                return float(np.expm1(raw_transformed))
            return float(raw_transformed)
    return 0.0


# ---------------------------------------------------------------------------
# Issuer LTV
# ---------------------------------------------------------------------------
_INTERCHANGE_RATE = 0.02          # ~2 % interchange fee on card spend
_PROCESSOR_RETURN_COST = 0.05     # ~$0.05 network/processor cost per reversed transaction
_MAX_LIFETIME_MONTHS = 120        # 10-year cap on projected lifetime


def _compute_ltv(
    centroid: dict[str, float], scaling_params: list,
) -> float:
    """Estimate credit-card issuer Lifetime Value (LTV) for a profile.

    LTV = monthly_interchange_revenue × expected_lifetime_months

    monthly_interchange_revenue
        = (interchange earned on successful transactions)
          − (processor costs for returned transactions)

    expected_lifetime_months
        = observed_active_months × retention_factor
        where retention_factor ≈ 1 / (1 − temporal_spread),
        reflecting how consistently the cardholder transacts.
        Dormant users (high recency) get their lifetime discounted.
    """
    # --- Monthly interchange revenue ---
    aov = _denormalize_feature(
        "avg_order_value",
        centroid.get("avg_order_value", 0.0),
        scaling_params,
    )
    freq = _denormalize_feature(
        "frequency_per_month",
        centroid.get("frequency_per_month", 0.0),
        scaling_params,
    )
    cancel = _denormalize_feature(
        "cancellation_rate",
        centroid.get("cancellation_rate", 10.0),
        scaling_params,
    )
    
    real_aov = max(aov, 0.0)
    real_freq = max(freq, 0.0)
    real_cancel = min(max(cancel, 0.0), 1.0)
    
    # Interchange earned on successful (non-returned) transactions
    interchange_revenue = real_aov * real_freq * _INTERCHANGE_RATE * (1.0 - real_cancel)
    
    # Cost incurred by processor/issuer for handling returned/cancelled transactions
    return_costs = real_freq * real_cancel * _PROCESSOR_RETURN_COST
    
    monthly_revenue = interchange_revenue - return_costs

    # --- Expected cardholder lifetime (months) ---
    active_months = _denormalize_feature(
        "active_months",
        centroid.get("active_months", 0.0),
        scaling_params,
    )
    temporal_spread = _to_0_1(centroid.get("temporal_spread", 0.0))
    recency_norm = _to_0_1(centroid.get("recency_days", 0.0))

    # Retention factor: consistent transactors project further out
    retention = 1.0 / max(1.0 - temporal_spread, 0.1)

    # Dormancy discount: high recency → cardholder likely to churn soon
    dormancy_discount = max(1.0 - recency_norm, 0.05)

    expected_lifetime = min(
        max(active_months, 1.0) * retention * dormancy_discount,
        _MAX_LIFETIME_MONTHS,
    )

    ltv = monthly_revenue * expected_lifetime
    return round(ltv, 2)


def train_profiles(
    feature_df: pd.DataFrame,
    k: int = 10,
    source: str = "",
    random_state: int = 42,
    dataset_max_date: datetime | None = None,
) -> ProfileCatalog:
    """Train K canonical profiles from a feature DataFrame.

    Args:
        feature_df: DataFrame with customer_id as index, one column per feature.
                    Should contain raw (unnormalized) features.
        k: number of profiles to learn (default 10)
        source: data source identifier
        random_state: random seed for reproducibility

    Returns:
        A ProfileCatalog with ordered profiles and scaling parameters.
    """
    if len(feature_df) < k:
        k = max(len(feature_df), 2)

    # Transform and normalize (all features)
    normalized_df, scaling_params = fit_transform(feature_df)

    all_feature_names = list(normalized_df.columns)

    # FR-2A: cluster on core behavioral axes only
    core_cols = [c for c in CORE_FEATURE_NAMES if c in normalized_df.columns]
    X_core = normalized_df[core_cols].values.astype(np.float64)
    np.nan_to_num(X_core, copy=False)

    # Full feature matrix (for enrichment after clustering)
    X_all = normalized_df.values.astype(np.float64)
    np.nan_to_num(X_all, copy=False)

    kmeans = KMeans(n_clusters=k, random_state=random_state, n_init=10, max_iter=300)
    labels = kmeans.fit_predict(X_core)

    # Build profiles per cluster
    raw_profiles: list[dict] = []

    for cluster_idx in range(k):
        mask = labels == cluster_idx
        cluster_all = X_all[mask]

        # Full centroid: mean of ALL features for members of this cluster
        centroid = {
            feat: float(cluster_all[:, j].mean()) if cluster_all.shape[0] > 0 else (10.0 if feat in ["cancellation_rate", "cancellation_count"] else 0.0)
            for j, feat in enumerate(all_feature_names)
        }
        dispersion = {}
        for j, feat in enumerate(all_feature_names):
            if cluster_all.shape[0] > 1:
                dispersion[feat] = float(np.std(cluster_all[:, j]))
            else:
                dispersion[feat] = 0.0

        pop_count = int(mask.sum())
        pop_share = float(pop_count) / len(labels)

        raw_profiles.append({
            "centroid": centroid,
            "dispersion": dispersion,
            "population_share": pop_share,
            "population_count": pop_count,
        })

    total_population = len(labels)

    # Pre-compute LTV for each profile (denormalized USD value)
    for rp in raw_profiles:
        rp["ltv"] = _compute_ltv(rp["centroid"], scaling_params)
        rp["portfolio_ltv"] = round(rp["ltv"] * rp["population_count"], 2)

    # Order by descending portfolio LTV, with return-heavy profiles pushed to the end
    raw_profiles.sort(
        key=lambda p: (not _is_return_heavy(p["centroid"]), p["portfolio_ltv"]),
        reverse=True,
    )

    # Assign IDs, labels, and descriptions
    profiles: list[CanonicalProfile] = []
    for i, rp in enumerate(raw_profiles):
        profiles.append(CanonicalProfile(
            profile_id=f"P{i}",
            label=_label_profile(rp["centroid"]),
            centroid=rp["centroid"],
            dispersion=rp["dispersion"],
            population_share=rp["population_share"],
            population_count=rp["population_count"],
            description=_describe_profile(rp["centroid"], i, k),
            ltv=rp["ltv"],
            portfolio_ltv=rp["portfolio_ltv"],
        ))

    # Generate version hash
    config_hash = hashlib.sha256(
        json.dumps({"k": k, "random_state": random_state, "features": all_feature_names}, sort_keys=True).encode()
    ).hexdigest()[:12]

    dataset_hash = hashlib.sha256(
        feature_df.to_csv().encode()
    ).hexdigest()[:12]

    version = f"v_{config_hash}_{dataset_hash}"

    return ProfileCatalog(
        version=version,
        created_at=datetime.now(timezone.utc),
        k=k,
        feature_names=all_feature_names,
        core_feature_names=core_cols,
        scaling_params=scaling_params,
        profiles=profiles,
        training_dataset_hash=dataset_hash,
        config_hash=config_hash,
        total_training_population=total_population,
        source=source,
        dataset_max_date=dataset_max_date,
    )
