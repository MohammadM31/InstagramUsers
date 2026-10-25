# GrowthEngine
Instagram growth tool: Express + PostgreSQL + Redis/BullMQ API with a React + TypeScript (Vite, Recharts) frontend in `web/`.

**Features:** JWT auth (ToS-gated signup, login lockout), dashboard KPIs, post import (CSV/JSON/Instagram), competitor tracking (queued, audit-logged, 1h cache, 200/hr, 30-day retention), one-shot AI assistant (analytics, finance split, tips, images), AI captions/hashtags, async image generation (Replicate + sharp text overlay), scheduling + publisher, Finance & Capital planner, encrypted per-user API keys (actually used), GDPR export/delete.

**Pages:** Dashboard, Statistics (post table, ER heatmap, type chart), Competitors, Content AI, Scheduling, Finance & Capital, Settings (post import, API keys, privacy), Roadmap.

## Required configuration
The API **exits at boot** with a clear message if these are missing or malformed: `JWT_SECRET` (32+ chars), `ENCRYPTION_KEY` (exactly 64 hex chars), `DATABASE_URL`. Copy `.env.example` to `.env` and fill them in.

    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"    # run twice: JWT_SECRET and ENCRYPTION_KEY

## Platform roles and the owner account (R.0)
Every user has a platform role: `user` (a normal customer), `support`, `admin` or `owner`. Staff open the admin area at `/admin` (the "Admin" entry appears at the bottom of the sidebar only for staff). **Nobody can sign up as staff.** The first owner is created like this:

1. Sign up normally in the app with the email address you will use as owner.
2. In `.env`, set `OWNER_EMAIL=` to exactly that email address.
3. Restart the server. It logs `OWNER_EMAIL: ... is now the platform owner`. Restarting again changes nothing.

If `OWNER_EMAIL` is empty the server logs a warning at every start and nobody can open `/admin`. If it is set but nobody has signed up with that email yet, the server logs that too and does nothing; sign up, then restart.

`npm run migrate` now also applies `db/schema.rbac.sql` (and any other `db/schema.<name>.sql`). `npm run check:admin` fails if any admin route lacks a permission check. The `curl.exe` commands for these routes are in `docs/RBAC_R0.md`.

## Run with Docker
    cp .env.example .env     # set JWT_SECRET and ENCRYPTION_KEY
    docker compose up --build
    docker compose exec api node src/seed.js    # demo@growthengine.ai / demo1234

## Run on Windows without Docker
1. Install Node 20.12+ (22 or newer recommended; the `.env` file is loaded by `src/loadenv.js`, which needs `process.loadEnvFile`), PostgreSQL 16 (set a password for `postgres`) and a Redis-compatible server (Memurai Developer, or Redis inside WSL2).
2. Create the database (PowerShell): `psql -U postgres -c "CREATE USER ge WITH PASSWORD 'ge' SUPERUSER" -c "CREATE DATABASE ge OWNER ge"`
3. `copy .env.example .env`, then set `JWT_SECRET`, `ENCRYPTION_KEY` (command above); the default `DATABASE_URL` and `REDIS_URL` already match steps 1-2.
4. `npm install`, `npm run migrate`, `npm run seed`, `npm run dev` (API on :3000, `INLINE_WORKER=1` runs the workers in-process).
5. Frontend: `cd web`, `npm install`, `npm run dev` (http://localhost:5173, proxies `/api` to :3000).

## Tests
    npm test            # unit tests (crypto, advisor, config, importer, phase 1+2 logic, import job, schedule, notifications)
    cd web && npm run build

## API quick tour
    TOKEN=$(curl -s localhost:3000/api/auth/login -H 'content-type: application/json' -d '{"email":"demo@growthengine.ai","password":"demo1234"}' | jq -r .token)
    curl -H "Authorization: Bearer $TOKEN" localhost:3000/api/dashboard
    # import your own posts (duplicates are skipped; response shows imported / duplicates / invalid)
    curl -H "Authorization: Bearer $TOKEN" -H 'content-type: text/csv' --data-binary @posts.csv localhost:3000/api/import/posts
    curl -H "Authorization: Bearer $TOKEN" localhost:3000/api/import/status
    # newer export of posts you already imported? add ?update=1 to refresh their likes/reach/etc. (response adds "updated")
    curl -H "Authorization: Bearer $TOKEN" -H 'content-type: text/csv' --data-binary @posts.csv 'localhost:3000/api/import/posts?update=1'
    # Phase 1: ranked tips with why + metric to watch, what the AI knows (and lacks), marketing methods (estimates)
    curl -H "Authorization: Bearer $TOKEN" localhost:3000/api/priorities
    curl -H "Authorization: Bearer $TOKEN" localhost:3000/api/ai/context
    curl -H "Authorization: Bearer $TOKEN" localhost:3000/api/marketing/breakdown
    # Phase 2: GET /api/posts/:id/analysis (text, delta, rank); GET /api/notifications, PATCH /api/notifications/:id|read-all, DELETE /api/notifications/:id
    curl -H "Authorization: Bearer $TOKEN" localhost:3000/api/notifications
    # images are queued (Content AI and the assistant alike): POST returns {jobId}; poll until status is done/failed
    curl -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"prompt":"coffee cup on marble","ratio":"4:5","overlayText":"New Menu"}' localhost:3000/api/content/image
    curl -H "Authorization: Bearer $TOKEN" localhost:3000/api/content/image/<jobId>
    # O.3 brand voice: GET/PUT /api/voice (every save is a new version), POST /api/voice/samples, DELETE /api/voice/samples/:id, POST /api/onboarding/voice/generate
    curl -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"tone_tags":["warm","witty"],"emoji_use":"low","consent":false}' localhost:3000/api/onboarding/voice/generate
    # O.4 goal progress: GET /api/goal (percent from the stored starting value to the target, pace, the data it used)
    # 4.2 editable replies: POST /api/responses/save {original,edited}, GET /api/responses, DELETE /api/responses/:id
