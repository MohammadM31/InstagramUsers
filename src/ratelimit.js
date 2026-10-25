// Per-user Redis limits (roadmap 0.3). Fixed window. Fails CLOSED (503) if Redis is down: these protect paid APIs.
import { redis } from './cache.js';
import { isEventType, securityKey, hourKeys, lockoutPattern } from './rbac/security.js';
export async function hit(name, uid, max, windowSec) {
  const k = `rl:${name}:${uid}`, n = await redis.incr(k);
  if (n === 1) await redis.expire(k, windowSec);
  if (n <= max) return { ok: true };
  const ttl = Math.max(1, await redis.ttl(k));
  return { ok: false, ttl, msg: `Rate limit reached for ${name}: ${max} per ${windowSec >= 3600 ? windowSec / 3600 + 'h' : windowSec / 60 + 'min'}. Try again in ${Math.ceil(ttl / 60)} min.` };
}
export function limit(name, max, windowSec) {
  return async (req, res, next) => {
    try {
      const r = await hit(name, req.uid, max, windowSec);
      if (!r.ok) { recordSecurityEvent('rate_limit'); res.set('Retry-After', String(r.ttl)); return res.status(429).json({ error: r.msg }); }
      next();
    } catch (e) { console.error('ratelimit', e.message); res.status(503).json({ error: 'rate limiter unavailable' }); }
  };
}
// Login lockout: 10 failures per email+IP -> 429 for 15 min.
const LF = (email, ip) => `lf:${String(email).toLowerCase()}:${ip}`, MAXF = 10, LOCK = 900;
export async function loginLocked(email, ip) {
  const n = +(await redis.get(LF(email, ip))) || 0;
  return n >= MAXF ? Math.max(1, await redis.ttl(LF(email, ip))) : 0;
}
export async function loginFailed(email, ip) {
  const k = LF(email, ip), n = await redis.incr(k);
  if (n === 1 || n >= MAXF) await redis.expire(k, LOCK); // lock window restarts at the 10th failure
  if (n === MAXF) recordSecurityEvent('lockout'); // R.0: counted once, when the lock starts
  return n;
}
export const loginOk = (email, ip) => redis.del(LF(email, ip));

// ---- R.0 security hooks (pure helpers: src/rbac/security.js) ----
// Hourly counters for the admin security view, kept 48 h. Accounting must never break a request, so nothing here throws.
export async function recordSecurityEvent(type, at = new Date()) {
  try {
    if (!isEventType(type)) return;
    const k = securityKey(type, at);
    if (await redis.incr(k) === 1) await redis.expire(k, 172800);
  } catch (e) { console.error('securityEvent', e.message); }
}
// Counts for the last `hours` hours, newest first, e.g. [3, 0, 1, ...]; zeros when Redis is unreachable.
export async function securityCounts(type, hours = 24, at = new Date()) {
  const keys = hourKeys(type, hours, at);
  try { return (await redis.mget(keys)).map(v => +v || 0); } catch { return keys.map(() => 0); }
}
// Lift a login lockout (admin "unlock"): deletes every lf:<email>:<ip> key for this email. Returns how many keys were removed.
export async function clearLockout(identifier) {
  let removed = 0;
  for await (const keys of redis.scanStream({ match: lockoutPattern(identifier), count: 100 })) if (keys.length) removed += await redis.del(...keys);
  return removed;
}
