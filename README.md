# GrowthEngine
Instagram growth tool: Express + PostgreSQL + Redis/BullMQ API with a React + TypeScript (Vite, Recharts) frontend in `web/`.

**Features:** JWT auth (ToS-gated signup, login lockout), dashboard KPIs, post import (CSV/JSON/Instagram), competitor tracking (queued, audit-logged, 1h cache, 200/hr, 30-day retention), one-shot AI assistant (analytics, finance split, tips, images), AI captions/hashtags, async image generation (Replicate + sharp text overlay), scheduling + publisher, Finance & Capital planner, encrypted per-user API keys (actually used), GDPR export/delete.

**Pages:** Dashboard, My Account (post table, ER heatmap, type chart), Competitors, Content AI, Scheduling, Finance & Capital, Settings (post import, API keys, privacy), Roadmap.

## Required configuration
The API **exits at boot** with a clear message if these are missing or malformed: `JWT_SECRET` (32+ chars), `ENCRYPTION_KEY` (exactly 64 hex chars), `DATABASE_URL`. Copy `.env.example` to `.env` and fill them in.

    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"    # run twice: JWT_SECRET and ENCRYPTION_KEY

## Run with Docker
    cp .env.example .env     # set JWT_SECRET and ENCRYPTION_KEY
    docker compose up --build
    docker compose exec api node src/seed.js    # demo@growthengine.ai / demo1234

## Run on Windows without Docker
1. Install Node 20+, PostgreSQL 16 (set a password for `postgres`) and a Redis-compatible server (Memurai Developer, or Redis inside WSL2).
2. Create the database (PowerShell): `psql -U postgres -c "CREATE USER ge WITH PASSWORD 'ge' SUPERUSER" -c "CREATE DATABASE ge OWNER ge"`
3. `copy .env.example .env`, then set `JWT_SECRET`, `ENCRYPTION_KEY` (command above); the default `DATABASE_URL` and `REDIS_URL` already match steps 1-2.
4. Load the env vars into your shell (PowerShell): `Get-Content .env | ForEach-Object { if ($_ -match '^\s*([^#=]+)=(.*?)(\s+#.*)?$') { [Environment]::SetEnvironmentVariable($Matches[1].Trim(), $Matches[2].Trim()) } }`
5. `npm install`, `npm run migrate`, `npm run seed`, `npm run dev` (API on :3000, `INLINE_WORKER=1` runs the workers in-process).
6. Frontend: `cd web`, `npm install`, `npm run dev` (http://localhost:5173, proxies `/api` to :3000).

## Tests
    npm test            # unit tests (crypto, advisor, config, importer)
    cd web && npm run build

## API quick tour
    TOKEN=$(curl -s localhost:3000/api/auth/login -H 'content-type: application/json' -d '{"email":"demo@growthengine.ai","password":"demo1234"}' | jq -r .token)
    curl -H "Authorization: Bearer $TOKEN" localhost:3000/api/dashboard
    # import your own posts (duplicates are skipped; response shows imported / duplicates / invalid)
    curl -H "Authorization: Bearer $TOKEN" -H 'content-type: text/csv' --data-binary @posts.csv localhost:3000/api/import/posts
    curl -H "Authorization: Bearer $TOKEN" localhost:3000/api/import/status
    # images are queued: POST returns {jobId}; poll until status is done/failed
    curl -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"prompt":"coffee cup on marble","ratio":"4:5","overlayText":"New Menu"}' localhost:3000/api/content/image
    curl -H "Authorization: Bearer $TOKEN" localhost:3000/api/content/image/<jobId>
`GET /health` is liveness; `GET /ready` also checks Postgres and Redis.

CSV columns (case-insensitive, common aliases accepted): `date`, `type` (reel / carousel / image), `likes`, `comments`, `saves`, `shares`, `reach` (required), `impressions`, `watch_s`, `caption`.

## Limits (per user, Redis)
Assistant 30/h · images 20/h (assistant images count too) · captions + hashtags 60/h combined · import 20/h · login: 10 failures per email+IP locks that pair for 15 min. Over the limit returns `429` with `Retry-After`.

## Deploy (Render)
Push the repo, New → Blueprint, fill the `sync:false` env vars. **`ENCRYPTION_KEY` is mandatory.** Changing it later makes already-stored API keys unreadable (users must re-save them).

## Integration points
- `src/worker.js`: `fetchProfile` uses Business Discovery when `IG_*` is set, else demo data; `processImport` / `processImage` are the import and image jobs. The image result is a base64 data URI today: replace it with an S3/CDN upload at the marked swap point.
- `src/images.js`: ProductAI's model registry, reference-image routing and fallback chain.
- `src/assistant.js`: one-shot assistant; with an LLM key it picks one action from live page metrics, otherwise regex rules decide. Assistant-generated images are still synchronous (see docs/AI_PROGRESS.md).
- Not built yet: webhooks, TimescaleDB aggregates, S3 storage, and Phases 1-4 of the roadmap (see `docs/`).
