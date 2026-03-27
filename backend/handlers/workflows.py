"""Workflow CRUD handler logic extracted from main.py.

Each handler returns a plain (dict, int) tuple.
Heavy imports are deferred inside functions to minimize cold-start latency.
"""

from handlers._common import handler


@handler
def handle_list_workflows() -> tuple[dict, int]:
    """List all workflows from Firestore."""
    from profile_generator.firestore_client import fs_list_workflows

    workflows = fs_list_workflows()
    return {"workflows": workflows}, 200


@handler
def handle_get_workflow(workflow_id: str) -> tuple[dict, int]:
    """Get a single workflow by ID."""
    from profile_generator.firestore_client import fs_get_workflow

    if not workflow_id:
        return {"error": "Missing workflow_id"}, 400
    wf = fs_get_workflow(workflow_id)
    if not wf:
        return {"error": "Workflow not found"}, 404
    return wf, 200


@handler
def handle_create_workflow(data: dict) -> tuple[dict, int]:
    """Create a new workflow."""
    from profile_generator.firestore_client import fs_create_workflow

    name = (data.get("name") or "").strip()
    description = (data.get("description") or "").strip()
    detail = (data.get("detail") or "").strip()
    if not name:
        return {"error": "Missing workflow name"}, 400
    wf = fs_create_workflow(name, description, detail=detail)
    return wf, 200


@handler
def handle_update_workflow(workflow_id: str, data: dict) -> tuple[dict, int]:
    """Update a workflow's name, description, and/or detail."""
    from profile_generator.firestore_client import fs_update_workflow

    if not workflow_id:
        return {"error": "Missing workflow_id"}, 400
    name = data.get("name")
    description = data.get("description")
    detail = data.get("detail")
    wf = fs_update_workflow(workflow_id, name=name, description=description, detail=detail)
    if not wf:
        return {"error": "Workflow not found"}, 404
    return wf, 200


@handler
def handle_delete_workflow(workflow_id: str) -> tuple[dict, int]:
    """Delete a workflow."""
    from profile_generator.firestore_client import fs_delete_workflow

    if not workflow_id:
        return {"error": "Missing workflow_id"}, 400
    ok = fs_delete_workflow(workflow_id)
    if not ok:
        return {"error": "Workflow not found"}, 404
    return {"deleted": True}, 200
