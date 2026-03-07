"""Incentive set management: seeding, versioning, and cost map computation.

The 133 seed incentives (previously hardcoded in experiment.py) live here as
SEED_INCENTIVES. On first use, load_or_seed_default() creates the initial
IncentiveSet in Firestore if none exists.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone

from models.incentive_set import Incentive, IncentiveSet
from profile_generator.firestore_client import (
    fs_get_default_incentive_set,
    fs_save_incentive_set,
)

# redemption_rate: fraction of users who actually redeem/use the benefit.
# Auto-applied rewards (cash back, points) ~ 0.85-0.95
# Popular monthly credits ~ 0.55-0.70
# Travel/niche perks ~ 0.10-0.30
# Insurance/protection (claim-based) ~ 0.03-0.10
# Fee waivers (automatic) ~ 1.0
SEED_INCENTIVES = [
    {"name": "5x points for dining", "estimated_annual_cost_per_user": 45, "redemption_rate": 0.90},
    {"name": "2% flat cash back", "estimated_annual_cost_per_user": 60, "redemption_rate": 0.95},
    {"name": "$0 intro fee (Waived $95)", "estimated_annual_cost_per_user": 95, "redemption_rate": 1.0},
    {"name": "Double rewards on groceries", "estimated_annual_cost_per_user": 40, "redemption_rate": 0.90},
    {"name": "10x points on travel", "estimated_annual_cost_per_user": 120, "redemption_rate": 0.30},
    {"name": "0% APR for 15 months", "estimated_annual_cost_per_user": 80, "redemption_rate": 0.60},
    {"name": "$200 sign-up bonus", "estimated_annual_cost_per_user": 200, "redemption_rate": 0.85},
    {"name": "Complimentary Airport Lounge Access", "estimated_annual_cost_per_user": 150, "redemption_rate": 0.18},
    {"name": "$50 Annual Statement Credit for Streaming", "estimated_annual_cost_per_user": 50, "redemption_rate": 0.65},
    {"name": "No Foreign Transaction Fees", "estimated_annual_cost_per_user": 25, "redemption_rate": 0.25},
    {"name": "Free primary rental car insurance", "estimated_annual_cost_per_user": 35, "redemption_rate": 0.12},
    {"name": "Elite Hotel Status Match", "estimated_annual_cost_per_user": 75, "redemption_rate": 0.10},
    {"name": "3x points on gas station purchases", "estimated_annual_cost_per_user": 30, "redemption_rate": 0.85},
    {"name": "Complimentary Global Entry/TSA PreCheck", "estimated_annual_cost_per_user": 20, "redemption_rate": 0.15},
    {"name": "$10 monthly Uber/Uber Eats credit", "estimated_annual_cost_per_user": 120, "redemption_rate": 0.60},
    {"name": "Preferred boarding on partner airlines", "estimated_annual_cost_per_user": 50, "redemption_rate": 0.15},
    {"name": "6% cash back on select US streaming", "estimated_annual_cost_per_user": 45, "redemption_rate": 0.70},
    {"name": "3% cash back on online retail", "estimated_annual_cost_per_user": 55, "redemption_rate": 0.90},
    {"name": "Unlimited free delivery via DashPass", "estimated_annual_cost_per_user": 96, "redemption_rate": 0.40},
    {"name": "Purchase protection (up to $500/claim)", "estimated_annual_cost_per_user": 15, "redemption_rate": 0.05},
    {"name": "Extended warranty protection (+1 year)", "estimated_annual_cost_per_user": 10, "redemption_rate": 0.04},
    {"name": "4% cash back on gas and EV charging", "estimated_annual_cost_per_user": 40, "redemption_rate": 0.85},
    {"name": "$200 airline fee credit", "estimated_annual_cost_per_user": 200, "redemption_rate": 0.25},
    {"name": "Cell phone protection (up to $600)", "estimated_annual_cost_per_user": 25, "redemption_rate": 0.08},
    {"name": "3x points on drugstores", "estimated_annual_cost_per_user": 20, "redemption_rate": 0.75},
    {"name": "Complimentary first checked bag", "estimated_annual_cost_per_user": 60, "redemption_rate": 0.20},
    {"name": "Low intro APR on balance transfers", "estimated_annual_cost_per_user": 70, "redemption_rate": 0.35},
    {"name": "$100 hotel credit on luxury stays", "estimated_annual_cost_per_user": 100, "redemption_rate": 0.12},
    {"name": "5% cash back on rotating categories", "estimated_annual_cost_per_user": 50, "redemption_rate": 0.55},
    {"name": "Identity theft protection services", "estimated_annual_cost_per_user": 12, "redemption_rate": 0.10},
    {"name": "$15 monthly dining credit", "estimated_annual_cost_per_user": 180, "redemption_rate": 0.65},
    {"name": "Airport concierge services discount", "estimated_annual_cost_per_user": 30, "redemption_rate": 0.05},
    {"name": "Double points on all foreign spend", "estimated_annual_cost_per_user": 45, "redemption_rate": 0.25},
    {"name": "$300 annual travel credit", "estimated_annual_cost_per_user": 300, "redemption_rate": 0.30},
    {"name": "5x points on flights booked via portal", "estimated_annual_cost_per_user": 70, "redemption_rate": 0.20},
    {"name": "10x points on hotels booked via portal", "estimated_annual_cost_per_user": 130, "redemption_rate": 0.15},
    {"name": "$20 monthly digital entertainment credit", "estimated_annual_cost_per_user": 240, "redemption_rate": 0.55},
    {"name": "Complimentary Boingo Wi-Fi access", "estimated_annual_cost_per_user": 15, "redemption_rate": 0.05},
    {"name": "$100 back for Global Entry application", "estimated_annual_cost_per_user": 20, "redemption_rate": 0.15},
    {"name": "Unlimited 1.5% cash back on all spend", "estimated_annual_cost_per_user": 45, "redemption_rate": 0.95},
    {"name": "3x points on office supply stores", "estimated_annual_cost_per_user": 40, "redemption_rate": 0.30},
    {"name": "25% redemption bonus on travel", "estimated_annual_cost_per_user": 85, "redemption_rate": 0.25},
    {"name": "Free credit score monitoring", "estimated_annual_cost_per_user": 5, "redemption_rate": 0.35},
    {"name": "$200 hotel statement credit", "estimated_annual_cost_per_user": 200, "redemption_rate": 0.15},
    {"name": "3x points on eco-friendly merchants", "estimated_annual_cost_per_user": 25, "redemption_rate": 0.20},
    {"name": "Complimentary ShopRunner membership", "estimated_annual_cost_per_user": 10, "redemption_rate": 0.15},
    {"name": "$50 back on fitness subscriptions", "estimated_annual_cost_per_user": 50, "redemption_rate": 0.25},
    {"name": "Triple points on local transit/commute", "estimated_annual_cost_per_user": 35, "redemption_rate": 0.35},
    {"name": "No overlimit fees ever", "estimated_annual_cost_per_user": 8, "redemption_rate": 1.0},
    {"name": "$0 foreign transaction fee (premium)", "estimated_annual_cost_per_user": 30, "redemption_rate": 0.25},
    {"name": "2x points on entertainment and tickets", "estimated_annual_cost_per_user": 35, "redemption_rate": 0.50},
    {"name": "Complimentary roadside assistance", "estimated_annual_cost_per_user": 20, "redemption_rate": 0.06},
    {"name": "3x points on wholesale clubs", "estimated_annual_cost_per_user": 40, "redemption_rate": 0.45},
    {"name": "$100 anniversary travel voucher", "estimated_annual_cost_per_user": 100, "redemption_rate": 0.20},
    {"name": "5x points on prepaid rental cars", "estimated_annual_cost_per_user": 60, "redemption_rate": 0.10},
    {"name": "Airport lounge guest passes (2/yr)", "estimated_annual_cost_per_user": 60, "redemption_rate": 0.12},
    {"name": "$5 monthly coffee shop credit", "estimated_annual_cost_per_user": 60, "redemption_rate": 0.55},
    {"name": "Double points on utilities and bills", "estimated_annual_cost_per_user": 50, "redemption_rate": 0.70},
    {"name": "3x points on department stores", "estimated_annual_cost_per_user": 35, "redemption_rate": 0.40},
    {"name": "Complimentary museum pass program", "estimated_annual_cost_per_user": 20, "redemption_rate": 0.08},
    {"name": "$40 annual credit for pet supplies", "estimated_annual_cost_per_user": 40, "redemption_rate": 0.20},
    {"name": "No late payment fees for first year", "estimated_annual_cost_per_user": 25, "redemption_rate": 1.0},
    {"name": "5x points on ride-sharing", "estimated_annual_cost_per_user": 55, "redemption_rate": 0.35},
    {"name": "$100 home improvement store credit", "estimated_annual_cost_per_user": 100, "redemption_rate": 0.15},
    {"name": "2x points on online subscriptions", "estimated_annual_cost_per_user": 30, "redemption_rate": 0.65},
    {"name": "Global Assist Hotline access", "estimated_annual_cost_per_user": 5, "redemption_rate": 0.03},
    {"name": "3x points on charitable donations", "estimated_annual_cost_per_user": 15, "redemption_rate": 0.15},
    {"name": "$25 statement credit for car rentals", "estimated_annual_cost_per_user": 25, "redemption_rate": 0.15},
    {"name": "Free annual night stay at partner hotel", "estimated_annual_cost_per_user": 250, "redemption_rate": 0.12},
    {"name": "5x points on cell phone services", "estimated_annual_cost_per_user": 65, "redemption_rate": 0.60},
    {"name": "Complimentary CLEAR membership", "estimated_annual_cost_per_user": 189, "redemption_rate": 0.08},
    {"name": "2x points on health and wellness", "estimated_annual_cost_per_user": 30, "redemption_rate": 0.35},
    {"name": "$100 Saks Fifth Avenue credit", "estimated_annual_cost_per_user": 100, "redemption_rate": 0.18},
    {"name": "Unlimited 2x points for first year", "estimated_annual_cost_per_user": 150, "redemption_rate": 0.85},
    {"name": "Trip delay reimbursement up to $500", "estimated_annual_cost_per_user": 15, "redemption_rate": 0.05},
    {"name": "Baggage delay insurance up to $100/day", "estimated_annual_cost_per_user": 10, "redemption_rate": 0.04},
    {"name": "$50 annual credit for florist/gifts", "estimated_annual_cost_per_user": 50, "redemption_rate": 0.12},
    {"name": "Double points on insurance premiums", "estimated_annual_cost_per_user": 70, "redemption_rate": 0.30},
    {"name": "5x points on luxury brand purchases", "estimated_annual_cost_per_user": 120, "redemption_rate": 0.15},
    {"name": "Priority Pass Select membership", "estimated_annual_cost_per_user": 150, "redemption_rate": 0.15},
    {"name": "$100 annual credit for luxury spa", "estimated_annual_cost_per_user": 100, "redemption_rate": 0.10},
    {"name": "3x points on educational expenses", "estimated_annual_cost_per_user": 50, "redemption_rate": 0.15},
    {"name": "Free shipping on all portal shopping", "estimated_annual_cost_per_user": 20, "redemption_rate": 0.40},
    {"name": "$30 annual statement credit for Wi-Fi", "estimated_annual_cost_per_user": 30, "redemption_rate": 0.35},
    {"name": "Return protection up to $300/item", "estimated_annual_cost_per_user": 15, "redemption_rate": 0.05},
    {"name": "Double points on home security spend", "estimated_annual_cost_per_user": 25, "redemption_rate": 0.15},
    {"name": "5x points on concerts and theaters", "estimated_annual_cost_per_user": 80, "redemption_rate": 0.20},
    {"name": "$150 annual statement credit for cruises", "estimated_annual_cost_per_user": 150, "redemption_rate": 0.08},
    {"name": "Unlimited 3% cash back on travel booked through us", "estimated_annual_cost_per_user": 90, "redemption_rate": 0.30},
    {"name": "2x points on hardware and DIY stores", "estimated_annual_cost_per_user": 35, "redemption_rate": 0.25},
    {"name": "$50 annual statement credit for pharmacy", "estimated_annual_cost_per_user": 50, "redemption_rate": 0.40},
    {"name": "Double points on recurring memberships", "estimated_annual_cost_per_user": 40, "redemption_rate": 0.55},
    {"name": "5x points on electric vehicle charging", "estimated_annual_cost_per_user": 50, "redemption_rate": 0.10},
    {"name": "Free entry to selected art galleries", "estimated_annual_cost_per_user": 15, "redemption_rate": 0.06},
    {"name": "$75 statement credit for baggage fees", "estimated_annual_cost_per_user": 75, "redemption_rate": 0.18},
    {"name": "6x points on selected supermarket spend", "estimated_annual_cost_per_user": 110, "redemption_rate": 0.80},
    {"name": "Unlimited 1% cash back on everything else", "estimated_annual_cost_per_user": 25, "redemption_rate": 0.95},
    {"name": "$100 statement credit for golf courses", "estimated_annual_cost_per_user": 100, "redemption_rate": 0.06},
    {"name": "Double points on all eco-transfers", "estimated_annual_cost_per_user": 30, "redemption_rate": 0.15},
    {"name": "5x points on furniture and decor", "estimated_annual_cost_per_user": 95, "redemption_rate": 0.15},
    {"name": "$50 annual credit for sustainable local business", "estimated_annual_cost_per_user": 50, "redemption_rate": 0.12},
    {"name": "3x points on professional services", "estimated_annual_cost_per_user": 45, "redemption_rate": 0.20},
    {"name": "Complimentary premium airport transfers (1/yr)", "estimated_annual_cost_per_user": 100, "redemption_rate": 0.05},
    {"name": "Double points on pet insurance premiums", "estimated_annual_cost_per_user": 20, "redemption_rate": 0.12},
]


def generate_version(incentives: list[dict]) -> str:
    """Generate a deterministic version string from incentive contents."""
    canonical = json.dumps(
        sorted(incentives, key=lambda i: i["name"]),
        sort_keys=True,
    )
    digest = hashlib.sha256(canonical.encode()).hexdigest()[:12]
    return f"is_{digest}"


def get_incentive_cost_map(incentives: list[dict]) -> dict[str, float]:
    """Compute effective cost map: name -> annual_cost * redemption_rate."""
    return {
        inc["name"]: round(
            inc["estimated_annual_cost_per_user"] * inc["redemption_rate"], 2
        )
        for inc in incentives
    }


def load_or_seed_default() -> IncentiveSet:
    """Load the default incentive set from Firestore. Seed from SEED_INCENTIVES if none exists."""
    existing = fs_get_default_incentive_set()
    if existing:
        return existing

    version = generate_version(SEED_INCENTIVES)
    incentive_set = IncentiveSet(
        version=version,
        name="Default Incentive Set",
        description="Seed set of 133 credit card incentive programs.",
        is_default=True,
        incentive_count=len(SEED_INCENTIVES),
        incentives=[Incentive(**inc) for inc in SEED_INCENTIVES],
    )
    fs_save_incentive_set(incentive_set)
    return incentive_set
