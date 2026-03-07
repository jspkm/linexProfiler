"""Firestore persistence layer for profile catalogs, experiments, and incentive sets.

Centralizes Firebase initialization and provides CRUD operations for all three
collections. Reuses the Firebase Admin SDK init pattern from cards/catalog.py.
"""

from __future__ import annotations

import datetime

import firebase_admin
from firebase_admin import credentials, firestore

from google.cloud.firestore_v1.base_query import FieldFilter

from config import FIREBASE_CREDENTIALS_PATH
from models.profile_catalog import ProfileCatalog
from models.incentive_set import IncentiveSet


def _get_db():
    """Get Firestore client, initializing Firebase if needed."""
    if not firebase_admin._apps:
        if FIREBASE_CREDENTIALS_PATH:
            cred = credentials.Certificate(FIREBASE_CREDENTIALS_PATH)
            firebase_admin.initialize_app(cred)
        else:
            firebase_admin.initialize_app()
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


# ---------- Experiments ----------

EXPERIMENT_COLLECTION = "experiments"


def fs_save_experiment(state) -> str:
    """Save an ExperimentState to Firestore. Returns the experiment_id."""
    db = _get_db()
    data = state.model_dump(mode="json")
    db.collection(EXPERIMENT_COLLECTION).document(state.experiment_id).set(data)
    return state.experiment_id


def fs_load_experiment(experiment_id: str):
    """Load an ExperimentState by ID. Returns None if not found."""
    from profile_generator.experiment import ExperimentState

    db = _get_db()
    doc = db.collection(EXPERIMENT_COLLECTION).document(experiment_id).get()
    if not doc.exists:
        return None
    data = _serialize_dates(doc.to_dict())
    return ExperimentState.model_validate(data)


def fs_list_experiments(catalog_version: str | None = None) -> list[dict]:
    """List saved experiments, optionally filtered by catalog_version."""
    db = _get_db()
    query = db.collection(EXPERIMENT_COLLECTION)
    if catalog_version:
        query = query.where(filter=FieldFilter("catalog_version", "==", catalog_version))
    docs = query.stream()
    results = []
    for doc in docs:
        data = _serialize_dates(doc.to_dict())
        results.append({
            "experiment_id": data.get("experiment_id", doc.id),
            "catalog_version": data.get("catalog_version", ""),
            "status": data.get("status", ""),
            "started_at": data.get("started_at", ""),
            "completed_at": data.get("completed_at", ""),
            "result_count": len(data.get("results", [])),
        })
    results.sort(
        key=lambda e: e.get("completed_at") or e.get("started_at") or "",
        reverse=True,
    )
    return results


def fs_delete_experiment(experiment_id: str) -> bool:
    """Delete an experiment by ID. Returns True if it existed."""
    db = _get_db()
    doc_ref = db.collection(EXPERIMENT_COLLECTION).document(experiment_id)
    doc = doc_ref.get()
    if not doc.exists:
        return False
    doc_ref.delete()
    return True


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


def fs_delete_incentive_set(version: str) -> bool:
    """Delete an incentive set. Returns True if it existed."""
    db = _get_db()
    doc_ref = db.collection(INCENTIVE_SET_COLLECTION).document(version)
    doc = doc_ref.get()
    if not doc.exists:
        return False
    doc_ref.delete()
    return True
