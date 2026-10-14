# GrowthEngine AI — AI Progress Ledger
Last checked: 2026-10-14 (UTC)
Repository revision: user reports 934fe47 (the Phase 0 commit, pushed to origin/main). I only ever saw a GitHub "Download ZIP" of main (no .git) and could not confirm its hash. Patches are built against that zip: `phase-0-fix.diff`, then `phase-1.diff` on top of it.
Current phase/item: Phase 2 (2.2 per-post analysis, 2.3 notifications) written and verified against a live API; browser check of the new UI outstanding
Overall state: PHASE 1 GATE CONFIRMED (user, 2026-10-14). PHASE 2: 2.1 verified (API), 2.2 and 2.3 verified (API), UI unverified. Phase 2 gate NOT passed.

## Phase gates
- [x] Phase 0: GATE CONFIRMED by the user on 2026-10-13, with local evidence (Windows 11, Postgres 18, Memurai, Node 24.19.0): npm test 17/17, migrate, seed, /ready ok, login and /import/status valid JSON, frontend renders the Settings Import card. Not covered by that evidence: CSV upload from the UI, real provider calls, the 0.3 limit runs, Graph API import. All six defaults accepted.
- [x] Phase 1: GATE CONFIRMED by the user on 2026-10-14 ("everything works", after the browser check; the specific screens clicked were not itemised). AI evidence: live run on Postgres 16 + Redis, see "Live verification run".
- [ ] Phase 2 verified; user confirmation received before Phase 3   <- 2.1/2.2/2.3 coded + API-verified; needs the browser check of the bell and the expandable rows, then confirmation
- [ ] Phase 3 verified; user confirmation received before Phase 4
- [ ] Phase 4 verified

## Discrepancies found when reconciling the repo with the previous ledger
- `growthengine-api.zip` and a stray file `tatus` (a pasted `git diff --stat` output) were still in main. 0.6 claimed the zip was untracked. Both are deleted in this session's diff; run `git rm --cached` if your index still has them.
- Previous ledger said "4 open decisions"; the PDF report lists 6. Decisions log now covers all 6.
- Bug found: reel share never matched ('reel' vs stored 'REEL'). Fixed (decision 10).

- User-reported defect 1: `.env` was not loaded by plain `node src/server.js` (README line 9 implied it was; scripts relied on `--env-file`). Fixed in phase-0-fix.diff (src/loadenv.js, first import of every entry point).
- User asked whether the reel-case bug was fixed in Phase 0: NO. 934fe47 still has `t.type === 'reel'` in financePlan. It is fixed only in phase-1.diff (`needWeights`, case-insensitive).

