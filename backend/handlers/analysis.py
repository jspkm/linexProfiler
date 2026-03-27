"""Analysis handlers (analyze transactions, ask agent, test-user variants).

All handlers return plain (dict, int) tuples.
Heavy imports are deferred inside each function for cold-start optimisation.
"""

from __future__ import annotations

from handlers._common import get_catalog as _get_catalog, handler


@handler
def handle_analyze_transactions(data: dict) -> tuple[dict, int]:
    """Analyze raw transactions: compute features, assign profile, recommend cards."""
    from analysis.feature_engine import compute_features
    from analysis.preprocessor import clean_transactions, parse_json_transactions
    from analysis.profiler import profile_user_sync
    from profile_generator.assigner import assign_profile
    from profile_generator.versioning import get_latest_catalog

    transactions = data.get("transactions", [])
    customer_id = data.get("customer_id", "")
    region = data.get("region")
    if not transactions:
        return {"error": "No transactions provided"}, 400
    user_txns = parse_json_transactions(transactions, customer_id)
    clean = clean_transactions(user_txns)
    features = compute_features(clean)
    catalog = get_latest_catalog()
    assignment = None
    if catalog:
        assignment = assign_profile(user_txns, catalog, eval_date=catalog.dataset_max_date)
    user_profile, card_rec = profile_user_sync(features, assignment, _get_catalog(), region)
    return {
        "profile": user_profile.model_dump(),
        "features": features.model_dump(mode="json"),
        "card_recommendations": card_rec.model_dump(),
    }, 200


@handler
def handle_ask_agent(data: dict) -> tuple[dict, int]:
    """Answer a free-form question about a user's spending data using Gemini."""
    from config import GEMINI_API_KEY, MODEL
    if not GEMINI_API_KEY:
        return {"error": "GEMINI_API_KEY not configured"}, 500

    from analysis.feature_engine import compute_features
    from analysis.preprocessor import clean_transactions, parse_json_transactions
    from utils.formatters import format_features_for_llm
    from google import genai
    from google.genai import types

    transactions = data.get("transactions", [])
    question = data.get("question", "")
    customer_id = data.get("customer_id", "")
    if not transactions or not question:
        return {"error": "Missing transactions or question"}, 400
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
            system_instruction=system, temperature=0.0, max_output_tokens=1000,
        ),
    )
    return {
        "question": question,
        "answer": response.text.strip(),
        "customer_id": customer_id,
    }, 200


@handler
def handle_analyze_test_user(data: dict) -> tuple[dict, int]:
    """Analyze a test user by ID: load from Firestore/disk, compute features, profile."""
    from analysis.feature_engine import compute_features
    from analysis.preprocessor import clean_transactions, load_test_user
    from analysis.profiler import profile_user_sync
    from profile_generator.assigner import assign_profile
    from profile_generator.versioning import get_latest_catalog

    user_id = data.get("user_id", "")
    if not user_id:
        return {"error": "Missing user_id"}, 400
    user_txns = load_test_user(user_id)
    clean = clean_transactions(user_txns)
    features = compute_features(clean)
    catalog = get_latest_catalog()
    assignment = None
    if catalog:
        assignment = assign_profile(user_txns, catalog, eval_date=catalog.dataset_max_date)
    user_profile, card_rec = profile_user_sync(features, assignment, _get_catalog())
    return {
        "profile": user_profile.model_dump(),
        "features": features.model_dump(mode="json"),
        "card_recommendations": card_rec.model_dump(),
    }, 200


@handler
def handle_ask_test_user(data: dict) -> tuple[dict, int]:
    """Answer a free-form question about a test user's spending data using Gemini."""
    from config import GEMINI_API_KEY, MODEL
    if not GEMINI_API_KEY:
        return {"error": "GEMINI_API_KEY not configured"}, 500

    from analysis.feature_engine import compute_features
    from analysis.preprocessor import clean_transactions, load_test_user
    from utils.formatters import format_features_for_llm
    from google import genai
    from google.genai import types

    user_id = data.get("user_id", "")
    question = data.get("question", "")
    if not user_id or not question:
        return {"error": "Missing user_id or question"}, 400
    user_txns = load_test_user(user_id)
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
            system_instruction=system, temperature=0.0, max_output_tokens=1000,
        ),
    )
    return {
        "question": question,
        "answer": response.text.strip(),
        "user_id": user_id,
    }, 200
