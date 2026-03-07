#!/usr/bin/env python3
"""One-time migration: move existing JSON files from disk to Firestore
and seed the default incentive set.

Usage:
    cd backend
    python scripts/migrate_to_firestore.py
"""

import json
import sys
from pathlib import Path

# Add backend to path so imports work
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config import PROFILE_CATALOG_DIR, EXPERIMENT_DIR
from models.profile_catalog import ProfileCatalog
from profile_generator.experiment import ExperimentState
from profile_generator.firestore_client import (
    fs_save_catalog,
    fs_save_experiment,
    fs_load_catalog,
    fs_load_experiment,
)
from profile_generator.incentive_manager import load_or_seed_default


def migrate_catalogs():
    """Read all catalog JSON files from disk and write to Firestore."""
    if not PROFILE_CATALOG_DIR.exists():
        print("No profile_catalogs directory found, skipping.")
        return

    files = list(PROFILE_CATALOG_DIR.glob("*.json"))
    print(f"Found {len(files)} catalog file(s) to migrate.")

    for f in files:
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            catalog = ProfileCatalog.model_validate(data)

            # Check if already exists in Firestore
            existing = fs_load_catalog(catalog.version)
            if existing:
                print(f"  [skip] {catalog.version} (already in Firestore)")
                continue

            fs_save_catalog(catalog)
            print(f"  [ok]   {catalog.version} ({len(catalog.profiles)} profiles)")
        except Exception as e:
            print(f"  [fail] {f.name}: {e}")


def migrate_experiments(extra_dirs: list[Path] | None = None):
    """Read all experiment JSON files from disk and write to Firestore."""
    dirs = [EXPERIMENT_DIR]
    if extra_dirs:
        dirs.extend(extra_dirs)

    for exp_dir in dirs:
        if not exp_dir.exists():
            print(f"No experiments directory at {exp_dir}, skipping.")
            continue

        files = list(exp_dir.glob("*.json"))
        print(f"Found {len(files)} experiment file(s) in {exp_dir}.")

        for f in files:
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
                state = ExperimentState.model_validate(data)

                existing = fs_load_experiment(state.experiment_id)
                if existing:
                    print(f"  [skip] {state.experiment_id} (already in Firestore)")
                    continue

                fs_save_experiment(state)
                print(f"  [ok]   {state.experiment_id} ({len(state.results)} results)")
            except Exception as e:
                print(f"  [fail] {f.name}: {e}")


def seed_incentives():
    """Ensure the default incentive set exists in Firestore."""
    inc_set = load_or_seed_default()
    print(f"Default incentive set: {inc_set.version} ({inc_set.incentive_count} incentives)")


if __name__ == "__main__":
    print("=== Migrating Profile Catalogs ===")
    migrate_catalogs()

    print("\n=== Migrating Experiments ===")
    # Pass additional experiment directories as CLI args:
    #   python scripts/migrate_to_firestore.py /path/to/extra/experiments/
    extra = [Path(p) for p in sys.argv[1:]]
    migrate_experiments(extra)

    print("\n=== Seeding Default Incentive Set ===")
    seed_incentives()

    print("\nMigration complete.")
