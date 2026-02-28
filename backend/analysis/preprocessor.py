"""Transaction preprocessing: normalize, clean, and filter input data."""

from __future__ import annotations

import csv
import io
from datetime import datetime

from config import EXCLUDED_STOCK_CODES, MAX_REASONABLE_QUANTITY
from models.transaction import Transaction, UserTransactions


def parse_csv_transactions(csv_text: str, customer_id: str = "") -> UserTransactions:
    """Parse transactions from a CSV string (test data format).

    Expected columns: Invoice, StockCode, Description, Quantity, InvoiceDate, Price, Customer ID, Country
    """
    reader = csv.DictReader(io.StringIO(csv_text))
    transactions: list[Transaction] = []

    for row in reader:
        stock_code = row.get("StockCode", "").strip()
        if stock_code.upper() in EXCLUDED_STOCK_CODES:
            continue

        try:
            quantity = int(float(row.get("Quantity", "1")))
        except (ValueError, TypeError):
            quantity = 1

        if abs(quantity) > MAX_REASONABLE_QUANTITY:
            continue

        try:
            unit_price = float(row.get("Price", "0"))
        except (ValueError, TypeError):
            unit_price = 0.0

        try:
            dt = datetime.fromisoformat(row.get("InvoiceDate", ""))
        except (ValueError, TypeError):
            continue

        transactions.append(Transaction(
            date=dt,
            description=row.get("Description", "").strip(),
            amount=round(quantity * unit_price, 2),
            quantity=quantity,
            unit_price=unit_price,
            country=row.get("Country", "").strip(),
            invoice=row.get("Invoice", "").strip(),
            stock_code=stock_code,
        ))

    cid = customer_id
    if not cid and transactions:
        cid = str(transactions[0].invoice)

    return UserTransactions(customer_id=cid, transactions=transactions)


def parse_json_transactions(
    records: list[dict], customer_id: str = ""
) -> UserTransactions:
    """Parse transactions from a list of JSON objects (production format).

    Minimum fields: date, description, amount.
    Optional: category, merchant, quantity, country, currency, invoice, stock_code.
    """
    transactions: list[Transaction] = []

    for rec in records:
        date_str = rec.get("date") or rec.get("InvoiceDate") or rec.get("invoice_date", "")
        try:
            dt = datetime.fromisoformat(str(date_str))
        except (ValueError, TypeError):
            continue

        amount = rec.get("amount")
        if amount is None:
            qty = rec.get("quantity", rec.get("Quantity", 1))
            price = rec.get("price", rec.get("Price", rec.get("unit_price", 0)))
            try:
                amount = round(float(qty) * float(price), 2)
            except (ValueError, TypeError):
                amount = 0.0
        else:
            try:
                amount = float(amount)
            except (ValueError, TypeError):
                amount = 0.0

        try:
            quantity = int(float(rec.get("quantity", rec.get("Quantity", 1))))
        except (ValueError, TypeError):
            quantity = 1

        if abs(quantity) > MAX_REASONABLE_QUANTITY:
            continue

        stock_code = str(rec.get("stock_code", rec.get("StockCode", ""))).strip()
        if stock_code.upper() in EXCLUDED_STOCK_CODES:
            continue

        unit_price_raw = rec.get("unit_price", rec.get("Price"))
        unit_price = None
        if unit_price_raw is not None:
            try:
                unit_price = float(unit_price_raw)
            except (ValueError, TypeError):
                pass

        transactions.append(Transaction(
            date=dt,
            description=str(rec.get("description", rec.get("Description", ""))).strip(),
            amount=amount,
            category=str(rec.get("category", "")).strip(),
            merchant=str(rec.get("merchant", "")).strip(),
            quantity=quantity,
            unit_price=unit_price,
            country=str(rec.get("country", rec.get("Country", ""))).strip(),
            currency=str(rec.get("currency", "")).strip(),
            invoice=str(rec.get("invoice", rec.get("Invoice", ""))).strip(),
            stock_code=stock_code,
        ))

    return UserTransactions(customer_id=customer_id, transactions=transactions)


def load_test_user(customer_id: str) -> UserTransactions:
    """Load a test user's CSV from data/test-users/ (for development only)."""
    from config import TEST_USERS_DIR

    path = TEST_USERS_DIR / f"test-user-{customer_id}.csv"
    csv_text = path.read_text(encoding="utf-8")
    return parse_csv_transactions(csv_text, customer_id=customer_id)


def clean_transactions(user_txns: UserTransactions) -> UserTransactions:
    """Remove cancellations and zero-amount transactions for analysis."""
    clean = [
        t for t in user_txns.transactions
        if not t.is_cancellation and t.amount > 0
    ]
    return UserTransactions(customer_id=user_txns.customer_id, transactions=clean)
