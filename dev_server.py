"""Local development server that serves all Cloud Functions via Flask.

This bypasses the Firebase emulator's buggy Python worker lifecycle by
running a single Flask process with all endpoints registered.

Usage:
    source venv/bin/activate
    python dev_server.py
"""

import json
from flask import Flask, request, jsonify, Response
from flask_cors import CORS

# Ensure env vars loaded before imports
from config import GEMINI_API_KEY, MODEL

from analysis.feature_engine import compute_features
from analysis.preprocessor import (
    clean_transactions,
    load_test_user,
    parse_json_transactions,
)
from cards.catalog import CardCatalog
from config import CARDS_PATH, TEST_USERS_DIR
from utils.formatters import format_features_for_llm, format_cards_for_llm
from prompts.profiling import SYSTEM_PROMPT as PROF_SYSTEM, build_user_prompt as prof_prompt
from prompts.card_matching import SYSTEM_PROMPT as CARD_SYSTEM, build_user_prompt as card_prompt
from analysis.profiler import _parse_toon_profile
from analysis.card_matcher import _parse_toon_recommendations

from google import genai
from google.genai import types

_catalog = CardCatalog(str(CARDS_PATH))
_gemini = genai.Client(api_key=GEMINI_API_KEY)

app = Flask(__name__)
CORS(app)


def _strip_fences(raw: str) -> str:
    """Strip markdown code fences if present."""
    if not raw.startswith("```"):
        return raw
    lines = raw.split("\n")
    clean = []
    in_block = False
    for line in lines:
        if line.startswith("```") and not in_block:
            in_block = True
            continue
        if line.startswith("```") and in_block:
            break
        if in_block:
            clean.append(line)
    return "\n".join(clean)


def _llm_call(system: str, user_content: str) -> str:
    """Make a Gemini API call and return the text response."""
    response = _gemini.models.generate_content(
        model=MODEL,
        contents=user_content,
        config=types.GenerateContentConfig(
            system_instruction=system,
            temperature=0.0,
            max_output_tokens=4000,
        )
    )
    return response.text.strip()


def _analyze_pipeline(features, catalog, region=None):
    """Run profile + match cards sequentially with Gemini."""
    features_toon = format_features_for_llm(features)

    # Step 1: Profile
    raw_prof = _llm_call(PROF_SYSTEM, prof_prompt(features_toon))
    raw_prof = _strip_fences(raw_prof)
    profile = _parse_toon_profile(raw_prof, features.customer_id)

    # Step 2: Match cards
    region_val = region or features.country
    cards = catalog.get_cards_for_region(region_val)
    if not cards:
        cards = catalog.cards
    cards_toon = format_cards_for_llm(cards)

    raw_card = _llm_call(CARD_SYSTEM, card_prompt(
        profile.raw_toon, features_toon, cards_toon
    ))
    raw_card = _strip_fences(raw_card)
    rec = _parse_toon_recommendations(raw_card, features.customer_id)

    return profile, rec


def _analyze_streaming(features, catalog, region=None):
    """Run profile + match with streaming progress via SSE."""
    features_toon = format_features_for_llm(features)

    def generate():
        # Step 1: Profile
        yield f"data: {json.dumps({'step': 'profiling', 'message': 'Profiling with Gemini...'})}\n\n"

        raw_prof = _llm_call(PROF_SYSTEM, prof_prompt(features_toon))
        raw_prof = _strip_fences(raw_prof)
        profile = _parse_toon_profile(raw_prof, features.customer_id)

        yield f"data: {json.dumps({'step': 'matching', 'message': 'Matching credit cards...'})}\n\n"

        # Step 2: Match cards
        region_val = region or features.country
        cards = catalog.get_cards_for_region(region_val)
        if not cards:
            cards = catalog.cards
        cards_toon = format_cards_for_llm(cards)

        raw_card = _llm_call(CARD_SYSTEM, card_prompt(
            profile.raw_toon, features_toon, cards_toon
        ))
        raw_card = _strip_fences(raw_card)
        rec = _parse_toon_recommendations(raw_card, features.customer_id)

        # Final result
        yield f"data: {json.dumps({'step': 'done', 'result': {'profile': profile.model_dump(), 'features': features.model_dump(mode='json'), 'card_recommendations': rec.model_dump()}})}\n\n"

    return generate


@app.route("/linexonewhitelabeler/us-central1/list_test_users", methods=["GET"])
def list_test_users():
    if not TEST_USERS_DIR.exists():
        return jsonify({"user_ids": []})
    ids = []
    for f in sorted(TEST_USERS_DIR.iterdir()):
        if f.name.startswith("test-user-") and f.name.endswith(".csv"):
            uid = f.name.replace("test-user-", "").replace(".csv", "")
            ids.append(uid)
    return jsonify({"user_ids": ids[:20]})


