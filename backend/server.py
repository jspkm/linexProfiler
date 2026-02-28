"""qu — Financial Quant MCP Server for the Linex loyalty platform.

Analyzes time-series financial transactions to profile users and
recommend optimal loyalty credit cards.
"""

from __future__ import annotations

import json

from google import genai
from google.genai import types
from mcp.server.fastmcp import FastMCP

from analysis.card_matcher import match_cards_sync
from analysis.feature_engine import compute_features
from analysis.preprocessor import (
    clean_transactions,
    load_test_user,
    parse_json_transactions,
)
from analysis.profiler import profile_user_sync
from cards.catalog import CardCatalog
from config import CARDS_PATH, GEMINI_API_KEY, MODEL
from utils.formatters import format_features_for_llm

mcp = FastMCP("qu")

# Load card catalog at startup
_catalog = CardCatalog(str(CARDS_PATH))


@mcp.tool()
async def profile_user_tool(
    transactions: list[dict],
    customer_id: str = "",
) -> dict:
    """Analyze a user's transaction history and produce a full demographic/behavioral
    profile with credit card recommendations.

    Args:
        transactions: JSON array of transaction objects. Each must have at minimum:
            date (ISO format), description, amount. Optional: category, merchant,
            quantity, country, currency.
        customer_id: Optional identifier for the user.

    Returns:
        Complete user profile with demographics, spending features,
        and top 3 credit card recommendations.
    """
    user_txns = parse_json_transactions(transactions, customer_id)
    clean = clean_transactions(user_txns)
    features = compute_features(clean)
    user_profile = profile_user_sync(features)
    card_rec = match_cards_sync(user_profile, features, _catalog)

    return {
        "profile": user_profile.model_dump(),
        "features": features.model_dump(mode="json"),
        "card_recommendations": card_rec.model_dump(),
    }


@mcp.tool()
async def analyze_spending_tool(
    transactions: list[dict],
    customer_id: str = "",
) -> dict:
    """Compute spending features for a user without LLM profiling.
    Fast, deterministic, no API calls. Useful for bulk analysis.

    Args:
        transactions: JSON array of transaction objects.
        customer_id: Optional identifier for the user.

    Returns:
        Computed spending features (totals, averages, categories, trends).
    """
    user_txns = parse_json_transactions(transactions, customer_id)
    clean = clean_transactions(user_txns)
    features = compute_features(clean)
    return features.model_dump(mode="json")


@mcp.tool()
async def match_card_tool(
    transactions: list[dict],
    customer_id: str = "",
    region: str | None = None,
) -> dict:
    """Recommend the best loyalty credit cards for a user.
    Runs full pipeline: features → profile → card match.

    Args:
        transactions: JSON array of transaction objects.
        customer_id: Optional identifier for the user.
        region: Optional region filter (e.g., "United Kingdom", "Germany").

    Returns:
        Top 3 card recommendations with reasoning and fit scores.
    """
    user_txns = parse_json_transactions(transactions, customer_id)
    clean = clean_transactions(user_txns)
    features = compute_features(clean)
    user_profile = profile_user_sync(features)
    card_rec = match_cards_sync(user_profile, features, _catalog, region)
    return card_rec.model_dump()


@mcp.tool()
async def ask_qu_tool(
    transactions: list[dict],
    question: str,
    customer_id: str = "",
) -> dict:
    """Ask any question about a person based on their transaction history.

    Examples: "Is this person likely a student?", "What's their estimated income?",
    "Do they travel frequently?", "Are they likely male or female?"

    Args:
        transactions: JSON array of transaction objects.
        question: The question to answer about this person.
        customer_id: Optional identifier for the user.

    Returns:
        The answer with reasoning and evidence.
    """
    user_txns = parse_json_transactions(transactions, customer_id)
    clean = clean_transactions(user_txns)
    features = compute_features(clean)
    features_toon = format_features_for_llm(features)

    client = genai.Client(api_key=GEMINI_API_KEY)
    system = (
        "You are a financial analyst for the Linex loyalty platform. "
        "Given a user's spending data (in TOON format), answer the question. "
        "Be specific, cite evidence from the data, and state your confidence level."
    )
    response = client.models.generate_content(
        model=MODEL,
        contents=f"Based on this spending data:\n\n{features_toon}\n\nQuestion: {question}",
        config=types.GenerateContentConfig(
            system_instruction=system,
            temperature=0.0,
            max_output_tokens=1000,
        ),
    )

    return {
        "question": question,
        "answer": response.text.strip(),
        "customer_id": customer_id,
    }


@mcp.tool()
async def compare_users_tool(
    users: dict[str, list[dict]],
) -> dict:
    """Compare spending profiles across multiple users.

    Args:
        users: Dict mapping user IDs to their transaction arrays.
            Example: {"user_a": [...transactions...], "user_b": [...transactions...]}

    Returns:
        Comparative feature analysis across all specified users.
    """
    results = {}
    for uid, txns in users.items():
        user_txns = parse_json_transactions(txns, uid)
        clean = clean_transactions(user_txns)
        features = compute_features(clean)
        results[uid] = features.model_dump(mode="json")

    return {"users": results, "count": len(results)}


@mcp.tool()
async def list_available_cards_tool(
    region: str | None = None,
) -> dict:
    """List all credit cards in the catalog, optionally filtered by region.

    Args:
        region: Optional country/region filter (e.g., "United Kingdom", "Germany").

    Returns:
        List of available credit cards with their reward structures.
    """
    if region:
        cards = _catalog.get_cards_for_region(region)
    else:
        cards = _catalog.cards

    return {
        "cards": cards,
        "count": len(cards),
        "regions": _catalog.get_all_regions(),
    }


# --- Resources ---

@mcp.resource("qu://cards/catalog")
def get_card_catalog() -> str:
    """The full credit card catalog as JSON."""
    return json.dumps(_catalog.cards, indent=2)


# --- Prompts ---

@mcp.prompt()
def profile_analysis(customer_id: str) -> str:
    """Generate a prompt for analyzing a specific test user's profile."""
    return (
        f"Analyze customer {customer_id} and provide their demographic profile, "
        f"spending patterns, and optimal credit card recommendation."
    )


if __name__ == "__main__":
    mcp.run(transport="stdio")
