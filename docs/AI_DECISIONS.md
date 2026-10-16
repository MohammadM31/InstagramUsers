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

## 2026-10-15 - A.1c / A.1d (rebuilt in session 3)
33. The zip contained only A.1a/A.1b; the earlier A.1c/A.1d work was lost with its sandbox, so it was re-implemented from the PDF. Numbers that came from the lost version (thresholds, 14 days) were reused only where the user had been told about them; they are still the AI's choices.
34. PROPOSED, needs your confirmation (changes data-model shape): `ig_accounts.fb_user_id`. Meta's deauthorize and data-deletion callbacks identify a person only by their Facebook user id, so it is stored on the account (read from `/me` at connect, best effort; an account connected before this change has none until it reconnects, so Meta callbacks cannot match it).
35. PROPOSED: `follower_history.source` ('live' | 'reconstructed') so back-filled numbers can be labelled. Reconstructed rows are walked back from today's total using Instagram's daily NET follower change; they never overwrite a live row.
36. PROPOSED thresholds (not in the PDF): follower_drop tip when followers fall more than 1% in 7 days; with follower history the collab tip fires below 2% growth over 30 days and the giveaway tip below 0% (reach-based rules unchanged: 5% and 0%).
37. PROPOSED: Dismiss hides a tip for 14 days by default (API accepts 1 to 365 whole days); the key is the tip kind. Undo and Restore delete the row.
38. Under 100 followers (PDF rule): only today's total is stored, net_new is NULL, no demographics or online-time are requested, and a note says why. Account problems never stop the post sync; they are reported in last_error.
39. Account insights are requested for yesterday and the day before on every run (48 h lag), not as a 30-day back-fill (except follower_count, which is back-filled once). follows_and_unfollows is stored only when the breakdown labels are exactly FOLLOWS and UNFOLLOWS, otherwise NULL. These parse rules are guesses about Meta's responses: UNVERIFIED.
40. The deletion callback deletes posts that carry an ig_media_id (same rule as decision 32), the A.1c tables, the token and the ig_accounts row. It stores only sha256(fb user id) plus a result text, and no user id.
41. /privacy is a DRAFT written from what the code stores. It shows a DRAFT banner until PRIVACY_OPERATOR and PRIVACY_CONTACT_EMAIL are set. It must be reviewed (and updated when A.2 comments ship) before Meta submission.
42. The ?ig= redirect result is read once at load, shown as a dismissible banner, the URL is cleaned, and the app opens Settings.

## 2026-10-15 - O.1 (session 4, after "continue development")
43. "continue development" taken as the go-ahead past Gate A.1 for work that needs no Meta account (O.1). Gate A.1 itself is still NOT passed: it needs A.0 + a real test account. Decisions 34-37 stay PROPOSED (the user did not answer them).
44. business_profile is created inside a guarded DO block: existing users are backfilled as complete exactly once (table creation), so nobody already using the app is forced through onboarding, while users who register later get no row and start at step 'about'. seed.js marks the demo user complete.
45. Steps: about, connect, business, voice, goals, content. connect (O.2) and voice (O.3) own no profile fields yet. Only 'about' (display name) is required; every other step can be skipped; saving a skipped step un-skips it; progress never moves backwards when an earlier step is edited.
46. Validation is strict: an unknown field or a field from another step is a 400 (never silently dropped); null clears optional fields; numbers must be JSON numbers. goal_baseline_value is accepted but is filled by O.4 at goal time. goal_secondary must differ from goal_primary when both are in one request (a stored-vs-new clash is not checked).
47. PUT /api/profile (O.6 backend) is a partial update across all fields, does not change onboarding progress, and returns 409 if the user never started onboarding.

## 2026-10-15 - O.1 UI (session 4c)
48. Guard lives in App.tsx (no router): after login it asks GET /api/onboarding; completed -> app, otherwise the wizard. If that request fails the app opens normally (a profile-check failure must never lock a user out).
49. The wizard's voice step is a placeholder (O.3 not built). Skipping it records "skipped" on the server so O.3 can offer it again; Settings (O.6) will be the place to set it later.
50. The wizard pre-fills time zone from the browser and language "en" as suggestions only; nothing is saved until the user presses Continue.
51. test/onboardingUi.test.js imports a .ts file, which needs Node 22.18+ (the user runs 24.19). On older Node those 7 tests are reported as skipped, not failed.

## 2026-10-16 - O.2 (session 6)
52. PROPOSED, needs your confirmation (changes data-model shape): the roadmap's "skip with @handle only" has nowhere to be stored today (connect owns no profile fields, decision 45). Smallest change: one nullable text column `business_profile.ig_handle` (validated as an Instagram username, owned by step `connect`). Until you confirm, the connect step offers only "skip" and "import a CSV instead", and the Dashboard says plainly that it has no live data. An @handle alone cannot fetch anything (no Instagram data without the person's own connection), so it would be a label for later steps, not live data.
53. The permission list and the failure fixes shown in the wizard live in web/src/ig.ts and are tested against the server's IG_SCOPES and CONNECT_ERRORS, so a new scope or error code that is not described in the UI fails a test.
54. The first sync starts by itself, once, when the connect step opens for an account that is connected and has never synced. It uses the normal 5-minute per-user cooldown, so a refresh cannot trigger repeated pulls.
55. The ok message from the redirect is not shown in the wizard (it told people to press Sync now, which the step now does for them); error messages are shown with their code-specific fix.

