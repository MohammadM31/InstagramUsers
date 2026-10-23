# GrowthEngine / RaidTechs - AI Roadmap v4: Handoff and Insight Engine

Where we left off, what is not built yet, and the phases for building the part that matters most: scraping and analyzing data (tags, timing, formats, competitors) so customers get the best approach for automated posting.

| Item | Value |
|---|---|
| Product | GrowthEngine API (app header: RaidTechs). Instagram growth and posting-automation tool. |
| Owner | Mohammad Moghnieh (independent developer). |
| Repository | github.com/MohammadM31/InstagramUsers, branch main, last commit `743cc7c` ("assistant tab"). Live site: instagramusers.onrender.com (Render). |
| Audience | The next working AI (primary), and the owner (review and decisions). |
| Relationship to earlier docs | Extends Roadmap v3 ("AI Handoff and Trace"). All v3 item IDs (0.x, 1.x, 2.x, 3.x, 4.x, A.x, B.x, C.x, D.x, O.x) keep their meaning. New work uses the prefix **I** (Intelligence), items I.0 to I.7. |
| Date | 23 October 2026. Ledger it builds on: `docs/AI_PROGRESS.md`. |
| Source | Converted from `GrowthEngine_AI_Roadmap_v4_Handoff.pdf`. Section 0 and the blocks marked **PROPOSED CONTRACT** were added during the conversion and checked against the repo at `743cc7c`. Everything else is the PDF content. |

**How to read this document.** Section 0 lists corrections to the PDF found in the repo; read it first. Section 2 says where we stopped. Section 4 says what is missing against the product goal. Section 6 is the phased plan (I.0 to I.7) with deliverables, tests and a gate per phase. Section 8 is the working protocol the next AI must follow. Anything marked **UNVERIFIED** was written or read but never run against a live stack; do not treat it as working.

## Contents

0. Corrections and additions (verified against the repo)
1. Product goal and principles
2. Where we left off
3. System map
4. Gap analysis against the product goal
5. Constraints and compliance
6. Phased plan: Track I (Intelligence)
7. Open decisions for the owner
8. Working protocol for the next AI
- Appendix A. Environment variables (names only)
- Appendix B. Verification checklist for I.0

---

## 0. Corrections and additions (verified against the repo)

Checked on 2026-10-23 against `743cc7c`. Where this section disagrees with the PDF text below, this section wins. Re-check anything here that matters before relying on it (section 8.1).