## Item ledger
| ID | Status | Code evidence | Verification evidence | Blocker / next action |
|---|---|---|---|---|
| 0.1 | VERIFIED (API, previous session); UI card renders (user, 2026-10-13); UI upload not exercised | unchanged except 0.1b below | previous curl evidence + user: /import/status valid JSON, Settings card renders | Graph API path and an actual upload from the UI untested |
| 0.1b | VERIFIED (API live 2026-10-14; UI confirmed by user 2026-10-14) | importjob.js `makeProcessImport` (INSERT ... ON CONFLICT DO NOTHING, then `UPDATE ... SET col=coalesce(v.col,p.col)` for existing posts, one transaction), importer.js `missing` per row + merging `dedupeRows`, routes.js `?update=1`/`updateExisting`, Settings.tsx checkbox | Unit tests assert the statements and parameters sent (missing metric -> NULL -> keeps stored value; explicit 0 overwrites). The SQL has NOT been run against Postgres | run scripts/smoke-fix1.sh (partial refresh block) and scripts/smoke-phase1.sh (0.1b block) |
| 0.2 | VERIFIED (boot checks; user ran migrate, seed, /ready). `.env` loading: IMPLEMENTED — UNVERIFIED on Windows | loadenv.js imported first by server/worker/migrate/seed/config | test/loadenv.test.js passes on Linux Node 22 (CRLF .env, real env wins, missing .env ok) | user: run plain `node src/server.js` with only a .env file |
| 0.3 | VERIFIED (assistant + login) | unchanged | previous session | image/captions buckets not driven to limit; monthly quotas deferred |
| 0.4 | IMPLEMENTED — UNVERIFIED (provider call) | unchanged | | test with a real user key |
| 0.5 | VERIFIED (API, mock); UI IMPLEMENTED — UNVERIFIED | routes.js now calls `enqueueImage` (imagejobs.js) | previous session's evidence predates this refactor; re-run | re-check POST /content/image after the refactor |
| 0.6 | IMPLEMENTED — UNVERIFIED (Windows) | zip + `tatus` removed in working tree | | `git rm --cached growthengine-api.zip tatus`; run Windows steps once |
| 0.7 | VERIFIED (previous session) | GDPR export now also lists post_snapshots and metrics_baseline | export change not run | run smoke-regression.sh |
| 0.8 | VERIFIED (API live 2026-10-14; UI confirmed by user 2026-10-14) | assistant.js image branch -> `enqueueImage`; imagejobs.js; Assistant.tsx polls /content/image/:jobId (2s, 60s, cancels when a newer request replaces the card) | none beyond syntax/type check | run smoke-phase1.sh last block; try with a Replicate key or the mock |
| 1.1 | VERIFIED (API live 2026-10-14; UI confirmed by user 2026-10-14) | advisor.advise (+why/watch), insights.js `priorities`, GET /api/priorities, DashboardCards.tsx `Priorities` on Dashboard above the KPI grid | unit tests; handler test with fake deps | smoke-phase1.sh; look at the card in a browser |
| 1.2 | VERIFIED (API live 2026-10-14; UI confirmed by user 2026-10-14) | advisor.contextGaps, insights.js `aiContext`, GET /api/ai/context, `AIContext` card (health ring, sources table, gaps). Includes imports as a source and flags seeded demo data | unit tests; handler test with fake deps. SQL not run | smoke-phase1.sh |
| 1.3 | VERIFIED (API live 2026-10-14; UI confirmed by user 2026-10-14) | App.tsx PAGES key and icons.tsx key renamed to "Statistics"; README updated | tsc clean against loose stubs | click through the drawer in a browser |
| 1.4 | VERIFIED (API live 2026-10-14; UI confirmed by user 2026-10-14) | advisor.needWeights (shared with financePlan), marketingBreakdown, GET /api/marketing/breakdown, Statistics card labelled as estimates | unit tests (shares ~100, low confidence carries "correlation, not causation") | smoke-phase1.sh; browser |
| 2.1 | VERIFIED (API live 2026-10-14: 56 snapshots / 56 posts, restart adds none) | schema.sql post_snapshots (+ unique per post per UTC day), metrics_baseline; snapshots.js; worker.js `startSnapshots` (5s after boot, then hourly) | runSnapshots unit test with fake q. SQL not run; no worker run | `npm run migrate`, start worker, query tables, restart and confirm no duplicates |
| 2.2 | VERIFIED (API live 2026-10-14); UI IMPLEMENTED — UNVERIFIED | advisor.postAnalysis + snapshotDelta (pure), insights.js `postAnalysis`, GET /api/posts/:id/analysis -> {text,delta,rank,snapshots}; ui.tsx DataTable `expand` prop; pages/PostAnalysis.tsx; Analytics.tsx rows expand on click | test/phase2.test.js (7 tests); smoke-phase2.sh: text+rank returned, other user 404, bad id 400, no token 401, delta appears once snapshots span 2 days (the second snapshot was inserted by the script, not collected) | click a row in Statistics in a browser |
| 2.3 | VERIFIED (API live 2026-10-14); UI IMPLEMENTED — UNVERIFIED | schema.sql `notifications` (+ UNIQUE(user_id,dedupe_key)) and `metrics_baseline.ahead`; advisor.detectAlerts (pure); notifications.js `runNotifications` (hourly, 15s after boot) + handlers; routes: GET /notifications, PATCH /notifications/:id and /read-all, DELETE /notifications/:id; web/src/Notifications.tsx bell in the header; GDPR export includes notifications | test/phase2.test.js (10 tests); smoke-phase2.sh: day one created 0; forced drop -> reach_drop, er_drop, best_post (3); rerun 0 (dedupe); demo competitor data silent, non-demo -> 1 competitor alert; mark read / unread count; other user 404 on PATCH and DELETE; read-all; bad id 400; no token 401 | open the bell in a browser; monitoring-threshold alert is deferred to Phase 3 |
| 3.1 - 4.2 (8 items) | NOT STARTED | | | wait for gates |

