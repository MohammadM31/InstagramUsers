// Per-user Redis limits (roadmap 0.3). Fixed window. Fails CLOSED (503) if Redis is down: these protect paid APIs.
import { redis } from './cache.js';
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
      if (!r.ok) { res.set('Retry-After', String(r.ttl)); return res.status(429).json({ error: r.msg }); }
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
  return n;
}
export const loginOk = (email, ip) => redis.del(LF(email, ip));