1. **The LLM patch is not applied and not in the repo.** `llmChat` appears 0 times in `src/keys.js`, `src/routes.js` and `src/assistant.js`, and `llm-retry-fallback.diff` is not in the repository (it exists only on the owner's machine). I.0.1 therefore cannot "confirm it is applied". Do one of: (a) the owner commits the diff to the repo (suggested: `docs/patches/`) and the AI applies it, or (b) the AI implements `llmChat` from the specification in section 2.3 and I.0.2. Record which one in the ledger.
2. **Decision numbering.** `docs/AI_DECISIONS.md` already contains decision **105** (the `web/index.html` title change). The **next free number is 106**, not 105. The PDF's "numbered up to 104" is out of date.
3. **Ledger dates.** `docs/AI_PROGRESS.md` says "Last checked 2026-10-17", while `docs/AI_DECISIONS.md` has entries dated 2026-10-18 (session 14). The progress ledger header and the item table may lag behind the decisions log; reconcile them in I.0.6.
4. **Time zone and niche data already exist.** `business_profile` (O.1) has `timezone`, `languages text[]`, `niche`, `niche_keywords text[]`, `posts_per_week` and goal columns. I.4.1 must use `business_profile.timezone` first and fall back to the browser-reported zone, not invent a new column.
5. **GDPR export and account delete are code, not config.** `GET /api/gdpr/export` in `src/routes.js` is a hard-coded list: tables with a `user_id` column go in its `for` loops, and tables without one use a JOIN (see `post_snapshots` and `competitor_history`). Account delete is `DELETE FROM users` plus the stored-images purge, so every new table needs `ON DELETE CASCADE` to `users`, directly or through its parent. Adding a table means editing both the migration and that export route in the same patch.
6. **New tests must be registered.** `npm test` runs an explicit file list in `package.json`. A new `test/*.test.js` file does not run until it is appended to the `test` script. Smoke scripts follow `scripts/smoke-<phase>.sh`.
7. **Competitor raw rows expire at 30 days.** `competitor_posts.expires_at` is `NOT NULL`. A derived table with a foreign key to `competitor_posts ... ON DELETE CASCADE` would lose its rows when the raw rows expire, which defeats decision D-I1 (keep derived rows 180 days). The proposed contract for I.1.2 below stores its own copy of the public counts and its own `expires_at`, with no foreign key to `competitor_posts`.
8. **`/api/priorities` already has a shape.** It returns `{ updatedAt, priorities: [{ priority, kind, key?, text, why, watch }], snoozed }`, and `priority_dismissals.tip_key` is the item's `kind`. The recommendation schema in I.4.5 uses `kind` for a different meaning. Keep every existing field and add the new ones (see the I.4.5 contract).
9. **Post types in the database** are `IMAGE`, `REEL` and `CAROUSEL_ALBUM`; stories are filed as `IMAGE` (importer). Compare types case-insensitively (see `isReel` in `src/advisor.js`). Story-specific advice cannot be derived from stored data.
10. **The publisher claims `status='scheduled'`** (`src/worker.js`, `UPDATE ... WHERE status='scheduled' AND scheduled_at<=now() ... FOR UPDATE SKIP LOCKED`, index `scheduled_due`). Approval states must keep `scheduled` meaning "approved and due-able" so the publisher query and index stay unchanged (see the I.6.1 contract).

---

## 1. Product goal and principles

**Purpose.** Make it easy for customers to automate posting on social media (today: Instagram).

**The real differentiator.** Automation is a commodity. What the customer should get from this product is the **best approach**: what to post, in which format, with which tags, at what time, and why. That is why the application scrapes and analyzes data (own posts, competitors, market tags) instead of asking an LLM for generic advice.

> **Honest status of that goal.** Posting automation exists in a basic form (schedule, publisher worker, image posts). The analysis half is thin: hashtags are produced by an LLM from a niche string only (`hashtagPrompt` in `src/brandvoice.js`: "Niche: ..."), not from scraped or measured data. Captions are stored but no tags are extracted, counted or scored. Track I exists to close this gap.

### Principles every phase must respect

- **Data decides, the LLM words it.** Selection of tags, times and formats comes from measured data. The LLM may write captions, labels and explanations, never numbers.
- **Explain every recommendation:** show the evidence (sample size, lift against the account baseline, source) and a confidence level.
- **Never invent numbers.** This rule already exists in the assistant prompt. Approximate values are labeled as estimates (see decision 82 for the pattern).
- **Say when there is not enough data** and what data would unlock the recommendation (existing endpoint `GET /api/ai/context` lists what the AI knows and lacks).
- **Human approval before publishing** by default. Autopilot is opt-in with guardrails (phase I.6).
- **Official APIs only.** No HTML scraping, no login automation, no unofficial endpoints (account-ban and terms risk for the client). See section 5.
- **Correlation, not proof.** Tag and timing effects are observational. The UI wording and the A/B tracking in I.5 must reflect that.

---

## 2. Where we left off

### 2.1 Snapshot

| Item | State |
|---|---|
| Stack | Backend: Node (ESM), Express 4, PostgreSQL (`pg`), Redis with BullMQ/ioredis, sharp. Frontend: React + TypeScript (Vite, Recharts) in `web/`. Deploy: Render (`render.yaml`, `Dockerfile`). Local dev: Windows 11, native Postgres and Memurai (Redis), no Docker assumed, Node 22 or newer recommended. |
| Entry points | `npm start` / `dev` (`src/server.js`), `npm run worker` (`src/worker.js`, or `INLINE_WORKER=1` to run workers inside the API), `npm run migrate`, `npm run seed`, `npm test`. |
| Queues (BullMQ) | scrape, import, image, igsync. A publisher loop runs every 30 s inside the worker and publishes due rows of `scheduled_posts`. |
| Tests | Last recorded in the ledger: `npm test` 252/252 (2026-10-17). Not re-run for this document. |
| Phase gates | Phase 0, 1, 2 confirmed by the owner (2026-10-13, 14, 15). Phase 3 and Phase 4 gates are open. |
| Frontend pages | Command Center, Dashboard, Statistics (post table, ER heatmap, type chart), Competitors, Content AI, Scheduling, Finance and Capital, Settings, Roadmap. Placeholder pages: Marketing, CRM, Ads, Collabs ("not built yet"). |
| Global AI chat | One component (`web/src/Assistant.tsx`) used twice: embedded on the Command Center (page mode) and as a global bottom chat on every other tab. Both call `POST /api/assistant` (one request in, one result out, no conversation state). |

### 2.2 What is verified and what is not

Source: `docs/AI_PROGRESS.md`. The next AI must re-check these statements against the repository before relying on them (section 8).

| Status | Items |
|---|---|
| **VERIFIED** (API run against live Postgres and Redis, UI confirmed by owner where noted) | 0.1, 0.1b, 0.2 (boot), 0.3, 0.7, 0.8 (image jobs), 1.1 to 1.4, 2.1 snapshots, 2.2 per-post analysis, 2.3 notifications (UI confirmed 2026-10-15). Smoke-verified API only: A.1a (connect), A.1c, O.1, O.3, O.4, 4.2. |
| **IMPLEMENTED - UNVERIFIED** | 0.4 (real provider call), 0.5 UI, 0.6 (Windows steps), A.1b (real Graph responses), A.1d backend and UI (compliance, deauthorize, data deletion), O.2 onboarding wizard in a browser, O.6 Settings business profile (never built with vite), D.1 microphone, A.2 comments (SQL never run), A.3 competitor history (SQL never run), C.1 public image storage (no real bucket). |
| **NOT STARTED or NOT BUILT** | A.0 (owner: Meta dev-mode app), A.2 reply drafts with approval, C.1b Reels video upload, C.2 to C.4, 3.1 and 3.2 monitoring (needs 3+ days of real snapshots), B.1 to B.4 (defined in the v3 PDF, not in the repo), voice extras (delete voice, restore older version, editor in Settings), hashtag set builder UI, placeholders Marketing/CRM/Ads/Collabs. |

### 2.3 Findings from the last working session (2026-10-23)

- **Gemini 503 "high demand".** The owner's Gemini key and model (`gemini-3.8-flash`, generally available since 2026-09-02) are valid. Google returned HTTP 503 UNAVAILABLE, and returned the error body as a JSON **array** (`[{"error":{...}}]`).
- **Why the app looked broken.** (1) `POST /api/assistant` made one attempt with a 10 s timeout and silently fell back to regex rules, so answers looked canned (the three static tips in `src/advisor.js`). (2) `POST /api/content/hashtags` and `/captions` use a separate helper, `llm()` in `src/routes.js`, which throws `j.error?.message || 'llm error'`; an array body has no `.error`, so the thrown text was `'llm error'` and Express returned HTTP 500. The 21-byte response body seen on Render matches `{"error":"llm error"}`. This is an inference; the Response tab text was not captured.
- **Patch delivered (not confirmed applied or deployed; see section 0, item 1):** `llm-retry-fallback.diff` changes `src/keys.js` (new `llmChat()`: retry once on 429/5xx or timeout, then models in `LLM_FALLBACK_MODELS`, reads array-shaped errors, tags upstream failures with status 502), `src/routes.js` (`llm()` now calls `llmChat`) and `src/assistant.js` (`route()` uses `llmChat`, 20 s timeout, logs the failure reason). All three pass `node --check` and the diff applies cleanly to `743cc7c`. **Not tested against live Gemini.**
- **Render environment (set in the dashboard, not `.env`):** `LLM_API_KEY`, `LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai`, `LLM_MODEL=gemini-3.8-flash`, `LLM_FALLBACK_MODELS=gemini-3.7-flash,gemini-2.5-flash`, plus `REPLICATE_API_TOKEN` and `IMAGE_MODEL`. A key saved in Settings (openai) wins over env and always talks to api.openai.com with `gpt-4o-mini` (see `llmConfig` in `src/keys.js`).
- **Open, unexplained:** (a) a browser console HTTP 400 on some request; URL and body never captured. (b) Local Vite proxy error ECONNRESET on `/api/assistant`; cause not identified (API restart under `node --watch`, API crash, or wrong port are the candidates).
- **Command Center redesign.** Requested earlier (RaidTechs header, 3-column grid, embedded assistant, global bottom chat on every tab except the Command Center, Activate Post Generation toggle). The repo contains `web/src/pages/CommandCenter.tsx`, `App.tsx` hides the global assistant on it, and a loose `command-center.patch` sits in the repo root. Treat it as applied but **UNVERIFIED in a browser**.

### 2.4 Housekeeping debt

- Three loose patch files in the repo root (`command-center.patch`, `phase1-all.patch`, `ui-instagram-restore.diff`) look like leftovers. Remove them once confirmed applied.
- `docs/AI_PROGRESS.md` header still says "archive, no .git" and was last checked 2026-10-17. Refresh it with the real `git rev-parse HEAD`.
- Decisions are numbered up to 105 (103 and 104 marked PROPOSED; see section 0, item 2). **Next decision number: 106.**

---

## 3. System map (as read from the repository)

Module descriptions marked (*) come from file names and ledger entries; the files were not opened line by line.

### 3.1 Backend modules (`src/`)

| Module | Role |
|---|---|
| `server.js`, `routes.js`, `config.js`, `loadenv.js`, `auth.js`, `ratelimit.js` | Express app, all `/api` routes (dense one-liners; async handlers wrapped for Express 4), boot validation (JWT_SECRET, ENCRYPTION_KEY, DATABASE_URL), JWT auth with login lockout, Redis per-user limits (`limit`/`hit`). |
| `keys.js`, `crypto.js` | Per-user API keys (encrypted), `llmConfig` (user key first, env fallback), `llmChat` (retry and fallback, in the patch). |
| `advisor.js`, `insights.js`, `goals.js`, `dismissals.js` | Ranked tips with why and metric to watch, health score, finance plan, goal-weighted advice, per-post analysis, goal progress, priority dismissals (*). |
| `assistant.js` | One-shot assistant: `pageMetrics()` from posts/competitors/follower_history, intent routing (LLM JSON, regex fallback) to image, analytics, finance, tip, info. |
| `brandvoice.js`, `responses.js` | Brand voice (versioned), caption and hashtag prompts, saved/edited replies. |
| `images.js`, `imagejobs.js`, `imageresult.js`, `storage.js`, `storedimages.js` | Replicate image models (`flux-1.1-pro` default, kontext for reference images), BullMQ image jobs, S3-compatible public image storage with retention (C.1). |
| `competitors.js`, `competitorintel.js`, `worker.js` | Competitor tracking through Instagram Business Discovery (public data), history rows, scrape errors, queued scrape job, daily snapshots, publisher loop. |
| `instagram.js`, `igconnect.js`, `igsync.js`, `igaccount.js`, `igwire.js`, `igcompliance.js` | Facebook Login for Business connection, long-lived token handling, media and insights sync, account daily metrics, signed-request deauthorize and data-deletion endpoints (*). |
| `comments.js`, `commentintel.js` | Post comments sync and keyword/emoji sentiment and theme estimates (labeled as estimates, decision 82). Reply drafts NOT built (decision 85). |
| `importer.js`, `csv.js`, `importjob.js`, `onboarding.js`, `schedule.js`, `notifications.js`, `snapshots.js`, `cache.js`, `queue.js`, `migrate.js`, `seed.js` | CSV/JSON/Instagram import, onboarding wizard state and business profile, schedule create/requeue, notification bell, daily snapshots (*), cache and queues, migration and demo seed. |

### 3.2 Database tables (`db/schema.sql`)

`users`, `api_keys`, `posts`, `competitors`, `competitor_posts`, `scrape_audit`, `hashtag_sets`, `scheduled_posts`, `import_log`, `post_snapshots`, `metrics_baseline`, `notifications`, `ig_accounts`, `follower_history`, `ig_account_daily`, `ig_audience`, `priority_dismissals`, `ig_deletion_requests`, `business_profile`, `brand_voice`, `voice_samples`, `saved_responses`, `post_comments`, `competitor_history`, `stored_images`.

- `posts`: id (serial), user_id (uuid), type, posted_at (timestamptz), likes, comments, saves, shares, reach, impressions, watch_s, caption, plus `ig_media_id`, `permalink`, `thumbnail_url`, `views`, `media_product_type`. Unique index on `(user_id, posted_at, type, md5(caption))`.
- `competitors`: id, user_id, handle, followers, last_scraped, plus `last_error*` columns. `competitor_posts`: id, competitor_id, type, posted_at, likes, comments, caption, `expires_at` (30-day retention).
- `hashtag_sets`: id, user_id, name, `tags text[]` only. No performance link.
- `scheduled_posts`: id, user_id, caption, image, `platforms text[]` (default `{instagram}`), scheduled_at, status (`scheduled`, `publishing`, `published`, `failed`, `demo-published`), error, published_at.
- `business_profile.timezone` and `.niche_keywords` exist (O.1). `ig_audience.online_followers` is jsonb.

### 3.3 API surface (from `routes.js`)

- Auth: login, signup.
- GET: `/dashboard`, `/posts`, `/posts/:id/analysis`, `/posts/:id/comments`, `/analytics/heatmap`, `/analytics/types`, `/analytics/insights`, `/priorities`, `/ai/context`, `/marketing/breakdown`, `/goal`, `/finance/plan`, `/competitors`, `/competitors/:id/history`, `/competitors/:id/posts`, `/notifications`, `/schedule`, `/hashtag-sets`, `/voice`, `/responses`, `/profile`, `/onboarding`, `/instagram/status`, `/gdpr/export`.
- POST: `/assistant`, `/content/captions`, `/content/hashtags`, `/content/image`, `/import/posts`, `/competitors`, `/scrape/:id`, `/schedule`, `/hashtag-sets`, `/instagram/sync`, `/voice/samples`, `/onboarding/voice/generate`, `/priorities/:key/dismiss`, `/responses/save`.
- PUT: `/settings/keys/:name`, `/voice`, `/profile`. PATCH: `/schedule/:id`, `/notifications/:id`, `/onboarding/:step`. DELETE: on competitors, schedule, hashtag-sets, notifications, priorities, responses, voice samples, settings keys, `/instagram/disconnect`, `/gdpr/account`.
- Limits: assistant 30/h, images 20/h, captions plus hashtags 60/h combined, import 20/h, competitors 200/h with a 1 h cache.

---

## 4. Gap analysis against the product goal

| Capability | Today (verified in code) | Gap | Phase |
|---|---|---|---|
| Hashtag recommendation | LLM from a niche string; saved as a plain list in `hashtag_sets` | Not data-driven. No tag extraction, counting, scoring or explanation. | I.1 to I.3, I.5 |
| Own-post tag analysis | Captions stored in `posts.caption` | No `post_tags` table, no lift against baseline, no tag-count or position analysis. | I.1, I.2 |
| Competitor tag analysis | Business Discovery returns the last 25 posts with captions; stored in `competitor_posts` (30-day retention) | No extraction or aggregation; sample is small; retention conflicts with trend analysis. | I.1, I.3 |
| Market tag discovery | None | No Hashtag Search integration; needs Meta feature approval. Competition proxy needed. | I.3 |
| Best posting time | ER heatmap by weekday and hour (own posts) | No recommendation, no minimum sample or confidence; no explicit time-zone conversion in the query (verify what zone Render uses; Lebanon is UTC+2/+3). | I.4 |
| Format and caption traits | ER by type chart; finance plan weights by type | No caption-trait analysis (length, question, call to action, emoji, tag count). No goal-aware format advice with evidence. | I.4 |
| Competitor benchmarking | Followers and average likes/comments history | Not tied to tags, formats or timing. Reach is never public. | I.3, I.4 |
| Plan generation | One-shot assistant gives one tip or one image | No weekly plan of slots (time, format, topic, tags, caption). | I.5 |
| Feedback loop | `post_snapshots` and per-post analysis exist | Nothing links a recommendation to its outcome, so the engine cannot learn or show a hit rate. | I.5 |
| Posting automation | Schedule UI and a 30 s publisher; image plus caption through Graph `media` and `media_publish`; demo mode when Instagram is not connected | Image posts only; no carousel, Reels or Stories; no container-status polling; no retry or backoff; no approval queue or autopilot guardrails; `platforms[]` accepts other values but only Instagram is published (verify). | I.6 |
| Multi-platform | `platforms[]` field | Out of scope until the owner decides (D-I6). | later |
| Demo readiness | Placeholders for Marketing, CRM, Ads, Collabs | Hide or build; demo data for tag intelligence; export reports. | I.7 |

---

## 5. Constraints and compliance

### 5.1 Data sources: what is legitimately available

| Source | What it gives | Limits to design around |
|---|---|---|
| Own account (Graph API insights, import) | Per-post likes, comments, saves, shares, reach, impressions, plays; account daily metrics; audience data (`ig_audience`) | Needs the Meta app and a connected business or creator account (A.0, A.1). Until then: CSV or JSON import and demo data. |
| Business Discovery (competitors) | Public followers, media count, last posts with caption, like and comment counts | Public business or creator accounts only. Reach is never public. Hidden like counts return null (store null, never 0). Current code asks for `media.limit(25)`; pagination beyond that must be verified in the Graph docs. |
| Hashtag Search (market tags) | Hashtag id, then `top_media` and `recent_media` for that tag with limited fields | Requires the Instagram Public Content Access feature (Meta app review). A cap on unique hashtags queried per account per rolling 7 days applies (documented as 30; **verify the current figure**). The API exposes no hashtag volume or follower count, so competition must be a labeled proxy. Fields and limits must be re-checked against current Meta docs at build time. |

### 5.2 Rules

- **No HTML scraping, no logged-in browsing, no unofficial endpoints.** If a data point is not available through an official API, the product says it is unavailable.
- **Privacy and retention.** New tables with user data must (a) cascade on account delete, (b) appear in `GET /api/gdpr/export`, (c) respect the 30-day competitor retention unless the owner decides otherwise (D-I1). Prefer storing derived aggregates (tag counts, stats) over third-party captions. From market tag searches, keep tags and counts only and discard third-party captions after extraction. (See section 0, items 5 and 7 for how this works in code.)
- **Meta dev mode.** Until A.0 and app review, only test accounts work. Everything Meta-dependent is built against the mock Graph server (`scripts/mock-graph.js`, `test/fixtures/graph/`) and marked IMPLEMENTED - UNVERIFIED with the blocker named.
- **LLM resilience.** All LLM calls go through `llmChat` (retry, fallback models, JSON mode). Cache LLM labeling. A deterministic fallback must exist for every LLM-assisted feature so a 503 never produces a blank screen or a 500.
- **Language.** The owner is in Lebanon: expect Arabic and mixed Arabic/English captions. Tag extraction must be Unicode-aware; keyword lists (call to action, sentiment) are English-biased today and must be labeled estimates for other languages.
- **Secrets.** Never ask users to paste tokens or keys. If one appears in pasted material, tell the owner to rotate it.

---

## 6. Phased plan: Track I (Intelligence)

Ordering and dependencies at a glance. Items marked Meta-independent can be built and verified with CSV imports, demo data and the mock Graph server.

| Phase | Name | Depends on | Meta needed? | Outcome |
|---|---|---|---|---|
| I.0 | Stabilize and verify | - | A.0 is owner-side | LLM calls resilient; open errors explained; unverified UI and SQL actually run. |
| I.1 | Tag and caption feature extraction | I.0 | No | Every post (own and competitor) has structured tags and caption features. |
| I.2 | Tag performance analysis (own data) | I.1 | No | Which of my tags and tag habits lift engagement, with evidence. |
| I.3 | Market tag discovery and competitor tag intelligence | I.1; live part needs A.0 and Meta approval | Live: yes | Candidate tags from competitors and the market, with proxies. |
| I.4 | Timing, format and caption-trait analysis, unified recommendations | I.1, I.2 | No | Best windows, formats and traits with confidence; one recommendation schema. |
| I.5 | Best-approach planner and feedback loop | I.2, I.4 (I.3 enriches) | No | Weekly plan, tag-set composer, A/B tracking, recommendation hit rate. |
| I.6 | Posting automation hardening | I.0; live checks need A.0 | Live: yes | Approval queue, autopilot guardrails, carousel, Reels, polling, retries. |
| I.7 | Demo readiness and productization | any time, last | Partly | No dead tabs, reports, demo data, Meta review pack. |

**Who does what.** Each phase below lists what the AI can do alone and what needs the owner. The AI must not mark owner-side items done, and must not claim a stronger evidence label than the environment it actually used supports (section 8.2).

### Phase I.0 - Stabilize and verify

| | |
|---|---|
| Goal | Close the debt from earlier phases and from the last session before building new analysis on top of it. |
| Depends on | Nothing. |
| Blocked by | A.0 (Meta app) is owner-side and only blocks the live-Meta checks. |
| Gate | Every checklist item (Appendix B) recorded in `docs/AI_PROGRESS.md` with command, environment and result; owner confirms. |

**Build**

- **I.0.1 LLM patch (AI).** Get `llmChat` into the code (see section 0, item 1: apply the owner-committed diff, or implement from section 2.3 and I.0.2). Make the fetch implementation injectable in `llmChat`. The owner deploys and sets the four LLM variables on Render.
- **I.0.2 Unit tests for `llmChat` (AI)** with an injected fetch: retries on 503 then succeeds; array-shaped error text is surfaced; falls through to the next model in `LLM_FALLBACK_MODELS`; does not retry on 401 or 404 but moves to the next model; returns status 502 when everything fails; user-key configs never use env fallback models. Register the test file in the `package.json` test script.
- **I.0.3 Live checks, curl (owner, after deploy; AI supplies the exact commands).** `POST /api/assistant` with a free-form message (answer text differs from the static tips and is at most 20 words); `POST /api/content/hashtags` and `/captions` return JSON; with a deliberately wrong `LLM_MODEL` the logs show the fallback reason and the response is a clean 502, not an opaque 500.
- **I.0.4 Explain the open errors (owner supplies evidence, AI diagnoses).** Capture URL, status and Response body of the browser 400; find the cause of the local ECONNRESET on `/api/assistant` (backend terminal and port). Record both in the ledger.
- **I.0.5 Run the never-run SQL and screens (AI if it has Postgres and Redis, otherwise owner runs and pastes output).** Run `smoke-regression.sh` and `smoke-phaseA1`, `A1c`, `O`, `O3`, `O4-42`, `A2` against real Postgres and Redis; build the web app with vite; the owner (or the AI, if it has a browser) walks through onboarding (O.2), Settings business profile (O.6), Instagram card (A.1d), comments card (A.2), competitor history (A.3), voice step and microphone (D.1), Command Center and global chat placement.
- **I.0.6 Housekeeping (AI).** Remove the three loose patch files from the repo root once confirmed applied; refresh the ledger header with the real commit hash; correct stale statuses (section 0, items 2 and 3).
- **I.0.7 A.0 (owner).** Create the Meta dev-mode app and a test Instagram business account; record permissions granted. This unlocks real data for every later phase.

**Acceptance**

- All tests pass (`npm test`) and `node --check` is clean on every `src` file; web build succeeds.
- No remaining place in `src/` where an upstream LLM failure becomes an opaque 500 (grep for direct fetch to `/chat/completions`: only `llmChat` may call it).

### Phase I.1 - Tag and caption feature extraction

| | |
|---|---|
| Goal | Turn raw captions into structured, queryable features for own posts and competitor posts. |
| Depends on | I.0. |
| Blocked by | Nothing (works on CSV imports, demo data and the mock Graph). |
| Gate | Extractor unit tests pass; backfill run on the demo account gives correct counts; GDPR export and account delete cover the new tables. |

**Build**

- **I.1.1 Pure module `src/textfeatures.js`** (no database, no network). `extractHashtags(caption)`: Unicode-aware (Arabic, accents), NFKC-normalized, lowercase, deduplicated, ignores URL fragments, handles adjacent tags like `#a#b`, ignores pure numbers, caps at 30. `extractMentions`. `captionFeatures`: length, line count, emoji count, question mark, call-to-action detection (keyword list, labeled estimate), hashtag count, hashtag position (inline vs trailing block).
- **I.1.2 Schema (additive migration).** `post_tags`, `competitor_post_tags`, `post_features`; index on `(user_id, tag)`; backfill job over existing `posts` and `competitor_posts`. See the proposed contract below.
- **I.1.3 Hook extraction into every write path:** `importer.js` (CSV/JSON), `igsync.js` (Instagram sync), and the scrape worker (competitor posts). Idempotent: re-running does not duplicate rows.
- **I.1.4 Deeper competitor sample.** Raise the competitor sample beyond 25 posts if Business Discovery pagination is confirmed; keep the per-hour limits and the 1 h cache. Store null, never 0, for hidden counts.
- **I.1.5 Retention decision (D-I1).** Raw competitor captions expire at 30 days today. Default proposal: keep derived tag and feature rows (no caption text) for 180 days so trends are possible.
- **I.1.6 Privacy plumbing.** New tables added to `GET /api/gdpr/export` and to the account-delete cascade; documented in the ledger.

> **PROPOSED CONTRACT (I.1.2).** Follows the repo's `db/schema.sql` style: one idempotent file, `CREATE TABLE IF NOT EXISTS`, ids as `serial`/`int`, `user_id uuid`. Deviations require a decision entry.
>
> ```sql
> -- ===== I.1 tag and caption features (idempotent) =====
> -- Own posts: derived from posts.caption. Cascades with the post and the user. Export: has user_id (add to the export loop).
> CREATE TABLE IF NOT EXISTS post_tags(
>   post_id int NOT NULL REFERENCES posts ON DELETE CASCADE,
>   user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
>   tag text NOT NULL,                 -- lowercase, NFKC, no leading '#'
>   position int NOT NULL,             -- 0-based order of first appearance
>   PRIMARY KEY(post_id, tag));
> CREATE INDEX IF NOT EXISTS post_tags_user_tag ON post_tags(user_id, tag);
>
> CREATE TABLE IF NOT EXISTS post_features(
>   post_id int PRIMARY KEY REFERENCES posts ON DELETE CASCADE,
>   user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
>   length int NOT NULL, line_count int NOT NULL, emoji_count int NOT NULL,
>   has_question boolean NOT NULL, has_cta boolean NOT NULL,   -- has_cta is an ESTIMATE (English-biased keyword list)
>   tag_count int NOT NULL,
>   tag_block text NOT NULL CHECK (tag_block IN ('none','inline','trailing','both')),
>   extracted_at timestamptz NOT NULL DEFAULT now());
>
> -- Competitor posts: NO foreign key to competitor_posts (raw rows expire at 30 days; derived rows must outlive them, D-I1).
> -- Public counts are copied here (null stays null, never 0). Cascades with the competitor, hence the user.
> -- Export: no user_id column, so read it through competitors with a JOIN (same pattern as competitor_history).
> CREATE TABLE IF NOT EXISTS competitor_post_tags(
>   competitor_id int NOT NULL REFERENCES competitors ON DELETE CASCADE,
>   posted_at timestamptz NOT NULL,
>   tag text NOT NULL,
>   type text, likes int, comments int,
>   expires_at timestamptz NOT NULL,   -- set to now() + 180 days when the row is first inserted (D-I1); not tied to the raw row
>   PRIMARY KEY(competitor_id, posted_at, tag));
> CREATE INDEX IF NOT EXISTS competitor_post_tags_comp_tag ON competitor_post_tags(competitor_id, tag);
> CREATE INDEX IF NOT EXISTS competitor_post_tags_exp ON competitor_post_tags(expires_at);
> ```
>
> Notes: a retention job deletes `competitor_post_tags` rows past `expires_at` (follow the existing retention job pattern for `post_comments`). Extraction is a pure function `extractHashtags(caption) -> string[]` (ordered, deduplicated, at most 30) and `captionFeatures(caption) -> { length, lineCount, emojiCount, hasQuestion, hasCta, tagCount, tagBlock }`; database writes live in a separate module that takes `q` injected, so tests use a fake `q` (section 8.4).

**Tests and acceptance**

- Unit tests for the extractor: Arabic and mixed tags, emoji next to tags, duplicates in different case, `#1` and `#2024` style numbers, URL with `#fragment`, tags glued together, 30-tag cap.
- Smoke: import a CSV with known tags, then assert `post_tags` counts equal the expected numbers; run the backfill twice and assert no duplicates.
- Delete the demo account and assert zero rows remain in the new tables.
- `GET /api/gdpr/export` includes `post_tags`, `post_features` and `competitor_post_tags`.

### Phase I.2 - Tag performance analysis (own data)

| | |
|---|---|
| Goal | Show which tags and tag habits actually go with better results on the user's own account, with evidence. |
| Depends on | I.1. |
| Blocked by | Nothing. |
| Gate | Synthetic-data tests recover known lifts; small-sample tags are suppressed; UI card reviewed by the owner. |

**Build**

- **I.2.1 Per-tag metrics** (nightly job plus on-demand): posts using the tag (n), median engagement rate and reach versus the account baseline, computed **within the same post type** to reduce format confounding; consistency (share of tag posts above the baseline). Minimum n (default 5) before a tag is shown; below that it is listed as "not enough data".
- **I.2.2 Tag-set habits:** engagement by number of tags (buckets), trailing block versus inline, repeated identical tag blocks versus rotating sets.
- **I.2.3 Early velocity** where `post_snapshots` allow it (reach after about 24 h), used as a second signal because it reacts faster than final reach.
- **I.2.4 Endpoints:** `GET /api/tags/performance` (sortable, with n, lift, consistency, confidence) and `GET /api/tags/summary` (top lifting tags, tags to drop, habit findings). Rate-limited like other analytics reads.
- **I.2.5 UI:** a "Tags" card in Statistics: table with sort, n and lift, plain-language why, and a clear "correlation, not proof" note. Hide anything below the minimum sample.

> **PROPOSED CONTRACT (I.2).** Definitions use the repo's existing engagement rate: `ER = (likes + comments + saves + shares) * 100.0 / NULLIF(reach, 0)` (see `/analytics/heatmap`). Posts with null or zero reach are excluded from ER, never counted as 0. Post types are compared case-insensitively.
>
> - `baseline_t` = median ER of all the user's posts of type `t`.
> - For a tag, for each type `t` it appears in: `lift_t = median ER of (tag posts of type t) / baseline_t - 1`. Tag `lift` = n-weighted mean of `lift_t`. `consistency` = share of the tag's posts whose ER is above their own type's baseline.
> - `weeks` = number of distinct ISO weeks the tag appears in.
> - Confidence (one pure function `confidenceFor({ n, weeks, lift, consistency })`, thresholds written in the ledger and tunable): `low` if n < 10 or weeks < 2; `medium` if n >= 10 and weeks >= 3; `high` if n >= 20 and weeks >= 4 and the sign of `lift` agrees with `consistency` (>= 0.6 for positive lift, <= 0.4 for negative). n below the minimum (D-I5, default 5) is never returned as a recommendation.
>
> ```
> GET /api/tags/performance?sort=lift|n|consistency&order=asc|desc&type=IMAGE|REEL|CAROUSEL_ALBUM&limit=50
> -> { "minN": 5,
>      "baseline": { "er": number|null, "n": int, "scope": "account" },
>      "tags": [ { "tag": "string", "n": int, "weeks": int, "medianEr": number, "medianReach": number|null,
>                  "lift": number, "consistency": number, "confidence": "low|medium|high" } ],
>      "notEnoughData": [ { "tag": "string", "n": int } ],
>      "note": "Correlation, not proof." }
>
> GET /api/tags/summary
> -> { "top": [tag...], "drop": [tag...],
>      "habits": { "tagCountBuckets": [{ "bucket": "0|1-5|6-10|11-20|21-30", "n": int, "medianEr": number|null }],
>                  "block": [{ "kind": "trailing|inline|both|none", "n": int, "medianEr": number|null }],
>                  "repeatedBlockShare": number|null },
>      "missing": [ "what data would unlock more findings" ] }
> ```
>
> A fresh account returns empty arrays plus a non-empty `missing`, never made-up tags.

**Tests and acceptance**

- Pure functions with synthetic datasets where the true lift is known (for example a tag that adds 20 percent engagement): the computed lift lands within a stated tolerance (state it in the test).
- A tag with n below the minimum never appears in the API response as a recommendation.
- Confidence levels follow the thresholds written in the code and in the ledger (low, medium, high).

### Phase I.3 - Market tag discovery and competitor tag intelligence

| | |
|---|---|
| Goal | Find candidate tags the user does not use yet, from competitors and from the market, and score them with honest proxies. |
| Depends on | I.1. Live part needs A.0 and Meta approval for public content access. |
| Blocked by | Meta app review (Hashtag Search). Competitor-derived discovery is not blocked. |
| Gate | Competitor-derived discovery verified end to end; Hashtag Search path IMPLEMENTED - UNVERIFIED against the mock Graph with the blocker named; UI states which sources were used. |

**Build**

- **I.3.1 Competitor tag intelligence (not blocked):** per competitor and across the tracked set: tag frequency, tags attached to their best posts (public likes plus comments relative to followers as the engagement proxy), co-occurring tags, and tags used by several competitors but never by the user.
- **I.3.2 `src/hashtagsearch.js`** (new, behind the mock Graph first): resolve tag to id, read `top_media` and `recent_media` with the fields Meta currently allows, extract tags and counts, discard third-party captions. Cache tag ids (they are stable).
- **I.3.3 Query budget manager.** Track unique hashtags queried per connected account in a rolling 7-day window (Redis), respect the documented cap, spend it on the best candidates first (user tags, competitor tags, then LLM-suggested niche seeds). LLM seeds are only candidates; data validates them.
- **I.3.4 Derived market stats per tag:** competition proxy from how fast `recent_media` accumulates (post timestamps), engagement proxy from `top_media` public counts, related tags from co-occurrence. Tier (broad, medium, niche) from these proxies, always labeled as an estimate because the API gives no volume.
- **I.3.5 Storage and endpoints:** `tag_market(tag, tier, competition_proxy, engagement_proxy, fetched_at, source)`; `POST /api/tags/discover` (queued job, returns a job id like image jobs), `GET /api/tags/market`.
- **I.3.6 Fallback behavior:** without Hashtag Search the product still recommends from own performance (I.2) and competitor usage, and says so on screen.

> **PROPOSED CONTRACT (I.3.5).** `tag_market` is per user because the query budget is per connected account (D-I8) and because it stores user-specific proxies. Tags and counts only; no third-party captions.
>
> ```sql
> CREATE TABLE IF NOT EXISTS tag_market(
>   user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
>   tag text NOT NULL,
>   tier text CHECK (tier IN ('broad','medium','niche')),            -- ESTIMATE, from proxies
>   competition_proxy numeric, engagement_proxy numeric,              -- null = not measured
>   related_tags text[] NOT NULL DEFAULT '{}',
>   source text NOT NULL CHECK (source IN ('competitor','hashtag_search','llm_seed')),
>   fetched_at timestamptz NOT NULL DEFAULT now(),
>   PRIMARY KEY(user_id, tag));
> ```
>
> Budget manager: a Redis sorted set per account (key via `keyFor`), members = tag, score = epoch ms, trimmed to the last 7 days; a pure function `canQuery({ queriedTags, now, cap, tag })` injected with the cap so tests need no Redis. Re-querying a tag already counted in the window is free. `POST /api/tags/discover` -> `{ jobId }`; `GET /api/tags/market` -> `{ sources: ["competitor"|"hashtag_search"|"llm_seed"], budget: { used, cap, windowDays: 7 }, tags: [...] }`.

**Tests and acceptance**

- Mock Graph fixtures for hashtag search, `top_media`, `recent_media`; error cases (permission missing, cap exceeded, empty result).
- Unit tests for the budget manager (rolling window, reuse of already-counted tags, refusal when over the cap).
- Ledger entry names exactly what stays UNVERIFIED until real Meta access (field names, caps, response shapes).

### Phase I.4 - Timing, format and caption traits, unified recommendations

| | |
|---|---|
| Goal | Turn the existing heatmap and type chart into evidence-backed recommendations, and put every recommendation kind in one schema. |
| Depends on | I.1, I.2. |
| Blocked by | Nothing. |
| Gate | Recommendations carry evidence and confidence; insufficient data produces an explicit "what is missing" message; time zone behavior verified. |

**Build**

- **I.4.1 Time zone first.** The heatmap query groups by weekday and hour of `posted_at` without an explicit time-zone conversion. Use `business_profile.timezone` (fall back to the browser-reported zone) and convert before grouping. Verify what zone the Render database session uses (`SHOW timezone`). Validate zone names against `pg_timezone_names`.
- **I.4.2 Best posting windows:** smoothed engagement by weekday and hour with a minimum sample per cell, neighbors pooled when sparse, top three windows with confidence. If `ig_audience` holds usable active-hours data, use it as a second signal (check `src/igaccount.js` for what is actually stored).
- **I.4.3 Format mix:** engagement and reach per type, weighted by the user's goal (`advisor.js` already has goal weights), compared with the competitor format mix from I.3.
- **I.4.4 Caption traits:** lift for length buckets, question or call to action, emoji use, tag count, within the same post type, with n shown.
- **I.4.5 One recommendation schema** returned by `GET /api/priorities` (extend, do not break existing consumers).
- **I.4.6 Confidence rules** in one place (pure function), for example: fewer than 5 observations is never above low; high requires a larger n and consistency across weeks. Thresholds go in the ledger and can be tuned later.

The PDF's target item shape:

```
{ id, kind: "tag_set|time|format|caption_trait|competitor_gap",
  text, why,
  evidence: { n, lift, baseline, source: "own|competitor|market" },
  confidence: "low|medium|high", estimate: true|false,
  watch: "metric to watch" }
```

> **PROPOSED CONTRACT (I.4.5), resolving the clash in section 0, item 8.** `GET /api/priorities` keeps its envelope and every existing field: `{ updatedAt, priorities: [...], snoozed }`, each item `{ priority, kind, key?, text, why, watch }`. Existing consumers (Command Center, Dashboard) and `priority_dismissals.tip_key` (= `kind`) keep working unchanged. New recommendation items are added to the same array with these **additional** fields:
>
> - `category`: one of `tag_set | time | format | caption_trait | competitor_gap` (this is the PDF's `kind` meaning).
> - `kind`: a distinct dismissal key per recommendation family, e.g. `rec_time`, `rec_format`, `rec_tag_set`, `rec_caption_trait`, `rec_competitor_gap`, so that dismissing one does not hide the others; `key` carries the per-week or per-subject snooze id as it does today.
> - `id`: stable string, e.g. `time:tue-19` or `tag:#example`, reused later by `plan_items.rec_ids` (I.5).
> - `evidence: { n, lift, baseline, source }`, `confidence`, `estimate`.
> - `priority`: a number, as today, so existing sorting is unchanged.
>
> When data is insufficient, return one item with `category: "need_data"`, `confidence: "low"` and a `text` listing exactly which data to import or connect. A fresh account never gets an invented recommendation. Stories cannot be distinguished from images in stored data (section 0, item 9); do not give story advice.

**Tests and acceptance**

- Synthetic datasets with a known best hour and known best format: the engine returns them.
- A fresh account (no posts) gets a "what I need to know" answer, not a made-up recommendation.
- Existing `/api/priorities` consumers (Command Center, Dashboard) still render.
- Time zone: a dataset with posts at known UTC times and a `business_profile.timezone` of `Asia/Beirut` lands in the expected local cell, including across a DST change.

### Phase I.5 - Best-approach planner and feedback loop

| | |
|---|---|
| Goal | Give the customer a concrete weekly plan built from the data, then measure whether following it worked. |
| Depends on | I.2, I.4. I.3 enriches the tag choices. |
| Blocked by | Nothing for the engine; live outcome tracking needs real snapshots. |
| Gate | Plan generated from data with a deterministic fallback when the LLM is down; recommendation hit rate shown honestly. |

**Build**

- **I.5.1 Slot selection is deterministic.** From goal, voice, best windows and format mix, choose N slots (day, time, format). The LLM only writes the caption draft, topic angle and image prompt for each slot, through `llmChat` with JSON validation; a template fallback fills the text if the LLM fails.
- **I.5.2 Tag-set composer.** Build a set of about 8 to 15 tags per post from three sources: own proven tags (I.2), competitor-validated tags (I.3), market candidates (I.3). Mix tiers (broad, medium, niche); the default ratios are heuristics, written down and configurable. Exclude tags with negative lift or on the user's blocklist; rotate sets so the same block is not repeated every post.
- **I.5.3 `plan_items` table:** week, slot time, format, tag set, recommendation ids that justified it, status (suggested, accepted, edited, scheduled, published, skipped), link to `scheduled_post`, outcome fields.
- **I.5.4 UI.** Command Center card "This week's plan" and a plan view in Scheduling: accept, edit, regenerate one slot, "Add to schedule". The hashtag set builder UI (API `/hashtag-sets` exists) becomes part of this, with performance per saved set.
- **I.5.5 Feedback loop.** After publish and after 48 h and 7 d, join `post_snapshots` to compute outcome against baseline; store per recommendation. Show a hit rate with its sample size. Use simple shrinkage so a few results do not swing confidence. Reserve a small exploration share (alternate tag sets) so the engine can learn; label it as A/B tracking.
- **I.5.6 Notifications:** "weekly plan ready" and "recommendation outcome available" through the existing bell.

> **PROPOSED CONTRACT (I.5).**
>
> ```sql
> CREATE TABLE IF NOT EXISTS plan_items(
>   id serial PRIMARY KEY,
>   user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
>   week_start date NOT NULL,                       -- Monday of the plan week, in the user's time zone
>   slot_at timestamptz NOT NULL,
>   format text NOT NULL,                           -- IMAGE | REEL | CAROUSEL_ALBUM
>   tags text[] NOT NULL DEFAULT '{}',
>   caption text, topic text, image_prompt text,
>   rec_ids text[] NOT NULL DEFAULT '{}',           -- ids from I.4.5 that justified this slot
>   status text NOT NULL DEFAULT 'suggested'
>     CHECK (status IN ('suggested','accepted','edited','scheduled','published','skipped')),
>   is_experiment boolean NOT NULL DEFAULT false,   -- exploration share (A/B tracking)
>   scheduled_post_id int REFERENCES scheduled_posts ON DELETE SET NULL,
>   post_id int REFERENCES posts ON DELETE SET NULL,
>   outcome jsonb,                                  -- { h48: { er, vsBaseline }, d7: { er, vsBaseline }, hit: true|false|null }
>   created_at timestamptz NOT NULL DEFAULT now(),
>   updated_at timestamptz NOT NULL DEFAULT now());
> CREATE INDEX IF NOT EXISTS plan_items_user_week ON plan_items(user_id, week_start);
> -- Needed to link a published post back to its plan item (also used by I.6.4):
> ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS ig_media_id text;
> ```
>
> `plan_items` has a `user_id`, so add it to the GDPR export loop. The publisher must store `ig_media_id` when it publishes (small additive change in `src/worker.js`); I.5.5 matches `posts.ig_media_id` to it after the next sync.
>
> Endpoints (rate-limited with `limit('plan', ...)`):
>
> ```
> POST  /api/plan/generate  { weekStart?: "YYYY-MM-DD", slots?: int }   // default = business_profile.posts_per_week or 3; max 14
>   -> { weekStart, source: "llm"|"template", items: [plan_item...], missing: [string] }
> GET   /api/plan?week=YYYY-MM-DD
>   -> { weekStart, items: [plan_item...], hitRate: { n, rate: number|null, shrunk: number|null, minN: 5 } }
> PATCH /api/plan/items/:id  { status?: "accepted"|"skipped", caption?, tags?, slotAt? }   // an edit sets status "edited"
> POST  /api/plan/items/:id/regenerate     // regenerates caption/topic/tags for this slot only
> POST  /api/plan/items/:id/schedule       // explicit user action: creates the scheduled_posts row (see I.6.1)
> ```
>
> LLM output per slot is validated JSON: `{ "caption": string, "topic": string, "image_prompt": string }`. Reject and use the template fallback if it fails validation; never put LLM text into any numeric field. Hit-rate shrinkage default: `shrunk = (hits + 0.5 * k) / (n + k)` with `k = 5`; hide the rate below `minN`.

**Tests and acceptance**

- Plan generation with the LLM stubbed to fail still returns a complete, valid plan.
- Slot times fall inside the recommended windows; tag sets respect the blocklist and tier rules.
- Outcome computation is unit-tested on synthetic before/after data; hit rate is hidden below a minimum sample.

### Phase I.6 - Posting automation hardening

| | |
|---|---|
| Goal | Make the automation itself trustworthy: safe by default, robust to failure, and covering the formats customers use. |
| Depends on | I.0. Live verification needs A.0. |
| Blocked by | A real connected test account for live checks; Reels need C.1b. |
| Gate | State machine and failure paths verified on the mock Graph; live checks marked UNVERIFIED with the blocker if A.0 is not done. |

**Build**

- **I.6.1 Approval queue.** States: draft, approved, scheduled, publishing, published, failed (extend `scheduled_posts` or add a table). Default: nothing publishes without approval.
- **I.6.2 Autopilot (opt-in, default OFF)** with guardrails: daily cap, quiet hours, first N posts always need approval, kill switch, notification on every autopublish. Decision D-I2 sets whether v4 ships it.
- **I.6.3 Media types.** Image (exists), carousel (child containers then a parent), Reels (C.1b: video upload, container status polling), Stories (verify current API support before promising it).
- **I.6.4 Robust publishing.** Persist the creation id before `media_publish` so a crash can resume instead of double-posting; poll container status until finished; retry with backoff on transient errors; respect the documented per-day API publishing limit (verify the current number) with a counter; keep the `FOR UPDATE SKIP LOCKED` claim already used by the publisher.
- **I.6.5 Token and failure UX.** Detect expired or revoked tokens (A.1 stores a long-lived token) and notify the user to reconnect; show the real failure reason in the schedule list; one-click retry (`PATCH /schedule/:id` already requeues).
- **I.6.6 Images and storage.** Instagram needs a public image URL: verify C.1 with a real S3-compatible bucket, then implement C.2 (`releaseAfterPublish` already exists and is tested but nothing calls it).
- **I.6.7 Time zones in the Scheduling UI,** a "post now" action, and hiding platform options other than Instagram until another adapter exists (design an adapter interface only).

> **PROPOSED CONTRACT (I.6.1 and I.6.4).** Keep `scheduled` meaning "approved and due-able" so the publisher claim query and the `scheduled_due` index are unchanged (section 0, item 10). Existing rows already mean the user scheduled them, so no data migration is needed.
>
> - Add status `draft` (created by autopilot or imported plans; the publisher never claims it). Approving a draft sets it to `scheduled`. The `status` column has no CHECK constraint today; do not add one that rejects existing values (`scheduled`, `publishing`, `published`, `failed`, `demo-published`).
> - Additive columns (all `ADD COLUMN IF NOT EXISTS`): `media_type text NOT NULL DEFAULT 'image'` (`image|carousel|reel`), `children text[]` (carousel image urls), `video_url text`, `creation_id text` (persisted before `media_publish`), `ig_media_id text` (added in I.5), `attempts int NOT NULL DEFAULT 0`, `next_attempt_at timestamptz`, `autopublished boolean NOT NULL DEFAULT false`, `plan_item_id int`.
> - Publisher recovery rule: a row in `publishing` with a `creation_id` and no `ig_media_id` is resumed (poll the container, then publish once), never re-created.
> - Retry rule: transient errors set status back to `scheduled` with `next_attempt_at = now() + backoff(attempts)` (for example 1, 5, 15 minutes, then `failed`); the claim query also requires `next_attempt_at IS NULL OR next_attempt_at <= now()`.
> - Autopilot settings live in `business_profile` or a new `autopilot_settings(user_id PK, enabled boolean DEFAULT false, daily_cap int, quiet_start time, quiet_end time, approve_first_n int DEFAULT 5, updated_at)` table (new table: `user_id` cascade and GDPR export).

**Tests and acceptance**

- Mock Graph smoke for carousel and Reels flows with failure injection: container error, expired token, timeout after creation, duplicate publish attempt.
- Unit tests for the state machine and for the retry and backoff rules.
- Autopilot guardrails tested: cap reached, quiet hours, kill switch.

### Phase I.7 - Demo readiness and productization

| | |
|---|---|
| Goal | Make a client demo convincing and honest, and prepare the Meta review. |
| Depends on | Any time; best last. |
| Blocked by | Real data needs A.0. |
| Gate | Owner walkthrough with no dead tabs and every number traceable to data or labeled demo. |

- **I.7.1 Placeholders.** Marketing, CRM, Ads and Collabs show "not built yet". Hide them from the sidebar, or build Collabs from mention and collaboration detection plus competitor partner suggestions (the owner's goal list included collabs, mentions, stories and bought views as growth comparisons).
- **I.7.2 Demo data** for tag intelligence and the weekly plan, clearly labeled demo (the app already has a demo mode for competitors and publishing).
- **I.7.3 Reports.** Export the insights and the weekly plan as PDF or spreadsheet for the client.
- **I.7.4 Monitoring (3.1, 3.2)** once 3 or more days of real snapshots exist; B.1 to B.4 as defined in the v3 PDF (not in the repo; ask the owner).
- **I.7.5 Meta review pack (owner with AI drafting):** use-case text, screencasts, privacy policy and data-deletion URLs (A.1d endpoints exist), and the public-content-access request for I.3.

---

## 7. Open decisions for the owner

Each decision has a default the next AI may proceed with if the owner has not answered; record the answer or the default in `docs/AI_DECISIONS.md` starting at number **106**.

| ID | Question | Default if unanswered |
|---|---|---|
| D-I1 | Keep derived tag and feature rows from competitor posts beyond the 30-day raw retention? | Yes: keep derived rows without caption text for 180 days. |
| D-I2 | Ship autopilot in v4, or approval-only? | Approval-only first; autopilot behind a flag, off by default. |
| D-I3 | Which formats first? | Image and carousel, then Reels (C.1b). Stories only if the API supports it. |
| D-I4 | Source and language of the niche? | Business profile niche from onboarding; English and Arabic tag extraction; keyword lists labeled estimates. |
| D-I5 | Minimum sample before a tag or time is recommended? | n of at least 5 per tag, with confidence rules from I.4.6. |
| D-I6 | Stay Instagram-only in v4? | Yes. Other platforms need their own adapters and APIs. |
| D-I7 | LLM policy? | Gemini via the OpenAI-compatible endpoint with fallback models; a user-saved key still wins. |
| D-I8 | Hashtag Search budget: per connected account or shared? | Per connected account (the Meta cap is per account). |

---

## 8. Working protocol for the next AI

### 8.1 First actions, in order

1. Read this document, `docs/AI_PROGRESS.md`, `docs/AI_DECISIONS.md` (decisions 1 to 105), `README.md` and `db/schema.sql`.
2. Run `git rev-parse HEAD` and compare with `743cc7c`. If different, list what changed before doing anything else.
3. Run `npm test` and `node --check` on every `src` file; record the results. Do not repeat the 252/252 figure without running it.
4. Update the ledger header (date, commit, current item, overall state) before starting new work.
5. Ask the owner for the v3 PDF if B.1 to B.4 or any v3 detail is needed; it is not in the repository.

### 8.2 Evidence labels (use exactly these)

| Label | Meaning |
|---|---|
| VERIFIED | Ran against the real stack. State the command, the environment and the result in the ledger. |
| API VERIFIED BY SMOKE | Ran over HTTP against real Postgres and Redis with a mock Graph server. |
| IMPLEMENTED - UNVERIFIED | Code exists and passes unit tests or `node --check`, but the live path or the UI was not run. Name the blocker. |
| NOT STARTED / BLOCKED | Say what blocks it (A.0, Meta approval, owner decision). |

State the environment you actually used. If you could not run Postgres and Redis, you cannot claim API VERIFIED BY SMOKE.

### 8.3 Delivery rules (owner preferences)

- Work phase by phase and **stop for confirmation after each phase**.
- Deliver a **git diff patch** against a stated commit (or a branch and pull request when you have write access to the repo), full files for changed files when asked, curl tests for every new endpoint, and unit tests for new pure logic.
- Add new tables to the GDPR export and the account-delete cascade in the same patch.
- Local environment is Windows 11 with native Postgres and Redis (Memurai) and no Docker; give PowerShell-friendly commands. Production is Render; environment variables live in the Render dashboard.
- Report back with: what was built, files changed, commands run and results, what stays UNVERIFIED and why, decisions added, and the next item.

### 8.4 Code conventions in this repository

- ESM everywhere. `routes.js` uses one-line handlers and a `wrap` helper because Express 4 does not catch async errors; keep that.
- Logic that can be pure lives in its own module with the database function (`q`) injected, so tests use a fake. Follow `src/commentintel.js` and `src/competitorintel.js`.
- Per-user limits through `limit()` and `hit()` (Redis). Per-user keys through `keyFor` and `llmConfig`.
- All LLM calls go through `llmChat` with JSON mode and a deterministic fallback. User-facing error messages are written in code, never copied from upstream responses.
- Migrations are additive and idempotent (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`) in `db/schema.sql`, applied by `npm run migrate`.
- New test files must be appended to the `test` script in `package.json` (section 0, item 6).

---

## Appendix A. Environment variables (names only)

| Group | Variables |
|---|---|
| Required | `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET` (32 or more chars), `ENCRYPTION_KEY` (64 hex chars), `CORS_ORIGIN`, `INLINE_WORKER` |
| LLM | `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`, `LLM_FALLBACK_MODELS` (new, from the patch) |
| Images | `REPLICATE_API_TOKEN`, `IMAGE_MODEL` (default `flux-1.1-pro`) |
| Instagram | `IG_USER_ID`, `IG_ACCESS_TOKEN`, `META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI`, `APP_URL`, `META_GRAPH_VERSION`, `IG_ALLOW_ENV_FALLBACK`, `PRIVACY_OPERATOR`, `PRIVACY_CONTACT_EMAIL` |
| Image storage (all six or none) | S3-compatible bucket variables, `IMAGE_RETENTION_DAYS` (1 to 365, default 30) |

## Appendix B. Verification checklist for I.0

| # | Check | How | Record |
|---|---|---|---|
| 1 | LLM resilience | Unit tests for `llmChat`; curl `/assistant`, `/content/hashtags`, `/content/captions` | Command and output |
| 2 | Wrong model fails cleanly | Set `LLM_MODEL` to an invalid name; expect 502 with the reason and a log line | Output |
| 3 | Browser 400 | Network tab: URL, status, Response | URL and body |
| 4 | Local ECONNRESET | Backend terminal at the moment of the error; port check | Cause |
| 5 | Smoke scripts | `scripts/smoke-*.sh` against real Postgres and Redis | Pass or fail per script |
| 6 | Web build | `cd web`, `npm run build` | Result |
| 7 | UI walkthrough | Onboarding, Settings profile, Instagram card, comments, competitor history, voice and mic, Command Center | Screens seen |
| 8 | Housekeeping | Remove root patch files; refresh ledger header | Commit hash |
