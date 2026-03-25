import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent
ENV_FILE_PATH = PROJECT_ROOT / ".env"
DEV_ENV_FILE_PATH = PROJECT_ROOT / ".env.dev"
PROD_ENV_FILE_PATH = PROJECT_ROOT / ".env.prod"
LOADED_ENV_FILE: Path | None = None

try:
    from dotenv import load_dotenv
    if DEV_ENV_FILE_PATH.exists():
        load_dotenv(DEV_ENV_FILE_PATH)
        LOADED_ENV_FILE = DEV_ENV_FILE_PATH
    if ENV_FILE_PATH.exists():
        load_dotenv(ENV_FILE_PATH, override=True)
        LOADED_ENV_FILE = ENV_FILE_PATH
except ImportError:
    pass

IS_CLOUD_RUNTIME = bool(os.environ.get("K_SERVICE") or os.environ.get("FUNCTION_TARGET"))
APP_ENV = os.environ.get("LINEX_ENV", "production" if IS_CLOUD_RUNTIME else "development").strip().lower()

PRODUCTION_FIREBASE_PROJECT_ID = "linexonewhitelabeler"
DEVELOPMENT_FIREBASE_PROJECT_ID = "linexone-dev"
PRODUCTION_STORAGE_BUCKET = "linexonewhitelabeler-portfolio-uploads"
DEVELOPMENT_STORAGE_BUCKET = "linexone-dev-portfolio-uploads"

# Gemini API
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
MODEL = os.environ.get("AGENT_MODEL", "gemini-2.0-flash")

# Data paths (testing only)
DATA_DIR = PROJECT_ROOT / "data"
TEST_USERS_DIR = DATA_DIR / "test-users"

# Card catalog
CARDS_PATH = PROJECT_ROOT / "cards" / "cards.json"

# Firebase
FIREBASE_CREDENTIALS_PATH = os.environ.get("FIREBASE_CREDENTIALS_PATH", "linexonewhitelabeler-firebase-adminsdk-fbsvc-3b7f1d399f.json")
FIREBASE_PROJECT_ID = os.environ.get(
    "GCLOUD_PROJECT",
    PRODUCTION_FIREBASE_PROJECT_ID if APP_ENV == "production" else DEVELOPMENT_FIREBASE_PROJECT_ID,
)
FIREBASE_STORAGE_BUCKET = os.environ.get(
    "FIREBASE_STORAGE_BUCKET",
    PRODUCTION_STORAGE_BUCKET if APP_ENV == "production" else DEVELOPMENT_STORAGE_BUCKET,
)


def writes_allowed() -> bool:
    """Block non-production environments from mutating the production Firebase project."""
    return not (
        APP_ENV != "production" and FIREBASE_PROJECT_ID == PRODUCTION_FIREBASE_PROJECT_ID
    )


def write_block_reason() -> str:
    return (
        f"Write blocked: LINEX_ENV={APP_ENV!r} is configured against production Firebase "
        f"project {PRODUCTION_FIREBASE_PROJECT_ID!r}. Point GCLOUD_PROJECT at "
        f"{DEVELOPMENT_FIREBASE_PROJECT_ID!r} for development."
    )


def dev_credentials_error() -> str | None:
    """Return a startup error when local development credentials are missing or unsafe."""
    if APP_ENV != "development":
        return None
    if not FIREBASE_CREDENTIALS_PATH:
        return "FIREBASE_CREDENTIALS_PATH is required for local development."
    cred_path = Path(FIREBASE_CREDENTIALS_PATH).expanduser()
    if not cred_path.exists():
        return f"FIREBASE_CREDENTIALS_PATH does not exist: {cred_path}"
    if "linexonewhitelabeler" in cred_path.name.lower():
        return (
            f"FIREBASE_CREDENTIALS_PATH appears to point at production credentials: {cred_path}. "
            "Use a linexone-dev service account."
        )
    return None


def local_write_safety_error() -> str | None:
    """Return a safety error for local scripts or dev servers before any Firebase writes."""
    cred_error = dev_credentials_error()
    if cred_error:
        return cred_error
    if not writes_allowed():
        return write_block_reason()
    return None

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
