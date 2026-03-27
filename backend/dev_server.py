"""Local development server that serves all Cloud Functions via Flask.

This bypasses the Firebase emulator's buggy Python worker lifecycle by
running a single Flask process with all endpoints registered.

Usage:
    source venv/bin/activate
    python dev_server.py
"""

import csv
import io
import sys
import time

from flask import Flask, request, jsonify, Response
from flask_cors import CORS

from config import (
    APP_ENV,
    FIREBASE_PROJECT_ID,
    FIREBASE_STORAGE_BUCKET,
    LOADED_ENV_FILE,
    MODEL,
    TEST_USERS_DIR,
    dev_credentials_error,
    write_block_reason,
    writes_allowed,
)

import handlers.analysis as h_analysis
import handlers.chat as h_chat
import handlers.incentives as h_incentives
import handlers.optimize as h_optimize
import handlers.portfolios as h_portfolios
import handlers.profiles as h_profiles
import handlers.test_users as h_test_users
import handlers.workflows as h_workflows
from handlers._common import check_write_guard

# ---------------------------------------------------------------------------
# Flask app
# ---------------------------------------------------------------------------
app = Flask(__name__)
CORS(app)


def _resp(result):
    """Convert a handler (dict, int) tuple into a Flask response."""
    body, status = result
    return jsonify(body), status


def _guard_write():
    """Return a Flask error response if writes are blocked, else None."""
    guard = check_write_guard()
    if guard:
        return jsonify(guard[0]), guard[1]
    return None


# ---------------------------------------------------------------------------
# Middleware
# ---------------------------------------------------------------------------
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


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------
@app.route("/healthz", methods=["GET"])
def healthz():
    return jsonify({
        "ok": True,
        "env": APP_ENV,
        "project": FIREBASE_PROJECT_ID,
        "bucket": FIREBASE_STORAGE_BUCKET,
        "config": str(LOADED_ENV_FILE) if LOADED_ENV_FILE else None,
    })


# ---------------------------------------------------------------------------
# Dev-server-only helpers (not in handlers/)
# ---------------------------------------------------------------------------
def _load_all_test_users():
    """Load all test users from data/test-users/."""
    from analysis.preprocessor import parse_csv_transactions
    from models.transaction import UserTransactions

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


