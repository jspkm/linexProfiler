from __future__ import annotations

from pydantic import BaseModel


class Attribute(BaseModel):
    """A single deduced attribute with confidence."""

    value: str
    confidence: str  # "high", "medium", "low"


class UserProfile(BaseModel):
    """LLM-deduced demographic and behavioral profile.

    Uses a flexible dict of attributes so the LLM can return as many
    Linex-relevant profiles as it deems useful, not limited to a fixed set.
    """

    customer_id: str = ""
    attributes: dict[str, Attribute] = {}
    raw_toon: str = ""  # The raw TOON-formatted profile from the LLM
