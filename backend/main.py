"""Firebase Cloud Functions entry point for the Linex Agent.

All data is persisted to/read from Firestore — no mock data.
Heavy imports are deferred to minimize cold-start latency.
"""

import json
import os
import random
import traceback
import re
import datetime

from firebase_functions import https_fn, options
from firebase_admin import initialize_app, credentials, get_app, storage
import firebase_admin

from config import (
    APP_ENV,
    CARDS_PATH,
    FIREBASE_CREDENTIALS_PATH,
    FIREBASE_PROJECT_ID,
    FIREBASE_STORAGE_BUCKET,
    GEMINI_API_KEY,
    MODEL,
    TEST_USERS_DIR,
    write_block_reason,
    writes_allowed,
)

# Initialize Firebase Admin SDK (lightweight — no Firestore queries)
try:
    get_app()
except ValueError:
    try:
        if FIREBASE_CREDENTIALS_PATH and os.path.exists(FIREBASE_CREDENTIALS_PATH):
            cred = credentials.Certificate(FIREBASE_CREDENTIALS_PATH)
            initialize_app(cred, {"storageBucket": FIREBASE_STORAGE_BUCKET})
        else:
            initialize_app(options={"storageBucket": FIREBASE_STORAGE_BUCKET})  # Uses ADC (Cloud Run)
    except ValueError:
        # Another concurrent init won the race; existing default app is fine.
        pass
    except Exception as e:
        print(f"Firebase initialization warning: {e}")


# --------------- Lazy accessors (avoid cold-start Firestore/Gemini work) ---------------

_catalog = None


def _get_catalog():
    """Lazy-init CardCatalog on first use (avoids Firestore query at import time)."""
    global _catalog
    if _catalog is None:
        from cards.catalog import CardCatalog
        _catalog = CardCatalog(str(CARDS_PATH))
    return _catalog


# --------------- Common CORS / helpers ---------------

_CORS_ALL = options.CorsOptions(
    cors_origins="*",
    cors_methods=["GET", "POST", "DELETE", "OPTIONS"],
)


def _json_response(data, status=200):
    return https_fn.Response(
        json.dumps(data), status=status, content_type="application/json"
    )


def _extract_path_param(req, endpoint_name):
    """Extract path parameter that comes after endpoint_name in the URL path."""
    path = (req.path or "").rstrip("/")
    parts = path.split("/")
    try:
        idx = parts.index(endpoint_name)
        if idx + 1 < len(parts) and parts[idx + 1]:
            return parts[idx + 1]
    except ValueError:
        pass
    return None


