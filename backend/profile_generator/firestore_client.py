"""Firestore persistence layer for profile catalogs, optimizations, and incentive sets.

Centralizes Firebase initialization and provides CRUD operations for all three
collections. Reuses the Firebase Admin SDK init pattern from cards/catalog.py.
"""

from __future__ import annotations

import datetime
import uuid
import os

import firebase_admin
from firebase_admin import credentials, firestore, get_app, storage

from google.cloud.firestore_v1.base_query import FieldFilter

from config import FIREBASE_CREDENTIALS_PATH, FIREBASE_STORAGE_BUCKET
from models.profile_catalog import ProfileCatalog
from models.incentive_set import IncentiveSet


def _get_db():
    """Get Firestore client, initializing Firebase if needed."""
    import os
    try:
        get_app()
    except ValueError:
        if FIREBASE_CREDENTIALS_PATH and os.path.exists(FIREBASE_CREDENTIALS_PATH):
            cred = credentials.Certificate(FIREBASE_CREDENTIALS_PATH)
            try:
                firebase_admin.initialize_app(cred, {"storageBucket": FIREBASE_STORAGE_BUCKET})
            except ValueError:
                # Another thread/process initialized already.
                pass
        else:
            try:
                firebase_admin.initialize_app(options={"storageBucket": FIREBASE_STORAGE_BUCKET})  # Uses ADC (Cloud Run)
            except ValueError:
                pass
    return firestore.client()


