"""Firebase Cloud Functions entry point for the Linex Profiler Quant Agent."""

import json
import random

from google import genai
from google.genai import types

from firebase_functions import https_fn, options
from firebase_admin import initialize_app, credentials
import firebase_admin

from analysis.card_matcher import match_cards_sync
from analysis.feature_engine import compute_features
from analysis.preprocessor import clean_transactions, parse_csv_transactions, parse_json_transactions, load_test_user
from analysis.profiler import profile_user_sync
from cards.catalog import CardCatalog
from config import CARDS_PATH, FIREBASE_CREDENTIALS_PATH, GEMINI_API_KEY, MODEL, TEST_USERS_DIR
from utils.formatters import format_features_for_llm

# Initialize Firebase Admin SDK
try:
    if not firebase_admin._apps:
        if FIREBASE_CREDENTIALS_PATH:
            cred = credentials.Certificate(FIREBASE_CREDENTIALS_PATH)
            initialize_app(cred)
        else:
            initialize_app()
except Exception as e:
    print(f"Firebase initialization warning: {e}")

# Load card catalog once at cold start
_catalog = CardCatalog(str(CARDS_PATH))




@https_fn.on_request(
    cors=options.CorsOptions(
        cors_origins="*",
        cors_methods=["GET", "POST", "OPTIONS"]
    )
)
def analyze_transactions(req: https_fn.Request) -> https_fn.Response:
    """Analyze a user's transaction history and recommend credit cards.
    Expects JSON body:
    {
        "transactions": [ ... ],
        "customer_id": "optional_id",
        "region": "optional_region"
    }
    """
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)

    try:
        req_json = req.get_json(silent=True) or {}
        transactions = req_json.get("transactions", [])
        customer_id = req_json.get("customer_id", "")
        region = req_json.get("region")

        if not transactions:
            return https_fn.Response(
                json.dumps({"error": "No transactions provided"}),
                status=400,
                content_type="application/json"
            )

        user_txns = parse_json_transactions(transactions, customer_id)
        clean = clean_transactions(user_txns)
        features = compute_features(clean)
        
        user_profile = profile_user_sync(features)
        card_rec = match_cards_sync(user_profile, features, _catalog, region)

        return https_fn.Response(
            json.dumps({
                "profile": user_profile.model_dump(),
                "features": features.model_dump(mode="json"),
                "card_recommendations": card_rec.model_dump(),
            }),
            status=200,
            content_type="application/json",
        )
    except Exception as e:
        return https_fn.Response(
            json.dumps({"error": str(e)}),
            status=500,
            content_type="application/json"
        )


@https_fn.on_request(
    cors=options.CorsOptions(
        cors_origins="*",
        cors_methods=["GET", "POST", "OPTIONS"]
    ),
    timeout_sec=120,
)
def ask_qu(req: https_fn.Request) -> https_fn.Response:
    """Ask a question about a person based on their transaction history.
    Expects JSON body:
    {
        "transactions": [ ... ],
        "question": "string",
        "customer_id": "optional_id"
    }
    """
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)

    try:
        if not GEMINI_API_KEY:
            return https_fn.Response(
                json.dumps({"error": "GEMINI_API_KEY not configured"}),
                status=500,
                content_type="application/json"
            )

        req_json = req.get_json(silent=True) or {}
        transactions = req_json.get("transactions", [])
        question = req_json.get("question", "")
        customer_id = req_json.get("customer_id", "")

        if not transactions or not question:
            return https_fn.Response(
                json.dumps({"error": "Missing transactions or question"}),
                status=400,
                content_type="application/json"
            )

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

        return https_fn.Response(
            json.dumps({
                "question": question,
                "answer": response.text.strip(),
                "customer_id": customer_id,
            }),
            status=200,
            content_type="application/json"
        )
    except Exception as e:
        return https_fn.Response(
            json.dumps({"error": str(e)}),
            status=500,
            content_type="application/json"
        )


@https_fn.on_request(
    cors=options.CorsOptions(
        cors_origins="*",
        cors_methods=["GET", "OPTIONS"]
    )
)
def list_test_users(req: https_fn.Request) -> https_fn.Response:
    """List available test user IDs."""
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    try:
        if not TEST_USERS_DIR.exists():
            return https_fn.Response(
                json.dumps({"user_ids": []}),
                status=200,
                content_type="application/json"
            )
        ids = []
        for f in sorted(TEST_USERS_DIR.iterdir()):
            if f.name.startswith("test-user-") and f.name.endswith(".csv"):
                uid = f.name.replace("test-user-", "").replace(".csv", "")
                ids.append(uid)
        selected = random.sample(ids, min(20, len(ids)))
        return https_fn.Response(
            json.dumps({"user_ids": selected}),
            status=200,
            content_type="application/json"
        )
    except Exception as e:
        return https_fn.Response(
            json.dumps({"error": str(e)}),
            status=500,
            content_type="application/json"
        )


@https_fn.on_request(
    cors=options.CorsOptions(
        cors_origins="*",
        cors_methods=["GET", "POST", "OPTIONS"]
    ),
    timeout_sec=120,
)
def analyze_test_user(req: https_fn.Request) -> https_fn.Response:
    """Analyze a test user by ID. Expects JSON: { "user_id": "12346" }"""
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    try:
        req_json = req.get_json(silent=True) or {}
        user_id = req_json.get("user_id", "")
        if not user_id:
            return https_fn.Response(
                json.dumps({"error": "Missing user_id"}),
                status=400,
                content_type="application/json"
            )
        user_txns = load_test_user(user_id)
        clean = clean_transactions(user_txns)
        features = compute_features(clean)
        user_profile = profile_user_sync(features)
        card_rec = match_cards_sync(user_profile, features, _catalog)
        return https_fn.Response(
            json.dumps({
                "profile": user_profile.model_dump(),
                "features": features.model_dump(mode="json"),
                "card_recommendations": card_rec.model_dump(),
            }),
            status=200,
            content_type="application/json",
        )
    except Exception as e:
        return https_fn.Response(
            json.dumps({"error": str(e)}),
            status=500,
            content_type="application/json"
        )


@https_fn.on_request(
    cors=options.CorsOptions(
        cors_origins="*",
        cors_methods=["GET", "POST", "OPTIONS"]
    ),
    timeout_sec=120,
)
def ask_test_user(req: https_fn.Request) -> https_fn.Response:
    """Ask a question about a test user by ID.
    Expects JSON: { "user_id": "12346", "question": "..." }
    """
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    try:
        if not GEMINI_API_KEY:
            return https_fn.Response(
                json.dumps({"error": "GEMINI_API_KEY not configured"}),
                status=500,
                content_type="application/json"
            )

        req_json = req.get_json(silent=True) or {}
        user_id = req_json.get("user_id", "")
        question = req_json.get("question", "")

        if not user_id or not question:
            return https_fn.Response(
                json.dumps({"error": "Missing user_id or question"}),
                status=400,
                content_type="application/json"
            )

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
                system_instruction=system,
                temperature=0.0,
                max_output_tokens=1000,
            ),
        )

        return https_fn.Response(
            json.dumps({
                "question": question,
                "answer": response.text.strip(),
                "user_id": user_id,
            }),
            status=200,
            content_type="application/json"
        )
    except Exception as e:
        return https_fn.Response(
            json.dumps({"error": str(e)}),
            status=500,
            content_type="application/json"
        )
