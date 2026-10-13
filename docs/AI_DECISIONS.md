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
