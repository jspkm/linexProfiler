"""Firebase Cloud Functions entry point for the Linex Agent.

Thin wrapper — all business logic lives in the handlers/ package.
Each endpoint delegates to its handler and converts the (dict, int) result
into an ``https_fn.Response``.
"""

import json
import os

from firebase_functions import https_fn, options
from firebase_admin import initialize_app, credentials, get_app
import firebase_admin

from config import (
    APP_ENV,
    FIREBASE_CREDENTIALS_PATH,
    FIREBASE_PROJECT_ID,
    FIREBASE_STORAGE_BUCKET,
)

# --------------- Firebase Admin SDK init ---------------

try:
    get_app()
except ValueError:
    try:
        if FIREBASE_CREDENTIALS_PATH and os.path.exists(FIREBASE_CREDENTIALS_PATH):
            cred = credentials.Certificate(FIREBASE_CREDENTIALS_PATH)
            initialize_app(cred, {"storageBucket": FIREBASE_STORAGE_BUCKET})
        else:
            initialize_app(options={"storageBucket": FIREBASE_STORAGE_BUCKET})
    except ValueError:
        pass
    except Exception as e:
        print(f"Firebase initialization warning: {e}")

# --------------- Common CORS / helpers ---------------

_CORS_ALL = options.CorsOptions(
    cors_origins="*",
    cors_methods=["GET", "POST", "DELETE", "OPTIONS"],
)


def _resp(result, status=None):
    """Convert a handler (dict, int) tuple — or (dict, status) args — to Response."""
    if isinstance(result, tuple):
        data, code = result
    else:
        data, code = result, (status or 200)
    return https_fn.Response(
        json.dumps(data), status=code, content_type="application/json",
    )


def _extract_path_param(req, endpoint_name):
    """Extract path parameter that comes after *endpoint_name* in the URL path."""
    path = (req.path or "").rstrip("/")
    parts = path.split("/")
    try:
        idx = parts.index(endpoint_name)
        if idx + 1 < len(parts) and parts[idx + 1]:
            return parts[idx + 1]
    except ValueError:
        pass
    return None


# ==================== Analysis endpoints ====================