`GET /health` is liveness; `GET /ready` also checks Postgres and Redis.

CSV columns (case-insensitive, common aliases accepted): `date`, `type` (reel / carousel / image), `likes`, `comments`, `saves`, `shares`, `reach` (required), `impressions`, `watch_s`, `caption`.

**Dates:** use ISO (`2026-10-01` or `2026-10-01T10:00:00Z`). Slash dates are accepted only when unambiguous (`13/10/2026` or `10/13/2026`); `01/10/2026` is rejected because it could be either, and the error says so. **Types:** reel, ig reel, carousel, image, photo and story are accepted (stories are stored as IMAGE). **Refresh imports (`?update=1`):** only the metrics present in the file are updated. A missing column or an empty cell leaves the stored value alone; an explicit `0` is a real 0. Posts are matched on date + type + caption, so a file without captions, or with date-only values, creates new rows instead of refreshing existing ones. Error lines in the response use the file's own numbering (CSV line numbers include the header).

Daily post snapshots (`post_snapshots`) and a per-user `metrics_baseline` are written by the worker (`INLINE_WORKER=1` or `npm run worker`). History only accumulates while a worker is running. Run `npm run migrate` after pulling: it adds both tables.

## Limits (per user, Redis)
Assistant 30/h · images 20/h (assistant images count too) · captions + hashtags 60/h combined · import 20/h · login: 10 failures per email+IP locks that pair for 15 min. Over the limit returns `429` with `Retry-After`.

## Deploy (Render)
Push the repo, New → Blueprint, fill the `sync:false` env vars. **`ENCRYPTION_KEY` is mandatory.** Changing it later makes already-stored API keys unreadable (users must re-save them).

## Integration points
- `src/worker.js`: `fetchProfile` uses Business Discovery with the user's own connected Instagram account, else demo data (demo data is never stored in competitor history); a daily job re-scrapes competitors (`competitor_history`, `GET /api/competitors/:id/history`); `processImport` (built in `src/importjob.js`) and `processImage` are the import and image jobs. The image result is a base64 data URI today: replace it with an S3/CDN upload at the marked swap point.
- `src/images.js`: ProductAI's model registry, reference-image routing and fallback chain.
- `src/assistant.js`: one-shot assistant; with an LLM key it picks one action from live page metrics, otherwise regex rules decide. Assistant-generated images are queued like Content AI's: the card polls `GET /api/content/image/:jobId` (`src/imagejobs.js` is shared by both).
- `src/brandvoice.js` (O.3): the saved brand voice (summary and options, never the raw example captions) is added to the assistant's and the caption/hashtag generator's prompts. With no voice the prompts are exactly what they were before. AI writes the voice summary only when the person has their own OpenAI key stored and ticks the consent box; otherwise a template summary is built from the chosen options.
- `src/storage.js` + `src/imageresult.js` (C.1): with the six `S3_*` variables set (any S3-compatible bucket, public read), each generated image is also converted to JPEG (Instagram takes JPEG only) and uploaded under an unguessable key; `GET /api/content/image/:jobId` then also returns `urls`. Without them nothing changes. Not built yet: video upload (C.1b), retention/delete-after-publish (needs C.2), webhooks, TimescaleDB aggregates. Roadmap progress lives in `docs/AI_PROGRESS.md`.
