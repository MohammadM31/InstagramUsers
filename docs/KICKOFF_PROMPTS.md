# Kickoff prompts for AI coding agents

Paste one prompt per session. Each one does **a single phase** of `docs/ROADMAP_v4.md` and then stops. Start every session from a fresh checkout of `main` (or of the branch that holds the previous phase, if it is not merged yet).

How to use:

1. Give the agent the repo (and write access if you want a branch and PR).
2. Paste the **Common preamble**, then the prompt for the phase.
3. When the agent reports, check its gate yourself (what you need to look at is listed under each phase), then tell it "Gate confirmed" (or what to fix) before starting the next phase.

---

## Common preamble (paste before every phase prompt)

```
You are a senior software engineer working in this repository (GrowthEngine / RaidTechs).

Read, in this order: CLAUDE.md, docs/ROADMAP_v4.md (especially section 0 "Corrections" and section 8 "Working protocol"), docs/AI_PROGRESS.md, docs/AI_DECISIONS.md, README.md, db/schema.sql. Where ROADMAP_v4.md section 0 disagrees with another document, section 0 wins.

Before writing code: run `git rev-parse HEAD`, run `npm test` and `node --check` on every file in src/, and record the results. If you cannot run Postgres and Redis, say so and label your evidence accordingly; never claim a stronger evidence label than your environment supports.

Work on ONLY the phase named below. Do not start the next phase. Follow the code conventions in CLAUDE.md, including: new tables cascade on account delete and are added to the GDPR export in src/routes.js; new test files are appended to the "test" script in package.json; migrations are additive and idempotent. Where the roadmap gives a "PROPOSED CONTRACT", implement it; record any deviation as a decision (number 106 onward, marked PROPOSED).

Where an item needs the owner (Render, Meta app, a browser, a real bucket), do not pretend it is done: prepare everything you can, mark it IMPLEMENTED - UNVERIFIED with the blocker named, and list the exact steps the owner must run.

When the phase's build items, tests and acceptance criteria are done: update docs/AI_PROGRESS.md (header with the real commit hash, item table with evidence labels) and docs/AI_DECISIONS.md, then STOP and report: what was built, files changed, commands run and results, what stays UNVERIFIED and why, decisions added, and the next item. Deliver a branch and pull request (or a git diff patch against a stated commit if you cannot push). Ask before doing anything outside the phase.
```

---

## Phase I.0 - Stabilize and verify

```
Do Phase I.0 of docs/ROADMAP_v4.md only.

AI items: I.0.1 (get llmChat into the code: the file llm-retry-fallback.diff is NOT in the repo, so implement llmChat from the specification in roadmap sections 2.3 and I.0.2, make the fetch injectable), I.0.2 (unit tests, registered in package.json), I.0.6 (housekeeping: remove the three loose patch files from the repo root once you have confirmed their changes are already in the code, refresh the ledger header, fix stale statuses and the decision numbering), and I.0.5 if your environment has Postgres and Redis.
Owner items (do not fake them): I.0.3 live curl checks after deploy, I.0.4 the browser 400 and ECONNRESET evidence, I.0.7 the Meta dev-mode app. For these, write the exact PowerShell and curl commands and a template for recording results in docs/AI_PROGRESS.md.

Acceptance: npm test passes, node --check is clean on every src file, the web build succeeds if you can run it, and grep shows only llmChat calls /chat/completions.
```

Owner checks for the gate: the Appendix B checklist, run on the deployed Render app.

## Phase I.1 - Tag and caption feature extraction

```
Do Phase I.1 of docs/ROADMAP_v4.md only. Implement src/textfeatures.js (pure, no DB, no network), the schema from the I.1.2 PROPOSED CONTRACT (competitor_post_tags must NOT have a foreign key to competitor_posts), the extraction hooks in importer.js, igsync.js and the scrape worker (idempotent), the backfill job, a retention job for competitor_post_tags, and the GDPR export and account-delete coverage.
Tests: unit tests for the extractor (Arabic and mixed tags, emoji next to tags, duplicates in different case, #1 and #2024, URL with #fragment, glued tags, 30-tag cap); a smoke script that imports a CSV with known tags, asserts the post_tags counts, runs the backfill twice and asserts no duplicates, and deletes the demo account and asserts no rows remain.
Treat D-I1 and D-I4 defaults as accepted unless I say otherwise; record them as decisions.
```

Owner checks for the gate: import a CSV with a few known tags (including Arabic ones) and compare the counts; export your data and confirm the new tables appear.

## Phase I.2 - Tag performance analysis

```
Do Phase I.2 of docs/ROADMAP_v4.md only (I.1 must be merged). Implement per-tag metrics, tag-set habits, early velocity where post_snapshots allow, GET /api/tags/performance and GET /api/tags/summary exactly as in the I.2 PROPOSED CONTRACT (including the shared confidenceFor function and the "correlation, not proof" note), rate limits, a nightly job plus on-demand computation, and the "Tags" card in Statistics.
Tests: pure functions on synthetic datasets with a known lift (state the tolerance); a tag below the minimum sample never appears as a recommendation; confidence levels follow the written thresholds. Write the thresholds into docs/AI_DECISIONS.md.
```

Owner checks for the gate: open the Tags card with your real or demo data; small-sample tags must be hidden and the wording must say correlation, not proof.

## Phase I.3 - Market tag discovery and competitor tag intelligence

