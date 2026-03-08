#!/usr/bin/env python3
"""One-time migration: upload test user CSVs from disk to Firestore.

Usage:
    cd backend
    python scripts/migrate_test_users.py
"""

import csv
import io
import sys
from pathlib import Path

# Add backend to path so imports work
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config import TEST_USERS_DIR
from profile_generator.firestore_client import fs_save_test_user, fs_list_test_user_ids


def migrate_test_users():
    """Read all test-user-*.csv files and upload to Firestore test_users collection."""
    if not TEST_USERS_DIR.exists():
        print(f"Test users directory not found: {TEST_USERS_DIR}")
        return

    csv_files = sorted(TEST_USERS_DIR.glob("test-user-*.csv"))
    print(f"Found {len(csv_files)} test user CSV file(s) to migrate.")

    # Get existing IDs to skip duplicates
    try:
        existing_ids = set(fs_list_test_user_ids())
        print(f"Already in Firestore: {len(existing_ids)} user(s).")
    except Exception as e:
        print(f"Warning: could not check existing users ({e}), uploading all.")
        existing_ids = set()

    uploaded = 0
    skipped = 0

    for csv_file in csv_files:
        customer_id = csv_file.name.replace("test-user-", "").replace(".csv", "")

        if customer_id in existing_ids:
            print(f"  [skip] {customer_id} (already in Firestore)")
            skipped += 1
            continue

        try:
            csv_text = csv_file.read_text(encoding="utf-8")

            # Extract metadata from the CSV
            reader = csv.DictReader(io.StringIO(csv_text))
            rows = list(reader)
            country = rows[0].get("Country", "") if rows else ""
            transaction_count = len(rows)

            fs_save_test_user(
                customer_id=customer_id,
                csv_text=csv_text,
                country=country,
                transaction_count=transaction_count,
            )
            print(f"  [ok]   {customer_id} ({transaction_count} transactions, {country})")
            uploaded += 1
        except Exception as e:
            print(f"  [fail] {customer_id}: {e}")

    print(f"\nDone: {uploaded} uploaded, {skipped} skipped.")


if __name__ == "__main__":
    migrate_test_users()