@app.route("/linexonewhitelabeler/us-central1/analyze_test_user", methods=["POST"])
def analyze_test_user():
    try:
        data = request.get_json(silent=True) or {}
        user_id = data.get("user_id", "")
        stream = data.get("stream", False)
        if not user_id:
            return jsonify({"error": "Missing user_id"}), 400

        user_txns = load_test_user(user_id)
        clean = clean_transactions(user_txns)
        features = compute_features(clean)

        if stream:
            gen = _analyze_streaming(features, _catalog)
            return Response(gen(), content_type="text/event-stream")

        profile, rec = _analyze_pipeline(features, _catalog)
        return jsonify({
            "profile": profile.model_dump(),
            "features": features.model_dump(mode="json"),
            "card_recommendations": rec.model_dump(),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/linexonewhitelabeler/us-central1/analyze_transactions", methods=["POST"])
def analyze_transactions():
    try:
        data = request.get_json(silent=True) or {}
        transactions = data.get("transactions", [])
        customer_id = data.get("customer_id", "")
        region = data.get("region")
        stream = data.get("stream", False)

        if not transactions:
            return jsonify({"error": "No transactions provided"}), 400

        user_txns = parse_json_transactions(transactions, customer_id)
        clean = clean_transactions(user_txns)
        features = compute_features(clean)

        if stream:
            gen = _analyze_streaming(features, _catalog, region)
            return Response(gen(), content_type="text/event-stream")

        profile, rec = _analyze_pipeline(features, _catalog, region)
        return jsonify({
            "profile": profile.model_dump(),
            "features": features.model_dump(mode="json"),
            "card_recommendations": rec.model_dump(),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/linexonewhitelabeler/us-central1/ask_test_user", methods=["POST"])
def ask_test_user():
    try:
        if not GEMINI_API_KEY:
            return jsonify({"error": "GEMINI_API_KEY not configured"}), 500

        data = request.get_json(silent=True) or {}
        user_id = data.get("user_id", "")
        question = data.get("question", "")

        if not user_id or not question:
            return jsonify({"error": "Missing user_id or question"}), 400

        user_txns = load_test_user(user_id)
        clean = clean_transactions(user_txns)
        features = compute_features(clean)
        features_toon = format_features_for_llm(features)

        system = (
            "You are a financial analyst for the Linex loyalty platform. "
            "Given a user's spending data (in TOON format), answer the question. "
            "Be specific, cite evidence from the data, and state your confidence level."
        )
        answer = _llm_call(system, f"Based on this spending data:\n\n{features_toon}\n\nQuestion: {question}")

        return jsonify({
            "question": question,
            "answer": answer,
            "user_id": user_id,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/linexonewhitelabeler/us-central1/ask_qu", methods=["POST"])
def ask_qu():
    try:
        if not GEMINI_API_KEY:
            return jsonify({"error": "GEMINI_API_KEY not configured"}), 500

        data = request.get_json(silent=True) or {}
        transactions = data.get("transactions", [])
        question = data.get("question", "")
        customer_id = data.get("customer_id", "")

        if not transactions or not question:
            return jsonify({"error": "Missing transactions or question"}), 400

        user_txns = parse_json_transactions(transactions, customer_id)
        clean = clean_transactions(user_txns)
        features = compute_features(clean)
        features_toon = format_features_for_llm(features)

        system = (
            "You are a financial analyst for the Linex loyalty platform. "
            "Given a user's spending data (in TOON format), answer the question. "
            "Be specific, cite evidence from the data, and state your confidence level."
        )
        answer = _llm_call(system, f"Based on this spending data:\n\n{features_toon}\n\nQuestion: {question}")

        return jsonify({
            "question": question,
            "answer": answer,
            "customer_id": customer_id,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    print(f"Starting local dev server on http://127.0.0.1:5050 (model: {MODEL})")
    print("Functions available:")
    print("  - GET  /linexonewhitelabeler/us-central1/list_test_users")
    print("  - POST /linexonewhitelabeler/us-central1/analyze_test_user")
    print("  - POST /linexonewhitelabeler/us-central1/analyze_transactions")
    print("  - POST /linexonewhitelabeler/us-central1/ask_test_user")
    print("  - POST /linexonewhitelabeler/us-central1/ask_qu")
    app.run(host="127.0.0.1", port=5050, debug=False)