def _load_retail_users(limit: int = 0):
    """Load users from retail.csv, grouped by Customer ID."""
    from analysis.preprocessor import parse_csv_transactions
    from config import DATA_DIR
    from models.transaction import UserTransactions

    retail_path = DATA_DIR / "retail.csv"
    if not retail_path.exists():
        return {}

    users_txns: dict[str, list] = {}
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

    result: dict[str, UserTransactions] = {}
    for cid, rows in users_txns.items():
        if rows:
            fieldnames = list(rows[0].keys())
            buf = io.StringIO()
            writer = csv.DictWriter(buf, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(rows)
            result[cid] = parse_csv_transactions(buf.getvalue(), customer_id=cid)
    return result


# ---------------------------------------------------------------------------
# Test users
# ---------------------------------------------------------------------------
@app.route("/linexone-dev/us-central1/list_test_users", methods=["GET"])
def list_test_users():
    try:
        return _resp(h_test_users.handle_list_test_users())
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/linexone-dev/us-central1/analyze_test_user", methods=["POST"])
def analyze_test_user():
    try:
        data = request.get_json(silent=True) or {}
        return _resp(h_analysis.handle_analyze_test_user(data))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/linexone-dev/us-central1/ask_test_user", methods=["POST"])
def ask_test_user():
    try:
        data = request.get_json(silent=True) or {}
        return _resp(h_analysis.handle_ask_test_user(data))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ---------------------------------------------------------------------------
# Analysis
# ---------------------------------------------------------------------------
@app.route("/linexone-dev/us-central1/analyze_transactions", methods=["POST"])
def analyze_transactions():
    try:
        data = request.get_json(silent=True) or {}
        return _resp(h_analysis.handle_analyze_transactions(data))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/linexone-dev/us-central1/ask_agent", methods=["POST"])
def ask_agent():
    try:
        data = request.get_json(silent=True) or {}
        return _resp(h_analysis.handle_ask_agent(data))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ---------------------------------------------------------------------------
# Agent chat
# ---------------------------------------------------------------------------
@app.route("/linexone-dev/us-central1/agent_chat", methods=["POST"])
def agent_chat():
    try:
        data = request.get_json(silent=True) or {}
        return _resp(h_chat.handle_agent_chat(data))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ---------------------------------------------------------------------------
# Profile Generator
# ---------------------------------------------------------------------------
@app.route("/linexone-dev/us-central1/learn_profiles", methods=["POST"])
def learn_profiles_endpoint():
    blocked = _guard_write()
    if blocked:
        return blocked
    try:
        data = request.get_json(silent=True) or {}
        return _resp(h_profiles.handle_learn_profiles(data))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/linexone-dev/us-central1/assign_profile", methods=["POST"])
def assign_profile_endpoint():
    """Dev-server-only: assign a test user to a profile catalog."""
    try:
        from analysis.preprocessor import load_test_user, clean_transactions
        from profile_generator.assigner import assign_profile as _assign_profile
        from profile_generator.versioning import load_catalog, get_latest_catalog

        data = request.get_json(silent=True) or {}
        user_id = data.get("user_id", "")
        catalog_version = data.get("catalog_version", "")
        if not user_id:
            return jsonify({"error": "Missing user_id"}), 400
        if catalog_version:
            catalog = load_catalog(catalog_version)
        else:
            catalog = get_latest_catalog()
        if not catalog:
            return jsonify({"error": "No profile catalog found"}), 404
        user_txns = load_test_user(user_id)
        clean = clean_transactions(user_txns)
        assignment = _assign_profile(clean, catalog, eval_date=catalog.dataset_max_date)
        return jsonify(assignment.model_dump(mode="json"))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/linexone-dev/us-central1/profile_catalog", methods=["GET"])
@app.route("/linexone-dev/us-central1/profile_catalog/<version>", methods=["GET"])
def get_profile_catalog_endpoint(version=None):
    try:
        return _resp(h_profiles.handle_get_profile_catalog(version))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/linexone-dev/us-central1/list_profile_catalogs", methods=["GET"])
def list_profile_catalogs_endpoint():
    try:
        return _resp(h_profiles.handle_list_profile_catalogs())
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/linexone-dev/us-central1/fork_catalog", methods=["POST"])
def fork_catalog_endpoint():
    blocked = _guard_write()
    if blocked:
        return blocked
    try:
        data = request.get_json(silent=True) or {}
        return _resp(h_profiles.handle_fork_catalog(data))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/linexone-dev/us-central1/delete_catalog/<version>", methods=["DELETE"])
def delete_catalog_endpoint(version):
    blocked = _guard_write()
    if blocked:
        return blocked
    try:
        return _resp(h_profiles.handle_delete_catalog(version))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ---------------------------------------------------------------------------
# Portfolio datasets
# ---------------------------------------------------------------------------
@app.route("/linexone-dev/us-central1/list_portfolio_datasets", methods=["GET"])
def list_portfolio_datasets_endpoint():
    try:
        return _resp(h_portfolios.handle_list_portfolio_datasets())
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/linexone-dev/us-central1/create_portfolio_upload_url", methods=["POST"])
def create_portfolio_upload_url_endpoint():
    blocked = _guard_write()
    if blocked:
        return blocked
    try:
        data = request.get_json(silent=True) or {}
        origin = (request.headers.get("origin") or request.headers.get("Origin") or "").strip()
        return _resp(h_portfolios.handle_create_portfolio_upload_url(data, request_origin=origin or None))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/linexone-dev/us-central1/delete_portfolio_dataset/<dataset_id>", methods=["DELETE"])
def delete_portfolio_dataset_endpoint(dataset_id):
    blocked = _guard_write()
    if blocked:
        return blocked
    try:
        return _resp(h_portfolios.handle_delete_portfolio_dataset(dataset_id))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ---------------------------------------------------------------------------
# Optimization
# ---------------------------------------------------------------------------
@app.route("/linexone-dev/us-central1/start_optimize", methods=["POST"])
def start_optimize_endpoint():
    blocked = _guard_write()
    if blocked:
        return blocked
    try:
        data = request.get_json(silent=True) or {}
        return _resp(h_optimize.handle_start_optimize(data))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/linexone-dev/us-central1/optimize_status/<optimization_id>", methods=["GET"])
def get_optimize_status_endpoint(optimization_id):
    try:
        return _resp(h_optimize.handle_optimize_status(optimization_id))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/linexone-dev/us-central1/list_optimizations", methods=["GET"])
def list_optimizations_endpoint():
    try:
        catalog_version = request.args.get("catalog_version")
        return _resp(h_optimize.handle_list_optimizations(catalog_version))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/linexone-dev/us-central1/load_optimize/<optimization_id>", methods=["GET"])
def load_optimize_endpoint(optimization_id):
    try:
        return _resp(h_optimize.handle_load_optimize(optimization_id))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/linexone-dev/us-central1/cancel_optimize/<optimization_id>", methods=["POST"])
def cancel_optimize_endpoint(optimization_id):
    try:
        return _resp(h_optimize.handle_cancel_optimize(optimization_id))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/linexone-dev/us-central1/save_optimize/<optimization_id>", methods=["POST"])
def save_optimize_endpoint(optimization_id):
    blocked = _guard_write()
    if blocked:
        return blocked
    try:
        return _resp(h_optimize.handle_save_optimize(optimization_id))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/linexone-dev/us-central1/delete_optimize/<optimization_id>", methods=["DELETE"])
def delete_optimize_endpoint(optimization_id):
    blocked = _guard_write()
    if blocked:
        return blocked
    try:
        return _resp(h_optimize.handle_delete_optimize(optimization_id))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ---------------------------------------------------------------------------
# Incentive sets
# ---------------------------------------------------------------------------
@app.route("/linexone-dev/us-central1/list_incentive_sets", methods=["GET"])
def list_incentive_sets_endpoint():
    try:
        return _resp(h_incentives.handle_list_incentive_sets())
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/linexone-dev/us-central1/incentive_set", methods=["GET"])
@app.route("/linexone-dev/us-central1/incentive_set/<version>", methods=["GET"])
def get_incentive_set_endpoint(version=None):
    # Write guard needed for auto-seed on first access (no version, no default)
    if not version:
        blocked = _guard_write()
        if blocked:
            return blocked
    try:
        return _resp(h_incentives.handle_get_incentive_set(version))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/linexone-dev/us-central1/create_incentive_set", methods=["POST"])
def create_incentive_set_endpoint():
    blocked = _guard_write()
    if blocked:
        return blocked
    try:
        data = request.get_json(silent=True) or {}
        return _resp(h_incentives.handle_create_incentive_set(data))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/linexone-dev/us-central1/set_default_incentive_set/<version>", methods=["POST"])
def set_default_incentive_set_endpoint(version):
    blocked = _guard_write()
    if blocked:
        return blocked
    try:
        return _resp(h_incentives.handle_set_default_incentive_set(version))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/linexone-dev/us-central1/update_incentive_set/<version>", methods=["POST"])
def update_incentive_set_endpoint(version):
    blocked = _guard_write()
    if blocked:
        return blocked
    try:
        data = request.get_json(silent=True) or {}
        return _resp(h_incentives.handle_update_incentive_set(version, data))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/linexone-dev/us-central1/delete_incentive_set/<version>", methods=["DELETE"])
def delete_incentive_set_endpoint(version):
    blocked = _guard_write()
    if blocked:
        return blocked
    try:
        return _resp(h_incentives.handle_delete_incentive_set(version))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/linexone-dev/us-central1/check_incentive_set_usage/<version>", methods=["GET"])
def check_incentive_set_usage_endpoint(version):
    try:
        return _resp(h_incentives.handle_check_incentive_set_usage(version))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ---------------------------------------------------------------------------
# Workflows
# ---------------------------------------------------------------------------
@app.route("/linexone-dev/us-central1/list_workflows", methods=["GET"])
def list_workflows_endpoint():
    try:
        return _resp(h_workflows.handle_list_workflows())
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/linexone-dev/us-central1/get_workflow/<workflow_id>", methods=["GET"])
def get_workflow_endpoint(workflow_id):
    try:
        return _resp(h_workflows.handle_get_workflow(workflow_id))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/linexone-dev/us-central1/create_workflow", methods=["POST"])
def create_workflow_endpoint():
    blocked = _guard_write()
    if blocked:
        return blocked
    try:
        data = request.get_json(silent=True) or {}
        return _resp(h_workflows.handle_create_workflow(data))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/linexone-dev/us-central1/update_workflow/<workflow_id>", methods=["POST"])
def update_workflow_endpoint(workflow_id):
    blocked = _guard_write()
    if blocked:
        return blocked
    try:
        data = request.get_json(silent=True) or {}
        return _resp(h_workflows.handle_update_workflow(workflow_id, data))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/linexone-dev/us-central1/delete_workflow/<workflow_id>", methods=["DELETE"])
def delete_workflow_endpoint(workflow_id):
    blocked = _guard_write()
    if blocked:
        return blocked
    try:
        return _resp(h_workflows.handle_delete_workflow(workflow_id))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ---------------------------------------------------------------------------
# Startup banner & main
# ---------------------------------------------------------------------------
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
    print("  - POST /linexone-dev/us-central1/update_incentive_set/<version>")
    print("  - POST /linexone-dev/us-central1/set_default_incentive_set/<version>")
    print("  - GET  /linexone-dev/us-central1/check_incentive_set_usage/<version>")
    print("  - DEL  /linexone-dev/us-central1/delete_incentive_set/<version>")
    print("  Workflows:")
    print("  - GET  /linexone-dev/us-central1/list_workflows")
    print("  - GET  /linexone-dev/us-central1/get_workflow/<id>")
    print("  - POST /linexone-dev/us-central1/create_workflow")
    print("  - POST /linexone-dev/us-central1/update_workflow/<id>")
    print("  - DEL  /linexone-dev/us-central1/delete_workflow/<id>")
    app.run(host="127.0.0.1", port=5050, debug=False)
