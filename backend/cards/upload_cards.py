"""Script to upload cards.json to Firebase Firestore.

For each card:
1. Creates a rule document in the 'rules' collection
2. Creates a card document in the 'known_cards' collection
   with ruleHistory[].ruleId referencing the rule document
"""

import json
from pathlib import Path
import sys
import uuid
import datetime

# Add project root to path
PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

import firebase_admin
from firebase_admin import credentials, firestore
from config import CARDS_PATH, FIREBASE_CREDENTIALS_PATH

# ISO-3 country code mapping
REGION_TO_ISO = {
    "United States": "USA",
    "United Kingdom": "GBR",
    "Canada": "CAN",
    "Australia": "AUS",
    "Germany": "DEU",
    "France": "FRA",
    "Singapore": "SGP",
    "United Arab Emirates": "ARE",
    "Brazil": "BRA",
    "Sweden": "SWE",
    "Norway": "NOR",
    "European Union": "EUR",
}

# Card image URLs from official issuer CDNs
CARD_IMAGES = {
    # Amex cards (icm.aexp-static.com)
    "amex-gold-uk": "https://icm.aexp-static.com/Internet/Acquisition/US_en/AppContent/OneSite/category/cardarts/gold-card.png",
    "amex-platinum-uk": "https://icm.aexp-static.com/Internet/Acquisition/US_en/AppContent/OneSite/category/cardarts/platinum-card.png",
    "amex-gold-us": "https://icm.aexp-static.com/Internet/Acquisition/US_en/AppContent/OneSite/category/cardarts/gold-card.png",
    "amex-platinum-us": "https://icm.aexp-static.com/Internet/Acquisition/US_en/AppContent/OneSite/category/cardarts/platinum-card.png",
    "amex-centurion-us": "https://icm.aexp-static.com/Internet/Acquisition/US_en/AppContent/OneSite/category/cardarts/centurion-card.png",
    "amex-cobalt-ca": "https://icm.aexp-static.com/Internet/Acquisition/US_en/AppContent/OneSite/category/cardarts/cobalt-card.png",
    "amex-british-airways-premium-plus": "https://icm.aexp-static.com/Internet/Acquisition/US_en/AppContent/OneSite/category/cardarts/british-airways-card.png",
    "marriott-bonvoy-amex": "https://icm.aexp-static.com/Internet/Acquisition/US_en/AppContent/OneSite/category/cardarts/marriott-bonvoy-brilliant.png",
    "air-france-klm-card": "https://icm.aexp-static.com/Internet/Acquisition/US_en/AppContent/OneSite/category/cardarts/air-france-klm.png",
    # Chase cards
    "chase-sapphire-preferred": "https://creditcards.chase.com/K-Marketplace/images/cardart/sapphire_702702_Background.png",
    "chase-sapphire-reserve": "https://creditcards.chase.com/K-Marketplace/images/cardart/sapphire_702702_Background.png",
    # Capital One cards
    "capital-one-venture": "https://ecm.capitalone.com/WCM/card/products/venture-rewards-tabletHero.png",
    "capital-one-classic-uk": "https://ecm.capitalone.com/WCM/card/products/classic-tabletHero.png",
    # Barclaycard
    "barclaycard-avios-plus": "https://www.barclaycard.co.uk/content/dam/barclaycard/images/redesign/credit-cards/avios-plus/avios-plus-card.png",
    # HSBC
    "hsbc-premier-world-elite": "https://www.hsbc.co.uk/content/dam/hsbc/gb/images/credit-cards/premier-world-elite-mastercard.png",
    "hsbc-visa-platinum-sg": "https://www.hsbc.com.sg/content/dam/hsbc/sg/images/credit-cards/visa-platinum.png",
    # UK Reward cards
    "tesco-clubcard-plus": "https://www.tescobank.com/globalassets/images/credit-cards/clubcard-plus-credit-card.png",
    "sainsburys-nectar": "https://www.sainsburysbank.co.uk/assets/images/credit-cards/nectar-credit-card.png",
    "john-lewis-partnership": "https://www.johnlewisfinance.com/content/dam/jlf/credit-cards/partnership-card.png",
    "ms-credit-card": "https://bank.marksandspencer.com/content/dam/mands-bank/credit-cards/ms-credit-card.png",
    "lloyds-avios-rewards": "https://www.lloydsbank.com/assets/images/credit-cards/avios-rewards-credit-card.png",
    "virgin-atlantic-reward-plus": "https://uk.virginmoney.com/content/dam/virgin-money/credit-cards/reward-plus-card.png",
    # European cards
    "n26-metal": "https://www.n26.com/sites/default/files/media/n26-metal-card.png",
    "revolut-ultra": "https://www.revolut.com/cdn-cgi/image/format=auto/ultra-card.png",
    "curve-metal": "https://www.curve.com/static/images/curve-metal-card.png",
    "lufthansa-miles-and-more": "https://www.miles-and-more.com/content/dam/mmg/card/gold-card.png",
    "sas-eurobonus-mastercard": "https://www.flysas.com/content/dam/eurobonus/eurobonus-mastercard.png",
    "norwegian-reward-world": "https://www.banknorwegian.no/globalassets/images/cards/norwegian-reward-world.png",
    # Citi cards
    "citi-premier": "https://www.citibank.com/US/JRS/pands/detail/images/citi-premier-card.png",
    "citi-rewards-sg": "https://www.citibank.com.sg/personal-banking/credit-cards/images/citi-rewards-card.png",
    # Asia-Pacific
    "anz-rewards-platinum-au": "https://www.anz.com.au/content/dam/anzau/images/credit-cards/rewards-platinum.png",
    "dbs-altitude-sg": "https://www.dbs.com.sg/iwov-resources/media/images/cards/altitude-visa.png",
    # Middle East
    "emirates-skywards-infinite": "https://www.emiratesnbd.com/assets/images/cards/skywards-infinite.png",
    "mashreq-solitaire": "https://www.mashreqbank.com/uae/en/images/cards/solitaire.png",
    # Americas
    "td-aeroplan-visa-infinite": "https://www.td.com/content/dam/tdct/images/personal-banking/credit-cards/aeroplan-visa-infinite.png",
    "scotiabank-gold-amex": "https://www.scotiabank.com/content/dam/scotiabank/canada/images/credit-cards/gold-amex.png",
    "itau-azul-infinite": "https://www.itau.com.br/assets/images/cartoes/azul-infinite.png",
}


