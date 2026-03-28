"""Optimization handler logic extracted from main.py.

Each handler returns a plain (dict, int) tuple.
Heavy imports are deferred inside functions to minimize cold-start latency.
"""

from handlers._common import handler


@handler
def handle_start_optimize(data: dict) -> tuple[dict, int]:
    """Start an LTV optimization run.

    Supports two engines:
    - "monte_carlo": synchronous Beta-sampling simulation (default). Returns full result immediately.
    - "legacy": iterative Gemini-based optimization with polling.
    """
    catalog_version = data.get("catalog_version", "")
    incentive_set_version = data.get("incentive_set_version") or None
    engine = data.get("engine", "monte_carlo")

    if not catalog_version:
        return {"error": "Missing catalog_version"}, 400

    if engine == "monte_carlo":
        from profile_generator.monte_carlo import run_monte_carlo_optimization
        from profile_generator.firestore_client import fs_save_optimization

        n_simulations = int(data.get("n_simulations", 5000))
        budget_raw = data.get("budget")
        budget = float(budget_raw) if budget_raw is not None else None
        target_ltv_raw = data.get("target_ltv")
        target_ltv = float(target_ltv_raw) if target_ltv_raw is not None else None
        print(f"[MC] engine=monte_carlo budget={budget} target_ltv={target_ltv} catalog={catalog_version}")
        result = run_monte_carlo_optimization(
            catalog_version,
            incentive_set_version=incentive_set_version,
            n_simulations=n_simulations,
            budget=budget,
            target_ltv=target_ltv,
        )
        if result.status == "completed":
            try:
                fs_save_optimization(result)
            except Exception:
                pass
        response = result.model_dump(mode="json")
        response["results"] = result.to_legacy_results()
        return response, 200

    # Legacy engine (polling-based)
    from profile_generator.optimization import start_optimization as _start_optimization

    max_iterations = data.get("max_iterations", 50)
    patience = data.get("patience", 3)
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
    from profile_generator.firestore_client import fs_load_optimization

    if not optimization_id:
        return {"error": "Missing optimization_id"}, 400
    state = fs_load_optimization(optimization_id)
    if not state:
        # Fall back to in-memory check for legacy running optimizations
        from profile_generator.optimization import load_optimization as _load_optimization
        state = _load_optimization(optimization_id)
    if not state:
        return {"error": "Optimization not found"}, 404
    response = state.model_dump(mode="json")
    if hasattr(state, "to_legacy_results"):
        response["results"] = state.to_legacy_results()
    return response, 200


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
def handle_export_deal_memo(optimization_id: str) -> tuple[dict, int]:
    """Generate a Deal Memo PDF for a Monte Carlo optimization."""
    from profile_generator.firestore_client import fs_load_optimization
    from models.monte_carlo import MonteCarloOptimizationResult

    if not optimization_id:
        return {"error": "Missing optimization_id"}, 400

    state = fs_load_optimization(optimization_id)
    if not state:
        return {"error": "Optimization not found"}, 404

    if not isinstance(state, MonteCarloOptimizationResult):
        return {"error": "Deal Memo export is only available for Monte Carlo optimizations"}, 400

    from profile_generator.versioning import load_catalog
    from profile_generator.firestore_client import fs_load_incentive_set
    from profile_generator.incentive_manager import load_or_seed_default
    from profile_generator.deal_memo import generate_deal_memo
    import base64

    catalog = load_catalog(state.catalog_version)
    if not catalog:
        return {"error": f"Catalog '{state.catalog_version}' not found"}, 404

    inc_set = fs_load_incentive_set(state.incentive_set_version) if state.incentive_set_version else None
    if not inc_set:
        inc_set = load_or_seed_default()

    pdf_bytes = generate_deal_memo(state, catalog, inc_set)
    pdf_b64 = base64.b64encode(pdf_bytes).decode("ascii")

    return {
        "pdf_base64": pdf_b64,
        "filename": f"deal_memo_{optimization_id}.pdf",
    }, 200


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
