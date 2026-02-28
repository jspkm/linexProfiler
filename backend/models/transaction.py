from __future__ import annotations

from datetime import datetime
from pydantic import BaseModel, Field


class Transaction(BaseModel):
    """A single financial transaction, normalized from any input format."""

    date: datetime
    description: str = ""
    amount: float = Field(description="Total line amount (quantity * unit_price, or raw amount)")
    category: str = ""
    merchant: str = ""
    quantity: int = 1
    unit_price: float | None = None
    country: str = ""
    currency: str = ""
    invoice: str = ""
    stock_code: str = ""

    @property
    def is_cancellation(self) -> bool:
        return self.invoice.startswith("C") or self.amount < 0


class UserTransactions(BaseModel):
    """A collection of transactions for a single user."""

    customer_id: str = ""
    transactions: list[Transaction]

    @property
    def count(self) -> int:
        return len(self.transactions)
