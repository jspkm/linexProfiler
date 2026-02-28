# qu — Linex Profiler Quant Agent

A financial profiling agent for the Linex loyalty platform. Analyzes transaction histories to build demographic/behavioral profiles and recommend optimal credit cards.

## Architecture

```
linexProfiler/
├── backend/          Python API (Firebase Cloud Functions + Flask dev server)
│   ├── analysis/     Feature engineering, profiling, card matching
│   ├── cards/        Credit card catalog and uploader
│   ├── models/       Pydantic models (features, profile, recommendation)
│   ├── prompts/      LLM system prompts
│   ├── utils/        Formatters and TOON serialization
│   ├── main.py       Firebase Cloud Functions entry point
│   ├── dev_server.py Local Flask dev server
│   ├── server.py     MCP server (for IDE integration)
│   └── config.py     Environment config
├── web/              Next.js frontend (static export)
│   └── src/app/      Pages and components
├── firebase.json     Firebase Hosting + Functions config
└── .firebaserc       Firebase project config
```

**Backend** — Python. Processes transactions through a pipeline: parse → clean → compute features → LLM profile → match cards. All LLM calls use the Gemini API.

**Frontend** — Next.js (static export). Calls the backend API endpoints to analyze test users or uploaded CSVs.

## Prerequisites

- Python 3.10+
- Node.js 18+
- A [Gemini API key](https://aistudio.google.com/apikey)
- Firebase CLI (`npm install -g firebase-tools`) — for deployment only

## Local Dev Setup

### 1. Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
pip install flask flask-cors python-dotenv
```

Create `backend/.env`:

```
GEMINI_API_KEY=your-key-here
```

### 2. Frontend

```bash
cd web
npm install
```

## Development

Run both servers in separate terminals:

**Terminal 1 — Backend** (Flask dev server on `:5050`):

```bash
cd backend
source venv/bin/activate
python dev_server.py
```

**Terminal 2 — Frontend** (Next.js dev server on `:3000`):

```bash
cd web
npm run dev
```

The frontend automatically routes API calls to `localhost:5050` in development mode.

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`  | `/list_test_users` | List available test user IDs |
| `POST` | `/analyze_test_user` | Analyze a test user by ID |
| `POST` | `/analyze_transactions` | Analyze uploaded transactions |
| `POST` | `/ask_test_user` | Ask a question about a test user |
| `POST` | `/ask_qu` | Ask a question about uploaded transactions |

### MCP Server

The backend also runs as an MCP server for IDE integration:

```bash
cd backend
source venv/bin/activate
python server.py
```

## Deploying

Deploy both frontend and backend to Firebase:

```bash
# Build the frontend static export
cd web
npm run build

# Deploy everything from the project root
cd ..
firebase deploy
```

This deploys:
- **Cloud Functions** from `backend/` (Python)
- **Hosting** from `web/out/` (static files) with `/api/*` rewrites to Cloud Functions

To deploy only functions or hosting:

```bash
firebase deploy --only functions
firebase deploy --only hosting
```

## Test Users

Place test user CSVs in `backend/data/test-users/` as `test-user-{id}.csv`. Each CSV should have columns: `InvoiceNo`, `StockCode`, `Description`, `Quantity`, `InvoiceDate`, `UnitPrice`, `CustomerID`, `Country`.
