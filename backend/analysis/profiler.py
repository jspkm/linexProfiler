"""LLM-based user profiling: features → demographic/behavioral profile."""

from __future__ import annotations

import re

from google import genai

from config import GEMINI_API_KEY, MODEL
from models.features import UserFeatures
from models.profile import Attribute, UserProfile
from prompts.profiling import SYSTEM_PROMPT, build_user_prompt
from utils.formatters import format_features_for_llm

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

    # Build the full linex_profile TOON structure
    toon_lines = ["linex_profile:", " profile:"] + attr_lines
    raw_toon = "\n".join(toon_lines)

    return UserProfile(
        customer_id=customer_id,
        attributes=attributes,
        raw_toon=raw_toon,
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


def profile_user_sync(features: UserFeatures) -> UserProfile:
    """Profile a user using the Gemini API."""
    client = genai.Client(api_key=GEMINI_API_KEY)
    features_toon = format_features_for_llm(features)
    user_prompt = build_user_prompt(features_toon)

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

    return _parse_toon_profile(raw_text, features.customer_id)
