"""Profile catalog versioning and persistence.

Catalogs are stored as immutable JSON files in the profile_catalogs directory.
Supports listing, loading, and forking.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from config import PROFILE_CATALOG_DIR
from models.profile_catalog import ProfileCatalog


def _ensure_dir() -> Path:
    """Ensure the catalog directory exists."""
    PROFILE_CATALOG_DIR.mkdir(parents=True, exist_ok=True)
    return PROFILE_CATALOG_DIR


def save_catalog(catalog: ProfileCatalog) -> str:
    """Save a ProfileCatalog to disk. Returns the file path."""
    catalog_dir = _ensure_dir()
    path = catalog_dir / f"{catalog.version}.json"
    path.write_text(catalog.model_dump_json(indent=2), encoding="utf-8")
    return str(path)


def load_catalog(version: str) -> ProfileCatalog | None:
    """Load a ProfileCatalog by version ID. Returns None if not found."""
    path = PROFILE_CATALOG_DIR / f"{version}.json"
    if not path.exists():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    return ProfileCatalog.model_validate(data)


def list_catalogs() -> list[dict]:
    """List all saved catalog versions with basic metadata.

    Returns list of {version, created_at, k, source, profile_count}.
    """
    catalog_dir = _ensure_dir()
    results = []
    for f in sorted(catalog_dir.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            results.append({
                "version": data.get("version", f.stem),
                "created_at": data.get("created_at", ""),
                "k": data.get("k", 0),
                "source": data.get("source", ""),
                "profile_count": len(data.get("profiles", [])),
            })
        except (json.JSONDecodeError, KeyError):
            continue
    return results


def get_latest_catalog() -> ProfileCatalog | None:
    """Load the most recently saved catalog."""
    catalog_dir = _ensure_dir()
    files = sorted(catalog_dir.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not files:
        return None
    data = json.loads(files[0].read_text(encoding="utf-8"))
    return ProfileCatalog.model_validate(data)


def fork_catalog(
    source_version: str,
    modifications: dict | None = None,
) -> ProfileCatalog | None:
    """Clone an existing catalog with optional modifications.

    Creates a new version that doesn't affect the original.

    Args:
        source_version: version ID of the catalog to clone
        modifications: optional dict of profile_id → {field: new_value} to apply

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