def _safe_file_name(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", name or "portfolio.csv").strip("._")
    return cleaned or "portfolio.csv"


def _guard_write():
    if writes_allowed():
        return None
    return _json_response({"error": write_block_reason()}, 403)


# ==================== Original endpoints ====================


@https_fn.on_request(cors=_CORS_ALL)
def analyze_transactions(req: https_fn.Request) -> https_fn.Response:
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    try:
        from analysis.feature_engine import compute_features
        from analysis.preprocessor import clean_transactions, parse_json_transactions
        from analysis.profiler import profile_user_sync
        from profile_generator.assigner import assign_profile
        from profile_generator.versioning import get_latest_catalog

        req_json = req.get_json(silent=True) or {}
        transactions = req_json.get("transactions", [])
        customer_id = req_json.get("customer_id", "")
        region = req_json.get("region")
        if not transactions:
            return _json_response({"error": "No transactions provided"}, 400)
        user_txns = parse_json_transactions(transactions, customer_id)
        clean = clean_transactions(user_txns)
        features = compute_features(clean)
        catalog = get_latest_catalog()
        assignment = None
        if catalog:
            assignment = assign_profile(user_txns, catalog, eval_date=catalog.dataset_max_date)
        user_profile, card_rec = profile_user_sync(features, assignment, _get_catalog(), region)
        return _json_response({
            "profile": user_profile.model_dump(),
            "features": features.model_dump(mode="json"),
            "card_recommendations": card_rec.model_dump(),
        })
    except Exception as e:
        print("learn_profiles exception:")
        print(traceback.format_exc())
        return _json_response({"error": f"{type(e).__name__}: {e}"}, 500)


@https_fn.on_request(cors=_CORS_ALL, timeout_sec=120)
def ask_agent(req: https_fn.Request) -> https_fn.Response:
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    try:
        if not GEMINI_API_KEY:
            return _json_response({"error": "GEMINI_API_KEY not configured"}, 500)

        from analysis.feature_engine import compute_features
        from analysis.preprocessor import clean_transactions, parse_json_transactions
        from utils.formatters import format_features_for_llm
        from google import genai
        from google.genai import types

        req_json = req.get_json(silent=True) or {}
        transactions = req_json.get("transactions", [])
        question = req_json.get("question", "")
        customer_id = req_json.get("customer_id", "")
        if not transactions or not question:
            return _json_response({"error": "Missing transactions or question"}, 400)
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
        return _json_response({
            "question": question,
            "answer": response.text.strip(),
            "customer_id": customer_id,
        })
    except Exception as e:
        return _json_response({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL, timeout_sec=60)
def agent_chat(req: https_fn.Request) -> https_fn.Response:
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    try:
        if not GEMINI_API_KEY:
            return _json_response({"error": "GEMINI_API_KEY not configured"}, 500)

        from google import genai
        from google.genai import types

        req_json = req.get_json(silent=True) or {}
        message = (req_json.get("message") or "").strip()
        if not message:
            return _json_response({"error": "Missing message"}, 400)

        grid_context = req_json.get("grid_context")
        history = req_json.get("history") or []

        # Load backend source code so the LLM can answer any methodology question
        _source_cache_key = "_agent_chat_source_cache"
        if not hasattr(agent_chat, _source_cache_key):
            source_snippets = {}
            _src_dir = os.path.join(os.path.dirname(__file__), "profile_generator")
            for fname in ["optimization.py", "incentive_manager.py", "trainer.py"]:
                fpath = os.path.join(_src_dir, fname)
                try:
                    with open(fpath, "r") as f:
                        source_snippets[fname] = f.read()
                except Exception:
                    pass
            setattr(agent_chat, _source_cache_key, source_snippets)
        source_snippets = getattr(agent_chat, _source_cache_key, {})

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
            "- WORKFLOW: A named template card displayed in the Workflow view. NOT a profile, NOT clustering, NOT optimization. "
            "A workflow is simply a saved card with a name and description. 'Create workflow' = create_workflow action. "
            "'Create profile' = create_profile action (K-Means clustering). These are COMPLETELY DIFFERENT operations.\n"
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
            "  POST /api/update_incentive_set/<version> — Update incentive set (blocked if used in optimizations)\n"
            "  POST /api/set_default_incentive_set/<version> — Set default incentive set\n"
            "  GET  /api/check_incentive_set_usage/<version> — Check if incentive set is used by optimizations\n"
            "  DELETE /api/delete_incentive_set/<version> — Delete incentive set + cascade-delete its optimizations\n\n"
            "Workflows:\n"
            "  GET  /api/list_workflows — List all workflows\n"
            "  GET  /api/get_workflow/<id> — Get a single workflow\n"
            "  POST /api/create_workflow — Create a new workflow (name, description)\n"
            "  POST /api/update_workflow/<id> — Update a workflow's name/description\n"
            "  DELETE /api/delete_workflow/<id> — Delete a workflow\n\n"
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
            "## Workflow Management\n"
            "WORKFLOWS are named template cards displayed in the Workflow view. They are NOT profiles, NOT clustering, "
            "and NOT optimization runs. A workflow is simply a saved card with a name and description that appears "
            "on the Workflow page. Do NOT confuse 'create workflow' with 'create profile' (K-Means clustering). "
            "When the user says 'create workflow' or 'new workflow', use the create_workflow action — NOT create_profile.\n\n"
            "Workflows have a `type` field — either `built-in` or `custom`. "
            "Built-in workflows (like 'Optimize portfolio') are READ-ONLY — they CANNOT be updated, renamed, or deleted. "
            "Only `custom` (user-created) workflows can be modified or deleted. "
            "If the user tries to edit or delete a built-in workflow, politely explain it is a built-in workflow and cannot be changed.\n\n"
            '  - list_workflows: {"type":"list_workflows"}\n'
            '    Lists all workflows (built-in + custom). Synonyms: "list workflows", "show workflows", "my workflows".\n'
            '    Do NOT try to list them in the answer text — use the action so the frontend renders the list.\n'
            '  - create_workflow: {"type":"create_workflow","name":"<NAME>","description":"<DESC>","detail":"<DETAIL>"}\n'
            '    Creates a new custom workflow card. Name is required; description and detail are optional.\n'
            '    `detail` is a rich text field containing instructions/context that the LLM uses to compose the UI '
            'when the workflow card is clicked (e.g. which data to load, which steps to show, what parameters to collect).\n'
            '    When the user asks to create a workflow, ask for a name, description, and detail.\n'
            '    This is NOT the same as creating a profile — no clustering or K value is involved.\n'
            '  - update_workflow: {"type":"update_workflow","workflow_id":"<ID>","name":"<NAME>","description":"<DESC>","detail":"<DETAIL>"}\n'
            '    Updates a custom workflow\'s name, description, and/or detail. ONLY for custom workflows (type != "built-in").\n'
            '    When the user says "rename workflow", "update workflow", etc., resolve the workflow from context or ask.\n'
            '  - request_delete_workflow: {"type":"request_delete_workflow","workflow_id":"<ID>"}\n'
            '    Stages a custom workflow for deletion. ONLY for custom workflows (type != "built-in").\n'
            '    ALWAYS use this first — NEVER use confirm_delete_workflow directly.\n'
            '    Your answer MUST ask the user to confirm.\n'
            '  - confirm_delete_workflow: {"type":"confirm_delete_workflow"}\n'
            '    Only use when the user explicitly confirms deletion AND pending_delete_workflow is set.\n'
            '  - cancel_delete_workflow: {"type":"cancel_delete_workflow"}\n'
            '    Use when user declines deletion AND pending_delete_workflow is set.\n'
            '  - When listing workflows, NUMBER them starting from 1. Users can reference by number in follow-ups.\n'
            '  - When user says "delete <N>" after listing workflows, resolve the number to the workflow_id '
            'from available_workflows and use request_delete_workflow. Reject if it resolves to a built-in workflow.\n\n'
            "When using workflow actions, respond with valid JSON: "
            '{"answer":"<text>","actions":[...]} — the answer text alone does NOT execute anything.\n'
            "Use \\n for newlines within the answer string.\n\n"
            "### Workflow Examples (follow these exactly)\n"
            'User: "create new workflow"\n'
            'Correct response: {"answer":"What would you like to name the new workflow?","actions":[]}\n'
            'User: "Define incentive set"\n'
            'Correct response: {"answer":"Creating workflow \\"Define incentive set\\".","actions":[{"type":"create_workflow","name":"Define incentive set","description":""}]}\n\n'
            'User: "create a workflow called Customer Segmentation with description Segment customers by spending behavior"\n'
            'Correct response: {"answer":"Creating workflow \\"Customer Segmentation\\".","actions":[{"type":"create_workflow","name":"Customer Segmentation","description":"Segment customers by spending behavior"}]}\n\n'
            'User: "list workflows"\n'
            'Correct response: {"answer":"Here are the available workflows:","actions":[{"type":"list_workflows"}]}\n\n'
            "## Incentive Set Management\n"
            "You can manage incentive sets (CRUD) through the following actions:\n"
            '  - list_incentive_sets: {"type":"list_incentive_sets"}\n'
            '    Lists all available incentive sets. Synonyms: "list incentive sets", "show incentive sets", '
            '"my incentive sets", "what incentive sets".\n'
            '    Do NOT try to list them in the answer text — use the action so the frontend renders the list.\n'
            '  - create_incentive_set: {"type":"create_incentive_set","name":"<NAME>","description":"<DESC>","incentives":[{"name":"<NAME>","estimated_annual_cost_per_user":<COST>,"redemption_rate":<RATE>},...], "set_as_default": false}\n'
            '    Creates a new incentive set. Each incentive requires name, estimated_annual_cost_per_user (number), '
            'and redemption_rate (0.0-1.0). Optionally set set_as_default to true.\n'
            '    CRITICAL — AUTO-GENERATE INCENTIVES: When the user asks to create an incentive set, do NOT ask them to '
            'enter each incentive one by one. Instead:\n'
            '    1. Ask for a name and a brief description of the incentive set (e.g. "travel rewards for premium cardholders", '
            '"cash back program for everyday spending", "student credit card perks").\n'
            '    2. If the description is too vague to generate meaningful incentives, ask ONE clarifying question '
            '(e.g. "What type of cardholders is this for?" or "Any spending categories to focus on?").\n'
            '    3. Once you have enough context, USE YOUR KNOWLEDGE to generate a complete set of 10-30 relevant incentives '
            'with realistic estimated_annual_cost_per_user ($10-$500 range) and redemption_rate (0.1-0.9) values. '
            'Base costs and rates on industry benchmarks for credit card loyalty programs.\n'
            '    4. Include the full incentives array in the create_incentive_set action — do NOT list them in the answer text '
            'and ask the user to confirm each one. Just create the set directly.\n'
            '    5. Do NOT ask for confirmation ("Is this ok?", "Would you like me to proceed?", etc.) — just create the set directly '
            'and report what was created. The action executes immediately; there is no confirmation step.\n'
            '    6. In your answer text, briefly summarize what you created (e.g. "Created \'Travel Premium\' with 18 incentives '
            'covering lounge access, travel credits, insurance, and points multipliers.").\n'
            '    Example categories to draw from: cash back tiers, points multipliers, travel benefits (lounges, upgrades, '
            'fee credits), insurance/protection, dining/entertainment credits, streaming/subscription credits, '
            'gas/auto benefits, shopping rewards, fee waivers, lifestyle perks.\n'
            '  - update_incentive_set: {"type":"update_incentive_set","version":"<version>","name":"<NAME>","description":"<DESC>","incentives":[...]}\n'
            '    Updates an existing incentive set\'s name, description, and/or incentives. All fields are optional.\n'
            '    IMPORTANT: Update is BLOCKED if the incentive set has been used to generate one or more incentive programs '
            '(optimization runs). If blocked, inform the user that the set cannot be modified because it has been used to '
            'generate programs. Suggest creating a new incentive set instead.\n'
            '    Synonyms: "edit incentive set", "rename incentive set", "update incentive set", "modify incentive set".\n'
            '  - request_delete_incentive_set: {"type":"request_delete_incentive_set","version":"<version>"}\n'
            '    Stages an incentive set for deletion. Use this when the user wants to delete an incentive set.\n'
            '    ALWAYS use this first to request confirmation — NEVER use confirm_delete_incentive_set directly.\n'
            '    IMPORTANT: Deleting an incentive set will ALSO delete ALL incentive programs (optimization runs) '
            'that were generated using it. Your confirmation message MUST warn the user about this cascade deletion. '
            'Example: "Are you sure you want to delete incentive set <name>? This will also delete N incentive program(s) '
            'that were generated from it. Reply yes to confirm."\n'
            '    The number of affected programs is available in grid_context.incentive_set_usage[version] if present.\n'
            '  - confirm_delete_incentive_set: {"type":"confirm_delete_incentive_set"}\n'
            '    Only use when the user explicitly confirms deletion AND pending_delete_incentive_set is set.\n'
            '  - cancel_delete_incentive_set: {"type":"cancel_delete_incentive_set"}\n'
            '    Use when user declines deletion AND pending_delete_incentive_set is set.\n'
            '  - set_default_incentive_set: {"type":"set_default_incentive_set","version":"<version>"}\n'
            '    Sets an incentive set as the default. Use when user says "set default", "make default", etc.\n'
            '  - When listing incentive sets, NUMBER them starting from 1. Users can reference by number in follow-ups.\n'
            '  - When user says "delete <N>" after listing incentive sets, resolve the number to the version '
            'from available_incentive_sets and use request_delete_incentive_set.\n'
            '  - When user says "edit <N>" or "update <N>" after listing incentive sets, resolve the number to the version '
            'from available_incentive_sets and use update_incentive_set.\n\n'
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
                '    Creates a new profile catalog using K-Means clustering with K clusters. THIS IS NOT A WORKFLOW.\n'
                '    ONLY use this when the user says "create profile", "learn profiles", or "cluster". '
                'NEVER use this for "create workflow" — use create_workflow instead.\n'
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
                "## Incentive Analysis & Categorization\n"
                "You have FULL access to the incentive set data in grid_context.incentive_set.incentives. "
                "Each incentive has: name, estimated_annual_cost_per_user, redemption_rate, effective_cost.\n"
                "You ARE capable of and SHOULD eagerly handle ANY analytical request about incentives, including:\n"
                "- **Categorize**: Group incentives by type (e.g. Cash Back, Points/Rewards, Travel, Dining, "
                "Insurance/Protection, Fee Waivers, Credits/Statements, Lifestyle/Subscriptions, Auto/Gas, etc.). "
                "Infer the category from the incentive name.\n"
                "- **Filter**: Find incentives matching criteria (e.g. cost < $50, redemption > 0.5, travel-related).\n"
                "- **Rank/Sort**: Rank by cost, redemption rate, effective cost, or value ratio.\n"
                "- **Compare**: Compare incentives across categories, cost tiers, or redemption bands.\n"
                "- **Summarize**: Provide statistics like count per category, average cost, total cost, etc.\n"
                "- **Recommend**: Suggest high-value incentives (high redemption, low cost) or flag low-value ones.\n"
                "When categorizing or analyzing, use ASCII tables or structured lists in the answer text. "
                "Be thorough — include ALL matching incentives, not just a few examples. "
                "No special action type is needed — just provide the analysis directly in the answer field.\n"
                "NEVER say you cannot categorize, filter, or analyze incentives. You have all the data you need.\n"
                "If grid_context.incentive_set is missing or has no incentives, tell the user to select an incentive set first "
                "(check available_incentive_sets) — do NOT say you lack the capability.\n\n"
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
            system += (
                "For simple questions, respond with plain text. "
                "But when executing actions (create/update/delete incentive sets, workflows, etc.), "
                "you MUST respond with valid JSON: "
                '{"answer":"<text>","actions":[...]}.\n'
            )

        client = genai.Client(api_key=GEMINI_API_KEY)
        # Build multi-turn contents from history + current message
        if history and len(history) > 0:
            contents = []
            for turn in history:
                role = "user" if turn.get("role") == "user" else "model"
                contents.append(types.Content(role=role, parts=[types.Part.from_text(text=turn["text"])]))
            contents.append(types.Content(role="user", parts=[types.Part.from_text(text=message)]))
        else:
            contents = message
        response = client.models.generate_content(
            model=MODEL,
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=system, temperature=0.3, max_output_tokens=4000,
            ),
        )
        raw = response.text.strip()

        # Try to parse structured JSON response (always attempt, not just with grid_context)
        if True:
            # Strip markdown code fences if present
            cleaned = raw
            if cleaned.startswith("```"):
                cleaned = "\n".join(cleaned.split("\n")[1:])
            if cleaned.endswith("```"):
                cleaned = "\n".join(cleaned.split("\n")[:-1])
            cleaned = cleaned.strip()
            try:
                parsed = json.loads(cleaned)
                if isinstance(parsed, dict) and "answer" in parsed:
                    return _json_response(parsed)
            except json.JSONDecodeError:
                # Try to extract JSON object from within the text
                import re as _re
                m = _re.search(r'\{[\s\S]*"answer"\s*:', cleaned)
                if m:
                    candidate = cleaned[m.start():]
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
                                return _json_response(parsed)
                        except json.JSONDecodeError:
                            pass

        # Check if the raw text contains a trailing JSON with actions
        actions_idx = raw.find('"actions"')
        if actions_idx >= 0:
            brace_start = raw.rfind('{', 0, actions_idx)
            if brace_start >= 0:
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
                            return _json_response(result)
                    except json.JSONDecodeError:
                        pass
        return _json_response({"answer": raw})
    except Exception as e:
        return _json_response({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL)
def list_test_users(req: https_fn.Request) -> https_fn.Response:
    """List test user IDs from Firestore, falling back to disk."""
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    try:
        ids = []

        # Try Firestore first (works in production)
        try:
            from profile_generator.firestore_client import fs_list_test_user_ids
            ids = fs_list_test_user_ids()
        except Exception:
            pass

        # Fall back to disk (local dev)
        if not ids and TEST_USERS_DIR.exists():
            for f in sorted(TEST_USERS_DIR.iterdir()):
                if f.name.startswith("test-user-") and f.name.endswith(".csv"):
                    uid = f.name.replace("test-user-", "").replace(".csv", "")
                    ids.append(uid)

        selected = random.sample(ids, min(20, len(ids))) if ids else []
        return _json_response({"user_ids": selected})
    except Exception as e:
        return _json_response({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL, timeout_sec=120)
def analyze_test_user(req: https_fn.Request) -> https_fn.Response:
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    try:
        from analysis.feature_engine import compute_features
        from analysis.preprocessor import clean_transactions, load_test_user
        from analysis.profiler import profile_user_sync
        from profile_generator.assigner import assign_profile
        from profile_generator.versioning import get_latest_catalog

        req_json = req.get_json(silent=True) or {}
        user_id = req_json.get("user_id", "")
        if not user_id:
            return _json_response({"error": "Missing user_id"}, 400)
        user_txns = load_test_user(user_id)
        clean = clean_transactions(user_txns)
        features = compute_features(clean)
        catalog = get_latest_catalog()
        assignment = None
        if catalog:
            assignment = assign_profile(user_txns, catalog, eval_date=catalog.dataset_max_date)
        user_profile, card_rec = profile_user_sync(features, assignment, _get_catalog())
        return _json_response({
            "profile": user_profile.model_dump(),
            "features": features.model_dump(mode="json"),
            "card_recommendations": card_rec.model_dump(),
        })
    except Exception as e:
        return _json_response({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL, timeout_sec=120)
def ask_test_user(req: https_fn.Request) -> https_fn.Response:
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    try:
        if not GEMINI_API_KEY:
            return _json_response({"error": "GEMINI_API_KEY not configured"}, 500)

        from analysis.feature_engine import compute_features
        from analysis.preprocessor import clean_transactions, load_test_user
        from utils.formatters import format_features_for_llm
        from google import genai
        from google.genai import types

        req_json = req.get_json(silent=True) or {}
        user_id = req_json.get("user_id", "")
        question = req_json.get("question", "")
        if not user_id or not question:
            return _json_response({"error": "Missing user_id or question"}, 400)
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
        return _json_response({
            "question": question,
            "answer": response.text.strip(),
            "user_id": user_id,
        })
    except Exception as e:
        return _json_response({"error": str(e)}, 500)


# ==================== Profile Catalog endpoints ====================


@https_fn.on_request(cors=_CORS_ALL)
def list_profile_catalogs(req: https_fn.Request) -> https_fn.Response:
    """List all profile catalogs from Firestore."""
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    try:
        from profile_generator.versioning import list_catalogs
        catalogs = list_catalogs()
        return _json_response({"catalogs": catalogs})
    except Exception as e:
        return _json_response({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL)
def list_portfolio_datasets(req: https_fn.Request) -> https_fn.Response:
    """List uploaded portfolio datasets from Firestore."""
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    try:
        from profile_generator.firestore_client import fs_list_portfolio_datasets
        datasets = fs_list_portfolio_datasets()
        return _json_response({"datasets": datasets})
    except Exception as e:
        return _json_response({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL)
def create_portfolio_upload_url(req: https_fn.Request) -> https_fn.Response:
    """Create a signed Cloud Storage upload URL and dataset metadata doc."""
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    blocked = _guard_write()
    if blocked:
        return blocked
    try:
        from profile_generator.firestore_client import fs_create_portfolio_dataset_metadata

        data = req.get_json(silent=True) or {}
        upload_name = str(data.get("upload_name", "")).strip()
        file_name = _safe_file_name(str(data.get("file_name", "portfolio.csv")))
        content_type = str(data.get("content_type", "text/csv") or "text/csv")
        size_bytes = int(data.get("size_bytes", 0) or 0)
        if not upload_name:
            return _json_response({"error": "Missing upload_name"}, 400)
        if size_bytes <= 0:
            return _json_response({"error": "Missing or invalid size_bytes"}, 400)

        dataset_id, bucket_name, object_path = fs_create_portfolio_dataset_metadata(
            upload_name=upload_name,
            file_name=file_name,
            content_type=content_type,
            size_bytes=size_bytes,
        )

        request_origin = (
            req.headers.get("origin")
            or req.headers.get("Origin")
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

        return _json_response({
            "dataset_id": dataset_id,
            "bucket": bucket_name,
            "object_path": object_path,
            "upload_url": upload_url,
            "required_headers": {"Content-Type": content_type},
        })
    except Exception as e:
        return _json_response({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL)
def profile_catalog(req: https_fn.Request) -> https_fn.Response:
    """Get a profile catalog by version, or the latest if no version given."""
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    try:
        from profile_generator.versioning import load_catalog, get_latest_catalog
        version = _extract_path_param(req, "profile_catalog")
        if version:
            cat = load_catalog(version)
        else:
            cat = get_latest_catalog()
        if not cat:
            return _json_response({"error": "No catalog found"}, 404)
        return _json_response(cat.model_dump(mode="json"))
    except Exception as e:
        return _json_response({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL)
def fork_catalog_fn(req: https_fn.Request) -> https_fn.Response:
    """Fork an existing catalog with optional modifications."""
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    blocked = _guard_write()
    if blocked:
        return blocked
    try:
        from profile_generator.versioning import fork_catalog
        data = req.get_json(silent=True) or {}
        source_version = data.get("source_version", "")
        modifications = data.get("modifications")
        if not source_version:
            return _json_response({"error": "Missing source_version"}, 400)
        forked = fork_catalog(source_version, modifications)
        if not forked:
            return _json_response({"error": f"Catalog '{source_version}' not found"}, 404)
        return _json_response(forked.model_dump(mode="json"))
    except Exception as e:
        return _json_response({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL)
def delete_catalog_fn(req: https_fn.Request) -> https_fn.Response:
    """Delete a catalog by version."""
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    blocked = _guard_write()
    if blocked:
        return blocked
    try:
        from profile_generator.versioning import delete_catalog
        version = _extract_path_param(req, "delete_catalog")
        if not version:
            return _json_response({"error": "Missing catalog version"}, 400)
        ok = delete_catalog(version)
        if not ok:
            return _json_response({"error": "Catalog not found"}, 404)
        return _json_response({"deleted": True})
    except Exception as e:
        return _json_response({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL)
def delete_portfolio_dataset_fn(req: https_fn.Request) -> https_fn.Response:
    """Delete a portfolio dataset and all associated catalogs/optimizations."""
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    blocked = _guard_write()
    if blocked:
        return blocked
    try:
        from profile_generator.firestore_client import fs_delete_portfolio_dataset_cascade
        dataset_id = _extract_path_param(req, "delete_portfolio_dataset")
        if not dataset_id:
            return _json_response({"error": "Missing dataset_id"}, 400)
        result = fs_delete_portfolio_dataset_cascade(dataset_id)
        if not result:
            return _json_response({"error": "Portfolio dataset not found"}, 404)
        return _json_response(result)
    except Exception as e:
        return _json_response({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL, timeout_sec=540, memory=options.MemoryOption.GB_4)
def learn_profiles(req: https_fn.Request) -> https_fn.Response:
    """Train profile clusters from test users (Firestore or disk) or retail data."""
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    blocked = _guard_write()
    if blocked:
        return blocked
    upload_dataset_id = ""
    try:
        from profile_generator.feature_derivation import derive_batch_features
        from profile_generator.trainer import learn_profiles as _learn_profiles
        from profile_generator.versioning import save_catalog
        from profile_generator.firestore_client import (
            fs_save_portfolio_dataset,
            fs_load_portfolio_dataset,
            fs_mark_portfolio_dataset_processing,
            fs_mark_portfolio_dataset_ready,
            fs_mark_portfolio_dataset_failed,
        )
        from analysis.preprocessor import parse_csv_transactions, parse_portfolio_records_with_metadata
        from config import DEFAULT_K
        import csv
        import io

        data = req.get_json(silent=True) or {}
        source = str(data.get("source", "test-users") or "test-users")
        k = data.get("k", DEFAULT_K)
        limit = data.get("limit", 0)
        upload_name = str(data.get("upload_name", "")).strip()
        upload_csv_text = str(data.get("csv_text", "") or "")
        upload_transactions = data.get("transactions", [])
        upload_dataset_id = str(data.get("upload_dataset_id", "") or "")

        users = {}
        if source == "uploaded":
            row_count = 0
            field_names: list[str] = []
            if upload_dataset_id:
                dataset = fs_load_portfolio_dataset(upload_dataset_id)
                if not dataset:
                    return _json_response({"error": "Uploaded dataset not found"}, 404)
                fs_mark_portfolio_dataset_processing(upload_dataset_id)
                storage_format = str(dataset.get("storage_format", "") or "")
                if storage_format == "gcs":
                    bucket_name = str(dataset.get("bucket", "") or "")
                    object_path = str(dataset.get("object_path", "") or "")
                    if not bucket_name or not object_path:
                        return _json_response({"error": "Uploaded dataset metadata missing Storage location"}, 400)
                    blob = storage.bucket(bucket_name).blob(object_path)
                    if not blob.exists():
                        return _json_response({"error": "Uploaded CSV file not found in Cloud Storage"}, 404)
                    with blob.open("rt", encoding="utf-8") as fh:
                        reader = csv.DictReader(fh)
                        field_names = sorted([str(k) for k in (reader.fieldnames or [])])
                        users, row_count, _ = parse_portfolio_records_with_metadata(
                            reader,
                            default_customer_id=upload_name,
                        )
                else:
                    dataset_csv_text = str(dataset.get("csv_text", "") or "")
                    if dataset_csv_text:
                        reader = csv.DictReader(io.StringIO(dataset_csv_text))
                        users, row_count, field_names = parse_portfolio_records_with_metadata(
                            reader,
                            default_customer_id=upload_name,
                        )
                    elif isinstance(dataset.get("rows"), list):
                        users, row_count, field_names = parse_portfolio_records_with_metadata(
                            dataset.get("rows") or [],
                            default_customer_id=upload_name,
                        )
                    else:
                        users = {}
                        row_count = 0
                        field_names = []
                upload_name = str(dataset.get("upload_name", "")).strip() or upload_name
            else:
                # Backward-compatible direct payload path for smaller files
                if upload_csv_text.strip():
                    reader = csv.DictReader(io.StringIO(upload_csv_text))
                    users, row_count, field_names = parse_portfolio_records_with_metadata(
                        reader,
                        default_customer_id=upload_name,
                    )
                elif isinstance(upload_transactions, list):
                    users, row_count, field_names = parse_portfolio_records_with_metadata(
                        upload_transactions,
                        default_customer_id=upload_name,
                    )
                else:
                    users = {}
                    row_count = 0
                    field_names = []

                if row_count > 0:
                    parsed_txn_count = sum(len(u.transactions) for u in users.values())
                    upload_dataset_id = fs_save_portfolio_dataset(
                        upload_name=upload_name,
                        transactions=upload_transactions if not upload_csv_text.strip() else None,
                        csv_text=upload_csv_text,
                        parsed_user_count=len(users),
                        parsed_transaction_count=parsed_txn_count,
                    )
                    fs_mark_portfolio_dataset_processing(upload_dataset_id)

            if row_count <= 0:
                return _json_response({"error": "No uploaded transactions provided"}, 400)

            if not users:
                if upload_dataset_id:
                    fs_mark_portfolio_dataset_failed(upload_dataset_id, "No valid user transactions found in uploaded data")
                return _json_response({"error": "No valid user transactions found in uploaded data"}, 400)

            if upload_dataset_id:
                fs_mark_portfolio_dataset_ready(
                    upload_dataset_id,
                    row_count=row_count,
                    parsed_user_count=len(users),
                    parsed_transaction_count=sum(len(u.transactions) for u in users.values()),
                    field_names=field_names,
                )
            source = f"upload:{upload_name}" if upload_name else f"upload:{upload_dataset_id}"
        elif source.startswith("uploaded-dataset:"):
            selected_dataset_id = source.split(":", 1)[1].strip()
            if not selected_dataset_id:
                return _json_response({"error": "Missing uploaded dataset id"}, 400)
            dataset = fs_load_portfolio_dataset(selected_dataset_id)
            if not dataset:
                return _json_response({"error": "Uploaded dataset not found"}, 404)
            fs_mark_portfolio_dataset_processing(selected_dataset_id)
            row_count = 0
            field_names: list[str] = []
            storage_format = str(dataset.get("storage_format", "") or "")
            if storage_format == "gcs":
                bucket_name = str(dataset.get("bucket", "") or "")
                object_path = str(dataset.get("object_path", "") or "")
                if not bucket_name or not object_path:
                    return _json_response({"error": "Uploaded dataset metadata missing Storage location"}, 400)
                blob = storage.bucket(bucket_name).blob(object_path)
                if not blob.exists():
                    return _json_response({"error": "Uploaded CSV file not found in Cloud Storage"}, 404)
                with blob.open("rt", encoding="utf-8") as fh:
                    reader = csv.DictReader(fh)
                    field_names = sorted([str(k) for k in (reader.fieldnames or [])])
                    users, row_count, _ = parse_portfolio_records_with_metadata(
                        reader,
                        default_customer_id="",
                    )
            else:
                dataset_csv_text = str(dataset.get("csv_text", "") or "")
                if dataset_csv_text:
                    reader = csv.DictReader(io.StringIO(dataset_csv_text))
                    users, row_count, field_names = parse_portfolio_records_with_metadata(
                        reader,
                        default_customer_id="",
                    )
                elif isinstance(dataset.get("rows"), list):
                    users, row_count, field_names = parse_portfolio_records_with_metadata(
                        dataset.get("rows") or [],
                        default_customer_id="",
                    )
                else:
                    users = {}
                    row_count = 0
                    field_names = []
            if row_count <= 0:
                return _json_response({"error": "Selected uploaded dataset has no rows"}, 400)
            if not users:
                fs_mark_portfolio_dataset_failed(selected_dataset_id, "No valid user transactions found in selected uploaded dataset")
                return _json_response({"error": "No valid user transactions found in selected uploaded dataset"}, 400)
            upload_dataset_id = selected_dataset_id
            upload_name = str(dataset.get("upload_name", "")).strip()
            fs_mark_portfolio_dataset_ready(
                upload_dataset_id,
                row_count=row_count,
                parsed_user_count=len(users),
                parsed_transaction_count=sum(len(u.transactions) for u in users.values()),
                field_names=field_names,
            )
            source = f"upload:{upload_name}" if upload_name else f"upload:{upload_dataset_id}"
        elif source == "retail":
            from config import DATA_DIR
            retail_path = DATA_DIR / "retail.csv"
            if not retail_path.exists():
                return _json_response({"error": "retail.csv not available (dev only)"}, 400)
            users_txns = {}
            with open(retail_path, "r", encoding="utf-8") as fh:
                reader = csv.DictReader(fh)
                for row in reader:
                    cid = row.get("Customer ID", "").strip()
                    if not cid:
                        continue
                    try:
                        cid = str(int(float(cid)))
                    except (ValueError, TypeError):
                        pass
                    users_txns.setdefault(cid, []).append(row)
            if limit > 0:
                keys = list(users_txns.keys())[:limit]
                users_txns = {k: users_txns[k] for k in keys}
            for cid, rows in users_txns.items():
                if rows:
                    fieldnames = list(rows[0].keys())
                    buf = io.StringIO()
                    writer = csv.DictWriter(buf, fieldnames=fieldnames)
                    writer.writeheader()
                    writer.writerows(rows)
                    users[cid] = parse_csv_transactions(buf.getvalue(), customer_id=cid)
        else:
            # Try Firestore first (works in production)
            try:
                from profile_generator.firestore_client import fs_load_all_test_user_csvs
                csv_map = fs_load_all_test_user_csvs()
                for uid, csv_text in csv_map.items():
                    users[uid] = parse_csv_transactions(csv_text, customer_id=uid)
            except Exception:
                pass

            # Fall back to disk (local dev)
            if not users and TEST_USERS_DIR.exists():
                for f in sorted(TEST_USERS_DIR.iterdir()):
                    if f.name.startswith("test-user-") and f.name.endswith(".csv"):
                        uid = f.name.replace("test-user-", "").replace(".csv", "")
                        csv_text = f.read_text(encoding="utf-8")
                        users[uid] = parse_csv_transactions(csv_text, customer_id=uid)

        if not users:
            return _json_response({"error": f"No users found for source '{source}'"}, 400)

        feature_df = derive_batch_features(users)
        if len(feature_df) < 2:
            return _json_response({"error": "Need at least 2 users to learn"}, 400)

        global_max = None
        for user_txns in users.values():
            for t in user_txns.transactions:
                if global_max is None or t.date > global_max:
                    global_max = t.date

        cat = _learn_profiles(feature_df, k=k, source=source, dataset_max_date=global_max)
        if upload_dataset_id:
            cat.upload_dataset_id = upload_dataset_id
            cat.upload_dataset_name = upload_name
        save_catalog(cat)
        return _json_response(cat.model_dump(mode="json"))
    except Exception as e:
        if upload_dataset_id:
            try:
                from profile_generator.firestore_client import fs_mark_portfolio_dataset_failed
                fs_mark_portfolio_dataset_failed(upload_dataset_id, f"{type(e).__name__}: {e}")
            except Exception:
                pass
        print("learn_profiles exception:")
        print(traceback.format_exc())
        return _json_response({"error": f"{type(e).__name__}: {e}"}, 500)


# ==================== Optimize endpoints ====================


@https_fn.on_request(cors=_CORS_ALL, timeout_sec=540)
def start_optimize_fn(req: https_fn.Request) -> https_fn.Response:
    """Start an LTV optimization run."""
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    blocked = _guard_write()
    if blocked:
        return blocked
    try:
        from profile_generator.optimization import start_optimization as _start_optimization
        data = req.get_json(silent=True) or {}
        catalog_version = data.get("catalog_version", "")
        max_iterations = data.get("max_iterations", 50)
        patience = data.get("patience", 3)
        incentive_set_version = data.get("incentive_set_version") or None
        if not catalog_version:
            return _json_response({"error": "Missing catalog_version"}, 400)
        optimization_id = _start_optimization(
            catalog_version,
            max_iterations=int(max_iterations),
            patience=int(patience),
            incentive_set_version=incentive_set_version,
        )
        return _json_response({"optimization_id": optimization_id})
    except Exception as e:
        return _json_response({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL)
def optimize_status(req: https_fn.Request) -> https_fn.Response:
    """Get optimization status by ID (checks memory then Firestore)."""
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    try:
        from profile_generator.optimization import (
            get_optimization_status as _get_optimization_status,
            advance_optimization as _advance_optimization,
        )
        optimization_id = _extract_path_param(req, "optimize_status")
        if not optimization_id:
            return _json_response({"error": "Missing optimization_id"}, 400)
        state = _get_optimization_status(optimization_id)
        if not state:
            return _json_response({"error": "Optimization not found"}, 404)
        if state.status == "running":
            state = _advance_optimization(optimization_id, profiles_per_tick=1) or state
        return _json_response(state.model_dump(mode="json"))
    except Exception as e:
        return _json_response({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL)
def list_optimizations_fn(req: https_fn.Request) -> https_fn.Response:
    """List saved optimization runs from Firestore."""
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    try:
        from profile_generator.optimization import list_optimizations as _list_optimizations
        catalog_version = req.args.get("catalog_version")
        optimizations = _list_optimizations(catalog_version or None)
        return _json_response({"optimizations": optimizations})
    except Exception as e:
        return _json_response({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL)
def load_optimize_fn(req: https_fn.Request) -> https_fn.Response:
    """Load a saved optimization run from Firestore."""
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    try:
        from profile_generator.optimization import load_optimization as _load_optimization
        optimization_id = _extract_path_param(req, "load_optimize")
        if not optimization_id:
            return _json_response({"error": "Missing optimization_id"}, 400)
        state = _load_optimization(optimization_id)
        if not state:
            return _json_response({"error": "Optimization not found"}, 404)
        return _json_response(state.model_dump(mode="json"))
    except Exception as e:
        return _json_response({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL)
def cancel_optimize_fn(req: https_fn.Request) -> https_fn.Response:
    """Cancel a running optimization."""
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    try:
        from profile_generator.optimization import cancel_optimization as _cancel_optimization
        optimization_id = _extract_path_param(req, "cancel_optimize")
        if not optimization_id:
            return _json_response({"error": "Missing optimization_id"}, 400)
        ok = _cancel_optimization(optimization_id)
        if not ok:
            return _json_response({"error": "Optimization not found or not running"}, 404)
        return _json_response({"cancelled": True})
    except Exception as e:
        return _json_response({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL)
def save_optimize_fn(req: https_fn.Request) -> https_fn.Response:
    """Persist a completed optimization to Firestore."""
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    blocked = _guard_write()
    if blocked:
        return blocked
    try:
        from profile_generator.optimization import save_optimization as _save_optimization
        optimization_id = _extract_path_param(req, "save_optimize")
        if not optimization_id:
            return _json_response({"error": "Missing optimization_id"}, 400)
        path = _save_optimization(optimization_id)
        if not path:
            return _json_response({"error": "Optimization not found or not saveable"}, 404)
        return _json_response({"saved": True, "path": path})
    except Exception as e:
        return _json_response({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL)
def delete_optimize_fn(req: https_fn.Request) -> https_fn.Response:
    """Delete an optimization run from memory and Firestore."""
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    blocked = _guard_write()
    if blocked:
        return blocked
    try:
        from profile_generator.optimization import delete_optimization as _delete_optimization
        optimization_id = _extract_path_param(req, "delete_optimize")
        if not optimization_id:
            return _json_response({"error": "Missing optimization_id"}, 400)
        ok = _delete_optimization(optimization_id)
        if not ok:
            return _json_response({"error": "Optimization not found"}, 404)
        return _json_response({"deleted": True})
    except Exception as e:
        return _json_response({"error": str(e)}, 500)


# ==================== Incentive Set endpoints ====================


@https_fn.on_request(cors=_CORS_ALL)
def list_incentive_sets(req: https_fn.Request) -> https_fn.Response:
    """List all incentive sets from Firestore."""
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    try:
        from profile_generator.firestore_client import fs_list_incentive_sets
        sets = fs_list_incentive_sets()
        return _json_response({"incentive_sets": sets})
    except Exception as e:
        return _json_response({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL)
def incentive_set(req: https_fn.Request) -> https_fn.Response:
    """Get an incentive set by version, or the default if no version given."""
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    try:
        from profile_generator.firestore_client import (
            fs_load_incentive_set, fs_get_default_incentive_set,
        )
        from profile_generator.incentive_manager import load_or_seed_default
        version = _extract_path_param(req, "incentive_set")
        if version:
            inc_set = fs_load_incentive_set(version)
        else:
            inc_set = fs_get_default_incentive_set()
            if not inc_set:
                blocked = _guard_write()
                if blocked:
                    return blocked
                inc_set = load_or_seed_default()
        if not inc_set:
            return _json_response({"error": "Incentive set not found"}, 404)
        return _json_response(inc_set.model_dump(mode="json"))
    except Exception as e:
        return _json_response({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL)
def create_incentive_set_fn(req: https_fn.Request) -> https_fn.Response:
    """Create a new incentive set."""
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    blocked = _guard_write()
    if blocked:
        return blocked
    try:
        from profile_generator.firestore_client import (
            fs_save_incentive_set, fs_set_default_incentive_set,
        )
        from profile_generator.incentive_manager import generate_version
        from models.incentive_set import Incentive, IncentiveSet
        data = req.get_json(silent=True) or {}
        name = data.get("name", "")
        description = data.get("description", "")
        raw_incentives = data.get("incentives", [])
        set_as_default = data.get("set_as_default", False)
        if not raw_incentives:
            return _json_response({"error": "No incentives provided"}, 400)
        version = generate_version(raw_incentives)
        inc_set = IncentiveSet(
            version=version, name=name, description=description,
            is_default=set_as_default, incentive_count=len(raw_incentives),
            incentives=[Incentive(**inc) for inc in raw_incentives],
        )
        if set_as_default:
            fs_set_default_incentive_set(version)
        fs_save_incentive_set(inc_set)
        if set_as_default:
            fs_set_default_incentive_set(version)
        return _json_response(inc_set.model_dump(mode="json"))
    except Exception as e:
        return _json_response({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL)
def set_default_incentive_set_fn(req: https_fn.Request) -> https_fn.Response:
    """Set an incentive set as the default."""
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    blocked = _guard_write()
    if blocked:
        return blocked
    try:
        from profile_generator.firestore_client import fs_set_default_incentive_set
        version = _extract_path_param(req, "set_default_incentive_set")
        if not version:
            return _json_response({"error": "Missing version"}, 400)
        ok = fs_set_default_incentive_set(version)
        if not ok:
            return _json_response({"error": "Incentive set not found"}, 404)
        return _json_response({"default": True, "version": version})
    except Exception as e:
        return _json_response({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL)
def update_incentive_set_fn(req: https_fn.Request) -> https_fn.Response:
    """Update an incentive set. Blocked if the set has been used to generate optimizations."""
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    blocked = _guard_write()
    if blocked:
        return blocked
    try:
        from profile_generator.firestore_client import (
            fs_update_incentive_set, fs_get_optimizations_by_incentive_set,
        )
        version = _extract_path_param(req, "update_incentive_set")
        if not version:
            return _json_response({"error": "Missing version"}, 400)
        # Guard: block update if used by any optimization
        used_by = fs_get_optimizations_by_incentive_set(version)
        if used_by:
            return _json_response({
                "error": "Cannot update: this incentive set has been used to generate incentive programs.",
                "optimization_count": len(used_by),
            }, 409)
        data = req.get_json(silent=True) or {}
        from models.incentive_set import Incentive
        raw_incentives = data.get("incentives")
        incentives = None
        if raw_incentives is not None:
            incentives = [Incentive(**inc).model_dump(mode="json") for inc in raw_incentives]
        result = fs_update_incentive_set(
            version, name=data.get("name"), description=data.get("description"),
            incentives=incentives,
        )
        if not result:
            return _json_response({"error": "Incentive set not found"}, 404)
        return _json_response(result)
    except Exception as e:
        return _json_response({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL)
def delete_incentive_set_fn(req: https_fn.Request) -> https_fn.Response:
    """Delete an incentive set and all optimizations generated from it."""
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    blocked = _guard_write()
    if blocked:
        return blocked
    try:
        from profile_generator.firestore_client import (
            fs_delete_incentive_set, fs_get_optimizations_by_incentive_set,
            fs_delete_optimizations_by_incentive_set,
        )
        version = _extract_path_param(req, "delete_incentive_set")
        if not version:
            return _json_response({"error": "Missing version"}, 400)
        # Check for dependent optimizations (for info endpoint)
        used_by = fs_get_optimizations_by_incentive_set(version)
        # Cascade-delete all optimizations that used this incentive set
        deleted_optimizations = fs_delete_optimizations_by_incentive_set(version)
        ok = fs_delete_incentive_set(version)
        if not ok:
            return _json_response({"error": "Incentive set not found"}, 404)
        return _json_response({"deleted": True, "deleted_optimizations": deleted_optimizations})
    except Exception as e:
        return _json_response({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL)
def check_incentive_set_usage_fn(req: https_fn.Request) -> https_fn.Response:
    """Check if an incentive set has been used to generate any optimizations."""
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    try:
        from profile_generator.firestore_client import fs_get_optimizations_by_incentive_set
        version = _extract_path_param(req, "check_incentive_set_usage")
        if not version:
            return _json_response({"error": "Missing version"}, 400)
        used_by = fs_get_optimizations_by_incentive_set(version)
        return _json_response({"version": version, "optimization_count": len(used_by), "optimizations": used_by})
    except Exception as e:
        return _json_response({"error": str(e)}, 500)


# ==================== Workflow endpoints ====================


@https_fn.on_request(cors=_CORS_ALL)
def list_workflows(req: https_fn.Request) -> https_fn.Response:
    """List all workflows from Firestore."""
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    try:
        from profile_generator.firestore_client import fs_list_workflows
        workflows = fs_list_workflows()
        return _json_response({"workflows": workflows})
    except Exception as e:
        return _json_response({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL)
def get_workflow(req: https_fn.Request) -> https_fn.Response:
    """Get a single workflow by ID."""
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    try:
        from profile_generator.firestore_client import fs_get_workflow
        workflow_id = _extract_path_param(req, "get_workflow")
        if not workflow_id:
            return _json_response({"error": "Missing workflow_id"}, 400)
        wf = fs_get_workflow(workflow_id)
        if not wf:
            return _json_response({"error": "Workflow not found"}, 404)
        return _json_response(wf)
    except Exception as e:
        return _json_response({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL)
def create_workflow(req: https_fn.Request) -> https_fn.Response:
    """Create a new workflow."""
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    blocked = _guard_write()
    if blocked:
        return blocked
    try:
        from profile_generator.firestore_client import fs_create_workflow
        data = req.get_json(silent=True) or {}
        name = (data.get("name") or "").strip()
        description = (data.get("description") or "").strip()
        detail = (data.get("detail") or "").strip()
        if not name:
            return _json_response({"error": "Missing workflow name"}, 400)
        wf = fs_create_workflow(name, description, detail=detail)
        return _json_response(wf)
    except Exception as e:
        return _json_response({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL)
def update_workflow(req: https_fn.Request) -> https_fn.Response:
    """Update a workflow's name and/or description."""
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    blocked = _guard_write()
    if blocked:
        return blocked
    try:
        from profile_generator.firestore_client import fs_update_workflow
        workflow_id = _extract_path_param(req, "update_workflow")
        if not workflow_id:
            return _json_response({"error": "Missing workflow_id"}, 400)
        data = req.get_json(silent=True) or {}
        name = data.get("name")
        description = data.get("description")
        detail = data.get("detail")
        wf = fs_update_workflow(workflow_id, name=name, description=description, detail=detail)
        if not wf:
            return _json_response({"error": "Workflow not found"}, 404)
        return _json_response(wf)
    except Exception as e:
        return _json_response({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL)
def delete_workflow(req: https_fn.Request) -> https_fn.Response:
    """Delete a workflow."""
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    blocked = _guard_write()
    if blocked:
        return blocked
    try:
        from profile_generator.firestore_client import fs_delete_workflow
        workflow_id = _extract_path_param(req, "delete_workflow")
        if not workflow_id:
            return _json_response({"error": "Missing workflow_id"}, 400)
        ok = fs_delete_workflow(workflow_id)
        if not ok:
            return _json_response({"error": "Workflow not found"}, 404)
        return _json_response({"deleted": True})
    except Exception as e:
        return _json_response({"error": str(e)}, 500)


print(
    f"Backend config: env={APP_ENV} project={FIREBASE_PROJECT_ID} bucket={FIREBASE_STORAGE_BUCKET}"
)
