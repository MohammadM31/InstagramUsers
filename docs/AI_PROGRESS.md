# GrowthEngine AI — AI Progress Ledger
Last checked: 2026-10-13 (UTC)
Repository revision: base efc8883 (main) + Phase 0 changes (branch phase-0 / phase-0.diff)
Current phase/item: Phase 0 complete pending user confirmation. Next: Phase 1 only after the gate.
Overall state: PHASE 0 AWAITING CONFIRMATION

## Phase gates
- [ ] Phase 0 verified; report delivered; user confirmation received before Phase 1   <- report delivered, WAITING for confirmation
- [ ] Phase 1 verified; user confirmation received before Phase 2
- [ ] Phase 2 verified; user confirmation received before Phase 3
- [ ] Phase 3 verified; user confirmation received before Phase 4
- [ ] Phase 4 verified

## Item ledger
| ID | Status | Code evidence | Verification evidence | Blocker / next action |
|---|---|---|---|---|
| 0.1 | VERIFIED (API); UI IMPLEMENTED — UNVERIFIED | schema.sql posts_dedupe + import_log; routes.js /import/*; worker.js processImport; importer.js, csv.js; Settings.tsx card | curl: CSV import imported 3 / invalid 1; same CSV again duplicates 3; JSON 1 new + 1 dup; /posts shows rows; /import/status count 4; other user gets 404 on the job and sees none of the seeded rows | Graph API path untested (needs IG token); Settings card not rendered in a browser |
| 0.2 | VERIFIED | config.js; auth.js, crypto.js no fallbacks; server/migrate/seed/worker call validateEnv | missing/malformed ENCRYPTION_KEY and short JWT_SECRET each exit 1 with a clear message; valid env boots; config.test.js | none |
| 0.3 | VERIFIED (assistant + login); other buckets share the same code | ratelimit.js; routes.js limit() on assistant/image/captions-hashtags/import | assistant: 30x200 then 429 + Retry-After 3600; second user unaffected; login: 10x401 then 429 (also with the correct password), different email unaffected | image 20/h and captions 60/h buckets not exercised to the limit; monthly quotas deferred (optional in plan) |
| 0.4 | IMPLEMENTED — UNVERIFIED (provider call) | keys.js getUserKey/keyFor/llmConfig; images.js, assistant.js, routes.js use it | script: stored key beats env, env is fallback, stored openai key selects api.openai.com; image job accepted with only a stored key; unreadable key row no longer breaks GET /settings/keys | no live call to OpenAI/Replicate with a user key (no provider network here) |
| 0.5 | VERIFIED (API, mocked Replicate); UI IMPLEMENTED — UNVERIFIED | worker.js processImage; routes.js POST/GET /content/image; Content.tsx polling | POST returned {jobId} in 16 ms; states pending (also with worker stopped), done (1080x1350 PNG with overlay), failed; other user 404 | real Replicate untested; assistant-initiated images are still synchronous (see 0.7) |
| 0.6 | IMPLEMENTED — UNVERIFIED (Windows) | zip git rm + *.zip in .gitignore; README rewritten; .env.example, render.yaml | git status shows zip deleted | Windows steps not run on Windows; zip still exists in git history (contains no secrets) |
| 0.7 (new) | VERIFIED | /ready, CORS prod default, GDPR export completeness, 3 indexes, variadic route helpers, auth body validation, scripts/smoke-*.sh | smoke-regression.sh all expected codes; export has api_keys names only | none |
| 1.1 - 4.2 (all 13 items) | NOT STARTED | | | wait for gate |

## Latest checkpoint
- Completed this session: Phase 0 items 0.1 - 0.6 plus new item 0.7
- Files changed: see PDF report / phase-0.diff (new: config.js, csv.js, importer.js, keys.js, ratelimit.js, 2 tests, 2 smoke scripts, docs/; changed: auth, crypto, images, assistant, routes, worker, queue, server, migrate, seed, schema.sql, README, .env.example, render.yaml, package.json, api.ts, Content.tsx, Settings.tsx; deleted from git: growthengine-api.zip)
- Commands/tests and results: `npm test` 17/17 pass; `cd web && npm run build` passes; migrate run twice OK (idempotent); endpoint checks as above
- Endpoints checked: /import/posts, /import/status, /import/jobs/:id, /content/image (POST/GET), /settings/keys, /assistant, /auth/login, /ready, plus regression set
- Unverified behavior / regressions: no regressions found. Untested: browser rendering of UI changes, Graph API import, real Replicate/OpenAI calls, Windows setup
- User decisions / approvals: none recorded yet (see AI_DECISIONS.md for decisions awaiting confirmation)
- Exact next action: user confirms Phase 0 (and answers the 4 open decisions); then start Phase 1 and pull forward 2.1 (snapshots) so Phase 3 has its 3 days of history
- Stop at phase gate: YES

## Rules
- Repository + fresh evidence outrank this ledger.
- Inspect before editing; never overwrite unseen files.
- Preserve existing features and API contracts.
- Mark VERIFIED only with recorded acceptance evidence.
- Stop at each phase gate for user confirmation.
