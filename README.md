# Linex Terminal

Terminal and quant agents for the Linex loyalty platform. Learns behavioral profiles from transaction data, optimizes incentive programs through simulation, and provides an agent chat interface for portfolio management.

## Architecture

```
linex-terminal/
├── backend/                Python API (Firebase Cloud Functions + Flask dev server)
│   ├── analysis/           Feature engineering, profiling, card matching
│   ├── cards/              Credit card catalog and uploader
│   ├── models/             Pydantic models (features, profile, recommendation, incentive_set)
│   ├── profile_generator/  Profile learning pipeline (clustering, optimization, incentive mgmt)
│   │   ├── assigner.py         Profile assignment
│   │   ├── feature_derivation.py  Feature extraction from transactions
│   │   ├── feature_transform.py   Feature normalization/scaling
│   │   ├── firestore_client.py    Firestore persistence layer
│   │   ├── incentive_manager.py   Incentive set CRUD
│   │   ├── optimization.py        Incentive program optimization engine
│   │   ├── trainer.py             K-means clustering trainer
│   │   └── versioning.py          Catalog version management
│   ├── prompts/            LLM system prompts
│   ├── scripts/            Migration scripts
│   ├── tests/              pytest test suite
│   ├── utils/              Formatters and TOON serialization
│   ├── main.py             Firebase Cloud Functions entry point
│   ├── dev_server.py       Local Flask dev server
│   ├── server.py           MCP server (for IDE integration)
│   └── config.py           Environment config
├── web/                    Next.js frontend (static export)
│   └── src/
│       ├── app/
│       │   ├── page.tsx            Main app (agent chat, profiler, optimization views)
│       │   └── components/
│       │       ├── NavRail.tsx         Left sidebar navigation
│       │       ├── WorkflowCanvas.tsx  Workflow selection grid
│       │       ├── DataroomCanvas.tsx  Dataset management table
│       │       ├── Dropdown.tsx        Reusable dropdown component
│       │       ├── WelcomeCanvas.tsx   Welcome screen
│       │       └── theme.ts           Design tokens and constants
│       ├── lib/utils.ts        Tailwind class merge utility
│       └── __tests__/          Vitest test suite
├── firebase.json           Firebase Hosting + Functions config
└── .firebaserc             Firebase project config (dev/prod)
```

## Key Features

- **Profile Learning** — K-means clustering on behavioral axes (recency, frequency, spend, refund) to learn customer profiles from transaction data
- **Incentive Optimization** — Simulation engine to derive optimal incentive programs per profile with convergence detection
- **Agent Chat** — Conversational interface with structured actions for workflow management, CRUD operations, and grid column customization
- **Workflow Management** — Create, edit, delete custom workflows; built-in "Optimize portfolio" template
- **Dataroom** — Upload and manage portfolio datasets (CSV/XLSX)
- **Incentive Sets** — CRUD with cascade delete, default set management, and usage checking

## Prerequisites

- Python 3.10+ (Conda recommended)
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

Local backend startup defaults to `backend/.env.dev` when `backend/.env` is absent.

If you want a machine-specific override, create `backend/.env`:

```bash
cp backend/.env.dev backend/.env
```

The checked-in development defaults target the separate Firebase project `linexone-dev`, not production.

### 2. Frontend

```bash
cd web
npm install
```

Frontend local startup defaults to `web/.env.dev`. If you want a machine-specific override, create `web/.env.local`:

