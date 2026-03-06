"""Portfolio simulation using the transition matrix.

Applies π(t+1) = π(t) × T iteratively for multi-period projection.
"""

from __future__ import annotations

import numpy as np

from models.profile_catalog import SimulationResult, TransitionMatrix


def run_simulation(
    initial_population: list[float],
    transition_matrix: TransitionMatrix,
    periods: int = 5,
    modified_matrix: list[list[float]] | None = None,
) -> SimulationResult:
    """Simulate portfolio evolution over multiple periods.

    Args:
        initial_population: population share per profile (sums to 1)
        transition_matrix: the learned transition matrix
        periods: number of time periods to simulate
        modified_matrix: optional modified transition matrix for scenario analysis

    Returns:
        SimulationResult with per-period population vectors.
    """
    T = np.array(modified_matrix or transition_matrix.matrix, dtype=np.float64)
    pi = np.array(initial_population, dtype=np.float64)

    # Validate dimensions
    k = len(transition_matrix.profile_ids)
    assert T.shape == (k, k), f"Matrix shape {T.shape} doesn't match {k} profiles"
    assert len(pi) == k, f"Population vector length {len(pi)} doesn't match {k} profiles"

    # Normalize initial population to sum to 1
    pi_sum = pi.sum()
    if pi_sum > 0:
        pi = pi / pi_sum

    # Run simulation
    population_vectors = [pi.tolist()]

    for _ in range(periods):
        pi = pi @ T
        # Re-normalize to handle floating point drift
        pi_sum = pi.sum()
        if pi_sum > 0:
            pi = pi / pi_sum
        population_vectors.append([round(v, 6) for v in pi.tolist()])

    return SimulationResult(
        periods=periods,
        profile_ids=transition_matrix.profile_ids,
        population_vectors=population_vectors,
        catalog_version=transition_matrix.catalog_version,
    )
