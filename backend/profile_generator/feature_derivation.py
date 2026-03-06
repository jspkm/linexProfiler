"""Derive behavioral features from a batch of user transactions.

Features are auto-derived from the transaction dataset — not hardcoded.
The derived feature space covers:
  - Purchase cadence (inter-purchase gap stats)
  - Spend intensity (total, AOV, max order)
  - Recency (days since last purchase)
  - Return/refund behavior (cancellation count and rate)
  - Product diversity (unique products / total transactions)
  - Temporal spread (active months as fraction of total span)
"""

from __future__ import annotations

import statistics
from collections import defaultdict
from datetime import datetime

import pandas as pd

from analysis.preprocessor import parse_csv_transactions, clean_transactions
from models.transaction import UserTransactions


def derive_user_features(
    user_txns: UserTransactions,
    eval_date: datetime | None = None,
) -> dict[str, float]:
    """Compute behavioral feature vector for a single user.

    Returns a dict of feature_name → raw value.
    """
    txns = user_txns.transactions
    if not txns:
        return {}

    # Sort by date
    txns_sorted = sorted(txns, key=lambda t: t.date)
    amounts = [t.amount for t in txns_sorted]
    dates = [t.date for t in txns_sorted]

    if eval_date is None:
        eval_date = max(dates)

    # --- Purchase cadence ---
    if len(dates) > 1:
        gaps = [(dates[i + 1] - dates[i]).days for i in range(len(dates) - 1)]
        gaps = [g for g in gaps if g >= 0]  # filter negative gaps
        cadence_mean = statistics.mean(gaps) if gaps else 0.0
        cadence_std = statistics.stdev(gaps) if len(gaps) > 1 else 0.0
    else:
        cadence_mean = 0.0
        cadence_std = 0.0

    # --- Spend intensity ---
    total_spend = sum(a for a in amounts if a > 0)
    positive_amounts = [a for a in amounts if a > 0]
    avg_order_value = statistics.mean(positive_amounts) if positive_amounts else 0.0
    max_order_value = max(positive_amounts) if positive_amounts else 0.0

    # --- Recency ---
    recency_days = (eval_date - max(dates)).days if dates else 9999

    # --- Return / refund behavior ---
    all_txns = user_txns.transactions  # include cancellations
    cancellation_count = sum(1 for t in all_txns if t.is_cancellation)
    total_count = len(all_txns)
    cancellation_rate = cancellation_count / total_count if total_count > 0 else 0.0

    # --- Product diversity ---
    descriptions = set()
    for t in txns_sorted:
        if t.description:
            descriptions.add(t.description.lower().strip())
    unique_products = len(descriptions)
    product_diversity = unique_products / len(txns_sorted) if txns_sorted else 0.0

    # --- Temporal spread ---
    if len(dates) > 1:
        span_days = (max(dates) - min(dates)).days
        months_seen: set[str] = set()
        for d in dates:
            months_seen.add(f"{d.year}-{d.month:02d}")
        active_months = len(months_seen)
        total_months = max(span_days / 30.0, 1.0)
        temporal_spread = min(active_months / total_months, 1.0)
    else:
        active_months = 1
        temporal_spread = 0.0

    # --- Transaction frequency (per month) ---
    if len(dates) > 1:
        span_days = (max(dates) - min(dates)).days
        months_span = max(span_days / 30.0, 1.0)
        frequency_per_month = len(txns_sorted) / months_span
    else:
        frequency_per_month = float(len(txns_sorted))

    return {
        "cadence_mean": cadence_mean,
        "cadence_std": cadence_std,
        "total_spend": total_spend,
        "avg_order_value": avg_order_value,
        "max_order_value": max_order_value,
        "recency_days": recency_days,
        "cancellation_count": float(cancellation_count),
        "cancellation_rate": cancellation_rate,
        "unique_products": float(unique_products),
        "product_diversity": product_diversity,
        "active_months": float(active_months),
        "temporal_spread": temporal_spread,
        "frequency_per_month": frequency_per_month,
        "transaction_count": float(len(txns_sorted)),
    }


# Feature names in canonical order
FEATURE_NAMES = [
    "cadence_mean",
    "cadence_std",
    "total_spend",
    "avg_order_value",
    "max_order_value",
    "recency_days",
    "cancellation_count",
    "cancellation_rate",
    "unique_products",
    "product_diversity",
    "active_months",
    "temporal_spread",
    "frequency_per_month",
    "transaction_count",
]


# ---------------------------------------------------------------------------
# FR-2A Behavioral Axes
#
# Every derived feature belongs to one of the four core economic dimensions.
# Canonical profile construction clusters on the PRIMARY feature of each axis.
# All features (primary + secondary) are retained in centroids for enrichment.
# ---------------------------------------------------------------------------

CORE_AXES: dict[str, list[str]] = {
    "activity_recency": [
        "recency_days",         # primary — days since last purchase
        "active_months",        # months with ≥1 transaction
        "temporal_spread",      # active months / total months ratio
    ],
    "purchase_frequency": [
        "frequency_per_month",  # primary — transactions per month
        "transaction_count",    # total number of transactions
        "cadence_mean",         # mean inter-purchase gap (days)
        "cadence_std",          # variability of purchase gaps
    ],
    "spend_intensity": [
        "total_spend",          # primary — total positive spend
        "avg_order_value",      # mean order size
        "max_order_value",      # largest single order
        "unique_products",      # distinct products purchased
        "product_diversity",    # unique products / total transactions
    ],
    "refund_return": [
        "cancellation_rate",    # primary — cancellations / total txns
        "cancellation_count",   # absolute count of cancellations
    ],
}

# The first entry in each axis list is the primary (clustering) feature
CORE_FEATURE_NAMES: list[str] = [
    axis_features[0] for axis_features in CORE_AXES.values()
]

AUXILIARY_FEATURE_NAMES: list[str] = [
    f for f in FEATURE_NAMES if f not in CORE_FEATURE_NAMES
]


def derive_batch_features(
    users: dict[str, UserTransactions],
    eval_date: datetime | None = None,
) -> pd.DataFrame:
    """Derive feature vectors for a batch of users.

    Args:
        users: mapping of customer_id → UserTransactions
        eval_date: optional evaluation date for recency calculation

    Returns:
        DataFrame with customer_id as index, one column per feature.
    """
    rows: list[dict[str, float]] = []
    index: list[str] = []

    # If no eval_date given, use the global max transaction date across all
    # users so that recency is relative to the dataset (important for
    # historical data where today's date would make everyone look dormant).
    if eval_date is None:
        global_max: datetime | None = None
        for user_txns in users.values():
            for t in user_txns.transactions:
                if global_max is None or t.date > global_max:
                    global_max = t.date
        eval_date = global_max

    for cid, user_txns in users.items():
        fv = derive_user_features(user_txns, eval_date)
        if fv:
            rows.append(fv)
            index.append(cid)

    if not rows:
        return pd.DataFrame(columns=FEATURE_NAMES)

    df = pd.DataFrame(rows, index=index)
    # Ensure canonical column order, fill missing with 0
    for col in FEATURE_NAMES:
        if col not in df.columns:
            df[col] = 0.0

    return df[FEATURE_NAMES]
