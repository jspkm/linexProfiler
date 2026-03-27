"""Test user handler.

All handlers return plain (dict, int) tuples.
Heavy imports are deferred inside each function for cold-start optimisation.
"""

from __future__ import annotations

import random

from handlers._common import handler


@handler
def handle_list_test_users() -> tuple[dict, int]:
    """List test user IDs from Firestore, falling back to disk."""
    from config import TEST_USERS_DIR

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
    return {"user_ids": selected}, 200
