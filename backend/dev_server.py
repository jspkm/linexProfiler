"""Local development server that serves all Cloud Functions via Flask.

This bypasses the Firebase emulator's buggy Python worker lifecycle by
running a single Flask process with all endpoints registered.

Usage:
    source venv/bin/activate
    python dev_server.py
"""

import json
import os
import sys
import time
import re
from flask import Flask, request, jsonify, Response
from flask_cors import CORS
from datetime import datetime
from firebase_admin import storage

# Ensure env vars loaded before imports
from config import (
    APP_ENV,
    FIREBASE_PROJECT_ID,
    FIREBASE_STORAGE_BUCKET,
    GEMINI_API_KEY,
    LOADED_ENV_FILE,
    MODEL,
    dev_credentials_error,
    write_block_reason,
    writes_allowed,
)

from analysis.feature_engine import compute_features
from analysis.preprocessor import (
    clean_transactions,
    load_test_user,
    parse_json_transactions,
    parse_portfolio_records,
)
from cards.catalog import CardCatalog
from config import CARDS_PATH, TEST_USERS_DIR
from utils.formatters import format_features_for_llm, format_cards_for_llm, format_profiles_for_llm
from profile_generator.versioning import get_latest_catalog
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


@app.before_request
def _log_request_start():
    request._started_at = time.time()
    print(f"[REQ] {request.method} {request.path}")


@app.after_request
def _log_request_end(response):
    started_at = getattr(request, "_started_at", None)
    duration_ms = round((time.time() - started_at) * 1000) if started_at else -1
    print(f"[RES] {request.method} {request.path} -> {response.status_code} ({duration_ms} ms)")
    return response


@app.route("/healthz", methods=["GET"])
def healthz():
    return jsonify({
        "ok": True,
        "env": APP_ENV,
        "project": FIREBASE_PROJECT_ID,
        "bucket": FIREBASE_STORAGE_BUCKET,
        "config": str(LOADED_ENV_FILE) if LOADED_ENV_FILE else None,
    })


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


def _llm_call(system: str, user_content: str, history: list = None) -> str:
    """Make a Gemini API call and return the text response."""
    if history and len(history) > 0:
        # Build multi-turn conversation from history + current message
        contents = []
        for turn in history:
            role = "user" if turn.get("role") == "user" else "model"
            contents.append(types.Content(role=role, parts=[types.Part.from_text(text=turn["text"])]))
        contents.append(types.Content(role="user", parts=[types.Part.from_text(text=user_content)]))
    else:
        contents = user_content
    response = _gemini.models.generate_content(
        model=MODEL,
        contents=contents,
        config=types.GenerateContentConfig(
            system_instruction=system,
            temperature=0.0,
            max_output_tokens=4000,
        )
    )
    return response.text.strip()


def _guard_write():
    if writes_allowed():
        return None
    return jsonify({"error": write_block_reason()}), 403


