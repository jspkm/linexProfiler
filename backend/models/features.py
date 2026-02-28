from __future__ import annotations

from datetime import datetime
from pydantic import BaseModel


class CategoryBreakdown(BaseModel):
    category: str
    spend: float
    count: int
    pct_of_total: float


class UserFeatures(BaseModel):
    """Computed features from a user's transaction history."""

    customer_id: str = ""
    country: str = ""
    currency: str = ""

    # Temporal
    first_purchase_date: datetime | None = None
    last_purchase_date: datetime | None = None
    active_months: int = 0
    purchase_frequency_per_month: float = 0.0
    days_between_purchases_mean: float = 0.0
    days_between_purchases_std: float = 0.0

    # Spending
    total_spend: float = 0.0
    avg_transaction_value: float = 0.0
    median_transaction_value: float = 0.0
    max_transaction_value: float = 0.0
    avg_unit_price: float = 0.0

    # Volume
    total_transactions: int = 0
    total_invoices: int = 0
    total_units_purchased: int = 0
    unique_products: int = 0

    # Cancellations
    cancellation_count: int = 0
    cancellation_rate: float = 0.0

    # Categories
    top_categories: list[CategoryBreakdown] = []
    product_diversity_score: float = 0.0

    # Wholesale indicators
    bulk_purchase_ratio: float = 0.0
    avg_quantity_per_line: float = 0.0
    max_single_quantity: int = 0

    # Seasonality
    monthly_spend_distribution: dict[str, float] = {}
    peak_month: str = ""
    spending_trend: str = ""  # "increasing", "decreasing", "stable", "sporadic"

    # Price sensitivity
    price_range: tuple[float, float] = (0.0, 0.0)

    # Sample descriptions for LLM context
    sample_descriptions: list[str] = []
