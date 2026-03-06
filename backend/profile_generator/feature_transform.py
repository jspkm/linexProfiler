"""Feature transformation and normalization.

Detects heavy-tailed distributions and applies appropriate transforms.
Normalizes all features to [0, 1] using robust percentile-based scaling.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy import stats as sp_stats

from models.profile_catalog import ScalingParams


def detect_and_transform(
    df: pd.DataFrame,
    skew_threshold: float = 2.0,
) -> tuple[pd.DataFrame, list[ScalingParams]]:
    """Detect heavy-tailed features and apply log1p transform.

    Args:
        df: raw feature DataFrame (customer_id as index)
        skew_threshold: features with abs(skewness) > this get log1p

    Returns:
        (transformed_df, scaling_params_list)
    """
    scaling_params: list[ScalingParams] = []
    transformed = df.copy()

    for col in df.columns:
        series = df[col].dropna()
        if len(series) < 2:
            scaling_params.append(ScalingParams(
                feature_name=col,
                transform="none",
                p5=0.0,
                p95=1.0,
            ))
            continue

        skewness = float(sp_stats.skew(series, nan_policy="omit"))
        if abs(skewness) > skew_threshold:
            transformed[col] = np.log1p(df[col].clip(lower=0))
            transform_type = "log1p"
        else:
            transform_type = "none"

        # Compute percentile bounds from (possibly transformed) data
        col_data = transformed[col].dropna()
        p5 = float(np.percentile(col_data, 5))
        p95 = float(np.percentile(col_data, 95))

        # Avoid zero-width range
        if p95 <= p5:
            p95 = p5 + 1.0

        scaling_params.append(ScalingParams(
            feature_name=col,
            transform=transform_type,
            p5=p5,
            p95=p95,
        ))

    return transformed, scaling_params


def normalize(
    df: pd.DataFrame,
    scaling_params: list[ScalingParams],
) -> pd.DataFrame:
    """Normalize features to [0, 1] using stored scaling parameters.

    Apply transform first (if log1p), then clip to [p5, p95] and scale.
    """
    result = df.copy()
    params_map = {sp.feature_name: sp for sp in scaling_params}

    for col in df.columns:
        sp = params_map.get(col)
        if sp is None:
            continue

        # Apply transform
        if sp.transform == "log1p":
            result[col] = np.log1p(df[col].clip(lower=0))

        # Clip and scale to [0, 1]
        val_0_1 = (result[col] - sp.p5) / (sp.p95 - sp.p5)
        val_0_1 = val_0_1.clip(0.0, 1.0)
        
        if col in ["cancellation_rate", "cancellation_count"]:
            val_0_1 = 1.0 - val_0_1
            
        result[col] = val_0_1 * 10.0

    return result


def fit_transform(
    df: pd.DataFrame,
    skew_threshold: float = 2.0,
) -> tuple[pd.DataFrame, list[ScalingParams]]:
    """Convenience: detect transforms, apply them, then normalize.

    Returns:
        (normalized_df, scaling_params)
    """
    transformed, scaling_params = detect_and_transform(df, skew_threshold)
    normalized = normalize(df, scaling_params)  # normalize from raw using params
    return normalized, scaling_params
