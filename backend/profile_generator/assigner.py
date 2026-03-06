"""Assign individual users to canonical profiles.

Given a user's transactions and a stored ProfileCatalog, derives the user's
feature vector, normalizes it, and finds the nearest profile.
"""

from __future__ import annotations

from datetime import datetime, timezone

import numpy as np
import pandas as pd

from models.profile_catalog import ProfileAssignment, ProfileCatalog
from profile_generator.feature_derivation import derive_user_features, FEATURE_NAMES, CORE_FEATURE_NAMES
from profile_generator.feature_transform import normalize
from models.transaction import UserTransactions


def assign_profile(
    user_txns: UserTransactions,
    catalog: ProfileCatalog,
    eval_date: datetime | None = None,
) -> ProfileAssignment:
    """Assign a user to their best-matching canonical profile.

    Steps:
        1. Derive user feature vector
        2. Normalize using stored scaling parameters
        3. Compute Euclidean distance to all centroids
        4. Assign to nearest with confidence score

    Returns:
        ProfileAssignment with profile_id, confidence, feature_vector, alternates.
    """
    # 1. Derive features
    raw_features = derive_user_features(user_txns, eval_date)
    if not raw_features:
        return ProfileAssignment(
            customer_id=user_txns.customer_id,
            profile_id="unknown",
            confidence=0.0,
            catalog_version=catalog.version,
        )

    # 2. Normalize using stored params (all features)
    feature_names = catalog.feature_names
    row = {feat: raw_features.get(feat, 0.0) for feat in feature_names}
    df = pd.DataFrame([row], columns=feature_names)
    normalized = normalize(df, catalog.scaling_params)
    user_vec_all = normalized.values[0].astype(np.float64)
    np.nan_to_num(user_vec_all, copy=False)

    # FR-2A: distance computed on core axes only (matches clustering geometry)
    core_cols = catalog.core_feature_names or CORE_FEATURE_NAMES
    core_indices = [feature_names.index(f) for f in core_cols if f in feature_names]
    user_vec_core = user_vec_all[core_indices]

    # 3. Compute distances to all centroids (core features only)
    distances: list[tuple[str, float]] = []
    for p in catalog.profiles:
        centroid_core = np.array([p.centroid.get(f, 0.0) for f in core_cols], dtype=np.float64)
        dist = float(np.linalg.norm(user_vec_core - centroid_core))
        distances.append((p.profile_id, dist))

    distances.sort(key=lambda x: x[1])

    best_id, best_dist = distances[0]

    # 4. Confidence = 1 - (best_dist / second_best_dist)
    if len(distances) > 1:
        second_dist = distances[1][1]
        if second_dist > 0:
            confidence = max(0.0, 1.0 - (best_dist / second_dist))
        else:
            confidence = 1.0
    else:
        confidence = 1.0

    # Build alternates (top 3)
    alternates = [
        {"profile_id": pid, "distance": round(d, 4)}
        for pid, d in distances[:3]
    ]

    # Feature vector (normalized values) as dict
    feature_vector = {feat: round(float(v), 4) for feat, v in zip(feature_names, user_vec_all)}

    return ProfileAssignment(
        customer_id=user_txns.customer_id,
        profile_id=best_id,
        confidence=round(confidence, 4),
        feature_vector=feature_vector,
        alternates=alternates,
        catalog_version=catalog.version,
        evaluation_timestamp=eval_date or datetime.now(timezone.utc),
    )
