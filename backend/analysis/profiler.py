"""LLM-based user profiling: features → demographic/behavioral profile."""

from __future__ import annotations

import re

from google import genai

from analysis.card_matcher import _parse_toon_recommendations
from config import GEMINI_API_KEY, MODEL
from cards.catalog import CardCatalog
from models.features import UserFeatures
from models.profile import Attribute, UserProfile
from models.profile_catalog import ProfileAssignment
from models.recommendation import CardRecommendation
from prompts.profiling import SYSTEM_PROMPT, build_user_prompt
from utils.formatters import format_features_for_llm, format_profiles_for_llm, format_cards_for_llm

# Pattern: attribute_name: value [confidence]
_ATTR_RE = re.compile(r"^([a-z_][a-z0-9_]*):\s*(.+?)\s*\[(high|medium|low)\]\s*$")


def _parse_toon_profile(raw: str, customer_id: str) -> UserProfile:
    """Parse the LLM's TOON-formatted profile into a UserProfile.

    Accepts both nested (linex_profile: > profile: > attrs) and flat formats.
    Strips the envelope lines and keeps only the attribute lines for raw_toon,
    then re-wraps them in the full linex_profile > profile structure.
    """
    attributes: dict[str, Attribute] = {}
    attr_lines: list[str] = []

    for line in raw.strip().split("\n"):
        stripped = line.strip()
        if not stripped:
            continue
        # Stop collecting attributes if we hit the card recommendations block
        if stripped == "card_recommendation:":
            break

        # Skip envelope lines like "linex_profile:" and "profile:"
        if stripped in ("linex_profile:", "profile:"):
            continue

        m = _ATTR_RE.match(stripped)
        if m:
            key = m.group(1)
            value = m.group(2).strip()
            confidence = m.group(3)
            attributes[key] = Attribute(value=value, confidence=confidence)
            attr_lines.append(f"  {stripped}")

    # Build the full linex_profile TOON structure for just the profile block
    toon_lines = ["linex_profile:", " profile:"] + attr_lines
    raw_profile_toon = "\n".join(toon_lines)

    return UserProfile(
        customer_id=customer_id,
        attributes=attributes,
        raw_toon=raw_profile_toon,
    )


def _strip_code_fences(raw_text: str) -> str:
    """Strip markdown code fences if present."""
    if raw_text.startswith("```"):
        lines = raw_text.split("\n")
        clean_lines = []
        in_block = False
        for line in lines:
            if line.startswith("```") and not in_block:
                in_block = True
                continue
            if line.startswith("```") and in_block:
                break
            if in_block:
                clean_lines.append(line)
        return "\n".join(clean_lines)
    return raw_text


def profile_user_sync(
    features: UserFeatures,
    assignment: ProfileAssignment | None = None,
    card_catalog: CardCatalog | None = None,
    region_filter: str | None = None,
) -> tuple[UserProfile, CardRecommendation]:
    """Profile a user and recommend cards using the Gemini API in a single call."""
    client = genai.Client(api_key=GEMINI_API_KEY)
    
    # Format inputs
    features_toon = format_features_for_llm(features)
    profiles_toon = format_profiles_for_llm(assignment) if assignment else "assigned_profile: unknown"
    
    # Filter cards by region
    region = region_filter or features.country
    if card_catalog:
        cards = card_catalog.get_cards_for_region(region)
        if not cards:
            cards = card_catalog.cards  # Fallback to all cards
    else:
        cards = []
        
    cards_toon = format_cards_for_llm(cards)
    
    user_prompt = build_user_prompt(features_toon, profiles_toon, cards_toon)

    response = client.models.generate_content(
        model=MODEL,
        contents=user_prompt,
        config=genai.types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
            max_output_tokens=2000,
        ),
    )

    raw_text = response.text.strip()
    raw_text = _strip_code_fences(raw_text)

    # Parse the unified response into the two models
    user_profile = _parse_toon_profile(raw_text, features.customer_id)
    card_rec = _parse_toon_recommendations(raw_text, features.customer_id)

    return user_profile, card_rec
