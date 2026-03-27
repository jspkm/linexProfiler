"""Profile catalog handlers.

All handlers return plain (dict, int) tuples.
Heavy imports are deferred inside each function for cold-start optimisation.
"""

from __future__ import annotations

import traceback

from handlers._common import handler


@handler
def handle_list_profile_catalogs() -> tuple[dict, int]:
    """List all profile catalogs from Firestore."""
    from profile_generator.versioning import list_catalogs

    catalogs = list_catalogs()
    return {"catalogs": catalogs}, 200


@handler
def handle_get_profile_catalog(version: str | None) -> tuple[dict, int]:
    """Get a profile catalog by version, or the latest if no version given."""
    from profile_generator.versioning import load_catalog, get_latest_catalog

    if version:
        cat = load_catalog(version)
    else:
        cat = get_latest_catalog()
    if not cat:
        return {"error": "No catalog found"}, 404
    return cat.model_dump(mode="json"), 200


@handler
def handle_fork_catalog(data: dict) -> tuple[dict, int]:
    """Fork an existing catalog with optional modifications."""
    from profile_generator.versioning import fork_catalog

    source_version = data.get("source_version", "")
    modifications = data.get("modifications")
    if not source_version:
        return {"error": "Missing source_version"}, 400
    forked = fork_catalog(source_version, modifications)
    if not forked:
        return {"error": f"Catalog '{source_version}' not found"}, 404
    return forked.model_dump(mode="json"), 200


@handler
def handle_delete_catalog(version: str) -> tuple[dict, int]:
    """Delete a catalog by version."""
    from profile_generator.versioning import delete_catalog

    if not version:
        return {"error": "Missing catalog version"}, 400
    ok = delete_catalog(version)
    if not ok:
        return {"error": "Catalog not found"}, 404
    return {"deleted": True}, 200


