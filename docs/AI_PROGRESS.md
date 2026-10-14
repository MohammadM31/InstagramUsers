# GrowthEngine AI — AI Progress Ledger
Last checked: 2026-10-13 (UTC)
Repository revision: user reports 934fe47 (the Phase 0 commit, pushed to origin/main). I only ever saw a GitHub "Download ZIP" of main (no .git) and could not confirm its hash. Patches are built against that zip: `phase-0-fix.diff`, then `phase-1.diff` on top of it.
Current phase/item: Phase 1 + 2.1 written; NOT verified against a running stack
Overall state: PHASE 1 IMPLEMENTED — UNVERIFIED. Phase 1 gate NOT passed.

## Phase gates
- [x] Phase 0: GATE CONFIRMED by the user on 2026-10-13, with local evidence (Windows 11, Postgres 18, Memurai, Node 24.19.0): npm test 17/17, migrate, seed, /ready ok, login and /import/status valid JSON, frontend renders the Settings Import card. Not covered by that evidence: CSV upload from the UI, real provider calls, the 0.3 limit runs, Graph API import. All six defaults accepted.
- [ ] Phase 1 verified; user confirmation received before Phase 2   <- code written, needs `scripts/smoke-phase1.sh` + a browser check
- [ ] Phase 2 verified; user confirmation received before Phase 3
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
| 0.1b | IMPLEMENTED — UNVERIFIED (reworked in the fix patch) | importjob.js `makeProcessImport` (INSERT ... ON CONFLICT DO NOTHING, then `UPDATE ... SET col=coalesce(v.col,p.col)` for existing posts, one transaction), importer.js `missing` per row + merging `dedupeRows`, routes.js `?update=1`/`updateExisting`, Settings.tsx checkbox | Unit tests assert the statements and parameters sent (missing metric -> NULL -> keeps stored value; explicit 0 overwrites). The SQL has NOT been run against Postgres | run scripts/smoke-fix1.sh (partial refresh block) and scripts/smoke-phase1.sh (0.1b block) |
| 0.2 | VERIFIED (boot checks; user ran migrate, seed, /ready). `.env` loading: IMPLEMENTED — UNVERIFIED on Windows | loadenv.js imported first by server/worker/migrate/seed/config | test/loadenv.test.js passes on Linux Node 22 (CRLF .env, real env wins, missing .env ok) | user: run plain `node src/server.js` with only a .env file |
| 0.3 | VERIFIED (assistant + login) | unchanged | previous session | image/captions buckets not driven to limit; monthly quotas deferred |
| 0.4 | IMPLEMENTED — UNVERIFIED (provider call) | unchanged | | test with a real user key |
| 0.5 | VERIFIED (API, mock); UI IMPLEMENTED — UNVERIFIED | routes.js now calls `enqueueImage` (imagejobs.js) | previous session's evidence predates this refactor; re-run | re-check POST /content/image after the refactor |
| 0.6 | IMPLEMENTED — UNVERIFIED (Windows) | zip + `tatus` removed in working tree | | `git rm --cached growthengine-api.zip tatus`; run Windows steps once |
| 0.7 | VERIFIED (previous session) | GDPR export now also lists post_snapshots and metrics_baseline | export change not run | run smoke-regression.sh |
| 0.8 | IMPLEMENTED — UNVERIFIED | assistant.js image branch -> `enqueueImage`; imagejobs.js; Assistant.tsx polls /content/image/:jobId (2s, 60s, cancels when a newer request replaces the card) | none beyond syntax/type check | run smoke-phase1.sh last block; try with a Replicate key or the mock |
| 1.1 | IMPLEMENTED — UNVERIFIED | advisor.advise (+why/watch), insights.js `priorities`, GET /api/priorities, DashboardCards.tsx `Priorities` on Dashboard above the KPI grid | unit tests; handler test with fake deps | smoke-phase1.sh; look at the card in a browser |
| 1.2 | IMPLEMENTED — UNVERIFIED | advisor.contextGaps, insights.js `aiContext`, GET /api/ai/context, `AIContext` card (health ring, sources table, gaps). Includes imports as a source and flags seeded demo data | unit tests; handler test with fake deps. SQL not run | smoke-phase1.sh |
| 1.3 | IMPLEMENTED — UNVERIFIED | App.tsx PAGES key and icons.tsx key renamed to "Statistics"; README updated | tsc clean against loose stubs | click through the drawer in a browser |
| 1.4 | IMPLEMENTED — UNVERIFIED | advisor.needWeights (shared with financePlan), marketingBreakdown, GET /api/marketing/breakdown, Statistics card labelled as estimates | unit tests (shares ~100, low confidence carries "correlation, not causation") | smoke-phase1.sh; browser |
| 2.1 | IMPLEMENTED — UNVERIFIED | schema.sql post_snapshots (+ unique per post per UTC day), metrics_baseline; snapshots.js; worker.js `startSnapshots` (5s after boot, then hourly) | runSnapshots unit test with fake q. SQL not run; no worker run | `npm run migrate`, start worker, query tables, restart and confirm no duplicates |
| 2.2 - 4.2 (10 items) | NOT STARTED | | | wait for gates |

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