## 2026-10-16 - O.3 brand voice (session 7)
56. The code lives in a new src/brandvoice.js, not in src/onboarding.js as the roadmap's machine index says. onboarding.js owns the profile fields and the step state machine; the voice has its own tables, versioning and LLM call, so it follows the same factory pattern in its own module. The wizard still marks the voice step done through PATCH /api/onboarding/voice.
57. PROPOSED (a name that affects data shape): the columns are `dos` and `donts`, not `do` and `dont`, because DO is a reserved word in Postgres (a table with a column `do` fails to create; checked). The API and the UI still say `do` and `dont`.
58. Privacy (D11, accepted via "continue"): raw example captions leave the server only inside POST /api/onboarding/voice/generate, only when `consent:true`, and only to the person's OWN stored OpenAI key (the env key is never used for samples). Reference links are stored as reminders and never fetched or sent (no scraping). The assistant and the caption/hashtag generators receive only the voice profile (summary and options), never raw samples. A person with no key of their own still gets a template summary written from their options.
59. PROPOSED limits (AI's choices, not in the PDF): 10 AI summaries per hour per user in their own Redis bucket `voice-llm` (separate from the 60/h captions-hashtags bucket; the template path costs nothing); all voice writes 120 per hour (`voice-edit`); 30 examples per user; caption example up to 2000 characters, link note up to 300; up to 5 tone tags and 8 lines in each Do / Avoid / phrases list. When the AI budget is used up the answer is a template summary with reason `budget`, not an error.
60. Versioning: every save (PUT or generate) inserts a new row and the highest version is current; nothing is pruned. PUT is a partial update merged over the current version. PUT without a summary rebuilds the template summary from the options, so Tweak replaces an AI-written summary with a template one until the person presses Redo. A new version number is taken with INSERT ... SELECT max(version)+1 and retried when two saves collide (tested under real contention).
61. PROPOSED vocabulary (not in the PDF): tone tags (12), formality casual/balanced/formal, length short/medium/long, emoji none/low/med/high (same words as the existing caption generator), hashtag style niche/mixed/popular/branded. The UI lists are compared with the server's in test/voiceUi.test.js, so changing one without the other fails a test.
62. "Yes, that is me" calls PATCH /api/onboarding/voice with an empty body, which marks the step done (not skipped). In the UI the Yes button only exists once a voice has been generated or saved; the API itself does not require a saved voice (same as the connect step).
63. The assistant looks the voice up only when an LLM is configured (the regex fallback never uses it), and any failure to read it means "no voice", never an error for the person.
64. Additive beyond the PDF: an example can be created from one of the person's own posts (`source_post_id`, checked for ownership; the caption is copied). If that post is deleted the example stays and the link is cleared.
65. Not built (not in the O.3 scope): deleting a whole voice, restoring an older version, a voice editor in Settings (that is O.6), and using the profile's niche/summary in captions (the PDF only asks for the voice).

## 2026-10-16 - O.4 goals (session 8)
66. No new column. The roadmap's baseline-at-goal-time uses the existing `goal_baseline_value`. It is filled by GET /api/goal the first time the goal can be measured (an UPDATE that only touches an empty column), and `onboarding.save` clears it when the goal's measure or target number changes (a deadline-only change keeps it). Consequence: the start value is "today's number on the first read after the goal was set", not the exact moment of saving. An explicit baseline sent by the client is kept.
67. Pace needs no goal start date (there is no such column and adding one changes data shape). Instead the recent rate is projected to the deadline and compared with what is still needed: ratio >= 1.1 ahead, >= 0.9 on track, else behind. The 0.9/1.1 band is my choice (PROPOSED). Rate source: followers change over 30 days (else 7), reach 30-day total change per day, none for engagement rate (pace stays null and says so).
68. A followers goal with no follower history is NOT measured from reach. The PDF says "follower_history when present else reach with label"; converting reach into followers would be a made-up number, so the card says there is no follower history and shows the reach trend as text only. Reach and er goals use post data and say so in `dataUsed`. PROPOSED: tell me if you want a different fallback.
69. A reach change of exactly 0% gives no reach pace, because pageMetrics returns 0 both for a flat month and for "no earlier month".
70. PROPOSED weights (my choices, not in the PDF): see advisor.GOAL_AREA_FOCUS (area multipliers 1.25-1.5) and GOAL_TIP_BONUS (priority +1 to +3). The goal never removes a tip or an area; it re-orders and re-weights, and the tip's `why` says it was ranked higher because of the goal. Only goal_primary is used; goal_secondary is returned by /api/goal but does not weight anything yet.
71. The goal reaches the advisor through `pageMetrics().goal` (one extra query, any failure = no goal), so the assistant, finance split, priorities and breakdown all agree without changing their signatures.

## 2026-10-16 - 4.2 editable responses and D.1 voice input (session 10)
72. 4.2 keeps one row per (user, original text), so editing the same reply twice updates the edit and never overwrites the original. Table and columns follow the PDF (`saved_responses`, original, edited) plus `kind` ('assistant' | 'proposal_caption' for C.3), timestamps and a 500-row cap per user (my choice, PROPOSED). Text limit 4000 characters on both sides; an unchanged or empty edit is a 400.
73. Only plain text replies are editable (not images, the analytics card, the finance split, or a reply still generating). The marker is a small italic "edited" tag; the original shows in its tooltip. There is no "reset" button yet.
74. The person can list and delete saved edits through the API (GET /api/responses, DELETE /api/responses/:id); no screen uses it yet. Saved edits are in the GDPR export and deleted with the account (cascade).
75. D.1 is browser-only (decision D10): no backend, no audio leaves the page except to the browser's own speech service, stated in a notice shown before first use (remembered in localStorage). Language picker defaults to the first language from setup; the list (English, Arabic, French, Spanish, German) is my choice, PROPOSED. Continuous mode is a toggle, off by default.
76. No keyboard shortcut was added for the mic (see the checkpoint). Permission denied or no microphone disables the mic with the reason; other errors show a message and leave the mic usable.

