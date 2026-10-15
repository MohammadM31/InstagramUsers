# GrowthEngine AI — Decisions Log
Dated record of tradeoffs. "Proposed" means the AI chose a default; the user has not explicitly confirmed it.

## 2026-10-13 — Phase 0
1. 0.4 per-user keys: IMPLEMENTED rather than removing the Settings UI. (Proposed; user said "apply the necessary changes".) A stored `openai` key always uses api.openai.com; env LLM_* remains the fallback for Gemini/DeepSeek.
2. 0.3 monthly LLM/image quotas and reset job: DEFERRED (optional in the plan). Hourly limits shipped. (Proposed.)
3. Rate limiter fails CLOSED (503) if Redis is down, because it protects paid APIs. (Proposed.)
4. Assistant-initiated image generation stayed synchronous in Phase 0 and spends from the same 20/h image budget. Moved to the async job as 0.8 (see below).
5. Import dedupe uses DO NOTHING as the plan says. An opt-in update-on-duplicate mode was proposed as 0.1b (see below).
6. Existing duplicate posts are removed once by schema.sql (keeps the lowest id) so the unique index can be created. (Proposed.)

## 2026-10-13 — Gate: "implement the next step"
The PDF report asked for six decisions and said its defaults apply if the user just says "continue". The user first replied by uploading the repository and asking to "implement the next step". Later the same day the user explicitly confirmed the Phase 0 gate and wrote "All six defaults accepted". D1 to D6 below are therefore confirmed decisions.
- D1 keep per-user keys UI: accepted (default).  D2 defer monthly quotas: accepted (default).
- D3 0.1b opt-in metric refresh on re-import: BUILT as `?update=1` / `{updateExisting:true}` plus a Settings checkbox. Default stays "skip".
- D4 0.8 assistant images async: BUILT (queue + polling card). Content AI and assistant now share `src/imagejobs.js`.
- D5 formatting pass as its own commit: NOT DONE by the AI. `prettier` could not be installed (no network in the working environment). New modules are written readable; routes.js / worker.js keep their dense style. Do it locally with `npx prettier --write src web/src` as a separate commit AFTER applying the Phase 1 patch (see decision 12): formatting first would change every line the patch touches and make it fail to apply.
- D6 pull 2.1 snapshots forward: BUILT (post_snapshots, metrics_baseline, hourly idempotent job in the worker).

## 2026-10-13 — Phase 1 implementation choices
7. New endpoints use a small `makeInsights({q,pageMetrics})` factory in `src/insights.js` instead of adding more minified code to routes.js. routes.js only wires three lines. This follows the assistant.js pattern (handlers outside routes.js) and keeps them unit-testable.
8. Advice tips gained `why` and `watch` fields (additive; `priority`, `kind`, `text` unchanged) to meet the plan's explainability and measurement rules.
9. Marketing breakdown reuses the finance weights (`needWeights`) so money split and effort split cannot disagree. Collab/mention/giveaway rows are always LOW confidence and say "correlation, not causation".
10. Bug fix found during the work: `financePlan` looked for type `'reel'` but the database stores `'REEL'`, so the reel share was always 0 and the production need was always inflated. Matching is now case-insensitive. Money splits for real data will shift slightly.
11. AI Context treats a page as "demo data" when at least half its posts have captions starting "Demo caption" (what `seed.js` writes). Heuristic; stated as a gap, not asserted as fact.
12. Order of commits (agreed 2026-10-13 proposal): (a) apply phase-0-fix.diff (loads .env, removes growthengine-api.zip and the stray `tatus` file); (b) apply phase-1.diff; (c) run prettier as its own commit. Prettier runs last because the patch was built against the unformatted files.
13. `.env` loading: `src/loadenv.js` uses `process.loadEnvFile` (Node 20.12+/21.7+). Variables already in the environment win, like `--env-file`. The `--env-file=.env` flags in package.json scripts are harmless and left in place.

