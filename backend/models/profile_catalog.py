"""Pydantic models for the Profile Generator domain."""

from __future__ import annotations

from datetime import datetime
from pydantic import BaseModel, Field


class ScalingParams(BaseModel):
    """Per-feature scaling parameters for reproducible normalization."""

    feature_name: str
    transform: str = "none"  # "none" | "log1p"
    p5: float = 0.0   # 5th percentile (lower clip)
    p95: float = 1.0   # 95th percentile (upper clip)


class CanonicalProfile(BaseModel):
    """A single canonical behavioral profile learned from data."""

    profile_id: str  # e.g. "P0", "P1", ...
    label: str = ""  # short descriptive name, e.g. "Whales", "Power Buyers"
    centroid: dict[str, float] = {}  # feature_name → centroid value (normalized)
    dispersion: dict[str, float] = {}  # feature_name → std dev within cluster
    population_share: float = 0.0  # fraction of training population
    population_count: int = 0  # absolute number of users in this profile
    description: str = ""  # human-readable interpretation
    ltv: float = 0.0  # estimated issuer lifetime value in USD (per-user)
    portfolio_ltv: float = 0.0  # ltv × population_count


class ProfileCatalog(BaseModel):
    """An immutable versioned set of canonical profiles."""

    version: str  # hash-based version ID
    created_at: datetime = Field(default_factory=datetime.utcnow)
    k: int = 10
    feature_names: list[str] = []
    core_feature_names: list[str] = []  # FR-2A: features used for clustering
    scaling_params: list[ScalingParams] = []
    profiles: list[CanonicalProfile] = []
    training_dataset_hash: str = ""
    config_hash: str = ""
    total_training_population: int = 0  # total users in training set
    source: str = ""  # "retail" | "test-users"
    dataset_max_date: datetime | None = None  # max transaction date in training set


class ProfileAssignment(BaseModel):
    """Assignment of a single user to a canonical profile."""

    customer_id: str = ""
    profile_id: str = ""
    confidence: float = 0.0
    feature_vector: dict[str, float] = {}
    alternates: list[dict] = []  # [{profile_id, distance}, ...]
    catalog_version: str = ""
    evaluation_timestamp: datetime = Field(default_factory=datetime.utcnow)


class TransitionMatrix(BaseModel):
    """Profile transition probability matrix."""

    profile_ids: list[str] = []  # ordered profile IDs
    matrix: list[list[float]] = []  # T[i][j] = P(i → j), row-normalized
    raw_counts: list[list[int]] = []  # raw transition counts before smoothing
    smoothing_alpha: float = 0.0  # Laplace smoothing parameter used
    smoothed: bool = False  # whether smoothing was applied
    time_window: str = "Q"  # "Q" = quarterly, "M" = monthly
    catalog_version: str = ""
    num_users: int = 0
    num_transitions: int = 0


class SimulationResult(BaseModel):
    """Result of a multi-period portfolio simulation."""

    periods: int = 0
    profile_ids: list[str] = []
    population_vectors: list[list[float]] = []  # [period][profile_idx] = share
    catalog_version: str = ""
