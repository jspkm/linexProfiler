"""Compute derived features from cleaned transactions."""

from __future__ import annotations

import statistics
from collections import Counter, defaultdict
from datetime import datetime

from models.features import CategoryBreakdown, UserFeatures
from models.transaction import UserTransactions

CATEGORY_KEYWORDS: dict[str, list[str]] = {
    "home_decor": [
        "doormat", "frame", "hook", "sign", "clock", "mirror", "ornament",
        "plaque", "bunting", "garland", "wreath", "wall",
    ],
    "kitchen": [
        "mug", "plate", "bowl", "spoon", "teapot", "cake", "baking",
        "cutlery", "cup", "saucer", "jug", "tray", "frying pan", "milk pan",
        "coaster", "napkin", "apron", "rolling pin",
    ],
    "lighting": [
        "candle", "light", "lamp", "lantern", "torch", "t-light", "tealight",
    ],
    "bags_storage": [
        "bag", "purse", "box", "tin", "basket", "storage", "jar",
        "container", "lunch",
    ],
    "gifts_novelty": [
        "gift", "toy", "game", "puzzle", "card", "sticker", "magnet",
        "keyring", "charm", "trinket", "treasure",
    ],
    "stationery": [
        "pen", "pencil", "notebook", "ruler", "calculator", "memo",
        "notepad", "journal", "diary",
    ],
    "seasonal": [
        "christmas", "easter", "valentine", "halloween", "advent",
    ],
    "children": [
        "child", "baby", "boy", "girl", "kid", "nursery",
    ],
    "textile": [
        "towel", "glove", "cushion", "quilt", "blanket", "throw",
        "rug", "textile",
    ],
    "garden_outdoor": [
        "garden", "plant", "flower", "pot", "bird", "feeder", "outdoor",
    ],
}


def _infer_category(description: str) -> str:
    """Infer category from product description using keyword matching."""
    desc_lower = description.lower()
    for category, keywords in CATEGORY_KEYWORDS.items():
        for kw in keywords:
            if kw in desc_lower:
                return category
    return "other"


def _compute_spending_trend(monthly_totals: list[float]) -> str:
    """Determine spending trend from chronological monthly totals."""
    if len(monthly_totals) < 3:
        return "insufficient_data"

    n = len(monthly_totals)
    x_mean = (n - 1) / 2
    y_mean = statistics.mean(monthly_totals)

    numerator = sum((i - x_mean) * (y - y_mean) for i, y in enumerate(monthly_totals))
    denominator = sum((i - x_mean) ** 2 for i in range(n))

    if denominator == 0:
        return "stable"

    slope = numerator / denominator
    relative_slope = slope / y_mean if y_mean != 0 else 0

    if relative_slope > 0.1:
        return "increasing"
    elif relative_slope < -0.1:
        return "decreasing"
    else:
        cv = (statistics.stdev(monthly_totals) / y_mean) if y_mean != 0 else 0
        return "sporadic" if cv > 1.0 else "stable"


