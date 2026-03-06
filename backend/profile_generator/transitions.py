"""Build profile transition matrices from time-windowed assignments.

FR-6 compliant:
  1. Assign profiles at discrete time intervals
  2. Detect profile changes
  3. Aggregate transitions (raw counts)
  4. Smooth sparse transitions (Laplace / additive smoothing)
  5. Normalize rows

Output includes raw counts, probability matrix, and smoothing parameters.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime

import numpy as np
import pandas as pd

from models.profile_catalog import ProfileCatalog, TransitionMatrix
from models.transaction import UserTransactions
from profile_generator.assigner import assign_profile


def _split_by_window(
    user_txns: UserTransactions,
    window: str = "Q",
) -> dict[str, UserTransactions]:
    """Split a user's transactions into time windows.

    Args:
        user_txns: all transactions for one user
        window: 'Q' for quarterly, 'M' for monthly

    Returns:
        Dict of window_label → UserTransactions for that window.
    """
    if not user_txns.transactions:
        return {}

    txns_by_window: dict[str, list] = defaultdict(list)

    for t in user_txns.transactions:
        if window == "M":
            label = f"{t.date.year}-{t.date.month:02d}"
        else:  # quarterly
            q = (t.date.month - 1) // 3 + 1
            label = f"{t.date.year}-Q{q}"
        txns_by_window[label].append(t)

    result = {}
    for label, txns in sorted(txns_by_window.items()):
        result[label] = UserTransactions(
            customer_id=user_txns.customer_id,
            transactions=txns,
        )

    return result


def _smooth_and_normalize(
    counts: np.ndarray,
    alpha: float = 0.0,
) -> tuple[np.ndarray, bool]:
    """Apply Laplace smoothing and row-normalize the transition counts.

    Args:
        counts: K×K raw count matrix
        alpha: smoothing parameter (0 = no smoothing)

    Returns:
        (probability_matrix, was_smoothed)
    """
    k = counts.shape[0]
    smoothed_counts = counts + alpha
    was_smoothed = alpha > 0

    matrix = np.zeros((k, k), dtype=np.float64)
    for i in range(k):
        row_sum = smoothed_counts[i].sum()
        if row_sum > 0:
            matrix[i] = smoothed_counts[i] / row_sum
        else:
            # No observed transitions from this profile: self-loop
            matrix[i, i] = 1.0

    return matrix, was_smoothed


def _auto_alpha(counts: np.ndarray, min_transitions: int = 5) -> float:
    """Determine smoothing alpha based on count sparsity.

    If many rows have cells with fewer than min_transitions observations,
    apply modest Laplace smoothing to avoid zero-probability transitions.

    Returns:
        alpha value (0 = no smoothing needed)
    """
    k = counts.shape[0]
    if k <= 1:
        return 0.0

    # Count rows that have outgoing transitions
    active_rows = (counts.sum(axis=1) > 0).sum()
    if active_rows == 0:
        return 1.0  # no data at all, apply smoothing

    # Calculate sparsity: fraction of non-diagonal cells with < min_transitions
    sparse_cells = 0
    total_off_diag = 0
    for i in range(k):
        if counts[i].sum() == 0:
            continue  # skip entirely empty rows
        for j in range(k):
            if i == j:
                continue
            total_off_diag += 1
            if counts[i, j] < min_transitions:
                sparse_cells += 1

    if total_off_diag == 0:
        return 0.0

    sparsity_ratio = sparse_cells / total_off_diag

    # Apply smoothing if >60% of off-diagonal cells are sparse
    if sparsity_ratio > 0.6:
        return 1.0
    elif sparsity_ratio > 0.3:
        return 0.5
    else:
        return 0.0


def build_transition_matrix(
    users: dict[str, UserTransactions],
    catalog: ProfileCatalog,
    time_window: str = "Q",
    alpha: float | None = None,
) -> TransitionMatrix:
    """Build a profile transition matrix from a set of users.

    FR-6 implementation:
        1. Assign profiles at discrete time intervals (per window)
        2. Detect profile changes between consecutive windows
        3. Aggregate transition counts
        4. Smooth sparse transitions (Laplace smoothing, auto or manual)
        5. Normalize rows to probabilities

    Args:
        users: mapping customer_id → UserTransactions
        catalog: the profile catalog to assign against
        time_window: 'Q' for quarterly, 'M' for monthly
        alpha: Laplace smoothing parameter. None = auto-detect.

    Returns:
        TransitionMatrix with raw counts, probability matrix, and smoothing params.
    """
    profile_ids = [p.profile_id for p in catalog.profiles]
    k = len(profile_ids)
    pid_to_idx = {pid: i for i, pid in enumerate(profile_ids)}

    counts = np.zeros((k, k), dtype=np.float64)
    total_transitions = 0
    total_users_with_transitions = 0

    for cid, user_txns in users.items():
        # Step 1: Split into time windows
        windows = _split_by_window(user_txns, time_window)
        if len(windows) < 2:
            continue

        # Step 1: Assign profile per window
        window_profiles: list[str] = []
        for label, w_txns in windows.items():
            assignment = assign_profile(w_txns, catalog)
            window_profiles.append(assignment.profile_id)

        # Step 2 & 3: Detect changes and aggregate transitions
        total_users_with_transitions += 1
        for i in range(len(window_profiles) - 1):
            from_pid = window_profiles[i]
            to_pid = window_profiles[i + 1]
            from_idx = pid_to_idx.get(from_pid)
            to_idx = pid_to_idx.get(to_pid)
            if from_idx is not None and to_idx is not None:
                counts[from_idx, to_idx] += 1
                total_transitions += 1

    # Step 4: Smooth sparse transitions
    if alpha is None:
        alpha = _auto_alpha(counts)

    # Step 5: Normalize rows
    prob_matrix, was_smoothed = _smooth_and_normalize(counts, alpha)

    # Convert to Python lists for serialization
    raw_counts_list = [[int(v) for v in row] for row in counts]
    matrix_list = [[round(float(v), 6) for v in row] for row in prob_matrix]

    return TransitionMatrix(
        profile_ids=profile_ids,
        matrix=matrix_list,
        raw_counts=raw_counts_list,
        smoothing_alpha=alpha,
        smoothed=was_smoothed,
        time_window=time_window,
        catalog_version=catalog.version,
        num_users=total_users_with_transitions,
        num_transitions=total_transitions,
    )
