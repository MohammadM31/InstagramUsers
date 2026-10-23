// Per-user API keys (roadmap 0.4). The user's stored key wins; env var is the fallback.
import { q } from './db.js';
import { decrypt } from './crypto.js';
export async function getUserKey(uid, name) {
  if (!uid) return null;
  const [r] = await q('SELECT enc FROM api_keys WHERE user_id=$1 AND name=$2', [uid, name]);
  if (!r) return null;
  try { return decrypt(r.enc) || null; } catch { return null; } // unreadable row (e.g. ENCRYPTION_KEY rotated) -> fall back to env
}
export const keyFor = async (uid, name, envValue) => (await getUserKey(uid, name)) || envValue || null;
// LLM settings for a user. A stored 'openai' key talks to api.openai.com (the Settings UI says "openai");
// otherwise fall back to the env-configured provider (OpenAI-compatible: Gemini, DeepSeek...).
export async function llmConfig(uid) {
  const own = await getUserKey(uid, 'openai');
  if (own) return { key: own, base: 'https://api.openai.com/v1', model: 'gpt-4o-mini', source: 'user' };
  const key = process.env.LLM_API_KEY;
  return key ? { key, base: process.env.LLM_BASE_URL || 'https://api.openai.com/v1', model: process.env.LLM_MODEL || 'gpt-4o-mini', source: 'env' } : null;
}

// Chat-completions call with retry + model fallback. Google returns 503 "high demand" / 429 in spikes; a single try used to
// make every caller silently drop to the regex rules. Tries cfg.model, then LLM_FALLBACK_MODELS (comma list, same provider),
// retrying each once after a short pause on 429/500/502/503/504 or a network/timeout error.
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
export async function llmChat(cfg, body, timeoutMs = 20000) {
  const models = [cfg.model, ...(cfg.source === 'env' ? (process.env.LLM_FALLBACK_MODELS || '').split(',').map(x => x.trim()).filter(Boolean) : [])];
  let last;
  for (const model of models) for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(cfg.base + '/chat/completions', { method: 'POST', signal: AbortSignal.timeout(timeoutMs),
        headers: { Authorization: 'Bearer ' + cfg.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, model }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.choices?.[0]?.message?.content) return j;
      last = new Error(`LLM ${model} -> HTTP ${r.status}: ${(j.error?.message || JSON.stringify(j)).slice(0, 200)}`);
      if (!RETRYABLE.has(r.status)) break; // 400/401/404: retrying the same model will not help; try the next one
    } catch (e) { last = new Error(`LLM ${model} -> ${e.name}: ${e.message}`); }
    await new Promise(res => setTimeout(res, 800));
  }
  throw last;
}