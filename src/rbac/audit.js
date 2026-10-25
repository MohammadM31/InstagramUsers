// R.0: the audit trail writer. audit(req, {action, targetType, targetId, orgId, before, after, meta}) NEVER throws: a failed audit write is logged,
// it does not break (or silently allow) the action. Secrets are stripped from before/after/meta before they are stored.
const SECRET_KEY = /pass|hash|token|secret|api[_-]?key|authorization|cookie|enc$|^enc|credential|private/i;
const MAX_DEPTH = 6, MAX_STR = 2000;

// Copy of value with every secret-looking field replaced by '[redacted]' and long text cut. Pure.
export function redact(v, depth = 0) {
  if (v === null || v === undefined) return v ?? null;
  if (typeof v === 'string') return v.length > MAX_STR ? v.slice(0, MAX_STR) + '…' : v;
  if (typeof v !== 'object') return v;
  if (depth >= MAX_DEPTH) return '[truncated]';
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.slice(0, 100).map(x => redact(x, depth + 1));
  const o = {};
  for (const [k, x] of Object.entries(v)) o[k] = SECRET_KEY.test(k) ? '[redacted]' : redact(x, depth + 1);
  return o;
}
const json = v => (v === undefined || v === null ? null : JSON.stringify(redact(v)));

export function makeAudit({ q, log = console.error }) {
  return async function audit(req, e = {}) {
    try {
      if (!e.action || typeof e.action !== 'string') throw new Error('audit needs an action');
      await q(`INSERT INTO audit_log(actor_id,actor_role,org_id,action,target_type,target_id,before,after,meta,ip) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10)`,
        [req?.user?.id ?? null, req?.user?.role ?? null, e.orgId ?? req?.org?.id ?? null, e.action, e.targetType ?? null,
          e.targetId === undefined || e.targetId === null ? null : String(e.targetId), json(e.before), json(e.after), json(e.meta), req?.ip ?? null]);
    } catch (err) { try { log('audit failed:', e?.action, err?.message); } catch { /* never throws */ } }
  };
}

// The real writer (database loaded on first use, so importing this file opens nothing).
export const audit = (req, e) => makeAudit({ q: async (sql, p) => (await import('../db.js')).q(sql, p) })(req, e);
