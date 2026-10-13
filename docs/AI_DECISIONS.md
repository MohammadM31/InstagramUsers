# GrowthEngine AI — Decisions Log
Dated record of tradeoffs. "Proposed" means the AI chose a default; the user has not yet confirmed it.

## 2026-10-13 — Phase 0
1. 0.4 per-user keys: IMPLEMENTED rather than removing the Settings UI. (Proposed; user said "apply the necessary changes".) A stored `openai` key always uses api.openai.com; env LLM_* remains the fallback for Gemini/DeepSeek.
2. 0.3 monthly LLM/image quotas and reset job: DEFERRED (optional in the plan). Hourly limits shipped. (Proposed.)
3. Rate limiter fails CLOSED (503) if Redis is down, because it protects paid APIs. (Proposed.)
4. Assistant-initiated image generation stays synchronous; it spends from the same 20/h image budget. Moving it to the async job is proposed as 0.8. (Proposed.)
5. Import dedupe uses DO NOTHING as the plan says, so re-importing an updated CSV does NOT refresh metrics of existing posts. This matters for Phase 2 snapshots; an opt-in update-on-duplicate mode is proposed. (OPEN: needs user decision.)
6. Existing duplicate posts are removed once by schema.sql (keeps the lowest id) so the unique index can be created. (Proposed.)
