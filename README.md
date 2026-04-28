# RE-AI-Agent

Real Estate AI Agent for scraping Polish property listings, enriching them with AI scoring, storing them in PostgreSQL, and reviewing offers in a React dashboard.

## Workflow Versioning

The active n8n workflow is versioned with semantic versions in `x.y.z` format.

- Canonical source: `n8n/workflows/Real Estate AI Agent.json`
- Visible checks after import: workflow name, version sticky note, and disconnected metadata node

Restamp the workflow using the version already embedded in the metadata node:

```bash
node scripts/bump-workflow-version.js
```

Bump to a new version and restamp the workflow:

```bash
node scripts/bump-workflow-version.js 1.0.1
```

After importing the workflow into n8n, confirm that the workflow name stays `Real Estate AI Agent` and that the `Workflow Metadata - v...` node matches the expected version.

## What This Project Does

- Scrapes listing portals with n8n workflows.
- Normalizes offer data into a shared schema.
- Stores and updates offers in PostgreSQL.
- Exposes filtered data and statistics through FastAPI.
- Lets you review offers in a React + MUI dashboard.

## Tech Stack

- n8n (automation + scraping flow)
- PostgreSQL 15 (data store)
- FastAPI + asyncpg (backend API)
- React + MUI + Recharts (frontend)
- Docker Compose (local orchestration)

## Architecture

Data flow:

1. Schedule Trigger in n8n
2. HTTP Request: fetch list page HTML
3. Code node: parse offers from list page
4. HTTP Request: fetch offer details page
5. Code node: merge metadata + detail HTML
6. AI Agent node: generate score + summary
7. PostgreSQL node: upsert into `rea_property_offers`
8. FastAPI serves offers and stats to frontend

## Repository Structure

- [docker-compose.yml](docker-compose.yml): local stack (postgres, n8n, api, frontend)
- [n8n/parsers/oto-parser.js](n8n/parsers/oto-parser.js): Otodom list parser
- [n8n/parsers/no-parser.js](n8n/parsers/no-parser.js): Nieruchomosci Online list parser
- [sql/rea_property_offers.sql](sql/rea_property_offers.sql): table DDL
- [sql/add_offer.sql](sql/add_offer.sql): insert/upsert snippet for n8n SQL node
- [rea-fe/api/main.py](rea-fe/api/main.py): FastAPI backend
- [rea-fe/api/requirements.txt](rea-fe/api/requirements.txt): backend dependencies
- [rea-fe/frontend/package.json](rea-fe/frontend/package.json): frontend scripts and dependencies

## Prerequisites

- Docker + Docker Compose
- (Optional local dev without Docker)
	- Python 3.10+
	- Node.js 18+

## Environment Variables

Copy and edit:

```bash
cp .env.example .env
```

Required variables:

- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_DB`
- `N8N_ENCRYPTION_KEY`

## Quick Start (Docker Compose)

1. Create env file:

```bash
cp .env.example .env
```

2. Start all services:

```bash
docker compose up -d --build
```

PostgreSQL is exposed on `localhost:5433` to avoid conflicts with another local service using `5432`.

3. Initialize database schema:

```bash
docker exec -i postgres-db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < sql/rea_property_offers.sql
```

4. Open apps:

- Frontend: http://localhost:3000
- API docs: http://localhost:3001/docs
- n8n: http://localhost:5678
- PostgreSQL from host: localhost:5433

## Local Development (without Docker)

### Backend

```bash
cd rea-fe/api
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export POSTGRES_USER=pg_user
export POSTGRES_PASSWORD=pg_password
export POSTGRES_DB=pg_data
export POSTGRES_HOST=localhost
# Optional when reusing the Docker Compose database from the host.
export POSTGRES_PORT=5433
uvicorn main:app --host 0.0.0.0 --port 3001 --reload
```

### Frontend

```bash
cd rea-fe/frontend
npm install
REACT_APP_API_URL=http://localhost:3001 npm start
```

## n8n Parser Notes

### Otodom

- Source: Next.js data embedded in script JSON (`pageProps`).
- Parser: [n8n/parsers/oto-parser.js](n8n/parsers/oto-parser.js).
- Typical ID strategy: `OT-<id>` or MD5 hash from URL.

### Nieruchomosci Online

- Source: HTML links extracted with regex.
- Parser: [n8n/parsers/no-parser.js](n8n/parsers/no-parser.js).
- ID pattern: `NO-<numeric_id>`.

## Database

Main table: `rea_property_offers`

Key columns include:

- `external_id` (primary key)
- `category`, `url`, `title`
- `price`, `price_per_m2`, `area`, `lot_size`, `construction_year`
- `ai_rating`, `ai_analysis_html`
- `user_rating`, `user_notes`
- `created_at`, `last_seen_at`, `sent_at`

See full schema in [sql/rea_property_offers.sql](sql/rea_property_offers.sql).

## API Endpoints

Base URL: `http://localhost:3001`

- `GET /api/offers`: list offers with filters/sorting/pagination
- `GET /api/offers/{external_id}`: get offer details
- `PATCH /api/offers/{external_id}`: update `user_rating` and/or `user_notes`
- `GET /api/stats`: aggregate statistics for dashboard charts
- `GET /api/categories`: distinct categories list

Supported `sort_by` values:

- `created_at`, `price`, `price_per_m2`, `area`, `ai_rating`, `title`

Allowed `user_rating` values:

- `like`, `dislike`, `pending`

## Typical Workflow in n8n

1. Pull list page HTML.
2. Parse listing entries in Code node.
3. Loop over URLs and fetch detail pages.
4. Merge listing metadata with detail HTML.
5. Send data to AI node for score/summary.
6. Upsert into PostgreSQL using conflict-safe SQL.

## Troubleshooting

- Empty parser output:
	- Validate HTTP node response format (String vs File).
	- Re-check parser regex/path assumptions against latest portal HTML.
- Duplicate key errors:
	- Use `ON CONFLICT (external_id) DO NOTHING` or `DO UPDATE`.
- Frontend cannot fetch API:
	- Verify `REACT_APP_API_URL` and API container status.
- API cannot connect to Postgres:
	- Verify `POSTGRES_*` variables and host (`postgres` in Docker, `localhost` locally). If you are connecting from the host into the Dockerized database, use port `5433`.

## License

Internal project. Add a formal license if you plan to publish the repository.
