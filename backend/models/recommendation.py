from __future__ import annotations

from pydantic import BaseModel


class CardMatch(BaseModel):
    """A single credit card recommendation with reasoning."""

    card_id: str
    card_name: str
    issuer: str
    fit_score: int  # 0-100
    why_it_matches: str
    estimated_annual_reward_value: str
    description: str


class CardRecommendation(BaseModel):
    """Top credit card recommendations for a user."""

    customer_id: str = ""
    recommendations: list[CardMatch] = []
    raw_toon: str = ""  # The raw TOON-formatted recommendations from the LLM
