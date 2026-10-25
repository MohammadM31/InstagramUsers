// R.0: pure helpers for the security counters and lockout keys that src/ratelimit.js stores in Redis. No imports, so they are unit-tested directly.
export const EVENT_TYPE = /^[a-z_]{1,32}$/;
export const isEventType = t => typeof t === 'string' && EVENT_TYPE.test(t); // not String(t): undefined must not become the event "undefined"
// sec:<type>:<YYYYMMDDHH> in UTC: one counter per hour.
export const securityKey = (type, at = new Date()) => `sec:${type}:${at.toISOString().slice(0, 13).replace(/\D/g, '')}`;
// The counters for the last `hours` hours, newest first (1 to 48 hours).
export const hourKeys = (type, hours = 24, at = new Date()) => Array.from({ length: Math.min(48, Math.max(1, Math.floor(hours) || 1)) }, (_, i) => securityKey(type, new Date(at.getTime() - i * 3600e3)));
// Redis SCAN pattern for every login-lockout key of one email (lf:<email>:<ip>). Glob characters in the email are escaped so "a*@x.com" cannot unlock other people.
const escapeGlob = s => s.replace(/[\\*?[\]]/g, '\\$&');
export const lockoutPattern = identifier => `lf:${escapeGlob(String(identifier).toLowerCase())}:*`;
