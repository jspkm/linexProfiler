"""Incentive set CRUD handler logic extracted from main.py.

Each handler returns a plain (dict, int) tuple.
Heavy imports are deferred inside functions to minimize cold-start latency.
"""

from handlers._common import handler


@handler
def handle_list_incentive_sets() -> tuple[dict, int]:
    """List all incentive sets from Firestore."""
    from profile_generator.firestore_client import fs_list_incentive_sets

    sets = fs_list_incentive_sets()
    return {"incentive_sets": sets}, 200


@handler
def handle_get_incentive_set(version: str | None) -> tuple[dict, int]:
    """Get an incentive set by version, or the default if no version given.

    Note: when no version is given and no default exists, this handler
    calls load_or_seed_default() which performs a write.  The caller is
    responsible for checking write-guard *before* invoking this handler
    in that scenario, but since the write only happens on an empty-DB
    cold start this is an acceptable trade-off.
    """
    from profile_generator.firestore_client import (
        fs_load_incentive_set,
        fs_get_default_incentive_set,
    )
    from profile_generator.incentive_manager import load_or_seed_default

    if version:
        inc_set = fs_load_incentive_set(version)
    else:
        inc_set = fs_get_default_incentive_set()
        if not inc_set:
            inc_set = load_or_seed_default()
    if not inc_set:
        return {"error": "Incentive set not found"}, 404
    return inc_set.model_dump(mode="json"), 200


@handler
def handle_create_incentive_set(data: dict) -> tuple[dict, int]:
    """Create a new incentive set."""
    from profile_generator.firestore_client import (
        fs_save_incentive_set,
        fs_set_default_incentive_set,
    )
    from profile_generator.incentive_manager import generate_version
    from models.incentive_set import Incentive, IncentiveSet

    name = data.get("name", "")
    description = data.get("description", "")
    raw_incentives = data.get("incentives", [])
    set_as_default = data.get("set_as_default", False)
    if not raw_incentives:
        return {"error": "No incentives provided"}, 400
    version = generate_version(raw_incentives)
    inc_set = IncentiveSet(
        version=version,
        name=name,
        description=description,
        is_default=set_as_default,
        incentive_count=len(raw_incentives),
        incentives=[Incentive(**inc) for inc in raw_incentives],
    )
    fs_save_incentive_set(inc_set)
    if set_as_default:
        fs_set_default_incentive_set(version)
    return inc_set.model_dump(mode="json"), 200


@handler
def handle_update_incentive_set(version: str, data: dict) -> tuple[dict, int]:
    """Update an incentive set. Blocked if the set has been used to generate optimizations."""
    from profile_generator.firestore_client import (
        fs_update_incentive_set,
        fs_get_optimizations_by_incentive_set,
    )
    from models.incentive_set import Incentive

    if not version:
        return {"error": "Missing version"}, 400
    # Guard: block update if used by any optimization
    used_by = fs_get_optimizations_by_incentive_set(version)
    if used_by:
        return {
            "error": "Cannot update: this incentive set has been used to generate incentive programs.",
            "optimization_count": len(used_by),
        }, 409
    raw_incentives = data.get("incentives")
    incentives = None
    if raw_incentives is not None:
        incentives = [Incentive(**inc).model_dump(mode="json") for inc in raw_incentives]
    result = fs_update_incentive_set(
        version,
        name=data.get("name"),
        description=data.get("description"),
        incentives=incentives,
    )
    if not result:
        return {"error": "Incentive set not found"}, 404
    return result, 200


@handler
def handle_set_default_incentive_set(version: str) -> tuple[dict, int]:
    """Set an incentive set as the default."""
    from profile_generator.firestore_client import fs_set_default_incentive_set

    if not version:
        return {"error": "Missing version"}, 400
    ok = fs_set_default_incentive_set(version)
    if not ok:
        return {"error": "Incentive set not found"}, 404
    return {"default": True, "version": version}, 200


@handler
def handle_delete_incentive_set(version: str) -> tuple[dict, int]:
    """Delete an incentive set and all optimizations generated from it."""
    from profile_generator.firestore_client import (
        fs_delete_incentive_set,
        fs_delete_optimizations_by_incentive_set,
    )

    if not version:
        return {"error": "Missing version"}, 400
    # Cascade-delete all optimizations that used this incentive set
    deleted_optimizations = fs_delete_optimizations_by_incentive_set(version)
    ok = fs_delete_incentive_set(version)
    if not ok:
        return {"error": "Incentive set not found"}, 404
    return {"deleted": True, "deleted_optimizations": deleted_optimizations}, 200


@handler
def handle_check_incentive_set_usage(version: str) -> tuple[dict, int]:
    """Check if an incentive set has been used to generate any optimizations."""
    from profile_generator.firestore_client import fs_get_optimizations_by_incentive_set

    if not version:
        return {"error": "Missing version"}, 400
    used_by = fs_get_optimizations_by_incentive_set(version)
    return {"version": version, "optimization_count": len(used_by), "optimizations": used_by}, 200
