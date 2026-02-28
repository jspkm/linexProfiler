"""LLM-based credit card matching: profile + features + catalog → recommendations."""

from __future__ import annotations

import re

from google import genai

from cards.catalog import CardCatalog
from config import GEMINI_API_KEY, CARDS_PATH, MODEL
from models.features import UserFeatures
from models.profile import UserProfile
from models.recommendation import CardMatch, CardRecommendation
from prompts.card_matching import SYSTEM_PROMPT, build_user_prompt
from utils.formatters import format_cards_for_llm, format_features_for_llm


_HEADER_RE = re.compile(
    r"recommendations\[(\d+)\]\{([^}]+)\}:"
)


def _parse_toon_recommendations(raw: str, customer_id: str) -> CardRecommendation:
    """Parse the LLM's TOON tabular-array card recommendations.

    Expected format:
        linex_profile:
         card_recommendation:
          recommendations[3]{card_id,card_name,issuer,fit_score,match,estimated_annual_value,description}:
           amex-gold-uk,Amex Gold,American Express,92,Strong dining spend,~£180,High interchange
           ...

    Also handles the older block-per-recommendation format as a fallback.
    """
    recommendations: list[CardMatch] = []

    # Strip code fences
    clean_lines = []
    for line in raw.strip().split("\n"):
        if line.strip().startswith("```"):
            continue
        clean_lines.append(line)
    raw_stripped = "\n".join(clean_lines).strip()

    # Try to find the tabular header
    fields: list[str] | None = None
    data_lines: list[str] = []
    in_data = False

    for line in raw_stripped.split("\n"):
        stripped = line.strip()
        if not stripped:
            continue

        # Match the header: recommendations[3]{field1,field2,...}:
        hm = _HEADER_RE.search(stripped)
        if hm:
            fields = [f.strip() for f in hm.group(2).split(",")]
            in_data = True
            continue

        if in_data and fields:
            # Skip envelope lines
            if stripped in ("linex_profile:", "card_recommendation:"):
                continue
            # A data row is a comma-separated line (indented under the header)
            # Stop if we hit a non-data line (e.g. a new section)
            if ":" in stripped and not any(c == "," for c in stripped):
                in_data = False
                continue
            data_lines.append(stripped)

    if fields and data_lines:
        # Parse tabular rows
        field_map = {f: i for i, f in enumerate(fields)}
        for row in data_lines:
            # Split by comma, but respect the number of fields
            # (match/description fields may contain commas, so limit splits)
            parts = row.split(",", len(fields) - 1)
            if len(parts) < len(fields):
                # Pad with empty strings if short
                parts += [""] * (len(fields) - len(parts))

            def _get(name: str) -> str:
                idx = field_map.get(name)
                if idx is not None and idx < len(parts):
                    return parts[idx].strip()
                return ""

            try:
                score = int(re.sub(r"[^\d]", "", _get("fit_score")) or "0")
            except ValueError:
                score = 0

            recommendations.append(CardMatch(
                card_id=_get("card_id"),
                card_name=_get("card_name"),
                issuer=_get("issuer"),
                fit_score=score,
                why_it_matches=_get("match"),
                estimated_annual_reward_value=_get("estimated_annual_value"),
                description=_get("description"),
            ))
    else:
        # Fallback: parse the older block format (recommendation_1: ...)
        current_block: dict[str, str] = {}

        def _flush():
            if current_block:
                try:
                    score = int(re.sub(r"[^\d]", "", current_block.get("fit_score", "0")) or "0")
                except ValueError:
                    score = 0
                recommendations.append(CardMatch(
                    card_id=current_block.get("card_id", ""),
                    card_name=current_block.get("card_name", ""),
                    issuer=current_block.get("issuer", ""),
                    fit_score=score,
                    why_it_matches=current_block.get("match", ""),
                    estimated_annual_reward_value=current_block.get("estimated_annual_value", ""),
                    description=current_block.get("description", ""),
                ))

        for line in raw_stripped.split("\n"):
            stripped = line.strip()
            if not stripped:
                continue
            if re.match(r"^recommendation_\d+:\s*$", stripped):
                _flush()
                current_block = {}
                continue
            if ":" in stripped and current_block is not None:
                key, _, val = stripped.partition(":")
                current_block[key.strip()] = val.strip()

        _flush()

    # Build the canonical TOON output
    if recommendations:
        field_names = "card_id,card_name,issuer,fit_score,match,estimated_annual_value,description"
        toon_lines = [
            "linex_profile:",
            " card_recommendation:",
            f"  recommendations[{len(recommendations)}]{{{field_names}}}:",
        ]
        for r in recommendations:
            toon_lines.append(
                f"   {r.card_id},{r.card_name},{r.issuer},{r.fit_score},"
                f"{r.why_it_matches},{r.estimated_annual_reward_value},{r.description}"
            )
        raw_toon = "\n".join(toon_lines)
    else:
        raw_toon = raw_stripped

    return CardRecommendation(
        customer_id=customer_id,
        recommendations=recommendations,
        raw_toon=raw_toon,
    )


def match_cards_sync(
    profile: UserProfile,
    features: UserFeatures,
    catalog: CardCatalog | None = None,
    region_filter: str | None = None,
) -> CardRecommendation:
    """Recommend credit cards based on user profile and spending features using Gemini."""
    if catalog is None:
        catalog = CardCatalog(str(CARDS_PATH))

    # Filter cards by region
    region = region_filter or features.country
    cards = catalog.get_cards_for_region(region)
    if not cards:
        cards = catalog.cards  # Fallback to all cards

    client = genai.Client(api_key=GEMINI_API_KEY)

    profile_toon = profile.raw_toon
    features_toon = format_features_for_llm(features)
    cards_toon = format_cards_for_llm(cards)

    user_prompt = build_user_prompt(profile_toon, features_toon, cards_toon)

    response = client.models.generate_content(
        model=MODEL,
        contents=user_prompt,
        config=genai.types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
            max_output_tokens=2000,
        ),
    )

    raw_text = response.text.strip()

    # Strip markdown code fences if present
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
        raw_text = "\n".join(clean_lines)

    return _parse_toon_recommendations(raw_text, features.customer_id)