```
Do Phase I.3 of docs/ROADMAP_v4.md only. Build I.3.1 (competitor tag intelligence, from stored data, not blocked) fully and verify it end to end. Build I.3.2 to I.3.6 (src/hashtagsearch.js, the query budget manager, derived market stats, tag_market, POST /api/tags/discover, GET /api/tags/market, the fallback behavior) against the mock Graph server (scripts/mock-graph.js, test/fixtures/graph/) and mark them IMPLEMENTED - UNVERIFIED with the blocker named (Meta app review for Hashtag Search; A.0).
Re-check the current Meta documentation for the Hashtag Search limits (unique hashtags per rolling 7 days) and field names before coding, and put the figures you found, with the source, in docs/AI_DECISIONS.md. Do not store third-party captions from hashtag search.
Tests: mock fixtures including permission-missing, cap-exceeded and empty results; unit tests for the budget manager.
```

Owner checks for the gate: the Competitors/tags view shows which sources were used; without Hashtag Search the screen says so.

## Phase I.4 - Timing, format, caption traits, unified recommendations

```
Do Phase I.4 of docs/ROADMAP_v4.md only. Start with I.4.1: check what time zone the database session uses, then convert posted_at using business_profile.timezone (browser zone as fallback, validated against pg_timezone_names) before grouping. Then best windows, format mix, caption traits, and the single recommendation schema exactly as in the I.4.5 PROPOSED CONTRACT: keep every existing field of GET /api/priorities, add the new fields, give each recommendation family its own dismissal kind, and return a need_data item for fresh accounts.
Tests: synthetic datasets with a known best hour and best format; a fresh account gets "what I need to know"; Command Center and Dashboard still render; a time-zone test with Asia/Beirut across a DST change.
```

Owner checks for the gate: Command Center and Dashboard still look right; a recommendation shows its sample size and confidence.

## Phase I.5 - Best-approach planner and feedback loop

```
Do Phase I.5 of docs/ROADMAP_v4.md only. Implement deterministic slot selection, the tag-set composer, the plan_items table and endpoints exactly as in the I.5 PROPOSED CONTRACT (including scheduled_posts.ig_media_id stored by the publisher), the plan UI (Command Center card and the Scheduling plan view, including the hashtag set builder with per-set performance), the outcome feedback loop at 48 h and 7 d with shrinkage and an exploration share labeled A/B, and the two notifications.
The LLM writes only caption, topic and image prompt per slot through llmChat with JSON validation; the template fallback must produce a complete plan when the LLM is stubbed to fail. "Add to schedule" is an explicit user action.
Tests: plan generation with the LLM failing; slot times inside the recommended windows; tag sets respect the blocklist and tier rules; outcome computation on synthetic before/after data; hit rate hidden below the minimum sample.
```

Owner checks for the gate: generate a plan with the LLM key removed (fallback) and with it set; confirm nothing is scheduled until you click.

## Phase I.6 - Posting automation hardening

```
Do Phase I.6 of docs/ROADMAP_v4.md only. Implement the approval queue and the additive scheduled_posts columns exactly as in the I.6 PROPOSED CONTRACT (status 'scheduled' keeps meaning approved so the publisher claim query and index are unchanged), robust publishing (persist creation_id before media_publish, resume instead of double-posting, container-status polling, retry with backoff), carousel and Reels support, token-expiry handling with a reconnect notification, the real failure reason in the schedule list, C.2 (call releaseAfterPublish after a successful publish), and time zones plus "post now" in the Scheduling UI. Autopilot ships behind a flag, default OFF, only if decision D-I2 says so; otherwise implement approval-only.
Verify on the mock Graph with failure injection (container error, expired token, timeout after creation, duplicate publish). Live checks need a real test account (A.0), a real bucket (C.1) and, for Reels, C.1b: mark them IMPLEMENTED - UNVERIFIED with the blocker.
Before promising Stories or a per-day publishing limit, check the current Meta documentation and record the source.
```

Owner checks for the gate: with Instagram connected to a test account, publish one image, one carousel and one Reel, and break the token once to see the reconnect path.

## Phase I.7 - Demo readiness and productization

```
Do Phase I.7 of docs/ROADMAP_v4.md only. I.7.1: hide the Marketing, CRM, Ads and Collabs placeholders from the sidebar (do not build them unless I say so). I.7.2: demo data for tag intelligence and the weekly plan, clearly labeled demo. I.7.3: export the insights and the weekly plan as PDF or spreadsheet. I.7.4: only if 3 or more days of real snapshots exist; otherwise mark NOT STARTED / BLOCKED. I.7.5: draft the Meta review pack text (use cases, screencast script, privacy policy and data-deletion URL list); I will record screencasts and submit it myself.
Acceptance: a walkthrough with no dead tabs and every number traceable to data or labeled demo.
```

---

## Handy follow-up prompts

**Gate confirmed:** `Gate confirmed for Phase I.x. Record that in docs/AI_PROGRESS.md, then stop. I will start the next phase in a new session.`

**Fix after review:** `Review feedback on Phase I.x: <paste>. Fix only this, re-run the affected tests, update the ledger, and report.`

**Resume after a stop:** `Re-read CLAUDE.md and docs/ROADMAP_v4.md section 0, run git log --oneline -10 and git status, then tell me where Phase I.x stands before changing anything.`
