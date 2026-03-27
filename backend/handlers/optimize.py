"""Optimization handler logic extracted from main.py.

Each handler returns a plain (dict, int) tuple.
Heavy imports are deferred inside functions to minimize cold-start latency.
"""

from handlers._common import handler


@handler
def handle_start_optimize(data: dict) -> tuple[dict, int]:
    """Start an LTV optimization run."""
    from profile_generator.optimization import start_optimization as _start_optimization

    catalog_version = data.get("catalog_version", "")
    max_iterations = data.get("max_iterations", 50)
    patience = data.get("patience", 3)
    incentive_set_version = data.get("incentive_set_version") or None
    if not catalog_version:
        return {"error": "Missing catalog_version"}, 400
    optimization_id = _start_optimization(
        catalog_version,
        max_iterations=int(max_iterations),
        patience=int(patience),
        incentive_set_version=incentive_set_version,
    )
    return {"optimization_id": optimization_id}, 200


@handler
def handle_optimize_status(optimization_id: str) -> tuple[dict, int]:
    """Get optimization status by ID (checks memory then Firestore)."""
    from profile_generator.optimization import (
        get_optimization_status as _get_optimization_status,
        advance_optimization as _advance_optimization,
    )

    if not optimization_id:
        return {"error": "Missing optimization_id"}, 400
    state = _get_optimization_status(optimization_id)
    if not state:
        return {"error": "Optimization not found"}, 404
    if state.status == "running":
        state = _advance_optimization(optimization_id, profiles_per_tick=1) or state
    return state.model_dump(mode="json"), 200


@handler
def handle_list_optimizations(catalog_version: str | None) -> tuple[dict, int]:
    """List saved optimization runs from Firestore."""
    from profile_generator.optimization import list_optimizations as _list_optimizations

    optimizations = _list_optimizations(catalog_version or None)
    return {"optimizations": optimizations}, 200


@handler
def handle_load_optimize(optimization_id: str) -> tuple[dict, int]:
    """Load a saved optimization run from Firestore."""
    from profile_generator.optimization import load_optimization as _load_optimization

    if not optimization_id:
        return {"error": "Missing optimization_id"}, 400
    state = _load_optimization(optimization_id)
    if not state:
        return {"error": "Optimization not found"}, 404
    return state.model_dump(mode="json"), 200


@handler
def handle_cancel_optimize(optimization_id: str) -> tuple[dict, int]:
    """Cancel a running optimization."""
    from profile_generator.optimization import cancel_optimization as _cancel_optimization

    if not optimization_id:
        return {"error": "Missing optimization_id"}, 400
    ok = _cancel_optimization(optimization_id)
    if not ok:
        return {"error": "Optimization not found or not running"}, 404
    return {"cancelled": True}, 200


@handler
def handle_save_optimize(optimization_id: str) -> tuple[dict, int]:
    """Persist a completed optimization to Firestore."""
    from profile_generator.optimization import save_optimization as _save_optimization

    if not optimization_id:
        return {"error": "Missing optimization_id"}, 400
    path = _save_optimization(optimization_id)
    if not path:
        return {"error": "Optimization not found or not saveable"}, 404
    return {"saved": True, "path": path}, 200


@handler
def handle_delete_optimize(optimization_id: str) -> tuple[dict, int]:
    """Delete an optimization run from memory and Firestore."""
    from profile_generator.optimization import delete_optimization as _delete_optimization

    if not optimization_id:
        return {"error": "Missing optimization_id"}, 400
    ok = _delete_optimization(optimization_id)
    if not ok:
        return {"error": "Optimization not found"}, 404
    return {"deleted": True}, 200