def _build_rule_code(card: dict) -> str:
    """Build a simple JavaScript rule function from card earn_rates."""
    earn_rates = card.get("earn_rates", {})
    general = earn_rates.get("general", "1x points per unit spent")
    category = earn_rates.get("category_specific", "")

    return (
        f'function calculatePoints(transaction, cardParams) {{\n'
        f'  // {general}\n'
        f'  // {category}\n'
        f'  const {{ amount, merchant, description }} = transaction;\n'
        f'  const {{ baseMultiplier, highMultiplier }} = cardParams;\n'
        f'  return amount * baseMultiplier;\n'
        f'}}'
    )


def _build_rule_description(card: dict) -> str:
    """Build a description from the card's earn_rates."""
    earn_rates = card.get("earn_rates", {})
    general = earn_rates.get("general", "")
    category = earn_rates.get("category_specific", "")
    parts = [p for p in [general, category] if p]
    return "; ".join(parts) if parts else card.get("rewards_program", "")


def upload_cards():
    if not CARDS_PATH.exists():
        print(f"Local cards file not found at {CARDS_PATH}")
        return

    with open(CARDS_PATH) as f:
        cards = json.load(f)

    print(f"Loaded {len(cards)} cards from {CARDS_PATH}")

    # Initialize Firebase
    try:
        if not firebase_admin._apps:
            if FIREBASE_CREDENTIALS_PATH:
                cred = credentials.Certificate(FIREBASE_CREDENTIALS_PATH)
                firebase_admin.initialize_app(cred)
            else:
                firebase_admin.initialize_app()
        db = firestore.client()
    except Exception as e:
        print(f"Failed to initialize Firebase: {e}")
        print("Please ensure you have configured your Firebase credentials correctly.")
        return

    # Get existing cards to avoid duplicates
    collection_ref = db.collection('known_cards')
    existing_docs = collection_ref.stream()
    existing_ids = {doc.id for doc in existing_docs}
    print(f"Found {len(existing_ids)} existing cards in Firestore.")

    rules_ref = db.collection('rules')
    now_ts = datetime.datetime.now(datetime.timezone.utc)

    batch = db.batch()
    count = 0

    print("Uploading to 'known_cards' and 'rules' collections in Firestore...")
    for card in cards:
        card_id = card.get('id')
        if not card_id:
            print(f"Skipping card without an ID: {card.get('name', 'Unknown')}")
            continue

        if card_id in existing_ids:
            continue

        region = card.get('region', '')
        country = REGION_TO_ISO.get(region, "USA")
        image_url = CARD_IMAGES.get(card_id, "")

        # --- Step 1: Create a rule document in the 'rules' collection ---
        rule_doc_ref = rules_ref.document()  # auto-generate ID
        rule_id = rule_doc_ref.id

        rule_data = {
            "cardParams": {
                "baseMultiplier": 1,
                "highMultiplier": 2,
            },
            "code": _build_rule_code(card),
            "createdAt": now_ts,
            "description": _build_rule_description(card),
            "isSystemDefault": False,
            "testTransactions": [],
            "uid": "admin",
        }
        batch.set(rule_doc_ref, rule_data)

        # --- Step 2: Create the card document in 'known_cards' ---
        card_doc_data = {
            "cardParams": {
                "annualFee": card.get("annual_fee", 0),
            },
            "name": card.get("name", ""),
            "issuer": card.get("issuer", ""),
            "description": card.get("rewards_program", ""),
            "fee": card.get("annual_fee", 0),
            "image": image_url,
            "id": card_id,
            "country": country,
            "region": region,
            "currency": card.get("currency", ""),
            "rewards_program": card.get("rewards_program", ""),
            "earn_rates": card.get("earn_rates", {}),
            "signup_bonus": card.get("signup_bonus"),
            "perks": card.get("perks", []),
            "best_for": card.get("best_for", []),
            "typical_cardholder": card.get("typical_cardholder", ""),
            "foreign_transaction_fee_pct": card.get("foreign_transaction_fee_pct", 0),
            "enforcedRule": rule_id,
            "deleted": False,
            "createdAt": firestore.SERVER_TIMESTAMP,
            "updatedAt": firestore.SERVER_TIMESTAMP,
            "ruleHistory": [
                {
                    "createdAt": now_ts,
                    "createdBy": "system",
                    "ruleId": rule_id,
                    "version": 1,
                }
            ],
        }

        card_doc_ref = collection_ref.document(card_id)
        batch.set(card_doc_ref, card_doc_data)
        count += 1

        # Commit batch every 200 (each card = 2 writes, Firestore limit is 500)
        if count % 200 == 0:
            batch.commit()
            print(f"Committed {count} cards ({count * 2} writes)...")
            batch = db.batch()

    if count > 0 and count % 200 != 0:
        batch.commit()

    print(f"Successfully uploaded {count} cards (with {count} rules) to Firebase.")


if __name__ == "__main__":
    upload_cards()
