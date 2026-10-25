// R.0: feature flags and kill switches, stored in feature_flags. Reads are served from a 10 second in-process cache; setFlag clears it at once
// (on this instance; other instances catch up within 10 s). getFlag never throws: if the table cannot be read it returns the default you pass.
export const FLAG_KEYS = ['ai_enabled', 'image_generation_enabled', 'maintenance_mode', 'gemini_model', 'announcement'];
export const FLAG_TTL_MS = 10000;

export function makeFlags({ q, ttlMs = FLAG_TTL_MS, now = Date.now }) {
  let cache = null, loadedAt = 0, inflight = null;
  async function load() {
    if (cache && now() - loadedAt < ttlMs) return cache;
    if (!inflight) inflight = q('SELECT key,value FROM feature_flags').then(rows => { cache = Object.fromEntries(rows.map(r => [r.key, r.value])); loadedAt = now(); return cache; }).finally(() => { inflight = null; });
    return inflight;
  }
  async function getFlag(key, def = null) {
    try { const m = await load(); return Object.prototype.hasOwnProperty.call(m, key) && m[key] !== undefined ? m[key] : def; }
    catch { return def; }
  }
  async function setFlag(key, value, actorId = null) {
    if (!FLAG_KEYS.includes(key)) throw Object.assign(new Error('unknown flag ' + key), { status: 400 });
    await q(`INSERT INTO feature_flags(key,value,updated_by,updated_at) VALUES($1,$2::jsonb,$3,now())
      ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=now()`, [key, JSON.stringify(value ?? null), actorId]);
    cache = null; loadedAt = 0; // the next read sees the new value
  }
  return { getFlag, setFlag };
}

let real;
const flags = () => real ??= import('./db.js').then(m => makeFlags({ q: m.q }));
export const getFlag = async (key, def = null) => (await flags()).getFlag(key, def);
export const setFlag = async (key, value, actorId = null) => (await flags()).setFlag(key, value, actorId);