## 2026-10-14 — Phase 1 fix patch
14. 0.1b: "missing means don't change". The refresh is now an UPDATE with `coalesce(incoming, stored)` per metric instead of ON CONFLICT DO UPDATE (whose EXCLUDED row cannot tell "absent" from 0). New rows still store 0 for absent metrics so engagement sums never hit NULL. An explicit 0 in the file is a real value.
15. Dates: ambiguous slash/dot/dash dates (both numbers 12 or less, year last) are rejected, never guessed (user's option a). 2-digit years are rejected. Unambiguous slash dates are read as UTC.
16. `Story` imports as IMAGE and `IG Reel` as REEL (user request). Consequence: stories count in feed engagement statistics.
17. Import job moved to src/importjob.js and schedule handlers to src/schedule.js (injected deps, same pattern as insights.js, decision 7) so the fixes are unit-testable without Postgres.
18. config.js also rejects `REPLACE_ME` placeholders for JWT_SECRET in every environment (the placeholder is longer than 32 characters and would otherwise boot).
19. Priorities "Dismiss" persistence left as a Phase 2.3 task: it needs a server-side table and endpoints, which is a feature, not a one-line fix.

## 2026-10-14 — Phase 2 (2.2, 2.3)
20. Phase 1 gate: the user wrote "everything works" after running the stack and checking the UI. Recorded as confirmation; the screens were not itemised.
21. 2.2 returns `{text, delta, rank, snapshots}`. `delta` is null until snapshots exist on at least two different UTC days. The text compares ER with the user's average for that post type and the 30-day page average, names the largest interaction share, and always ends by saying it compares numbers rather than explaining causes (uncertainty rule).
22. 2.3 alerts are measured against `metrics_baseline`, not against the previous 30 days, so a page that has always looked weak does not alert on day one. Consequence: the baseline never rolls forward; a drop is "since tracking started". A rolling baseline is a possible later change.
23. Alert de-duplication is in the database (`UNIQUE(user_id,dedupe_key)`): reach and ER drops once per week, a best post once per ER value, a competitor once per rival per week. The hourly job is therefore safe to run any number of times.
24. "Competitor overtaking reach" is approximated by average likes + comments per post, because reach of other accounts is not public. The alert text says so. It needs 3+ competitor posts in 30 days.
25. Competitor alerts are suppressed when the user's latest scrape source is `demo` (synthetic data must not tell a user a rival overtook them). The competitor list at baseline time is stored in `metrics_baseline.ahead`; rivals already ahead then never alert, and the first run only records it.
26. The "monitoring threshold" alert listed in 2.3 is deferred to Phase 3 (it needs `posts.monitor_until`).
27. Priorities "Dismiss" persistence is still deferred (decision 19). It is not part of the plan's 2.3 scope and needs a product choice (how long a dismissal lasts), so it was not built.
28. `DataTable` gained an optional `expand` prop (additive; existing callers unchanged). Rows are keyed by `id` when present.


## 2026-10-15 - Roadmap v3 adopted
23. Roadmap v3 (AI Handoff PDF) is now the plan of record. Order follows D3 default (A.1, O, A.2/A.3, 3, B, C) until the user says otherwise. D1-D11 in the PDF are "proposed"; none confirmed yet.
24. P.0 confirmed by the user on 2026-10-15 ("P0 confirmed continue"). Per the PDF, "continue" accepts the section 6 defaults: D1-D11 are now treated as accepted (Facebook Login for Business, order A.1 > O > A.2/A.3 > 3 > B > C, one account per user, no Stories, 90-day comments, in-app notifications, voice browser-only, brand-profile consent checkbox).
## 2026-10-15 - Phase A.1a / A.1b implementation choices
25. Graph API version is one constant (src/instagram.js, default v25.0, override META_GRAPH_VERSION). Meta's changelog (checked 2026-10-15) lists v26.0 as latest and v25.0 supported until 2028-02; the old hard-coded v21.0 in worker.js (retires 2027-01-21) is gone. v25.0 chosen over v26.0 only to avoid a 10-week-old version; change it in one place if you prefer.
26. Connect start returns JSON {url}, not a 302, because a browser redirect cannot carry the bearer token. The callback is the one public route (server.js, before the authenticated router). State = 24 random bytes in Redis, 10 minute TTL, single use (consumed even when the user declines).
27. The user access token is exchanged for a long-lived one (fb_exchange_token) and stored encrypted in api_keys name 'instagram', overwriting a manually pasted key. Refresh re-exchanges the same way when under 15 days remain. UNVERIFIED that Meta accepts this for refresh; if it does not, the failure path (reconnect_needed + one notification) takes over, which is safe.
28. Credentials are per user (getIgCreds). A user who connected and lost the connection gets "reconnect" errors, never the env credentials (that would show another account's data). BEHAVIOUR CHANGE: in production the global IG_USER_ID/IG_ACCESS_TOKEN pair is ignored unless IG_ALLOW_ENV_FALLBACK=1 (PDF: "env fallback for dev only"). If your Render deployment relied on those env vars for the client demo, set that flag.
29. The competitor scrape cache is now per user (scrape:<uid>:<handle>) because results depend on whose credentials were used and demo data must never be served to a connected user.
30. Unavailable insight metrics are stored as NULL and a missing value never overwrites a stored one (coalesce). To keep engagement rates correct with NULLs, the ER sums in assistant.js, insights.js, notifications.js, routes.js and snapshots.js now use coalesce(x,0). Same results for existing data.
31. Insights are requested per media kind from a ladder (full list, then reach/saved/shares, then none). Only metrics with a column are requested; retired names throw at import time.
32. Disconnect with data=delete removes every post carrying an ig_media_id. That includes CSV rows that were matched to an Instagram post (their identity was linked to it), so it is stated in the API result as postsDeleted.
33. Daily sync slot = 02:00 in the user's time zone (UTC until O.1) plus a stable 0-6 h offset per user. Later runs re-pull only the last 3 days; the first run backfills up to 200 posts. Posts are matched to existing rows by ig_media_id, then UTC date + type + caption (closest timestamp wins), then inserted.
34. Test fixtures in test/fixtures/graph are hand-written from the documented response shapes, not recorded from a live account. The PDF's phrase "recorded fixtures" cannot be met until A.0 gives a test account.
