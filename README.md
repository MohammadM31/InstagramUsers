# GrowthEngine API (Phase 1)
Express + Postgres + Redis/BullMQ. Auth (JWT, ToS-gated signup), dashboard KPIs, posts, competitors, queued scraping (audit-logged, 1h cache, 200/hr limit, 30-day retention), AI captions/hashtags, image generation via Replicate with sharp text overlay, encrypted API keys, GDPR export/delete.

## Run
    cp .env.example .env   # set ENCRYPTION_KEY=$(openssl rand -hex 32)
    docker compose up --build
    docker compose exec api node src/seed.js   # demo@growthengine.ai / demo1234
    npm test

## Try it
    TOKEN=$(curl -s localhost:3000/api/auth/login -H 'content-type: application/json' -d '{"email":"demo@growthengine.ai","password":"demo1234"}' | jq -r .token)
    curl -H "Authorization: Bearer $TOKEN" localhost:3000/api/dashboard
    curl -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"prompt":"coffee cup on marble","ratio":"4:5","overlayText":"New Menu"}' localhost:3000/api/content/image

## Deploy (Render): push repo, New → Blueprint, fill the `sync:false` env vars.

## Integration points
- `src/worker.js` fetchProfile: Business Discovery API when IG_* set, else demo data. Add a proxy scraper there only if you accept the ToS risk.
- `src/images.js`: swap Replicate call for your ProductAI service (Flux Kontext / Recraft routing) or add S3 storage.
- Not built yet: IG publishing, webhooks, TimescaleDB aggregates, React app.

## Frontend (web/) — React + TypeScript + Recharts
    cd web && npm install && npm run dev      # http://localhost:5173, proxies /api → :3000
`docker compose up` builds the frontend and the API serves it on :3000 (single-service deploy, works on Render).

Pages wired to live API data: Login/Register (ToS-gated), Dashboard (KPIs, engagement chart, insights), My Account (sortable post table, ER heatmap, type chart), Competitors (add/scrape/feed/strategy tips), Content AI (captions, images, hashtags → schedule), Scheduling (queue, retry, publisher log), Settings (encrypted keys, GDPR export/delete), Roadmap.
Publisher: runs every 30s; real Instagram publishing needs IG_ACCESS_TOKEN + a public image URL, otherwise posts are marked `demo-published`.