@https_fn.on_request(cors=_CORS_ALL)
def analyze_transactions(req: https_fn.Request) -> https_fn.Response:
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    try:
        from handlers.analysis import handle_analyze_transactions
        return _resp(handle_analyze_transactions(req.get_json(silent=True) or {}))
    except Exception as e:
        return _resp({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL, timeout_sec=120)
def ask_agent(req: https_fn.Request) -> https_fn.Response:
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    try:
        from handlers.analysis import handle_ask_agent
        return _resp(handle_ask_agent(req.get_json(silent=True) or {}))
    except Exception as e:
        return _resp({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL, timeout_sec=60)
def agent_chat(req: https_fn.Request) -> https_fn.Response:
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    try:
        from handlers.chat import handle_agent_chat
        return _resp(handle_agent_chat(req.get_json(silent=True) or {}))
    except Exception as e:
        return _resp({"error": str(e)}, 500)


# ==================== Test-user endpoints ====================


@https_fn.on_request(cors=_CORS_ALL)
def list_test_users(req: https_fn.Request) -> https_fn.Response:
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    try:
        from handlers.test_users import handle_list_test_users
        return _resp(handle_list_test_users())
    except Exception as e:
        return _resp({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL, timeout_sec=120)
def analyze_test_user(req: https_fn.Request) -> https_fn.Response:
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    try:
        from handlers.analysis import handle_analyze_test_user
        return _resp(handle_analyze_test_user(req.get_json(silent=True) or {}))
    except Exception as e:
        return _resp({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL, timeout_sec=120)
def ask_test_user(req: https_fn.Request) -> https_fn.Response:
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    try:
        from handlers.analysis import handle_ask_test_user
        return _resp(handle_ask_test_user(req.get_json(silent=True) or {}))
    except Exception as e:
        return _resp({"error": str(e)}, 500)


# ==================== Profile Catalog endpoints ====================


@https_fn.on_request(cors=_CORS_ALL)
def list_profile_catalogs(req: https_fn.Request) -> https_fn.Response:
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    try:
        from handlers.profiles import handle_list_profile_catalogs
        return _resp(handle_list_profile_catalogs())
    except Exception as e:
        return _resp({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL)
def profile_catalog(req: https_fn.Request) -> https_fn.Response:
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    try:
        from handlers.profiles import handle_get_profile_catalog
        version = _extract_path_param(req, "profile_catalog")
        return _resp(handle_get_profile_catalog(version))
    except Exception as e:
        return _resp({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL)
def fork_catalog_fn(req: https_fn.Request) -> https_fn.Response:
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    guard = _check_guard()
    if guard:
        return _resp(guard)
    try:
        from handlers.profiles import handle_fork_catalog
        return _resp(handle_fork_catalog(req.get_json(silent=True) or {}))
    except Exception as e:
        return _resp({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL)
def delete_catalog_fn(req: https_fn.Request) -> https_fn.Response:
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    guard = _check_guard()
    if guard:
        return _resp(guard)
    try:
        from handlers.profiles import handle_delete_catalog
        version = _extract_path_param(req, "delete_catalog")
        return _resp(handle_delete_catalog(version or ""))
    except Exception as e:
        return _resp({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL, timeout_sec=540, memory=options.MemoryOption.GB_4)
def learn_profiles(req: https_fn.Request) -> https_fn.Response:
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    guard = _check_guard()
    if guard:
        return _resp(guard)
    try:
        from handlers.profiles import handle_learn_profiles
        return _resp(handle_learn_profiles(req.get_json(silent=True) or {}))
    except Exception as e:
        return _resp({"error": str(e)}, 500)


# ==================== Portfolio Dataset endpoints ====================


@https_fn.on_request(cors=_CORS_ALL)
def list_portfolio_datasets(req: https_fn.Request) -> https_fn.Response:
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    try:
        from handlers.portfolios import handle_list_portfolio_datasets
        return _resp(handle_list_portfolio_datasets())
    except Exception as e:
        return _resp({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL)
def create_portfolio_upload_url(req: https_fn.Request) -> https_fn.Response:
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    guard = _check_guard()
    if guard:
        return _resp(guard)
    try:
        from handlers.portfolios import handle_create_portfolio_upload_url
        origin = (req.headers.get("origin") or req.headers.get("Origin") or "").strip() or None
        return _resp(handle_create_portfolio_upload_url(req.get_json(silent=True) or {}, request_origin=origin))
    except Exception as e:
        return _resp({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL)
def delete_portfolio_dataset_fn(req: https_fn.Request) -> https_fn.Response:
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    guard = _check_guard()
    if guard:
        return _resp(guard)
    try:
        from handlers.portfolios import handle_delete_portfolio_dataset
        dataset_id = _extract_path_param(req, "delete_portfolio_dataset") or ""
        return _resp(handle_delete_portfolio_dataset(dataset_id))
    except Exception as e:
        return _resp({"error": str(e)}, 500)


# ==================== Optimize endpoints ====================


@https_fn.on_request(cors=_CORS_ALL, timeout_sec=540)
def start_optimize_fn(req: https_fn.Request) -> https_fn.Response:
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    guard = _check_guard()
    if guard:
        return _resp(guard)
    try:
        from handlers.optimize import handle_start_optimize
        return _resp(handle_start_optimize(req.get_json(silent=True) or {}))
    except Exception as e:
        return _resp({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL)
def optimize_status(req: https_fn.Request) -> https_fn.Response:
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    try:
        from handlers.optimize import handle_optimize_status
        optimization_id = _extract_path_param(req, "optimize_status") or ""
        return _resp(handle_optimize_status(optimization_id))
    except Exception as e:
        return _resp({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL)
def list_optimizations_fn(req: https_fn.Request) -> https_fn.Response:
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    try:
        from handlers.optimize import handle_list_optimizations
        catalog_version = req.args.get("catalog_version")
        return _resp(handle_list_optimizations(catalog_version))
    except Exception as e:
        return _resp({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL)
def load_optimize_fn(req: https_fn.Request) -> https_fn.Response:
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    try:
        from handlers.optimize import handle_load_optimize
        optimization_id = _extract_path_param(req, "load_optimize") or ""
        return _resp(handle_load_optimize(optimization_id))
    except Exception as e:
        return _resp({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL)
def cancel_optimize_fn(req: https_fn.Request) -> https_fn.Response:
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    try:
        from handlers.optimize import handle_cancel_optimize
        optimization_id = _extract_path_param(req, "cancel_optimize") or ""
        return _resp(handle_cancel_optimize(optimization_id))
    except Exception as e:
        return _resp({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL)
def save_optimize_fn(req: https_fn.Request) -> https_fn.Response:
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    guard = _check_guard()
    if guard:
        return _resp(guard)
    try:
        from handlers.optimize import handle_save_optimize
        optimization_id = _extract_path_param(req, "save_optimize") or ""
        return _resp(handle_save_optimize(optimization_id))
    except Exception as e:
        return _resp({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL)
def delete_optimize_fn(req: https_fn.Request) -> https_fn.Response:
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    guard = _check_guard()
    if guard:
        return _resp(guard)
    try:
        from handlers.optimize import handle_delete_optimize
        optimization_id = _extract_path_param(req, "delete_optimize") or ""
        return _resp(handle_delete_optimize(optimization_id))
    except Exception as e:
        return _resp({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL, timeout_sec=60)
def export_deal_memo(req: https_fn.Request) -> https_fn.Response:
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    try:
        from handlers.optimize import handle_export_deal_memo
        optimization_id = _extract_path_param(req, "export_deal_memo") or ""
        return _resp(handle_export_deal_memo(optimization_id))
    except Exception as e:
        return _resp({"error": str(e)}, 500)


# ==================== Incentive Set endpoints ====================


@https_fn.on_request(cors=_CORS_ALL)
def list_incentive_sets(req: https_fn.Request) -> https_fn.Response:
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    try:
        from handlers.incentives import handle_list_incentive_sets
        return _resp(handle_list_incentive_sets())
    except Exception as e:
        return _resp({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL)
def incentive_set(req: https_fn.Request) -> https_fn.Response:
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    try:
        from handlers.incentives import handle_get_incentive_set
        from handlers._common import check_write_guard
        version = _extract_path_param(req, "incentive_set")
        if not version:
            # If no default exists the handler will seed one (a write).
            # Pre-check guard; pass it to the handler so it can skip seeding.
            guard = check_write_guard()
            if guard:
                # Try to get default first; only block if it would need seeding.
                from profile_generator.firestore_client import fs_get_default_incentive_set
                if not fs_get_default_incentive_set():
                    return _resp(guard)
        return _resp(handle_get_incentive_set(version))
    except Exception as e:
        return _resp({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL)
def create_incentive_set_fn(req: https_fn.Request) -> https_fn.Response:
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    guard = _check_guard()
    if guard:
        return _resp(guard)
    try:
        from handlers.incentives import handle_create_incentive_set
        return _resp(handle_create_incentive_set(req.get_json(silent=True) or {}))
    except Exception as e:
        return _resp({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL)
def set_default_incentive_set_fn(req: https_fn.Request) -> https_fn.Response:
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    guard = _check_guard()
    if guard:
        return _resp(guard)
    try:
        from handlers.incentives import handle_set_default_incentive_set
        version = _extract_path_param(req, "set_default_incentive_set") or ""
        return _resp(handle_set_default_incentive_set(version))
    except Exception as e:
        return _resp({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL)
def update_incentive_set_fn(req: https_fn.Request) -> https_fn.Response:
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    guard = _check_guard()
    if guard:
        return _resp(guard)
    try:
        from handlers.incentives import handle_update_incentive_set
        version = _extract_path_param(req, "update_incentive_set") or ""
        return _resp(handle_update_incentive_set(version, req.get_json(silent=True) or {}))
    except Exception as e:
        return _resp({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL)
def delete_incentive_set_fn(req: https_fn.Request) -> https_fn.Response:
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    guard = _check_guard()
    if guard:
        return _resp(guard)
    try:
        from handlers.incentives import handle_delete_incentive_set
        version = _extract_path_param(req, "delete_incentive_set") or ""
        return _resp(handle_delete_incentive_set(version))
    except Exception as e:
        return _resp({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL)
def check_incentive_set_usage_fn(req: https_fn.Request) -> https_fn.Response:
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    try:
        from handlers.incentives import handle_check_incentive_set_usage
        version = _extract_path_param(req, "check_incentive_set_usage") or ""
        return _resp(handle_check_incentive_set_usage(version))
    except Exception as e:
        return _resp({"error": str(e)}, 500)


# ==================== Workflow endpoints ====================


@https_fn.on_request(cors=_CORS_ALL)
def list_workflows(req: https_fn.Request) -> https_fn.Response:
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    try:
        from handlers.workflows import handle_list_workflows
        return _resp(handle_list_workflows())
    except Exception as e:
        return _resp({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL)
def get_workflow(req: https_fn.Request) -> https_fn.Response:
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    try:
        from handlers.workflows import handle_get_workflow
        workflow_id = _extract_path_param(req, "get_workflow") or ""
        return _resp(handle_get_workflow(workflow_id))
    except Exception as e:
        return _resp({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL)
def create_workflow(req: https_fn.Request) -> https_fn.Response:
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    guard = _check_guard()
    if guard:
        return _resp(guard)
    try:
        from handlers.workflows import handle_create_workflow
        return _resp(handle_create_workflow(req.get_json(silent=True) or {}))
    except Exception as e:
        return _resp({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL)
def update_workflow(req: https_fn.Request) -> https_fn.Response:
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    guard = _check_guard()
    if guard:
        return _resp(guard)
    try:
        from handlers.workflows import handle_update_workflow
        workflow_id = _extract_path_param(req, "update_workflow") or ""
        return _resp(handle_update_workflow(workflow_id, req.get_json(silent=True) or {}))
    except Exception as e:
        return _resp({"error": str(e)}, 500)


@https_fn.on_request(cors=_CORS_ALL)
def delete_workflow(req: https_fn.Request) -> https_fn.Response:
    if req.method == "OPTIONS":
        return https_fn.Response(status=204)
    guard = _check_guard()
    if guard:
        return _resp(guard)
    try:
        from handlers.workflows import handle_delete_workflow
        workflow_id = _extract_path_param(req, "delete_workflow") or ""
        return _resp(handle_delete_workflow(workflow_id))
    except Exception as e:
        return _resp({"error": str(e)}, 500)


# --------------- Write-guard helper ---------------


def _check_guard():
    """Return (dict, int) if writes are blocked, else None."""
    from handlers._common import check_write_guard
    return check_write_guard()


# --------------- Startup banner ---------------

print(
    f"Backend config: env={APP_ENV} project={FIREBASE_PROJECT_ID} bucket={FIREBASE_STORAGE_BUCKET}"
)
