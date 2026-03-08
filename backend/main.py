"""Firebase Cloud Functions entry point for the Linex Profiler Quant Agent.

All data is persisted to/read from Firestore — no mock data.
Heavy imports are deferred to minimize cold-start latency.
"""

import json
import os
import random

from firebase_functions import https_fn, options
from firebase_admin import initialize_app, credentials
import firebase_admin

from config import CARDS_PATH, FIREBASE_CREDENTIALS_PATH, GEMINI_API_KEY, MODEL, TEST_USERS_DIR

# Initialize Firebase Admin SDK (lightweight — no Firestore queries)
try:
    if not firebase_admin._apps:
        if FIREBASE_CREDENTIALS_PATH and os.path.exists(FIREBASE_CREDENTIALS_PATH):
            cred = credentials.Certificate(FIREBASE_CREDENTIALS_PATH)
            initialize_app(cred)
        else:
            initialize_app()  # Uses Application Default Credentials (Cloud Run)
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
        return _json_response({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL, timeout_sec=120)
def ask_qu(req: https_fn.Request) -> https_fn.Response:
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


@https_fn.on_request(cors=_CORS_ALL, timeout_sec=300)
def train_profiles(req: https_fn.Request) -> https_fn.Response:
    """Train profile clusters from test users (Firestore or disk) or retail data."""
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    try:
        from profile_generator.feature_derivation import derive_batch_features
        from profile_generator.trainer import train_profiles as _train_profiles
        from profile_generator.versioning import save_catalog
        from analysis.preprocessor import parse_csv_transactions
        from config import DEFAULT_K
        from datetime import datetime
        import csv
        import io

        data = req.get_json(silent=True) or {}
        source = data.get("source", "test-users")
        k = data.get("k", DEFAULT_K)
        limit = data.get("limit", 0)

        users = {}
        if source == "retail":
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
            return _json_response({"error": "Need at least 2 users to train"}, 400)

        global_max = None
        for user_txns in users.values():
            for t in user_txns.transactions:
                if global_max is None or t.date > global_max:
                    global_max = t.date

        cat = _train_profiles(feature_df, k=k, source=source, dataset_max_date=global_max)
        save_catalog(cat)
        return _json_response(cat.model_dump(mode="json"))
    except Exception as e:
        return _json_response({"error": str(e)}, 500)


# ==================== Experiment endpoints ====================


@https_fn.on_request(cors=_CORS_ALL, timeout_sec=540)
def start_experiment_fn(req: https_fn.Request) -> https_fn.Response:
    """Start an LTV optimization experiment."""
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    try:
        from profile_generator.experiment import start_experiment as _start_experiment
        data = req.get_json(silent=True) or {}
        catalog_version = data.get("catalog_version", "")
        max_iterations = data.get("max_iterations", 50)
        patience = data.get("patience", 3)
        incentive_set_version = data.get("incentive_set_version") or None
        if not catalog_version:
            return _json_response({"error": "Missing catalog_version"}, 400)
        experiment_id = _start_experiment(
            catalog_version,
            max_iterations=int(max_iterations),
            patience=int(patience),
            incentive_set_version=incentive_set_version,
        )
        return _json_response({"experiment_id": experiment_id})
    except Exception as e:
        return _json_response({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL)
def experiment_status(req: https_fn.Request) -> https_fn.Response:
    """Get experiment status by ID (checks memory then Firestore)."""
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    try:
        from profile_generator.experiment import get_experiment_status as _get_experiment_status
        experiment_id = _extract_path_param(req, "experiment_status")
        if not experiment_id:
            return _json_response({"error": "Missing experiment_id"}, 400)
        state = _get_experiment_status(experiment_id)
        if not state:
            return _json_response({"error": "Experiment not found"}, 404)
        return _json_response(state.model_dump(mode="json"))
    except Exception as e:
        return _json_response({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL)
def list_experiments_fn(req: https_fn.Request) -> https_fn.Response:
    """List saved experiments from Firestore."""
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    try:
        from profile_generator.experiment import list_experiments as _list_experiments
        catalog_version = req.args.get("catalog_version")
        experiments = _list_experiments(catalog_version or None)
        return _json_response({"experiments": experiments})
    except Exception as e:
        return _json_response({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL)
def load_experiment_fn(req: https_fn.Request) -> https_fn.Response:
    """Load a saved experiment from Firestore."""
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    try:
        from profile_generator.experiment import load_experiment as _load_experiment
        experiment_id = _extract_path_param(req, "load_experiment")
        if not experiment_id:
            return _json_response({"error": "Missing experiment_id"}, 400)
        state = _load_experiment(experiment_id)
        if not state:
            return _json_response({"error": "Experiment not found"}, 404)
        return _json_response(state.model_dump(mode="json"))
    except Exception as e:
        return _json_response({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL)
def cancel_experiment_fn(req: https_fn.Request) -> https_fn.Response:
    """Cancel a running experiment."""
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    try:
        from profile_generator.experiment import cancel_experiment as _cancel_experiment
        experiment_id = _extract_path_param(req, "cancel_experiment")
        if not experiment_id:
            return _json_response({"error": "Missing experiment_id"}, 400)
        ok = _cancel_experiment(experiment_id)
        if not ok:
            return _json_response({"error": "Experiment not found or not running"}, 404)
        return _json_response({"cancelled": True})
    except Exception as e:
        return _json_response({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL)
def save_experiment_fn(req: https_fn.Request) -> https_fn.Response:
    """Persist a completed experiment to Firestore."""
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    try:
        from profile_generator.experiment import save_experiment as _save_experiment
        experiment_id = _extract_path_param(req, "save_experiment")
        if not experiment_id:
            return _json_response({"error": "Missing experiment_id"}, 400)
        path = _save_experiment(experiment_id)
        if not path:
            return _json_response({"error": "Experiment not found or not saveable"}, 404)
        return _json_response({"saved": True, "path": path})
    except Exception as e:
        return _json_response({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL)
def delete_experiment_fn(req: https_fn.Request) -> https_fn.Response:
    """Delete an experiment from memory and Firestore."""
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    try:
        from profile_generator.experiment import delete_experiment as _delete_experiment
        experiment_id = _extract_path_param(req, "delete_experiment")
        if not experiment_id:
            return _json_response({"error": "Missing experiment_id"}, 400)
        ok = _delete_experiment(experiment_id)
        if not ok:
            return _json_response({"error": "Experiment not found"}, 404)
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
def delete_incentive_set_fn(req: https_fn.Request) -> https_fn.Response:
    """Delete an incentive set."""
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    try:
        from profile_generator.firestore_client import fs_delete_incentive_set
        version = _extract_path_param(req, "delete_incentive_set")
        if not version:
            return _json_response({"error": "Missing version"}, 400)
        ok = fs_delete_incentive_set(version)
        if not ok:
            return _json_response({"error": "Incentive set not found"}, 404)
        return _json_response({"deleted": True})
    except Exception as e:
        return _json_response({"error": str(e)}, 500)
