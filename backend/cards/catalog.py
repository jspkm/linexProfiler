"""Credit card catalog: load, filter, and query the card knowledge base."""

from __future__ import annotations

import json
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, firestore

from config import FIREBASE_CREDENTIALS_PATH

# Map countries to their broader regions for card matching
REGION_MAP: dict[str, list[str]] = {
    "United Kingdom": ["United Kingdom", "Global"],
    "EIRE": ["United Kingdom", "European Union", "Global"],
    "Ireland": ["United Kingdom", "European Union", "Global"],
    "Germany": ["European Union", "Germany", "Global"],
    "France": ["European Union", "France", "Global"],
    "Netherlands": ["European Union", "Global"],
    "Belgium": ["European Union", "Global"],
    "Spain": ["European Union", "Spain", "Global"],
    "Portugal": ["European Union", "Global"],
    "Italy": ["European Union", "Italy", "Global"],
    "Switzerland": ["European Union", "Switzerland", "Global"],
    "Austria": ["European Union", "Austria", "Global"],
    "Sweden": ["Nordics", "European Union", "Global"],
    "Norway": ["Nordics", "Global"],
    "Denmark": ["Nordics", "European Union", "Global"],
    "Finland": ["Nordics", "European Union", "Global"],
    "Iceland": ["Nordics", "Global"],
    "Australia": ["Asia-Pacific", "Australia", "Global"],
    "Singapore": ["Asia-Pacific", "Singapore", "Global"],
    "Hong Kong": ["Asia-Pacific", "Hong Kong", "Global"],
    "Japan": ["Asia-Pacific", "Japan", "Global"],
    "United States": ["United States", "Global"],
    "Canada": ["Canada", "Global"],
    "United Arab Emirates": ["Middle East", "UAE", "Global"],
    "Saudi Arabia": ["Middle East", "Global"],
    "Israel": ["Middle East", "Global"],
    "Brazil": ["Latin America", "Brazil", "Global"],
    "Channel Islands": ["United Kingdom", "Global"],
    "Cyprus": ["European Union", "Global"],
    "Malta": ["European Union", "Global"],
    "Greece": ["European Union", "Global"],
    "Poland": ["European Union", "Global"],
    "Czech Republic": ["European Union", "Global"],
    "Lithuania": ["European Union", "Global"],
}


class CardCatalog:
    """Load and query the credit card knowledge base."""

    def __init__(self, cards_path: str | None = None):
        self.cards = self._load_cards(cards_path)

    @staticmethod
    def _load_cards(path: str | None) -> list[dict]:
        # Try Firebase first
        if not firebase_admin._apps:
            if FIREBASE_CREDENTIALS_PATH:
                cred = credentials.Certificate(FIREBASE_CREDENTIALS_PATH)
                firebase_admin.initialize_app(cred)
            else:
                firebase_admin.initialize_app()
        
        db = firestore.client()
        docs = db.collection('known_cards').stream()
        cards = []
        
        def _serialize_dates(obj):
            from google.api_core.datetime_helpers import DatetimeWithNanoseconds
            import datetime
            if isinstance(obj, dict):
                return {k: _serialize_dates(v) for k, v in obj.items()}
            elif isinstance(obj, list):
                return [_serialize_dates(i) for i in obj]
            elif isinstance(obj, (DatetimeWithNanoseconds, datetime.datetime)):
                return obj.isoformat()
            
            return obj

        for doc in docs:
            data = doc.to_dict()
            data = _serialize_dates(data)
            
            # Ensure the ID is present
            if 'id' not in data:
                data['id'] = doc.id
            cards.append(data)
        return cards

    def get_cards_for_region(self, country: str) -> list[dict]:
        """Return cards available in the user's region plus nearby/global cards.

        Uses REGION_MAP to expand a country into related regions, then matches
        cards whose region field is either the exact country, one of the related
        regions, or a parent region that encompasses the country.
        """
        # Direct match first
        search_regions = set(REGION_MAP.get(country, []))
        # Also add the country itself
        search_regions.add(country)
        # Always include "Global" tagged cards
        search_regions.add("Global")

        return [
            c for c in self.cards
            if c.get("region", "") in search_regions
        ]

    def get_all_regions(self) -> list[str]:
        """Return all unique regions in the catalog."""
        return sorted(set(c.get("region", "") for c in self.cards))

    def get_card_by_id(self, card_id: str) -> dict | None:
        """Look up a single card by ID."""
        for c in self.cards:
            if c.get("id") == card_id:
                return c
        return None
