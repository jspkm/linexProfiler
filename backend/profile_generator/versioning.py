"""Profile catalog versioning and persistence.

Catalogs are stored as immutable documents in the Firestore `profile_catalogs`
collection. Supports listing, loading, forking, and deletion.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone

from models.profile_catalog import ProfileCatalog
from profile_generator.firestore_client import (
    fs_save_catalog,
    fs_load_catalog,
    fs_list_catalogs,
    fs_delete_catalog,
)


def save_catalog(catalog: ProfileCatalog) -> str:
    """Save a ProfileCatalog to Firestore. Returns the version string."""
    return fs_save_catalog(catalog)


def load_catalog(version: str) -> ProfileCatalog | None:
    """Load a ProfileCatalog by version ID. Returns None if not found."""
    return fs_load_catalog(version)


def list_catalogs() -> list[dict]:
    """List all saved catalog versions with basic metadata.

    Returns list of {version, created_at, k, source, profile_count}.
    """
    return fs_list_catalogs()


def get_latest_catalog() -> ProfileCatalog | None:
    """Load the most recently saved catalog."""
    catalogs = fs_list_catalogs()
    if not catalogs:
        return None
    return fs_load_catalog(catalogs[0]["version"])


def delete_catalog(version: str) -> bool:
    """Delete a catalog by version. Returns True if deleted, False if not found."""
    return fs_delete_catalog(version)


def fork_catalog(
    source_version: str,
    modifications: dict | None = None,
) -> ProfileCatalog | None:
    """Clone an existing catalog with optional modifications.

    Creates a new version that doesn't affect the original.

    Args:
        source_version: version ID of the catalog to clone
        modifications: optional dict of profile_id -> {field: new_value} to apply

    Returns:
        New ProfileCatalog with a unique version, or None if source not found.
    """
    source = load_catalog(source_version)
    if source is None:
        return None

    # Deep clone via serialization
    new_catalog = ProfileCatalog.model_validate(source.model_dump())

    # Apply modifications
    if modifications:
        for profile in new_catalog.profiles:
            if profile.profile_id in modifications:
                mods = modifications[profile.profile_id]
                if "description" in mods:
                    profile.description = mods["description"]
                if "centroid" in mods:
                    profile.centroid.update(mods["centroid"])

    # Generate new version hash
    fork_hash = hashlib.sha256(
        json.dumps({
            "source": source_version,
            "modifications": modifications or {},
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }, sort_keys=True).encode()
    ).hexdigest()[:12]

    new_catalog.version = f"fork_{fork_hash}"
    new_catalog.created_at = datetime.now(timezone.utc)

    # Save the forked catalog
    save_catalog(new_catalog)
    return new_catalog