```bash
cp web/.env.dev web/.env.local
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

Or start both from the repo root:

```bash
npm run dev:all
```

Preflight the local setup without starting servers:

```bash
npm run dev:check
```

## Testing

### Backend (pytest)

```bash
cd backend
pip install -e ".[dev]"
pytest
```

### Frontend (Vitest)

```bash
cd web
npm test              # single run
npm run test:watch    # watch mode
```

### Linting

```bash
cd web
npm run lint          # ESLint
npx tsc --noEmit     # TypeScript type check
```

## Environment Split

Use configuration, not branches, to separate local development from production:

- `backend/.env`: optional machine-specific override, if you need one
- `backend/.env.dev`: tracked development env template
- `backend/.env.prod`: tracked production reference template
- `web/.env.dev`: tracked local frontend API base URL
- `web/.env.local`: optional machine-specific frontend override
- Firebase Hosting in production: frontend uses `/api` rewrites from `firebase.json`

Frontend behavior:

- Local dev: set `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:5050/linexone-dev/us-central1`
- Production on Firebase Hosting: leave `NEXT_PUBLIC_API_BASE_URL` unset so the app uses `/api`
- Production outside Firebase Hosting: set `NEXT_PUBLIC_API_BASE_URL` to the deployed backend base URL

This means `main` can serve both environments without code edits.

Backend behavior:

- Local development defaults to `LINEX_ENV=development`
- Development Firebase project defaults to `GCLOUD_PROJECT=linexone-dev`
- Production defaults to `GCLOUD_PROJECT=linexonewhitelabeler` when running in Cloud Functions
- Non-production environments are blocked from write operations if they are pointed at the production Firebase project

## Firebase Projects

Use two separate projects:

- Development: `linexone-dev`
- Production: `linexonewhitelabeler`

For local work, keep `backend/.env.dev` valid or create a machine-specific `backend/.env`.

To inspect production settings without making them active locally, review `backend/.env.prod`.

For Firebase CLI commands, switch aliases explicitly:

```bash
firebase use dev
firebase use prod
```

## API Endpoints

### Transactions & Agent

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/analyze_transactions` | Analyze uploaded transactions |
| `POST` | `/agent_chat` | Agent chat with structured actions |
| `POST` | `/ask_agent` | Ask a question about uploaded transactions |

### Test Users

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`  | `/list_test_users` | List available test user IDs |
| `GET`  | `/analyze_test_user` | Analyze a test user by ID |
| `POST` | `/ask_test_user` | Ask a question about a test user |

### Profile Catalogs

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`  | `/list_profile_catalogs` | List all profile catalog versions |
| `GET`  | `/profile_catalog` | Get a specific profile catalog |
| `POST` | `/learn_profiles` | Learn profiles from transaction data |
| `POST` | `/fork_catalog` | Fork an existing catalog |
| `DELETE` | `/delete_catalog/{version}` | Delete a catalog version |

### Portfolio Datasets

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`  | `/list_portfolio_datasets` | List uploaded portfolio datasets |
| `POST` | `/create_portfolio_upload_url` | Get a signed URL for dataset upload |
| `DELETE` | `/delete_portfolio_dataset/{id}` | Delete a portfolio dataset |

### Optimization

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/start_optimize` | Start incentive optimization run |
| `GET`  | `/optimize_status/{id}` | Poll optimization progress |
| `GET`  | `/list_optimizations` | List saved optimizations |
| `GET`  | `/load_optimize/{id}` | Load a saved optimization result |
| `POST` | `/save_optimize/{id}` | Save an optimization |
| `POST` | `/cancel_optimize/{id}` | Cancel a running optimization |
| `DELETE` | `/delete_optimize/{id}` | Delete a saved optimization |

### Incentive Sets

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`  | `/list_incentive_sets` | List all incentive sets |
| `GET`  | `/incentive_set/{version}` | Get a specific incentive set |
| `POST` | `/create_incentive_set` | Create a new incentive set |
| `POST` | `/set_default_incentive_set` | Set the default incentive set |
| `PUT`  | `/update_incentive_set/{version}` | Update an incentive set |
| `DELETE` | `/delete_incentive_set/{version}` | Delete an incentive set (cascade) |
| `GET`  | `/check_incentive_set_usage/{version}` | Check if an incentive set is in use |

### Workflows

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`  | `/list_workflows` | List all workflows |
| `GET`  | `/get_workflow/{id}` | Get a specific workflow |
| `POST` | `/create_workflow` | Create a new workflow |
| `PUT`  | `/update_workflow/{id}` | Update a workflow |
| `DELETE` | `/delete_workflow/{id}` | Delete a workflow |

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