def _safe_file_name(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", name or "portfolio.csv").strip("._")
    return cleaned or "portfolio.csv"


def _analyze_pipeline(features, assignment, catalog, region=None):
    """Run profile + match cards sequentially with Gemini."""
    features_toon = format_features_for_llm(features)

    profiles_toon = format_profiles_for_llm(assignment) if assignment else "assigned_profile: unknown"

    region_val = region or features.country
    cards = catalog.get_cards_for_region(region_val)
    if not cards:
        cards = catalog.cards
    cards_toon = format_cards_for_llm(cards)

    raw_resp = _llm_call(PROF_SYSTEM, prof_prompt(features_toon, profiles_toon, cards_toon))
    raw_resp = _strip_fences(raw_resp)
    
    profile = _parse_toon_profile(raw_resp, features.customer_id)
    rec = _parse_toon_recommendations(raw_resp, features.customer_id)

    return profile, rec


def _analyze_streaming(features, assignment, catalog, region=None):
    """Run profile + match with streaming progress via SSE."""
    features_toon = format_features_for_llm(features)
    
    profiles_toon = format_profiles_for_llm(assignment) if assignment else "assigned_profile: unknown"

    region_val = region or features.country
    cards = catalog.get_cards_for_region(region_val)
    if not cards:
        cards = catalog.cards
    cards_toon = format_cards_for_llm(cards)

    def generate():
        yield f"data: {json.dumps({'step': 'profiling', 'message': 'Profiling and matching with Gemini...'})}\n\n"

        raw_resp = _llm_call(PROF_SYSTEM, prof_prompt(features_toon, profiles_toon, cards_toon))
        raw_resp = _strip_fences(raw_resp)
        
        profile = _parse_toon_profile(raw_resp, features.customer_id)
        rec = _parse_toon_recommendations(raw_resp, features.customer_id)

        yield f"data: {json.dumps({'step': 'done', 'result': {'profile': profile.model_dump(), 'features': features.model_dump(mode='json'), 'card_recommendations': rec.model_dump()}})}\n\n"

    return generate


@app.route("/linexone-dev/us-central1/list_test_users", methods=["GET"])
def list_test_users():
    if not TEST_USERS_DIR.exists():
        return jsonify({"user_ids": []})
    ids = []
    for f in sorted(TEST_USERS_DIR.iterdir()):
        if f.name.startswith("test-user-") and f.name.endswith(".csv"):
            uid = f.name.replace("test-user-", "").replace(".csv", "")
            ids.append(uid)
    return jsonify({"user_ids": ids[:20]})


@app.route("/linexone-dev/us-central1/analyze_test_user", methods=["POST"])
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
        
        profile_catalog = get_latest_catalog()
        assignment = None
        if profile_catalog:
            assignment = _assign_profile(clean, profile_catalog, eval_date=profile_catalog.dataset_max_date)

        if stream:
            gen = _analyze_streaming(features, assignment, _catalog)
            return Response(gen(), content_type="text/event-stream")

        profile, rec = _analyze_pipeline(features, assignment, _catalog)
        return jsonify({
            "profile": profile.model_dump(),
            "features": features.model_dump(mode="json"),
            "card_recommendations": rec.model_dump(),
            "assignment": assignment.model_dump(mode="json") if assignment else None,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/linexone-dev/us-central1/analyze_transactions", methods=["POST"])
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
        
        profile_catalog = get_latest_catalog()
        assignment = None
        if profile_catalog:
            assignment = _assign_profile(clean, profile_catalog, eval_date=profile_catalog.dataset_max_date)

        if stream:
            gen = _analyze_streaming(features, assignment, _catalog, region)
            return Response(gen(), content_type="text/event-stream")

        profile, rec = _analyze_pipeline(features, assignment, _catalog, region)
        return jsonify({
            "profile": profile.model_dump(),
            "features": features.model_dump(mode="json"),
            "card_recommendations": rec.model_dump(),
            "assignment": assignment.model_dump(mode="json") if assignment else None,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/linexone-dev/us-central1/ask_test_user", methods=["POST"])
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


@app.route("/linexone-dev/us-central1/ask_agent", methods=["POST"])
def ask_agent():
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


@app.route("/linexone-dev/us-central1/agent_chat", methods=["POST"])
def agent_chat():
    try:
        if not GEMINI_API_KEY:
            return jsonify({"error": "GEMINI_API_KEY not configured"}), 500

        data = request.get_json(silent=True) or {}
        message = (data.get("message") or "").strip()
        if not message:
            return jsonify({"error": "Missing message"}), 400

        grid_context = data.get("grid_context")
        history = data.get("history") or []

        # Load backend source code so the LLM can answer any methodology question
        if not hasattr(agent_chat, "_source_cache"):
            source_snippets = {}
            _src_dir = os.path.join(os.path.dirname(__file__), "profile_generator")
            for fname in ["optimization.py", "incentive_manager.py", "trainer.py"]:
                fpath = os.path.join(_src_dir, fname)
                try:
                    with open(fpath, "r") as f:
                        source_snippets[fname] = f.read()
                except Exception:
                    pass
            agent_chat._source_cache = source_snippets
        source_snippets = agent_chat._source_cache

        system = (
            "You are the Agent, a quant for the Linex loyalty platform. "
            "You help users understand their portfolio optimization results, spending patterns, "
            "credit card incentive programs, and profile segmentation. "
            "Always refer to yourself as 'the Agent' (never 'I' or 'an assistant'). "
            "Keep answers brief and direct. Use plain language.\n\n"
            "## Conversational Context\n"
            "You receive the recent conversation history. ALWAYS interpret the user's message in context of the prior exchange. "
            "If the Agent just asked a question (e.g. 'How many clusters?'), the user's next message is a RESPONSE to that question — "
            "not a new standalone request. For example, if the Agent asked for K and the user says 'what are my options', "
            "they are asking about valid K values, NOT asking to list profiles or portfolios. "
            "Stay in the current conversational flow until the user explicitly changes topic.\n\n"
            "## Key Terminology\n"
            "- PORTFOLIO: An uploaded dataset of raw customer transaction data (CSV). Listed in uploaded_portfolios.\n"
            "- PROFILE: A generated set of behavioral customer segments from K-Means clustering on a portfolio. "
            "Listed in available_profiles. Each profile has a version, source, and K value.\n"
            "- These are DIFFERENT things. 'List portfolios' = show uploaded datasets. 'List profiles' = show available profile versions.\n"
            "- 'List profiles' means listing the NAMES/VERSIONS of all available profiles (from available_profiles), "
            "NOT the detailed cluster breakdown of the currently selected profile. Keep it brief — just version, source, K.\n"
            "- NEVER use the word 'catalog' in responses. Say 'profile' instead.\n"
            "- When listing profiles or portfolios, NUMBER them starting from 1 (e.g. '1. ...', '2. ...'). "
            "Users can then reference items by number in follow-up commands like 'delete 1', 'dup 2', 'copy 3'.\n"
            "- When a user says 'delete <N>', 'dup <N>', 'copy <N>', or 'duplicate <N>' (where N is a number), "
            "look up which item #N refers to from the most recently listed profiles or portfolios. "
            "For delete: use request_delete_profile with the resolved version. "
            "For dup/copy/duplicate: use fork_profile with the resolved version. "
            "ALWAYS confirm with the user before executing — state the full name/version of the item being acted on.\n\n"
            "## Platform APIs\n"
            "The Linex platform exposes 26 REST API endpoints under /api/ and an MCP server.\n\n"
            "### REST API Endpoints\n"
            "Transaction & Profiling:\n"
            "  POST /api/analyze_transactions — Parse transactions, compute spending features, assign profile, recommend cards\n"
            "  POST /api/ask_agent — Ask Gemini a question about a customer based on their transactions\n"
            "  POST /api/agent_chat — Financial assistant chat (this endpoint) with grid manipulation\n\n"
            "Test Users:\n"
            "  GET  /api/list_test_users — List 20 random test user IDs\n"
            "  POST /api/analyze_test_user — Full spending analysis of a test user\n"
            "  POST /api/ask_test_user — Ask a question about a test user's spending\n\n"
            "Profile Catalog:\n"
            "  GET  /api/profile_catalog?version=<v> — Get latest or specific profile catalog\n"
            "  GET  /api/list_profile_catalogs — List all profile catalogs\n"
            "  POST /api/fork_catalog — Fork a catalog with modifications\n"
            "  DELETE /api/delete_catalog/<version> — Delete a catalog\n\n"
            "Portfolio Datasets:\n"
            "  GET  /api/list_portfolio_datasets — List uploaded portfolio datasets\n"
            "  POST /api/create_portfolio_upload_url — Get signed upload URL for CSV\n"
            "  DELETE /api/delete_portfolio_dataset/<id> — Delete dataset + associated catalogs/optimizations\n\n"
            "Profile Learning:\n"
            "  POST /api/learn_profiles — Train K-Means clusters from transaction data (source: test-users, retail, uploaded)\n\n"
            "Optimization:\n"
            "  POST /api/start_optimize — Start convergence-based LTV optimization\n"
            "  GET  /api/optimize_status/<id> — Poll optimization progress\n"
            "  GET  /api/list_optimizations?catalog_version=<v> — List saved optimization runs\n"
            "  GET  /api/load_optimize/<id> — Load completed optimization\n"
            "  POST /api/cancel_optimize/<id> — Cancel running optimization\n"
            "  POST /api/save_optimize/<id> — Persist optimization to Firestore\n"
            "  DELETE /api/delete_optimize/<id> — Delete optimization\n\n"
            "Incentive Sets:\n"
            "  GET  /api/list_incentive_sets — List all incentive sets\n"
            "  GET  /api/incentive_set?version=<v> — Get default or specific incentive set\n"
            "  POST /api/create_incentive_set — Create new incentive set\n"
            "  POST /api/set_default_incentive_set/<version> — Set default incentive set\n"
            "  DELETE /api/delete_incentive_set/<version> — Delete incentive set\n\n"
            "### MCP Server (stdio transport, FastMCP)\n"
            "Server name: \"agent\". Available tools:\n"
            "  profile_user_tool(transactions, customer_id?) — Full demographic/behavioral profile with card recommendations\n"
            "  analyze_spending_tool(transactions, customer_id?) — Deterministic spending feature computation (no LLM)\n"
            "  match_card_tool(transactions, customer_id?, region?) — Optimal loyalty card recommendations\n"
            "  ask_agent_tool(transactions, question, customer_id?) — Answer arbitrary questions from spending data\n"
            "  compare_users_tool(users: {id: txns}) — Compare spending profiles across users\n"
            "  list_available_cards_tool(region?) — List credit cards in catalog\n"
            "Resources: agent://cards/catalog — Full credit card catalog JSON\n"
            "Prompts: profile_analysis(customer_id) — Generate analysis prompt for a test user\n\n"
        )

        if grid_context:
            # Source code context for methodology questions
            src_block = (
                "## Optimization Pipeline — Source Code (for methodology questions)\n"
                "When the user asks HOW something was derived, computed, or works, use the actual source code below "
                "to give a precise, code-grounded answer. Explain the algorithm, not just definitions.\n\n"
            )
            for fname in ["optimization.py", "incentive_manager.py", "trainer.py"]:
                if fname in source_snippets:
                    src_block += f"### {fname}\n```python\n{source_snippets[fname]}\n```\n\n"

            field_names = ", ".join(grid_context.get("fields", {}).keys())
            system += (
                src_block
                + "## Current Data\n"
                + json.dumps(grid_context, indent=2) + "\n\n"
                + "## Grid Manipulation\n"
                "You can manipulate the grid by including an `actions` array in your JSON response. "
                "Supported action types:\n"
                '  - add_column: {"type":"add_column","label":"<NAME>","formula":"<JS expression using field names>","format":"dollar|percent|ratio|number","totals":"sum|avg"}\n'
                '    The formula MUST be a valid JavaScript arithmetic expression using ONLY these field names as variables: '
                + field_names
                + '. Example: "new_net_portfolio_ltv / portfolio_cost"\n'
                '    Choose format based on what the result represents: percent for ratios meant as %, ratio for plain ratios, dollar for monetary values, number otherwise.\n'
                '    Choose totals: "avg" for ratios/percents, "sum" for dollar/number.\n'
                '  - remove_column: {"type":"remove_column","label":"<NAME>"}\n'
                '  - create_profile: {"type":"create_profile","k":<int>,"source":"uploaded-dataset:<id>"|"uploaded"}\n'
                '    Creates a new profile catalog using K-Means clustering with K clusters.\n'
                '    Check grid_context.is_busy — if true, tell the user to wait.\n'
                '    If user does not specify K, ASK them how many clusters to use (do NOT assume a default).\n'
                '    Valid K range: 2 to 20. Typical values are 3–10. Recommend 5–8 for most portfolios.\n'
                '    When you have JUST asked the user for K and they reply with a follow-up like "what are my options", '
                '"what values can I use", "help", etc., answer ONLY about K-Means cluster count options — '
                'do NOT interpret it as a general capabilities question or list profiles.\n'
                '    If no dataset_id is available in grid_context.available_catalogs or the user hasn\'t specified one, use source "uploaded".\n'
                '  - request_delete_profile: {"type":"request_delete_profile","version":"<catalog_version>"}\n'
                '    Stages a profile for deletion. Use this when user wants to delete a profile.\n'
                '    ALWAYS use this first to request confirmation — NEVER use confirm_delete_profile directly.\n'
                '    Your answer MUST ask the user to confirm (e.g. "Are you sure you want to delete profile <version>? '
                'This will also remove all associated optimization runs. Reply yes to confirm.").\n'
                '  - confirm_delete_profile: {"type":"confirm_delete_profile"}\n'
                '    Only use this when the user explicitly confirms deletion (yes, confirm, go ahead, do it, etc.) '
                'AND grid_context.pending_delete_catalog is set.\n'
                '  - cancel_delete_profile: {"type":"cancel_delete_profile"}\n'
                '    Use when user declines deletion (no, cancel, never mind, etc.) AND pending_delete_catalog is set.\n'
                '  - fork_profile: {"type":"fork_profile","version":"<source_version>"}\n'
                '    Duplicates/copies an existing profile. Use for dup/copy/duplicate commands.\n'
                '    ALWAYS confirm with the user first — state which profile will be duplicated.\n'
                '  - list_programs: {"type":"list_programs"}\n'
                '    Lists all saved Optimal Incentive Programs for the current context.\n'
                '    Synonyms: "list programs", "show programs", "my programs", "what programs", "show runs", "list runs".\n'
                '    Do NOT try to list them in the answer text — use the action so the frontend renders the list.\n'
                '  - delete_program: {"type":"delete_program","optimization_id":"<id>"}\n'
                '    Deletes a saved Optimal Incentive Program by optimization_id.\n'
                '    When the user says "delete 1", "remove 2", etc. after listing programs, '
                'match the number to the program in grid_context.saved_programs (1-indexed) and use its optimization_id.\n'
                '    ALWAYS ask for confirmation first — state which program will be deleted.\n'
                '    Context: "delete program" or "delete <number>" after a list refers to an optimization program, '
                'NOT a profile. Only use request_delete_profile when the user explicitly says "delete profile".\n'
                '  - run_optimization: {"type":"run_optimization","catalog_version":"<optional>","incentive_set_version":"<optional>"}\n'
                '    Starts a new Optimal Incentive Program run (convergence-based LTV optimization).\n'
                '    Uses the currently selected profile and incentive set if not specified.\n'
                '    Check grid_context.is_busy — if true, tell the user to wait.\n'
                '    Synonyms the user may use: "run", "generate", "create", "analyze", "optimize", "start", "go", "execute".\n'
                '    When the user says any of these in the context of the Optimal Incentive Program, '
                'incentive optimization, or just "program", they mean run_optimization.\n'
                '    Examples: "run the program", "generate optimal incentives", "create a new program", '
                '"analyze this profile", "optimize", "run optimization", "start a new run".\n'
                '    Do NOT ask for confirmation — just include the action and start immediately. '
                'This is a non-destructive operation. Keep the answer brief, e.g. "Starting optimization."\n'
                '    CRITICAL: You MUST include the run_optimization action in the actions array. '
                'Without it, nothing happens — the answer text alone does NOT trigger the optimization.\n\n'
                "## Response Rules\n"
                "- NEVER reveal backend implementation details: do NOT mention model names (Gemini, GPT, etc.), "
                "function names (evaluate_incentive_bundle, _enforce_baseline, etc.), variable names, code references, "
                "or that an LLM is used internally. Describe the methodology in DOMAIN terms only: "
                "'the optimizer evaluates...', 'a simulation run tests...', 'the convergence check measures...', "
                "'a Bayesian risk model adjusts...'. The user should understand the process without knowing the tech stack.\n"
                "- METHODOLOGY vs DEFINITION: When a user asks 'how was X derived/computed/calculated', or asks about "
                "the process/method/algorithm, they want the METHODOLOGY — the full process that produced the result. "
                "Use the source code to understand the algorithm, but explain it in domain language. Key aspects to cover:\n"
                "  * The simulation: how many iterations were run, what was tested each iteration\n"
                "  * Convergence: how the optimizer determined the result was stable (triple-gate: coefficient of variation, "
                "trend slope, normalized range — explain what these mean practically)\n"
                "  * Selection logic: why these specific incentives were kept (risk-adjusted marginal exceeded cost gate) "
                "and what was dropped\n"
                "  * Risk adjustment: Bayesian uptake blending, lower confidence bound, how this discounts uncertain incentives\n"
                "  * Baseline protection: the optimizer rejects any bundle that performs worse than no incentives at all\n"
                "  * For profile-specific questions, reference ACTUAL data: which incentives were assigned, their costs, "
                "the lift achieved, population impact\n"
                "A definition question ('what is X') gets a brief answer. A methodology question gets a process-level answer.\n"
                "- When explaining the process, reference ACTUAL data: K value, profile count, population sizes, "
                "incentive names and costs, convergence parameters, and specific results.\n"
                "- Use monospace/ASCII tables or bar charts in your answer when they help illustrate data.\n"
                "- When the user asks to add/modify/remove columns, include the appropriate action. "
                "If the definition is unclear, ask for clarification.\n"
                "- IMPORTANT: You MUST respond with valid JSON only, no markdown fences, in this format:\n"
                '{"answer":"<your message to the user>","actions":[...optional actions...]}\n'
                "If no action is needed (e.g. answering a question), omit the actions array. "
                "But if the user requests an OPERATION (create, delete, run, optimize, add column, etc.), "
                "you MUST include the corresponding action — the answer text alone does NOT execute anything.\n"
                "- Use \\n for newlines within the answer string.\n"
            )
        else:
            system += "Respond with plain text.\n"

        raw = _llm_call(system, message, history=history)

        # If grid_context was sent, try to parse structured JSON response
        if grid_context:
            cleaned = raw
            if cleaned.startswith("```"):
                cleaned = "\n".join(cleaned.split("\n")[1:])
            if cleaned.endswith("```"):
                cleaned = "\n".join(cleaned.split("\n")[:-1])
            cleaned = cleaned.strip()
            try:
                parsed = json.loads(cleaned)
                if isinstance(parsed, dict) and "answer" in parsed:
                    return jsonify(parsed)
            except json.JSONDecodeError:
                # Try to extract JSON object from within the text
                import re as _re
                m = _re.search(r'\{[\s\S]*"answer"\s*:', cleaned)
                if m:
                    candidate = cleaned[m.start():]
                    # Find matching closing brace
                    depth = 0
                    end = -1
                    for i, ch in enumerate(candidate):
                        if ch == '{': depth += 1
                        elif ch == '}':
                            depth -= 1
                            if depth == 0:
                                end = i
                                break
                    if end > 0:
                        try:
                            parsed = json.loads(candidate[:end+1])
                            if isinstance(parsed, dict) and "answer" in parsed:
                                return jsonify(parsed)
                        except json.JSONDecodeError:
                            pass

        # Check if the raw text contains a trailing JSON with actions
        actions_idx = raw.find('"actions"')
        if actions_idx >= 0:
            # Walk back to find the opening brace
            brace_start = raw.rfind('{', 0, actions_idx)
            if brace_start >= 0:
                # Walk forward to find matching closing brace
                depth, end = 0, -1
                for i in range(brace_start, len(raw)):
                    if raw[i] == '{': depth += 1
                    elif raw[i] == '}':
                        depth -= 1
                        if depth == 0: end = i; break
                if end > 0:
                    try:
                        actions_obj = json.loads(raw[brace_start:end+1])
                        if isinstance(actions_obj, dict) and "actions" in actions_obj:
                            answer_text = raw[:brace_start].strip()
                            if not answer_text:
                                answer_text = actions_obj.get("answer", "")
                            result = {"answer": answer_text, "actions": actions_obj["actions"]}
                            return jsonify(result)
                    except json.JSONDecodeError:
                        pass
        return jsonify({"answer": raw})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ---------- Profile Generator ----------
import csv
import io
from config import TEST_USERS_DIR, DEFAULT_K, DEFAULT_TIME_WINDOW
from analysis.preprocessor import parse_csv_transactions, clean_transactions as clean_txns_fn
from profile_generator.feature_derivation import derive_batch_features
from profile_generator.trainer import learn_profiles as _learn_profiles
from profile_generator.assigner import assign_profile as _assign_profile
from profile_generator.versioning import (
    save_catalog, load_catalog, list_catalogs, get_latest_catalog, fork_catalog, delete_catalog,
)
from profile_generator.optimization import (
    start_optimization, get_optimization_status, advance_optimization,
    cancel_optimization, save_optimization, delete_optimization,
    list_optimizations, load_optimization,
)
from profile_generator.incentive_manager import load_or_seed_default, generate_version
from profile_generator.firestore_client import (
    fs_save_incentive_set, fs_load_incentive_set,
    fs_list_incentive_sets, fs_get_default_incentive_set,
    fs_set_default_incentive_set, fs_delete_incentive_set,
    fs_save_portfolio_dataset, fs_list_portfolio_datasets,
    fs_load_portfolio_dataset, fs_delete_portfolio_dataset_cascade,
    fs_create_portfolio_dataset_metadata,
)
from models.incentive_set import Incentive, IncentiveSet
from models.transaction import UserTransactions


def _load_all_test_users() -> dict[str, UserTransactions]:
    """Load all test users from data/test-users/."""
    users: dict[str, UserTransactions] = {}
    if not TEST_USERS_DIR.exists():
        return users
    for f in sorted(TEST_USERS_DIR.iterdir()):
        if f.name.startswith("test-user-") and f.name.endswith(".csv"):
            uid = f.name.replace("test-user-", "").replace(".csv", "")
            csv_text = f.read_text(encoding="utf-8")
            user_txns = parse_csv_transactions(csv_text, customer_id=uid)
            users[uid] = user_txns
    return users


def _load_retail_users(limit: int = 0) -> dict[str, UserTransactions]:
    """Load users from retail.csv, grouped by Customer ID."""
    from config import DATA_DIR
    retail_path = DATA_DIR / "retail.csv"
    if not retail_path.exists():
        return {}

    users_txns: dict[str, list] = {}
    with open(retail_path, "r", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            cid = row.get("Customer ID", "").strip()
            if not cid or cid == "":
                continue
            # Clean float CIDs like "13085.0"
            try:
                cid = str(int(float(cid)))
            except (ValueError, TypeError):
                pass
            if cid not in users_txns:
                users_txns[cid] = []
            users_txns[cid].append(row)

    if limit > 0:
        keys = list(users_txns.keys())[:limit]
        users_txns = {k: users_txns[k] for k in keys}

    result: dict[str, UserTransactions] = {}
    for cid, rows in users_txns.items():
        csv_rows = []
        for r in rows:
            csv_rows.append(r)
        # Build CSV text and parse
        if csv_rows:
            fieldnames = list(csv_rows[0].keys())
            buf = io.StringIO()
            writer = csv.DictWriter(buf, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(csv_rows)
            result[cid] = parse_csv_transactions(buf.getvalue(), customer_id=cid)

    return result


@app.route("/linexone-dev/us-central1/learn_profiles", methods=["POST"])
def learn_profiles_endpoint():
    blocked = _guard_write()
    if blocked:
        return blocked
    try:
        data = request.get_json(silent=True) or {}
        source = str(data.get("source", "test-users") or "test-users")
        k = data.get("k", DEFAULT_K)
        limit = data.get("limit", 0)
        upload_name = str(data.get("upload_name", "")).strip()
        upload_csv_text = str(data.get("csv_text", "") or "")
        upload_transactions = data.get("transactions", [])
        upload_dataset_id = ""

        # Load transactions
        if source == "uploaded":
            raw_rows: list[dict] = []
            if upload_csv_text.strip():
                reader = csv.DictReader(io.StringIO(upload_csv_text))
                raw_rows = [row for row in reader]
            elif isinstance(upload_transactions, list):
                raw_rows = upload_transactions

            if not raw_rows:
                return jsonify({"error": "No uploaded transactions provided"}), 400

            users = parse_portfolio_records(raw_rows, default_customer_id=upload_name)
            if not users:
                return jsonify({"error": "No valid user transactions found in uploaded data"}), 400
            parsed_txn_count = sum(len(u.transactions) for u in users.values())
            upload_dataset_id = fs_save_portfolio_dataset(
                upload_name=upload_name,
                transactions=raw_rows if not upload_csv_text.strip() else None,
                csv_text=upload_csv_text,
                parsed_user_count=len(users),
                parsed_transaction_count=parsed_txn_count,
            )
            source = f"upload:{upload_name}" if upload_name else f"upload:{upload_dataset_id}"
        elif source.startswith("uploaded-dataset:"):
            selected_dataset_id = source.split(":", 1)[1].strip()
            if not selected_dataset_id:
                return jsonify({"error": "Missing uploaded dataset id"}), 400
            dataset = fs_load_portfolio_dataset(selected_dataset_id)
            if not dataset:
                return jsonify({"error": "Uploaded dataset not found"}), 404
            raw_rows: list[dict] = []
            dataset_csv_text = str(dataset.get("csv_text", "") or "")
            if dataset_csv_text:
                reader = csv.DictReader(io.StringIO(dataset_csv_text))
                raw_rows = [row for row in reader]
            elif isinstance(dataset.get("rows"), list):
                raw_rows = dataset.get("rows") or []
            if not raw_rows:
                return jsonify({"error": "Selected uploaded dataset has no rows"}), 400
            users = parse_portfolio_records(raw_rows, default_customer_id="")
            if not users:
                return jsonify({"error": "No valid user transactions found in selected uploaded dataset"}), 400
            upload_dataset_id = selected_dataset_id
            upload_name = str(dataset.get("upload_name", "")).strip()
            source = f"upload:{upload_name}" if upload_name else f"upload:{upload_dataset_id}"
        elif source == "retail":
            users = _load_retail_users(limit=limit)
        else:
            users = _load_all_test_users()

        if not users:
            return jsonify({"error": f"No users found for source '{source}'"}), 400

        # Derive features
        feature_df = derive_batch_features(users)

        if len(feature_df) < 2:
            return jsonify({"error": "Need at least 2 users to learn profiles"}), 400

        global_max: datetime | None = None
        for user_txns in users.values():
            for t in user_txns.transactions:
                if global_max is None or t.date > global_max:
                    global_max = t.date

        # Train
        catalog = _learn_profiles(feature_df, k=k, source=source, dataset_max_date=global_max)
        if upload_dataset_id:
            catalog.upload_dataset_id = upload_dataset_id
            catalog.upload_dataset_name = upload_name

        # Save
        save_catalog(catalog)

        return jsonify(catalog.model_dump(mode="json"))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/linexone-dev/us-central1/assign_profile", methods=["POST"])
def assign_profile_endpoint():
    try:
        data = request.get_json(silent=True) or {}
        user_id = data.get("user_id", "")
        catalog_version = data.get("catalog_version", "")

        if not user_id:
            return jsonify({"error": "Missing user_id"}), 400

        # Load catalog
        if catalog_version:
            catalog = load_catalog(catalog_version)
        else:
            catalog = get_latest_catalog()
        if not catalog:
            return jsonify({"error": "No profile catalog found"}), 404

        # Load user transactions
        user_txns = load_test_user(user_id)
        clean = clean_txns_fn(user_txns)

        # Assign
        assignment = _assign_profile(clean, catalog, eval_date=catalog.dataset_max_date)
        return jsonify(assignment.model_dump(mode="json"))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/linexone-dev/us-central1/profile_catalog", methods=["GET"])
@app.route("/linexone-dev/us-central1/profile_catalog/<version>", methods=["GET"])
def get_profile_catalog_endpoint(version=None):
    try:
        if version:
            catalog = load_catalog(version)
        else:
            catalog = get_latest_catalog()

        if not catalog:
            return jsonify({"error": "No catalog found"}), 404

        return jsonify(catalog.model_dump(mode="json"))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/linexone-dev/us-central1/list_profile_catalogs", methods=["GET"])
def list_profile_catalogs_endpoint():
    try:
        catalogs = list_catalogs()
        return jsonify({"catalogs": catalogs})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/linexone-dev/us-central1/list_portfolio_datasets", methods=["GET"])
def list_portfolio_datasets_endpoint():
    try:
        datasets = fs_list_portfolio_datasets()
        return jsonify({"datasets": datasets})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/linexone-dev/us-central1/create_portfolio_upload_url", methods=["POST"])
def create_portfolio_upload_url_endpoint():
    blocked = _guard_write()
    if blocked:
        return blocked
    try:
        data = request.get_json(silent=True) or {}
        upload_name = str(data.get("upload_name", "")).strip()
        file_name = _safe_file_name(str(data.get("file_name", "portfolio.csv")))
        content_type = str(data.get("content_type", "text/csv") or "text/csv")
        size_bytes = int(data.get("size_bytes", 0) or 0)
        if not upload_name:
            return jsonify({"error": "Missing upload_name"}), 400
        if size_bytes <= 0:
            return jsonify({"error": "Missing or invalid size_bytes"}), 400

        dataset_id, bucket_name, object_path = fs_create_portfolio_dataset_metadata(
            upload_name=upload_name,
            file_name=file_name,
            content_type=content_type,
            size_bytes=size_bytes,
        )

        request_origin = (
            request.headers.get("origin")
            or request.headers.get("Origin")
            or ""
        ).strip()
        upload_origin = request_origin if request_origin else None

        bucket = storage.bucket(bucket_name)
        blob = bucket.blob(object_path)
        upload_url = blob.create_resumable_upload_session(
            content_type=content_type,
            size=size_bytes,
            origin=upload_origin,
        )

        return jsonify({
            "dataset_id": dataset_id,
            "bucket": bucket_name,
            "object_path": object_path,
            "upload_url": upload_url,
            "required_headers": {"Content-Type": content_type},
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500





@app.route("/linexone-dev/us-central1/fork_catalog", methods=["POST"])
def fork_catalog_endpoint():
    blocked = _guard_write()
    if blocked:
        return blocked
    try:
        data = request.get_json(silent=True) or {}
        source_version = data.get("source_version", "")
        modifications = data.get("modifications")

        if not source_version:
            return jsonify({"error": "Missing source_version"}), 400

        forked = fork_catalog(source_version, modifications)
        if not forked:
            return jsonify({"error": f"Catalog version '{source_version}' not found"}), 404

        return jsonify(forked.model_dump(mode="json"))
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/linexone-dev/us-central1/start_optimize", methods=["POST"])
def start_optimize_endpoint():
    blocked = _guard_write()
    if blocked:
        return blocked
    try:
        data = request.get_json(silent=True) or {}
        catalog_version = data.get("catalog_version", "")
        max_iterations = data.get("max_iterations", 50)
        patience = data.get("patience", 3)

        if not catalog_version:
            return jsonify({"error": "Missing catalog_version"}), 400

        incentive_set_version = data.get("incentive_set_version") or None

        optimization_id = start_optimization(
            catalog_version,
            max_iterations=int(max_iterations),
            patience=int(patience),
            incentive_set_version=incentive_set_version,
        )
        return jsonify({"optimization_id": optimization_id})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/linexone-dev/us-central1/optimize_status/<optimization_id>", methods=["GET"])
def get_optimize_status_endpoint(optimization_id):
    try:
        state = get_optimization_status(optimization_id)
        if not state:
            return jsonify({"error": "Optimization not found"}), 404
        if state.status == "running":
            state = advance_optimization(optimization_id, profiles_per_tick=1) or state
            
        return jsonify(state.model_dump(mode="json"))
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/linexone-dev/us-central1/list_optimizations", methods=["GET"])
def list_optimizations_endpoint():
    try:
        catalog_version = request.args.get("catalog_version")
        optimizations = list_optimizations(catalog_version or None)
        return jsonify({"optimizations": optimizations})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/linexone-dev/us-central1/load_optimize/<optimization_id>", methods=["GET"])
def load_optimize_endpoint(optimization_id):
    try:
        state = load_optimization(optimization_id)
        if not state:
            return jsonify({"error": "Optimization not found"}), 404
        return jsonify(state.model_dump(mode="json"))
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/linexone-dev/us-central1/cancel_optimize/<optimization_id>", methods=["POST"])
def cancel_optimize_endpoint(optimization_id):
    try:
        ok = cancel_optimization(optimization_id)
        if not ok:
            return jsonify({"error": "Optimization not found or not running"}), 404
        return jsonify({"cancelled": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/linexone-dev/us-central1/save_optimize/<optimization_id>", methods=["POST"])
def save_optimize_endpoint(optimization_id):
    blocked = _guard_write()
    if blocked:
        return blocked
    try:
        path = save_optimization(optimization_id)
        if not path:
            return jsonify({"error": "Optimization not found or not in a saveable state"}), 404
        return jsonify({"saved": True, "path": path})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/linexone-dev/us-central1/delete_optimize/<optimization_id>", methods=["DELETE"])
def delete_optimize_endpoint(optimization_id):
    blocked = _guard_write()
    if blocked:
        return blocked
    try:
        ok = delete_optimization(optimization_id)
        if not ok:
            return jsonify({"error": "Optimization not found"}), 404
        return jsonify({"deleted": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/linexone-dev/us-central1/delete_catalog/<version>", methods=["DELETE"])
def delete_catalog_endpoint(version):
    blocked = _guard_write()
    if blocked:
        return blocked
    try:
        ok = delete_catalog(version)
        if not ok:
            return jsonify({"error": "Catalog not found"}), 404
        return jsonify({"deleted": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/linexone-dev/us-central1/delete_portfolio_dataset/<dataset_id>", methods=["DELETE"])
def delete_portfolio_dataset_endpoint(dataset_id):
    blocked = _guard_write()
    if blocked:
        return blocked
    try:
        result = fs_delete_portfolio_dataset_cascade(dataset_id)
        if not result:
            return jsonify({"error": "Portfolio dataset not found"}), 404
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ---------- Incentive Sets ----------

@app.route("/linexone-dev/us-central1/list_incentive_sets", methods=["GET"])
def list_incentive_sets_endpoint():
    try:
        sets = fs_list_incentive_sets()
        return jsonify({"incentive_sets": sets})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/linexone-dev/us-central1/incentive_set", methods=["GET"])
@app.route("/linexone-dev/us-central1/incentive_set/<version>", methods=["GET"])
def get_incentive_set_endpoint(version=None):
    try:
        if version:
            inc_set = fs_load_incentive_set(version)
        else:
            inc_set = fs_get_default_incentive_set()
            if not inc_set:
                blocked = _guard_write()
                if blocked:
                    return blocked
                # Auto-seed the default on first access
                inc_set = load_or_seed_default()
        if not inc_set:
            return jsonify({"error": "Incentive set not found"}), 404
        return jsonify(inc_set.model_dump(mode="json"))
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/linexone-dev/us-central1/create_incentive_set", methods=["POST"])
def create_incentive_set_endpoint():
    blocked = _guard_write()
    if blocked:
        return blocked
    try:
        data = request.get_json(silent=True) or {}
        name = data.get("name", "")
        description = data.get("description", "")
        raw_incentives = data.get("incentives", [])
        set_as_default = data.get("set_as_default", False)

        if not raw_incentives:
            return jsonify({"error": "No incentives provided"}), 400

        version = generate_version(raw_incentives)
        inc_set = IncentiveSet(
            version=version,
            name=name,
            description=description,
            is_default=set_as_default,
            incentive_count=len(raw_incentives),
            incentives=[Incentive(**inc) for inc in raw_incentives],
        )

        if set_as_default:
            # Clear old default first, then save
            fs_set_default_incentive_set(version)  # will be no-op if doc doesn't exist yet
        fs_save_incentive_set(inc_set)
        if set_as_default:
            fs_set_default_incentive_set(version)

        return jsonify(inc_set.model_dump(mode="json"))
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/linexone-dev/us-central1/set_default_incentive_set/<version>", methods=["POST"])
def set_default_incentive_set_endpoint(version):
    blocked = _guard_write()
    if blocked:
        return blocked
    try:
        ok = fs_set_default_incentive_set(version)
        if not ok:
            return jsonify({"error": "Incentive set not found"}), 404
        return jsonify({"default": True, "version": version})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/linexone-dev/us-central1/delete_incentive_set/<version>", methods=["DELETE"])
def delete_incentive_set_endpoint(version):
    blocked = _guard_write()
    if blocked:
        return blocked
    try:
        ok = fs_delete_incentive_set(version)
        if not ok:
            return jsonify({"error": "Incentive set not found"}), 404
        return jsonify({"deleted": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    startup_error = dev_credentials_error()
    if startup_error:
        print("=" * 72)
        print("LINEX PROFILER LOCAL DEV SERVER")
        print("=" * 72)
        print("Startup: FAILED")
        print(f"Reason:  {startup_error}")
        print("=" * 72)
        sys.exit(1)
    print("=" * 72)
    print("LINEX PROFILER LOCAL DEV SERVER")
    print("=" * 72)
    print("Server:  http://127.0.0.1:5050")
    print(f"Model:   {MODEL}")
    print(f"Env:     {APP_ENV}")
    print(f"Config:  {LOADED_ENV_FILE if LOADED_ENV_FILE else 'process environment only'}")
    print(f"Project: {FIREBASE_PROJECT_ID}")
    print(f"Bucket:  {FIREBASE_STORAGE_BUCKET}")
    if writes_allowed():
        print("Writes:  ENABLED")
    else:
        print("Writes:  BLOCKED")
        print(f"Reason:  {write_block_reason()}")
    print("=" * 72)
    print("Functions available:")
    print("  - GET  /linexone-dev/us-central1/list_test_users")
    print("  - POST /linexone-dev/us-central1/analyze_test_user")
    print("  - POST /linexone-dev/us-central1/analyze_transactions")
    print("  - POST /linexone-dev/us-central1/ask_test_user")
    print("  - POST /linexone-dev/us-central1/ask_agent")
    print("  - POST /linexone-dev/us-central1/agent_chat")
    print("  Profile Generator:")
    print("  - POST /linexone-dev/us-central1/learn_profiles")
    print("  - POST /linexone-dev/us-central1/assign_profile")
    print("  - GET  /linexone-dev/us-central1/profile_catalog")
    print("  - GET  /linexone-dev/us-central1/list_profile_catalogs")
    print("  - GET  /linexone-dev/us-central1/list_portfolio_datasets")
    print("  - POST /linexone-dev/us-central1/create_portfolio_upload_url")
    print("  - POST /linexone-dev/us-central1/fork_catalog")
    print("  Optimize:")
    print("  - POST /linexone-dev/us-central1/start_optimize")
    print("  - GET  /linexone-dev/us-central1/optimize_status/<id>")
    print("  - GET  /linexone-dev/us-central1/list_optimizations")
    print("  - GET  /linexone-dev/us-central1/load_optimize/<id>")
    print("  - POST /linexone-dev/us-central1/cancel_optimize/<id>")
    print("  - POST /linexone-dev/us-central1/save_optimize/<id>")
    print("  - DEL  /linexone-dev/us-central1/delete_optimize/<id>")
    print("  - DEL  /linexone-dev/us-central1/delete_catalog/<version>")
    print("  - DEL  /linexone-dev/us-central1/delete_portfolio_dataset/<dataset_id>")
    print("  Incentive Sets:")
    print("  - GET  /linexone-dev/us-central1/list_incentive_sets")
    print("  - GET  /linexone-dev/us-central1/incentive_set")
    print("  - GET  /linexone-dev/us-central1/incentive_set/<version>")
    print("  - POST /linexone-dev/us-central1/create_incentive_set")
    print("  - POST /linexone-dev/us-central1/set_default_incentive_set/<version>")
    print("  - DEL  /linexone-dev/us-central1/delete_incentive_set/<version>")
    app.run(host="127.0.0.1", port=5050, debug=False)