def _serialize_dates(obj):
    """Recursively convert Firestore DatetimeWithNanoseconds to ISO strings."""
    from google.api_core.datetime_helpers import DatetimeWithNanoseconds

    if isinstance(obj, dict):
        return {k: _serialize_dates(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [_serialize_dates(i) for i in obj]
    elif isinstance(obj, (DatetimeWithNanoseconds, datetime.datetime)):
        return obj.isoformat()
    return obj


# ---------- Profile Catalogs ----------

CATALOG_COLLECTION = "profile_catalogs"


def fs_save_catalog(catalog: ProfileCatalog) -> str:
    """Save a ProfileCatalog to Firestore. Returns the version string."""
    db = _get_db()
    data = catalog.model_dump(mode="json")
    db.collection(CATALOG_COLLECTION).document(catalog.version).set(data)
    return catalog.version


def fs_load_catalog(version: str) -> ProfileCatalog | None:
    """Load a ProfileCatalog by version. Returns None if not found."""
    db = _get_db()
    doc = db.collection(CATALOG_COLLECTION).document(version).get()
    if not doc.exists:
        return None
    data = _serialize_dates(doc.to_dict())
    return ProfileCatalog.model_validate(data)


def fs_list_catalogs() -> list[dict]:
    """List all catalog versions with basic metadata, newest first."""
    db = _get_db()
    docs = db.collection(CATALOG_COLLECTION).stream()
    results = []
    for doc in docs:
        data = _serialize_dates(doc.to_dict())
        results.append({
            "version": data.get("version", doc.id),
            "created_at": data.get("created_at", ""),
            "k": data.get("k", 0),
            "source": data.get("source", ""),
            "profile_count": len(data.get("profiles", [])),
        })
    results.sort(key=lambda c: c["created_at"] or "", reverse=True)
    return results


def fs_delete_catalog(version: str) -> bool:
    """Delete a catalog by version. Returns True if it existed."""
    db = _get_db()
    doc_ref = db.collection(CATALOG_COLLECTION).document(version)
    doc = doc_ref.get()
    if not doc.exists:
        return False
    doc_ref.delete()
    return True


# ---------- Optimizations ----------

OPTIMIZATION_COLLECTION = "optimizations"
LEGACY_OPTIMIZATION_COLLECTION = "experiments"


def fs_save_optimization(state) -> str:
    """Save an OptimizationState to Firestore. Returns the optimization_id."""
    db = _get_db()
    data = state.model_dump(mode="json")
    db.collection(OPTIMIZATION_COLLECTION).document(state.optimization_id).set(data)
    return state.optimization_id


def fs_load_optimization(optimization_id: str):
    """Load an optimization by ID. Returns the appropriate model based on engine type."""
    db = _get_db()
    doc = db.collection(OPTIMIZATION_COLLECTION).document(optimization_id).get()
    if not doc.exists:
        doc = db.collection(LEGACY_OPTIMIZATION_COLLECTION).document(optimization_id).get()
    if not doc.exists:
        return None
    data = _serialize_dates(doc.to_dict())
    if data.get("engine") == "monte_carlo":
        from models.monte_carlo import MonteCarloOptimizationResult
        return MonteCarloOptimizationResult.model_validate(data)
    from profile_generator.optimization import OptimizationState
    return OptimizationState.model_validate(data)


def fs_list_optimizations(catalog_version: str | None = None) -> list[dict]:
    """List saved optimizations, optionally filtered by catalog_version.

    Reads both `optimizations` and legacy `experiments` collections and
    de-duplicates by optimization_id (prefers optimizations when both exist).
    """
    db = _get_db()
    results_by_optimization_id: dict[str, dict] = {}
    for collection_name in [LEGACY_OPTIMIZATION_COLLECTION, OPTIMIZATION_COLLECTION]:
        query = db.collection(collection_name)
        if catalog_version:
            query = query.where(filter=FieldFilter("catalog_version", "==", catalog_version))
        docs = query.stream()
        for doc in docs:
            data = _serialize_dates(doc.to_dict())
            optimization_id = data.get("optimization_id") or data.get("experiment_id") or doc.id
            engine = data.get("engine", "legacy")
            if engine == "monte_carlo":
                total_lift = data.get("total_lift", 0)
                result_count = len(data.get("profiles", []))
            else:
                results_list = data.get("results", [])
                total_lift = sum(r.get("lift", 0) for r in results_list if isinstance(r, dict))
                result_count = len(results_list)
            results_by_optimization_id[optimization_id] = {
                "optimization_id": optimization_id,
                "catalog_version": data.get("catalog_version", ""),
                "incentive_set_version": data.get("incentive_set_version", ""),
                "status": data.get("status", ""),
                "engine": engine,
                "started_at": data.get("started_at", ""),
                "completed_at": data.get("completed_at", ""),
                "result_count": result_count,
                "total_lift": round(total_lift),
            }
    results = list(results_by_optimization_id.values())
    results.sort(
        key=lambda e: e.get("completed_at") or e.get("started_at") or "",
        reverse=True,
    )
    return results


def fs_delete_optimization(optimization_id: str) -> bool:
    """Delete an optimization by ID. Returns True if it existed."""
    db = _get_db()
    deleted = False
    for collection_name in [OPTIMIZATION_COLLECTION, LEGACY_OPTIMIZATION_COLLECTION]:
        doc_ref = db.collection(collection_name).document(optimization_id)
        doc = doc_ref.get()
        if doc.exists:
            doc_ref.delete()
            deleted = True
    return deleted


# ---------- Incentive Sets ----------

INCENTIVE_SET_COLLECTION = "incentive_sets"


def fs_save_incentive_set(incentive_set: IncentiveSet) -> str:
    """Save an IncentiveSet to Firestore. Returns the version string."""
    db = _get_db()
    data = incentive_set.model_dump(mode="json")
    db.collection(INCENTIVE_SET_COLLECTION).document(incentive_set.version).set(data)
    return incentive_set.version


def fs_load_incentive_set(version: str) -> IncentiveSet | None:
    """Load an IncentiveSet by version. Returns None if not found."""
    db = _get_db()
    doc = db.collection(INCENTIVE_SET_COLLECTION).document(version).get()
    if not doc.exists:
        return None
    data = _serialize_dates(doc.to_dict())
    return IncentiveSet.model_validate(data)


def fs_list_incentive_sets() -> list[dict]:
    """List all incentive set versions with metadata, newest first."""
    db = _get_db()
    docs = db.collection(INCENTIVE_SET_COLLECTION).stream()
    results = []
    for doc in docs:
        data = _serialize_dates(doc.to_dict())
        results.append({
            "version": data.get("version", doc.id),
            "created_at": data.get("created_at", ""),
            "name": data.get("name", ""),
            "is_default": data.get("is_default", False),
            "incentive_count": data.get("incentive_count", 0),
        })
    results.sort(key=lambda s: s["created_at"] or "", reverse=True)
    return results


def fs_get_default_incentive_set() -> IncentiveSet | None:
    """Load the current default incentive set."""
    db = _get_db()
    docs = (
        db.collection(INCENTIVE_SET_COLLECTION)
        .where(filter=FieldFilter("is_default", "==", True))
        .limit(1)
        .stream()
    )
    for doc in docs:
        data = _serialize_dates(doc.to_dict())
        return IncentiveSet.model_validate(data)
    return None


def fs_set_default_incentive_set(version: str) -> bool:
    """Set a specific incentive set as the default (clears old default atomically)."""
    db = _get_db()

    # Verify the target exists
    target_ref = db.collection(INCENTIVE_SET_COLLECTION).document(version)
    target = target_ref.get()
    if not target.exists:
        return False

    # Clear any existing defaults
    old_defaults = (
        db.collection(INCENTIVE_SET_COLLECTION)
        .where(filter=FieldFilter("is_default", "==", True))
        .stream()
    )
    batch = db.batch()
    for old_doc in old_defaults:
        batch.update(
            db.collection(INCENTIVE_SET_COLLECTION).document(old_doc.id),
            {"is_default": False},
        )
    # Set the new default
    batch.update(target_ref, {"is_default": True})
    batch.commit()
    return True


def fs_update_incentive_set(
    version: str,
    name: str | None = None,
    description: str | None = None,
    incentives: list | None = None,
) -> dict | None:
    """Update an incentive set's metadata and/or incentives. Returns updated doc or None."""
    db = _get_db()
    doc_ref = db.collection(INCENTIVE_SET_COLLECTION).document(version)
    doc = doc_ref.get()
    if not doc.exists:
        return None
    updates: dict = {}
    if name is not None:
        updates["name"] = name.strip()
    if description is not None:
        updates["description"] = description.strip()
    if incentives is not None:
        updates["incentives"] = incentives
        updates["incentive_count"] = len(incentives)
    if not updates:
        return _serialize_dates(doc.to_dict())
    doc_ref.update(updates)
    return _serialize_dates(doc_ref.get().to_dict())


def fs_get_optimizations_by_incentive_set(version: str) -> list[dict]:
    """Return optimization summaries that used a given incentive set version."""
    db = _get_db()
    results: list[dict] = []
    for collection_name in [OPTIMIZATION_COLLECTION, LEGACY_OPTIMIZATION_COLLECTION]:
        docs = (
            db.collection(collection_name)
            .where(filter=FieldFilter("incentive_set_version", "==", version))
            .stream()
        )
        for doc in docs:
            data = _serialize_dates(doc.to_dict())
            optimization_id = data.get("optimization_id") or data.get("experiment_id") or doc.id
            results.append({
                "optimization_id": optimization_id,
                "collection": collection_name,
                "status": data.get("status", ""),
                "started_at": data.get("started_at", ""),
            })
    return results


def fs_delete_optimizations_by_incentive_set(version: str) -> int:
    """Delete all optimizations that used a given incentive set version. Returns count deleted."""
    db = _get_db()
    deleted = 0
    for collection_name in [OPTIMIZATION_COLLECTION, LEGACY_OPTIMIZATION_COLLECTION]:
        docs = (
            db.collection(collection_name)
            .where(filter=FieldFilter("incentive_set_version", "==", version))
            .stream()
        )
        for doc in docs:
            db.collection(collection_name).document(doc.id).delete()
            deleted += 1
    return deleted


def fs_delete_incentive_set(version: str) -> bool:
    """Delete an incentive set. Returns True if it existed."""
    db = _get_db()
    doc_ref = db.collection(INCENTIVE_SET_COLLECTION).document(version)
    doc = doc_ref.get()
    if not doc.exists:
        return False
    doc_ref.delete()
    return True


# ---------- Test Users ----------

TEST_USERS_COLLECTION = "test_users"


def fs_save_test_user(customer_id: str, csv_text: str,
                      country: str = "", transaction_count: int = 0) -> str:
    """Save a test user's CSV data to Firestore. Returns customer_id."""
    db = _get_db()
    db.collection(TEST_USERS_COLLECTION).document(customer_id).set({
        "customer_id": customer_id,
        "country": country,
        "transaction_count": transaction_count,
        "csv_text": csv_text,
    })
    return customer_id


def fs_list_test_user_ids() -> list[str]:
    """Return sorted list of all test user customer IDs."""
    db = _get_db()
    docs = db.collection(TEST_USERS_COLLECTION).stream()
    ids = [doc.id for doc in docs]
    ids.sort()
    return ids


def fs_load_test_user_csv(customer_id: str) -> str | None:
    """Load a test user's CSV text from Firestore. Returns None if not found."""
    db = _get_db()
    doc = db.collection(TEST_USERS_COLLECTION).document(customer_id).get()
    if not doc.exists:
        return None
    return doc.to_dict().get("csv_text")


def fs_load_all_test_user_csvs() -> dict[str, str]:
    """Load all test user CSV texts from Firestore. Returns {customer_id: csv_text}."""
    db = _get_db()
    docs = db.collection(TEST_USERS_COLLECTION).stream()
    result = {}
    for doc in docs:
        data = doc.to_dict()
        csv_text = data.get("csv_text")
        if csv_text:
            result[doc.id] = csv_text
    return result


# ---------- Portfolio Datasets ----------

PORTFOLIO_DATASET_COLLECTION = "portfolio_datasets"


def fs_save_portfolio_dataset(
    upload_name: str,
    transactions: list[dict] | None = None,
    csv_text: str = "",
    parsed_user_count: int = 0,
    parsed_transaction_count: int = 0,
) -> str:
    """Persist uploaded portfolio rows and metadata. Returns dataset_id."""
    db = _get_db()
    dataset_id = f"upl_{uuid.uuid4().hex[:16]}"
    now_iso = datetime.datetime.utcnow().isoformat()
    upload_name = upload_name.strip()

    transactions = transactions or []

    # Store metadata on parent doc; raw content is chunked in subcollection docs
    dataset_ref = db.collection(PORTFOLIO_DATASET_COLLECTION).document(dataset_id)
    field_names: list[str] = []
    row_count = 0
    storage_format = "rows"
    if csv_text:
        import csv
        import io
        reader = csv.DictReader(io.StringIO(csv_text))
        row_count = 0
        for _ in reader:
            row_count += 1
        field_names = list(reader.fieldnames or [])
        storage_format = "csv_text"
    elif transactions and isinstance(transactions[0], dict):
        row_count = len(transactions)
        field_names = sorted(str(k) for k in transactions[0].keys())

    dataset_ref.set({
        "dataset_id": dataset_id,
        "upload_name": upload_name,
        "created_at": now_iso,
        "row_count": row_count,
        "storage_format": storage_format,
        "field_names": field_names,
        "parsed_user_count": parsed_user_count,
        "parsed_transaction_count": parsed_transaction_count,
    })

    if csv_text:
        # Firestore document limit is 1 MiB; keep chunks well below that.
        chunk_size = 800_000
        for idx in range(0, len(csv_text), chunk_size):
            chunk_text = csv_text[idx: idx + chunk_size]
            chunk_id = f"chunk_{idx // chunk_size:05d}"
            dataset_ref.collection("csv_chunks").document(chunk_id).set({
                "chunk_id": chunk_id,
                "start_index": idx,
                "char_count": len(chunk_text),
                "csv_text": chunk_text,
            })
    else:
        # Keep each chunk document small to avoid Firestore document size limits.
        chunk_size = 500
        for idx in range(0, len(transactions), chunk_size):
            chunk_rows = transactions[idx: idx + chunk_size]
            chunk_id = f"chunk_{idx // chunk_size:05d}"
            dataset_ref.collection("rows").document(chunk_id).set({
                "chunk_id": chunk_id,
                "start_index": idx,
                "row_count": len(chunk_rows),
                "rows": chunk_rows,
            })

    return dataset_id


def fs_create_portfolio_dataset_metadata(
    upload_name: str,
    file_name: str,
    content_type: str,
    size_bytes: int,
) -> tuple[str, str, str]:
    """Create metadata-only portfolio dataset record tied to a GCS object path."""
    db = _get_db()
    dataset_id = f"upl_{uuid.uuid4().hex[:16]}"
    now_iso = datetime.datetime.utcnow().isoformat()
    object_path = f"portfolio_uploads/{dataset_id}/{file_name}"
    bucket_name = FIREBASE_STORAGE_BUCKET

    db.collection(PORTFOLIO_DATASET_COLLECTION).document(dataset_id).set({
        "dataset_id": dataset_id,
        "upload_name": upload_name.strip(),
        "created_at": now_iso,
        "row_count": 0,
        "storage_format": "gcs",
        "field_names": [],
        "parsed_user_count": 0,
        "parsed_transaction_count": 0,
        "bucket": bucket_name,
        "object_path": object_path,
        "content_type": content_type,
        "size_bytes": int(size_bytes),
        "status": "uploading",
    })
    return dataset_id, bucket_name, object_path


def fs_mark_portfolio_dataset_processing(dataset_id: str) -> None:
    db = _get_db()
    db.collection(PORTFOLIO_DATASET_COLLECTION).document(dataset_id).set(
        {"status": "processing"},
        merge=True,
    )


def fs_mark_portfolio_dataset_ready(
    dataset_id: str,
    *,
    row_count: int,
    parsed_user_count: int,
    parsed_transaction_count: int,
    field_names: list[str],
) -> None:
    db = _get_db()
    db.collection(PORTFOLIO_DATASET_COLLECTION).document(dataset_id).set(
        {
            "status": "ready",
            "row_count": int(row_count),
            "parsed_user_count": int(parsed_user_count),
            "parsed_transaction_count": int(parsed_transaction_count),
            "field_names": field_names,
        },
        merge=True,
    )


def fs_mark_portfolio_dataset_failed(dataset_id: str, error: str) -> None:
    db = _get_db()
    db.collection(PORTFOLIO_DATASET_COLLECTION).document(dataset_id).set(
        {"status": "failed", "error": str(error)[:1000]},
        merge=True,
    )


def fs_list_portfolio_datasets() -> list[dict]:
    """List uploaded portfolio datasets, newest first."""
    db = _get_db()
    docs = db.collection(PORTFOLIO_DATASET_COLLECTION).stream()
    results: list[dict] = []
    for doc in docs:
        data = _serialize_dates(doc.to_dict() or {})
        results.append({
            "dataset_id": data.get("dataset_id", doc.id),
            "upload_name": data.get("upload_name", ""),
            "created_at": data.get("created_at", ""),
            "row_count": data.get("row_count", 0),
            "parsed_user_count": data.get("parsed_user_count", 0),
            "parsed_transaction_count": data.get("parsed_transaction_count", 0),
            "storage_format": data.get("storage_format", "rows"),
            "status": data.get("status", ""),
        })
    results.sort(key=lambda d: d.get("created_at", ""), reverse=True)
    return results


def fs_load_portfolio_dataset(dataset_id: str) -> dict | None:
    """Load a persisted uploaded dataset by ID.

    Returns a dict with metadata and either `csv_text` and/or `rows`.
    """
    db = _get_db()
    dataset_ref = db.collection(PORTFOLIO_DATASET_COLLECTION).document(dataset_id)
    doc = dataset_ref.get()
    if not doc.exists:
        return None

    data = _serialize_dates(doc.to_dict() or {})
    storage_format = data.get("storage_format", "rows")
    result = {
        "dataset_id": data.get("dataset_id", dataset_id),
        "upload_name": data.get("upload_name", ""),
        "created_at": data.get("created_at", ""),
        "row_count": data.get("row_count", 0),
        "parsed_user_count": data.get("parsed_user_count", 0),
        "parsed_transaction_count": data.get("parsed_transaction_count", 0),
        "storage_format": storage_format,
    }

    if storage_format == "gcs":
        bucket_name = str(data.get("bucket", "") or FIREBASE_STORAGE_BUCKET)
        object_path = str(data.get("object_path", "") or "")
        result["bucket"] = bucket_name
        result["object_path"] = object_path
        return result

    if storage_format == "csv_text":
        chunks = list(dataset_ref.collection("csv_chunks").stream())
        chunk_rows: list[dict] = []
        for c in chunks:
            chunk_rows.append(c.to_dict() or {})
        chunk_rows.sort(key=lambda c: c.get("start_index", 0))
        result["csv_text"] = "".join(str(c.get("csv_text", "")) for c in chunk_rows)
        return result

    chunks = list(dataset_ref.collection("rows").stream())
    chunk_rows: list[dict] = []
    for c in chunks:
        chunk_rows.append(c.to_dict() or {})
    chunk_rows.sort(key=lambda c: c.get("start_index", 0))
    rows: list[dict] = []
    for c in chunk_rows:
        part = c.get("rows", [])
        if isinstance(part, list):
            rows.extend(part)
    result["rows"] = rows
    return result


def fs_delete_portfolio_dataset_cascade(dataset_id: str) -> dict | None:
    """Delete a portfolio dataset and all associated catalogs/optimizations.

    Returns None if dataset doesn't exist, otherwise deletion counts.
    """
    db = _get_db()
    dataset_ref = db.collection(PORTFOLIO_DATASET_COLLECTION).document(dataset_id)
    dataset_doc = dataset_ref.get()
    if not dataset_doc.exists:
        return None

    # Delete dataset chunks first
    deleted_chunk_docs = 0
    for sub_name in ["rows", "csv_chunks"]:
        for doc in dataset_ref.collection(sub_name).stream():
            doc.reference.delete()
            deleted_chunk_docs += 1

    # Delete referenced GCS object when present
    dataset_data = _serialize_dates(dataset_doc.to_dict() or {})
    storage_format = str(dataset_data.get("storage_format", "") or "")
    if storage_format == "gcs":
        bucket_name = str(dataset_data.get("bucket", "") or FIREBASE_STORAGE_BUCKET)
        object_path = str(dataset_data.get("object_path", "") or "")
        if object_path:
            try:
                blob = storage.bucket(bucket_name).blob(object_path)
                if blob.exists():
                    blob.delete()
            except Exception:
                pass

    # Find catalogs trained from this dataset
    catalog_docs = (
        db.collection(CATALOG_COLLECTION)
        .where(filter=FieldFilter("upload_dataset_id", "==", dataset_id))
        .stream()
    )
    catalog_versions: list[str] = []
    for cdoc in catalog_docs:
        catalog_versions.append(cdoc.id)

    deleted_optimizations = 0
    for version in catalog_versions:
        seen_ids: set[str] = set()
        for collection_name in [OPTIMIZATION_COLLECTION, LEGACY_OPTIMIZATION_COLLECTION]:
            exp_docs = (
                db.collection(collection_name)
                .where(filter=FieldFilter("catalog_version", "==", version))
                .stream()
            )
            for edoc in exp_docs:
                if edoc.id in seen_ids:
                    continue
                seen_ids.add(edoc.id)
                edoc.reference.delete()
                deleted_optimizations += 1

    deleted_catalogs = 0
    for version in catalog_versions:
        db.collection(CATALOG_COLLECTION).document(version).delete()
        deleted_catalogs += 1

    dataset_ref.delete()

    orphan_cleanup = fs_delete_orphaned_portfolio_artifacts()

    return {
        "dataset_id": dataset_id,
        "deleted_dataset": True,
        "deleted_chunk_docs": deleted_chunk_docs,
        "deleted_catalogs": deleted_catalogs,
        "deleted_optimizations": deleted_optimizations,
        "deleted_orphan_catalogs": orphan_cleanup.get("deleted_catalogs", 0),
        "deleted_orphan_optimizations": orphan_cleanup.get("deleted_optimizations", 0),
    }


def fs_delete_orphaned_portfolio_artifacts() -> dict:
    """Delete upload-derived catalogs/optimizations that no longer map to a dataset."""
    db = _get_db()

    dataset_ids: set[str] = set()
    for ddoc in db.collection(PORTFOLIO_DATASET_COLLECTION).stream():
        dataset_ids.add(ddoc.id)

    orphan_catalog_versions: list[str] = []
    for cdoc in db.collection(CATALOG_COLLECTION).stream():
        data = _serialize_dates(cdoc.to_dict() or {})
        source = str(data.get("source", "") or "")
        if not source.startswith("upload:"):
            continue
        upload_dataset_id = str(data.get("upload_dataset_id", "") or "")
        if not upload_dataset_id or upload_dataset_id not in dataset_ids:
            orphan_catalog_versions.append(cdoc.id)

    deleted_optimizations = 0
    for version in orphan_catalog_versions:
        seen_ids: set[str] = set()
        for collection_name in [OPTIMIZATION_COLLECTION, LEGACY_OPTIMIZATION_COLLECTION]:
            exp_docs = (
                db.collection(collection_name)
                .where(filter=FieldFilter("catalog_version", "==", version))
                .stream()
            )
            for edoc in exp_docs:
                if edoc.id in seen_ids:
                    continue
                seen_ids.add(edoc.id)
                edoc.reference.delete()
                deleted_optimizations += 1

    deleted_catalogs = 0
    for version in orphan_catalog_versions:
        db.collection(CATALOG_COLLECTION).document(version).delete()
        deleted_catalogs += 1

    return {
        "deleted_catalogs": deleted_catalogs,
        "deleted_optimizations": deleted_optimizations,
    }


# ---------- Workflows ----------

WORKFLOW_COLLECTION = "workflows"


def fs_create_workflow(name: str, description: str, detail: str = "") -> dict:
    """Create a new workflow. Returns the workflow dict."""
    db = _get_db()
    workflow_id = f"wf_{uuid.uuid4().hex[:12]}"
    now_iso = datetime.datetime.utcnow().isoformat()
    doc = {
        "workflow_id": workflow_id,
        "name": name.strip(),
        "description": description.strip(),
        "detail": detail.strip(),
        "created_at": now_iso,
        "updated_at": now_iso,
    }
    db.collection(WORKFLOW_COLLECTION).document(workflow_id).set(doc)
    return doc


def fs_list_workflows() -> list[dict]:
    """List all workflows, newest first."""
    db = _get_db()
    results: list[dict] = []
    for doc in db.collection(WORKFLOW_COLLECTION).stream():
        data = _serialize_dates(doc.to_dict() or {})
        results.append({
            "workflow_id": data.get("workflow_id", doc.id),
            "name": data.get("name", ""),
            "description": data.get("description", ""),
            "detail": data.get("detail", ""),
            "created_at": data.get("created_at", ""),
            "updated_at": data.get("updated_at", ""),
        })
    results.sort(key=lambda w: w.get("created_at", ""), reverse=True)
    return results


def fs_get_workflow(workflow_id: str) -> dict | None:
    """Get a single workflow by ID. Returns None if not found."""
    db = _get_db()
    doc = db.collection(WORKFLOW_COLLECTION).document(workflow_id).get()
    if not doc.exists:
        return None
    return _serialize_dates(doc.to_dict())


def fs_update_workflow(workflow_id: str, name: str | None = None, description: str | None = None, detail: str | None = None) -> dict | None:
    """Update a workflow's name, description, and/or detail. Returns updated doc or None."""
    db = _get_db()
    doc_ref = db.collection(WORKFLOW_COLLECTION).document(workflow_id)
    doc = doc_ref.get()
    if not doc.exists:
        return None
    updates: dict = {"updated_at": datetime.datetime.utcnow().isoformat()}
    if name is not None:
        updates["name"] = name.strip()
    if description is not None:
        updates["description"] = description.strip()
    if detail is not None:
        updates["detail"] = detail.strip()
    doc_ref.update(updates)
    return _serialize_dates(doc_ref.get().to_dict())


def fs_delete_workflow(workflow_id: str) -> bool:
    """Delete a workflow. Returns True if it existed."""
    db = _get_db()
    doc_ref = db.collection(WORKFLOW_COLLECTION).document(workflow_id)
    doc = doc_ref.get()
    if not doc.exists:
        return False
    doc_ref.delete()
    return True