## Latest checkpoint
- Completed this session: reconciled repo vs ledger; 0.1b, 0.8, Phase 1 (1.1-1.4), 2.1 written; one bug fixed (reel casing)
- Files changed: NEW src/imagejobs.js, src/insights.js, src/snapshots.js, test/phase1.test.js, scripts/smoke-phase1.sh, web/src/pages/DashboardCards.tsx; CHANGED src/advisor.js, assistant.js, importer.js, routes.js, worker.js, db/schema.sql, package.json, README.md, docs/*, web/src/App.tsx, icons.tsx, Assistant.tsx, pages/Dashboard.tsx, Analytics.tsx, Settings.tsx, styles.css; DELETED growthengine-api.zip, tatus
- Commands/tests and results: `npm test` 29/29 pass (17 earlier + 10 Phase 1 + 2 loadenv); `node --check` on all src files passes; `tsc --noEmit` on web/ against loose `any` stubs reports only the unrelated `./styles.css` import (same as before the changes)
- NOT run (no network, so no npm install, Postgres or Redis in the working environment): the API, `npm run migrate`, any SQL, `vite build`, any browser rendering, the smoke scripts
- Endpoints checked: none against a live server
- Unverified behavior / regressions: everything marked UNVERIFIED above. No regression run of the existing tabs
- User decisions / approvals: see AI_DECISIONS.md ("implement the next step" taken as acceptance of defaults)
- Exact next action: apply phase-1.diff, `npm run migrate`, `npm test`, `cd web && npm run build`, start with INLINE_WORKER=1, run `bash scripts/smoke-phase1.sh` and `bash scripts/smoke-regression.sh`, open Dashboard + Statistics + Settings in a browser, then report results so items can be marked VERIFIED
- Stop at phase gate: YES (do not start 2.2/2.3 or Phase 3 until Phase 1 is verified and confirmed)

## Fix patch after the Phase 1 review (phase-1-fix.diff) — IMPLEMENTED — UNVERIFIED against a live stack
- Fixed: refresh import zeroed metrics the file did not contain (0.1b); ambiguous day/month dates were guessed; `.env.example` held the real secrets (rotate them: they are in git history); README contradicted the code.
- Small fixes: true row numbers in import errors; Replicate key checked before the image rate limit; `--env-file=.env` removed from npm scripts; `IG Reel`/`Story` type aliases; `/schedule` returns 400 on invalid dates; `REPLACE_ME` JWT_SECRET rejected at boot.
- Not done: priorities "Dismiss" persistence (needs server state; belongs with the 2.3 notifications work).
- New files: src/importjob.js, src/schedule.js, test/fix1.test.js, scripts/smoke-fix1.sh. `npm test`: 42/42 pass (29 + 13 new). The existing importer test used `story` as its unknown-type example; Story is now valid, so it uses `podcast`.
- NOT run: Postgres, Redis, `vite build`, a browser, the smoke scripts.
- Known limits of the 0.1b refresh: posts are matched on date + type + caption, so a file with no caption column or date-only values inserts new rows instead of refreshing; a post whose Graph API insights failed has no reach and is rejected, never refreshed.

## Rules
- Repository + fresh evidence outrank this ledger.
- Inspect before editing; never overwrite unseen files.
- Preserve existing features and API contracts.
- Mark VERIFIED only with recorded acceptance evidence.
- Stop at each phase gate for user confirmation.

## Live verification run — 2026-10-14 (Linux, Node 22, Postgres 16, Redis, INLINE_WORKER=1, real DB)
Commands and results:
- `npm install`, `npm test`: 42/42 pass. `node --check` on every src file passes.
- `npm run migrate` run twice: both print `migrated` (idempotent). `npm run seed`: ok. `GET /ready` -> {"ok":true,"db":true,"redis":true}.
- `bash scripts/smoke-fix1.sh`: every line matches its "expect" note. Partial refresh keeps comments/saves/shares/impressions/watch_s; explicit `saves:0` overwrites; unchanged re-import reports updated 0; `01/10/2026` rejected with row number, `13/10/2026` accepted; `IG Reel` -> REEL, `Story` -> IMAGE; /schedule 400 400 400 then 200; image with no Replicate key -> 25 x 503, no 429.
- `bash scripts/smoke-phase1.sh`: /priorities 3 tips, none missing why/watch; /ai/context has coverage, gaps, health, metrics, sources and flags demo data; new user gets "No posts yet" gap; /marketing/breakdown estimate=true, every low-confidence row carries the correlation caveat; 3 x 401 unauthenticated; 0.1b skip vs ?update=1 behaves as expected; assistant image with no key returns type info.
- 2.1 snapshots: after boot 56 snapshots / 56 posts / 4 baselines (one per user with posts). Restart on the same day: counts unchanged, nothing inserted.
- `bash scripts/smoke-regression.sh`: dashboard, posts, insights, heatmap, competitors, assistant (analytics, finance), finance plan, schedule, GDPR export (no ciphertext), register/auth errors all as expected.
- `cd web && npm run build`: passes (843 modules; only the >500 kB chunk warning).
Status changes from this run: 0.1b, 1.1, 1.2, 1.4, 2.1, 0.7 (GDPR export incl. new tables) and the fix-patch items are now VERIFIED (API). 1.3, the Dashboard/Statistics/Settings cards, and the Assistant image polling card remain UI-UNVERIFIED (no browser).
Still NOT run: a browser; a real Replicate or OpenAI call (0.4, 0.5, 0.8 done path); Graph API import; Windows steps; a >12 h snapshot rollover across two UTC days.
Next action: click through Dashboard, Statistics, Settings (upload a CSV, tick the refresh box) and the Assistant in a browser, then confirm the Phase 1 gate.

## Phase 2 checkpoint — 2.2 and 2.3 — 2026-10-14
- Completed this session: Phase 1 gate recorded as confirmed; 2.2 per-post analysis; 2.3 notifications (API, hourly job, bell UI). 2.1 re-verified.
- Files changed: NEW src/notifications.js, test/phase2.test.js, scripts/smoke-phase2.sh, web/src/Notifications.tsx, web/src/pages/PostAnalysis.tsx; CHANGED src/advisor.js (postAnalysis, snapshotDelta, detectAlerts, ALERT_RULES), src/insights.js, src/routes.js, src/worker.js, db/schema.sql, package.json, web/src/ui.tsx, App.tsx, icons.tsx, styles.css, pages/Analytics.tsx, README.md, docs/*
- Schema impact (idempotent, migrate run twice): TABLE notifications, INDEX notifications_user_time, COLUMN metrics_baseline.ahead text[]
- Commands/tests and results: `npm test` 57/57 pass (42 + 15 new); `node --check` on every src file; `cd web && npm run build` (tsc --noEmit + vite) passes; `bash scripts/smoke-phase2.sh` all expectations met; smoke-regression, smoke-fix1, smoke-phase1 re-run with no regressions. Environment: Linux, Node 22, Postgres 16, Redis 7, INLINE_WORKER=1.
- Alert rules (advisor.ALERT_RULES): reach down more than 15% vs baseline; ER down more than 2 points vs baseline; a post beats the stored best_post_er; a tracked competitor now averages more likes+comments per post than the user (needs 3+ posts in 30 days, real source only). Drops alert once per week, best-post once per value, competitor once per rival per week.
- NOT done / limits: monitoring-threshold alert (Phase 3: needs posts.monitor_until); priorities "Dismiss" still resets on reload (decision 19; not in the 2.3 scope); competitor comparison uses likes+comments because reach is not public; the baseline is the first snapshot-job run and never rolls forward, so "since tracking started" is literal; no browser run of the bell or expandable rows; no real-provider calls.
- Exact next action: in a browser, open Statistics > click a post row (analysis panel), then trigger notifications (`DATABASE_URL=... bash scripts/smoke-phase2.sh` on a throwaway database, then reload) and check the bell badge, mark read, dismiss. Then confirm the Phase 2 gate.
- Stop at phase gate: YES (do not start Phase 3 until Phase 2 is confirmed; Phase 3 also needs 3+ days of snapshots, which accumulate only while the worker runs).