def compute_features(user_txns: UserTransactions) -> UserFeatures:
    """Compute all features from a cleaned UserTransactions."""
    txns = user_txns.transactions
    if not txns:
        return UserFeatures(customer_id=user_txns.customer_id)

    # Sort by date
    txns = sorted(txns, key=lambda t: t.date)

    # Temporal features
    first_date = txns[0].date
    last_date = txns[-1].date
    span_days = max((last_date - first_date).days, 1)
    active_months = max(span_days // 30, 1)

    # Invoice-level aggregation
    invoices: dict[str, list] = defaultdict(list)
    for t in txns:
        key = t.invoice or t.date.isoformat()
        invoices[key].append(t)

    invoice_dates = sorted(set(t.date.date() for t in txns))
    days_between: list[float] = []
    for i in range(1, len(invoice_dates)):
        days_between.append((invoice_dates[i] - invoice_dates[i - 1]).days)

    invoice_values = [
        sum(t.amount for t in inv_txns)
        for inv_txns in invoices.values()
    ]

    # Spending features
    amounts = [t.amount for t in txns]
    total_spend = sum(amounts)
    unit_prices = [t.unit_price for t in txns if t.unit_price is not None and t.unit_price > 0]

    # Category breakdown
    category_spend: dict[str, float] = defaultdict(float)
    category_count: dict[str, int] = defaultdict(int)
    for t in txns:
        cat = t.category if t.category else _infer_category(t.description)
        category_spend[cat] += t.amount
        category_count[cat] += 1

    top_categories = sorted(
        [
            CategoryBreakdown(
                category=cat,
                spend=round(spend, 2),
                count=category_count[cat],
                pct_of_total=round(spend / total_spend * 100, 1) if total_spend > 0 else 0,
            )
            for cat, spend in category_spend.items()
        ],
        key=lambda c: c.spend,
        reverse=True,
    )[:10]

    # Wholesale indicators
    quantities = [t.quantity for t in txns]
    bulk_count = sum(1 for q in quantities if q >= 12)

    # Seasonality
    monthly_spend: dict[str, float] = defaultdict(float)
    monthly_totals_chrono: dict[str, float] = defaultdict(float)
    for t in txns:
        month_name = t.date.strftime("%B")
        monthly_spend[month_name] += t.amount
        year_month = t.date.strftime("%Y-%m")
        monthly_totals_chrono[year_month] += t.amount

    monthly_pct = {
        m: round(s / total_spend * 100, 1) if total_spend > 0 else 0
        for m, s in monthly_spend.items()
    }
    peak_month = max(monthly_spend, key=monthly_spend.get) if monthly_spend else ""

    chrono_keys = sorted(monthly_totals_chrono.keys())
    chrono_values = [monthly_totals_chrono[k] for k in chrono_keys]

    # Cancellation features (from original, not cleaned)
    cancellation_count = sum(1 for t in txns if t.is_cancellation)

    # Unique descriptions for LLM context
    desc_counter = Counter(t.description for t in txns if t.description)
    top_descs = [desc for desc, _ in desc_counter.most_common(20)]
    # Add some random diversity
    all_descs = list(set(t.description for t in txns if t.description))
    extra = [d for d in all_descs if d not in top_descs][:5]
    sample_descriptions = top_descs + extra

    # Country / currency
    countries = Counter(t.country for t in txns if t.country)
    primary_country = countries.most_common(1)[0][0] if countries else ""
    currencies = Counter(t.currency for t in txns if t.currency)
    primary_currency = currencies.most_common(1)[0][0] if currencies else ""

    # Unique products
    unique_products = len(set(
        t.stock_code or t.description for t in txns if t.stock_code or t.description
    ))

    return UserFeatures(
        customer_id=user_txns.customer_id,
        country=primary_country,
        currency=primary_currency,
        first_purchase_date=first_date,
        last_purchase_date=last_date,
        active_months=active_months,
        purchase_frequency_per_month=round(len(invoices) / active_months, 2),
        days_between_purchases_mean=round(statistics.mean(days_between), 1) if days_between else 0.0,
        days_between_purchases_std=round(statistics.stdev(days_between), 1) if len(days_between) > 1 else 0.0,
        total_spend=round(total_spend, 2),
        avg_transaction_value=round(statistics.mean(invoice_values), 2) if invoice_values else 0.0,
        median_transaction_value=round(statistics.median(invoice_values), 2) if invoice_values else 0.0,
        max_transaction_value=round(max(invoice_values), 2) if invoice_values else 0.0,
        avg_unit_price=round(statistics.mean(unit_prices), 2) if unit_prices else 0.0,
        total_transactions=len(txns),
        total_invoices=len(invoices),
        total_units_purchased=sum(quantities),
        unique_products=unique_products,
        cancellation_count=cancellation_count,
        cancellation_rate=round(cancellation_count / len(invoices), 3) if invoices else 0.0,
        top_categories=top_categories,
        product_diversity_score=round(unique_products / len(txns), 3) if txns else 0.0,
        bulk_purchase_ratio=round(bulk_count / len(txns), 3) if txns else 0.0,
        avg_quantity_per_line=round(statistics.mean(quantities), 1) if quantities else 0.0,
        max_single_quantity=max(quantities) if quantities else 0,
        monthly_spend_distribution=monthly_pct,
        peak_month=peak_month,
        spending_trend=_compute_spending_trend(chrono_values),
        price_range=(
            round(min(unit_prices), 2) if unit_prices else 0.0,
            round(max(unit_prices), 2) if unit_prices else 0.0,
        ),
        sample_descriptions=sample_descriptions,
    )
