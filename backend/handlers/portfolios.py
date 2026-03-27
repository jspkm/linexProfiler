"""Portfolio dataset handlers.

All handlers return plain (dict, int) tuples.
Heavy imports are deferred inside each function for cold-start optimisation.
"""

from __future__ import annotations

import re

from handlers._common import handler


def _safe_file_name(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", name or "portfolio.csv").strip("._")
    return cleaned or "portfolio.csv"


@handler
def handle_list_portfolio_datasets() -> tuple[dict, int]:
    """List uploaded portfolio datasets from Firestore."""
    from profile_generator.firestore_client import fs_list_portfolio_datasets

    datasets = fs_list_portfolio_datasets()
    return {"datasets": datasets}, 200


@handler
def handle_create_portfolio_upload_url(data: dict, request_origin: str | None = None) -> tuple[dict, int]:
    """Create a signed Cloud Storage upload URL and dataset metadata doc."""
    from profile_generator.firestore_client import fs_create_portfolio_dataset_metadata
    from firebase_admin import storage

    upload_name = str(data.get("upload_name", "")).strip()
    file_name = _safe_file_name(str(data.get("file_name", "portfolio.csv")))
    content_type = str(data.get("content_type", "text/csv") or "text/csv")
    size_bytes = int(data.get("size_bytes", 0) or 0)
    if not upload_name:
        return {"error": "Missing upload_name"}, 400
    if size_bytes <= 0:
        return {"error": "Missing or invalid size_bytes"}, 400

    dataset_id, bucket_name, object_path = fs_create_portfolio_dataset_metadata(
        upload_name=upload_name,
        file_name=file_name,
        content_type=content_type,
        size_bytes=size_bytes,
    )

    upload_origin = request_origin if request_origin else None

    bucket = storage.bucket(bucket_name)
    blob = bucket.blob(object_path)
    upload_url = blob.create_resumable_upload_session(
        content_type=content_type,
        size=size_bytes,
        origin=upload_origin,
    )

    return {
        "dataset_id": dataset_id,
        "bucket": bucket_name,
        "object_path": object_path,
        "upload_url": upload_url,
        "required_headers": {"Content-Type": content_type},
    }, 200


@handler
def handle_delete_portfolio_dataset(dataset_id: str) -> tuple[dict, int]:
    """Delete a portfolio dataset and all associated catalogs/optimizations."""
    from profile_generator.firestore_client import fs_delete_portfolio_dataset_cascade

    if not dataset_id:
        return {"error": "Missing dataset_id"}, 400
    result = fs_delete_portfolio_dataset_cascade(dataset_id)
    if not result:
        return {"error": "Portfolio dataset not found"}, 404
    return result, 200