@handler
def handle_learn_profiles(data: dict, request_origin: str | None = None) -> tuple[dict, int]:
    """Train profile clusters from test users (Firestore or disk) or retail data.

    This is the canonical implementation with full GCS/Firestore status tracking.
    """
    upload_dataset_id = ""
    try:
        from profile_generator.feature_derivation import derive_batch_features
        from profile_generator.trainer import learn_profiles as _learn_profiles
        from profile_generator.versioning import save_catalog
        from profile_generator.firestore_client import (
            fs_save_portfolio_dataset,
            fs_load_portfolio_dataset,
            fs_mark_portfolio_dataset_processing,
            fs_mark_portfolio_dataset_ready,
            fs_mark_portfolio_dataset_failed,
        )
        from analysis.preprocessor import parse_csv_transactions, parse_portfolio_records_with_metadata
        from config import DEFAULT_K, TEST_USERS_DIR
        from firebase_admin import storage
        import csv
        import io

        source = str(data.get("source", "test-users") or "test-users")
        k = data.get("k", DEFAULT_K)
        limit = data.get("limit", 0)
        upload_name = str(data.get("upload_name", "")).strip()
        upload_csv_text = str(data.get("csv_text", "") or "")
        upload_transactions = data.get("transactions", [])
        upload_dataset_id = str(data.get("upload_dataset_id", "") or "")

        users = {}
        if source == "uploaded":
            row_count = 0
            field_names: list[str] = []
            if upload_dataset_id:
                dataset = fs_load_portfolio_dataset(upload_dataset_id)
                if not dataset:
                    return {"error": "Uploaded dataset not found"}, 404
                fs_mark_portfolio_dataset_processing(upload_dataset_id)
                storage_format = str(dataset.get("storage_format", "") or "")
                if storage_format == "gcs":
                    bucket_name = str(dataset.get("bucket", "") or "")
                    object_path = str(dataset.get("object_path", "") or "")
                    if not bucket_name or not object_path:
                        return {"error": "Uploaded dataset metadata missing Storage location"}, 400
                    blob = storage.bucket(bucket_name).blob(object_path)
                    if not blob.exists():
                        return {"error": "Uploaded CSV file not found in Cloud Storage"}, 404
                    with blob.open("rt", encoding="utf-8") as fh:
                        reader = csv.DictReader(fh)
                        field_names = sorted([str(k) for k in (reader.fieldnames or [])])
                        users, row_count, _ = parse_portfolio_records_with_metadata(
                            reader,
                            default_customer_id=upload_name,
                        )
                else:
                    dataset_csv_text = str(dataset.get("csv_text", "") or "")
                    if dataset_csv_text:
                        reader = csv.DictReader(io.StringIO(dataset_csv_text))
                        users, row_count, field_names = parse_portfolio_records_with_metadata(
                            reader,
                            default_customer_id=upload_name,
                        )
                    elif isinstance(dataset.get("rows"), list):
                        users, row_count, field_names = parse_portfolio_records_with_metadata(
                            dataset.get("rows") or [],
                            default_customer_id=upload_name,
                        )
                    else:
                        users = {}
                        row_count = 0
                        field_names = []
                upload_name = str(dataset.get("upload_name", "")).strip() or upload_name
            else:
                # Backward-compatible direct payload path for smaller files
                if upload_csv_text.strip():
                    reader = csv.DictReader(io.StringIO(upload_csv_text))
                    users, row_count, field_names = parse_portfolio_records_with_metadata(
                        reader,
                        default_customer_id=upload_name,
                    )
                elif isinstance(upload_transactions, list):
                    users, row_count, field_names = parse_portfolio_records_with_metadata(
                        upload_transactions,
                        default_customer_id=upload_name,
                    )
                else:
                    users = {}
                    row_count = 0
                    field_names = []

                if row_count > 0:
                    parsed_txn_count = sum(len(u.transactions) for u in users.values())
                    upload_dataset_id = fs_save_portfolio_dataset(
                        upload_name=upload_name,
                        transactions=upload_transactions if not upload_csv_text.strip() else None,
                        csv_text=upload_csv_text,
                        parsed_user_count=len(users),
                        parsed_transaction_count=parsed_txn_count,
                    )
                    fs_mark_portfolio_dataset_processing(upload_dataset_id)

            if row_count <= 0:
                return {"error": "No uploaded transactions provided"}, 400

            if not users:
                if upload_dataset_id:
                    fs_mark_portfolio_dataset_failed(upload_dataset_id, "No valid user transactions found in uploaded data")
                return {"error": "No valid user transactions found in uploaded data"}, 400

            if upload_dataset_id:
                fs_mark_portfolio_dataset_ready(
                    upload_dataset_id,
                    row_count=row_count,
                    parsed_user_count=len(users),
                    parsed_transaction_count=sum(len(u.transactions) for u in users.values()),
                    field_names=field_names,
                )
            source = f"upload:{upload_name}" if upload_name else f"upload:{upload_dataset_id}"
        elif source.startswith("uploaded-dataset:"):
            selected_dataset_id = source.split(":", 1)[1].strip()
            if not selected_dataset_id:
                return {"error": "Missing uploaded dataset id"}, 400
            dataset = fs_load_portfolio_dataset(selected_dataset_id)
            if not dataset:
                return {"error": "Uploaded dataset not found"}, 404
            fs_mark_portfolio_dataset_processing(selected_dataset_id)
            row_count = 0
            field_names: list[str] = []
            storage_format = str(dataset.get("storage_format", "") or "")
            if storage_format == "gcs":
                bucket_name = str(dataset.get("bucket", "") or "")
                object_path = str(dataset.get("object_path", "") or "")
                if not bucket_name or not object_path:
                    return {"error": "Uploaded dataset metadata missing Storage location"}, 400
                blob = storage.bucket(bucket_name).blob(object_path)
                if not blob.exists():
                    return {"error": "Uploaded CSV file not found in Cloud Storage"}, 404
                with blob.open("rt", encoding="utf-8") as fh:
                    reader = csv.DictReader(fh)
                    field_names = sorted([str(k) for k in (reader.fieldnames or [])])
                    users, row_count, _ = parse_portfolio_records_with_metadata(
                        reader,
                        default_customer_id="",
                    )
            else:
                dataset_csv_text = str(dataset.get("csv_text", "") or "")
                if dataset_csv_text:
                    reader = csv.DictReader(io.StringIO(dataset_csv_text))
                    users, row_count, field_names = parse_portfolio_records_with_metadata(
                        reader,
                        default_customer_id="",
                    )
                elif isinstance(dataset.get("rows"), list):
                    users, row_count, field_names = parse_portfolio_records_with_metadata(
                        dataset.get("rows") or [],
                        default_customer_id="",
                    )
                else:
                    users = {}
                    row_count = 0
                    field_names = []
            if row_count <= 0:
                return {"error": "Selected uploaded dataset has no rows"}, 400
            if not users:
                fs_mark_portfolio_dataset_failed(selected_dataset_id, "No valid user transactions found in selected uploaded dataset")
                return {"error": "No valid user transactions found in selected uploaded dataset"}, 400
            upload_dataset_id = selected_dataset_id
            upload_name = str(dataset.get("upload_name", "")).strip()
            fs_mark_portfolio_dataset_ready(
                upload_dataset_id,
                row_count=row_count,
                parsed_user_count=len(users),
                parsed_transaction_count=sum(len(u.transactions) for u in users.values()),
                field_names=field_names,
            )
            source = f"upload:{upload_name}" if upload_name else f"upload:{upload_dataset_id}"
        elif source == "retail":
            from config import DATA_DIR
            retail_path = DATA_DIR / "retail.csv"
            if not retail_path.exists():
                return {"error": "retail.csv not available (dev only)"}, 400
            users_txns = {}
            with open(retail_path, "r", encoding="utf-8") as fh:
                reader = csv.DictReader(fh)
                for row in reader:
                    cid = row.get("Customer ID", "").strip()
                    if not cid:
                        continue
                    try:
                        cid = str(int(float(cid)))
                    except (ValueError, TypeError):
                        pass
                    users_txns.setdefault(cid, []).append(row)
            if limit > 0:
                keys = list(users_txns.keys())[:limit]
                users_txns = {k: users_txns[k] for k in keys}
            for cid, rows in users_txns.items():
                if rows:
                    fieldnames = list(rows[0].keys())
                    buf = io.StringIO()
                    writer = csv.DictWriter(buf, fieldnames=fieldnames)
                    writer.writeheader()
                    writer.writerows(rows)
                    users[cid] = parse_csv_transactions(buf.getvalue(), customer_id=cid)
        else:
            # Try Firestore first (works in production)
            try:
                from profile_generator.firestore_client import fs_load_all_test_user_csvs
                csv_map = fs_load_all_test_user_csvs()
                for uid, csv_text in csv_map.items():
                    users[uid] = parse_csv_transactions(csv_text, customer_id=uid)
            except Exception:
                pass

            # Fall back to disk (local dev)
            if not users and TEST_USERS_DIR.exists():
                for f in sorted(TEST_USERS_DIR.iterdir()):
                    if f.name.startswith("test-user-") and f.name.endswith(".csv"):
                        uid = f.name.replace("test-user-", "").replace(".csv", "")
                        csv_text = f.read_text(encoding="utf-8")
                        users[uid] = parse_csv_transactions(csv_text, customer_id=uid)

        if not users:
            return {"error": f"No users found for source '{source}'"}, 400

        feature_df = derive_batch_features(users)
        if len(feature_df) < 2:
            return {"error": "Need at least 2 users to learn"}, 400

        global_max = None
        for user_txns in users.values():
            for t in user_txns.transactions:
                if global_max is None or t.date > global_max:
                    global_max = t.date

        cat = _learn_profiles(feature_df, k=k, source=source, dataset_max_date=global_max)
        if upload_dataset_id:
            cat.upload_dataset_id = upload_dataset_id
            cat.upload_dataset_name = upload_name
        save_catalog(cat)
        return cat.model_dump(mode="json"), 200
    except Exception as e:
        if upload_dataset_id:
            try:
                from profile_generator.firestore_client import fs_mark_portfolio_dataset_failed
                fs_mark_portfolio_dataset_failed(upload_dataset_id, f"{type(e).__name__}: {e}")
            except Exception:
                pass
        print("learn_profiles exception:")
        print(traceback.format_exc())
        raise
