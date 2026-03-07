import os
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent / ".env")
except ImportError:
    pass

PROJECT_ROOT = Path(__file__).parent

# Gemini API
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
MODEL = os.environ.get("QU_MODEL", "gemini-2.0-flash")

# Data paths (testing only)
DATA_DIR = PROJECT_ROOT / "data"
TEST_USERS_DIR = DATA_DIR / "test-users"

# Card catalog
CARDS_PATH = PROJECT_ROOT / "cards" / "cards.json"

# Firebase
FIREBASE_CREDENTIALS_PATH = os.environ.get("FIREBASE_CREDENTIALS_PATH", "linexonewhitelabeler-firebase-adminsdk-fbsvc-3b7f1d399f.json")

# Preprocessing
EXCLUDED_STOCK_CODES = frozenset({
    "POST", "D", "M", "ADJUST", "C2", "DOT", "BANK CHARGES",
    "PADS", "TEST001", "TEST002", "AMAZONFEE", "CRUK",
})
MAX_REASONABLE_QUANTITY = 5000

# Profile Generator
PROFILE_CATALOG_DIR = DATA_DIR / "profile_catalogs"  # DEPRECATED: used only by migration script
EXPERIMENT_DIR = DATA_DIR / "experiments"  # DEPRECATED: used only by migration script
DEFAULT_K = 10
DEFAULT_TIME_WINDOW = "Q"  # quarterly
