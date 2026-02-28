"""Format features and data into LLM-consumable text using TOON encoding."""

from __future__ import annotations

from models.features import UserFeatures
from utils.toon import encode


def format_features_for_llm(features: UserFeatures) -> str:
    """Convert UserFeatures into a TOON-encoded string for LLM consumption."""

    # Build a structured dict that the LLM can reason about
    data = {
        "customer_id": features.customer_id,
        "country": features.country,
    }

    # Temporal
    temporal = {
        "first_purchase": features.first_purchase_date.isoformat() if features.first_purchase_date else "unknown",
        "last_purchase": features.last_purchase_date.isoformat() if features.last_purchase_date else "unknown",
        "active_months": features.active_months,
        "purchase_frequency_per_month": features.purchase_frequency_per_month,
        "avg_days_between_purchases": features.days_between_purchases_mean,
    }

    # Spending
    spending = {
        "total_spend": features.total_spend,
        "avg_invoice_value": features.avg_transaction_value,
        "median_invoice_value": features.median_transaction_value,
        "max_invoice_value": features.max_transaction_value,
        "avg_unit_price": features.avg_unit_price,
    }

    # Volume
    volume = {
        "total_transactions": features.total_transactions,
        "total_invoices": features.total_invoices,
        "total_units": features.total_units_purchased,
        "unique_products": features.unique_products,
    }

    # Cancellation
    cancellation = {
        "count": features.cancellation_count,
        "rate": features.cancellation_rate,
    }

    # Wholesale indicators
    wholesale = {
        "bulk_purchase_ratio": features.bulk_purchase_ratio,
        "avg_quantity_per_line": features.avg_quantity_per_line,
        "max_single_quantity": features.max_single_quantity,
    }

    # Categories as tabular
    categories = [
        {
            "category": c.category,
            "spend": c.spend,
            "count": c.count,
            "pct": c.pct_of_total,
        }
        for c in features.top_categories
    ]

    # Seasonality
    seasonality = {
        "peak_month": features.peak_month,
        "spending_trend": features.spending_trend,
    }

    price_sensitivity = {
        "price_range_low": features.price_range[0],
        "price_range_high": features.price_range[1],
    }

    # Build full TOON document
    parts = [
        encode(data, "user"),
        encode(temporal, "temporal"),
        encode(spending, "spending"),
        encode(volume, "volume"),
        encode(cancellation, "cancellations"),
        encode(wholesale, "wholesale_indicators"),
        encode(categories, "categories") if categories else "",
        encode(seasonality, "seasonality"),
        encode(price_sensitivity, "price_sensitivity"),
    ]

    # Sample descriptions as simple list
    if features.sample_descriptions:
        descs = features.sample_descriptions[:25]
        parts.append(f"sample_products[{len(descs)}]: {','.join(descs)}")

    return "\n".join(p for p in parts if p)


def format_cards_for_llm(cards: list[dict]) -> str:
    """Convert a list of card dicts into TOON-encoded string for LLM."""
    if not cards:
        return "cards[0]:"

    # Flatten earn_rates and signup_bonus into simple fields for tabular display
    flat_cards = []
    for c in cards:
        flat = {
            "id": c.get("id", ""),
            "name": c.get("name", ""),
            "issuer": c.get("issuer", ""),
            "region": c.get("region", ""),
            "annual_fee": c.get("annual_fee", 0),
            "rewards_program": c.get("rewards_program", ""),
            "best_for": " | ".join(c.get("best_for", [])),
            "typical_cardholder": c.get("typical_cardholder", ""),
            "foreign_tx_fee_pct": c.get("foreign_transaction_fee_pct", 0),
        }
        flat_cards.append(flat)

    result = encode(flat_cards, "cards")

    # Add detailed earn rates and perks as nested blocks
    details = []
    for c in cards:
        detail_lines = [f" {c['id']}:"]
        earn_rates = c.get("earn_rates", {})
        if earn_rates:
            detail_lines.append("  earn_rates:")
            for k, v in earn_rates.items():
                detail_lines.append(f"   {k}: {v}")
        perks = c.get("perks", [])
        if perks:
            detail_lines.append(f"  perks[{len(perks)}]: {','.join(perks)}")
        bonus = c.get("signup_bonus")
        if bonus:
            detail_lines.append("  signup_bonus:")
            for k, v in bonus.items():
                detail_lines.append(f"   {k}: {v}")
        details.append("\n".join(detail_lines))

    if details:
        result += "\ncard_details:\n" + "\n".join(details)

    return result
