# GrowthEngine / RaidTechs - instructions for AI coding agents

Instagram growth and posting-automation tool. Node (ESM) + Express 4 + PostgreSQL + Redis/BullMQ API in `src/`, React + TypeScript (Vite) frontend in `web/`. Owner: Mohammad Moghnieh. The product's point is data-driven "best approach" recommendations (tags, timing, formats), not generic LLM advice.

## Read first, in this order

1. `docs/ROADMAP_v4.md` - the plan (Track I, phases I.0 to I.7), corrections to earlier docs (section 0), and the working protocol (section 8). It is the source of truth for what to build next.
2. `docs/AI_PROGRESS.md` - the ledger: what is verified and what is not.
3. `docs/AI_DECISIONS.md` - numbered decisions. Next free number: **106**.
4. `README.md` and `db/schema.sql`.

Ready-made prompts for each phase are in `docs/KICKOFF_PROMPTS.md`.

## Hard rules

- **One phase at a time. Stop after each phase** and report; the owner confirms the gate before the next phase starts.
- **Evidence labels, exactly:** `VERIFIED`, `API VERIFIED BY SMOKE`, `IMPLEMENTED - UNVERIFIED`, `NOT STARTED / BLOCKED`. State the command, environment and result. Do not claim a stronger label than the environment you actually used supports (no Postgres/Redis means no "API VERIFIED BY SMOKE"). Do not repeat an old test count without running the tests.
- **Data decides, the LLM words it.** Tags, times and formats come from measured data; the LLM writes captions and explanations, never numbers. Never invent numbers. Say when there is not enough data and what would unlock a recommendation.
- **Official APIs only.** No HTML scraping, no logged-in browsing, no unofficial endpoints.
- **Human approval before publishing** by default. Autopilot is opt-in.
- **Secrets:** never ask users to paste tokens or keys; never commit `.env`. If a secret appears in pasted material, tell the owner to rotate it.
- **Do not change anything outside the current phase.** Record any decision you make in `docs/AI_DECISIONS.md` (number 106 onward, marked PROPOSED unless the owner confirmed it).

## Conventions that are easy to miss

- `routes.js` uses one-line handlers and the `wrap` helper (Express 4 does not catch async errors). Per-user limits use `limit()`/`hit()`; per-user keys use `keyFor` and `llmConfig`.
- Put logic in pure modules with the DB function `q` injected, so tests use a fake. Follow `src/commentintel.js` and `src/competitorintel.js`.
- All LLM calls go through `llmChat` with JSON mode and a deterministic fallback; a 503 must never become a blank screen or an opaque 500. User-facing errors are written in code, never copied from upstream.
- Migrations: additive and idempotent in `db/schema.sql` (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`), applied by `npm run migrate`.
- **New tables must cascade on account delete and be added to `GET /api/gdpr/export` in `src/routes.js` (hard-coded list) in the same patch.**
- **New test files must be appended to the `test` script in `package.json`**, or they never run. Smoke scripts: `scripts/smoke-<phase>.sh`.
- Post `type` values in the DB are `IMAGE`, `REEL`, `CAROUSEL_ALBUM`; compare case-insensitively. Null metrics stay null, never 0.
- Expect Arabic and mixed Arabic/English captions; extraction must be Unicode-aware.

## Commands

```
npm install
npm run migrate        # apply db/schema.sql
npm run seed           # demo data (demo@growthengine.ai / demo1234)
npm run dev            # API on :3000 (INLINE_WORKER=1 runs workers in-process)
npm run worker
npm test               # explicit file list in package.json
node --check src/<file>.js
cd web && npm install && npm run build
```

Required env: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET` (32+ chars), `ENCRYPTION_KEY` (64 hex chars). See `.env.example`. Production is Render; variables live in the Render dashboard. The owner develops on Windows 11 with native Postgres and Redis (Memurai), no Docker: give PowerShell-friendly commands for anything the owner must run.

## Reporting

Finish each phase with: what was built, files changed, commands run and results, what stays UNVERIFIED and why (name the blocker), decisions added, and the next item. Deliver a branch and pull request (or a git diff patch against a stated commit if you cannot push).
