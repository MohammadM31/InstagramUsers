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
