// R.0 platform foundations: permissions, session claims, auth gates, audit, flags, owner bootstrap, security counters, admin router guards,
// GET /api/me, the migration, and the wiring in auth.js / server.js. Pure logic and DI factories run against fakes (no database, Redis or Express needed);
// the wiring is checked by reading the source, like the other phase tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROLES, rank, PERMISSIONS, ROLE_PERMISSIONS, can, canActOn, roleChangeGuard, permissionsFor, isStaffRole, isPermission } from '../src/rbac/permissions.js';
import { makeClaims, readClaims } from '../src/rbac/claims.js';
import { makeRbac, authProblem } from '../src/rbac/guards.js';
import { loginBlock } from '../src/rbac/loginPolicy.js';
import { makeAudit, redact } from '../src/rbac/audit.js';
import { makeFlags, FLAG_KEYS } from '../src/flags.js';
import { makeBootstrap } from '../src/rbac/bootstrap.js';
import { securityKey, hourKeys, lockoutPattern, isEventType } from '../src/rbac/security.js';
import { makeMe } from '../src/rbac/meHandler.js';
import { unguardedRoutes } from '../src/admin/guards.js';
import { loadAdminRoutes, makeAdminRouter, unguardedIn } from '../src/admin/index.js';
import * as mw from '../src/rbac/middleware.js';

const src = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const res = () => { const r = { code: 200, body: undefined }; r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; }; return r; };

// ---------- permissions ----------
const CONTRACT = ['users:read', 'users:suspend', 'users:logout', 'users:unlock', 'users:role', 'users:export', 'users:delete', 'users:impersonate', 'orgs:read', 'orgs:suspend', 'orgs:manage', 'orgs:export', 'orgs:delete',
  'usage:read', 'quotas:manage', 'plans:manage', 'killswitch:toggle', 'jobs:read', 'jobs:manage', 'content:read', 'content:moderate', 'ig:read', 'ig:manage', 'system:read', 'flags:manage', 'announcement:manage', 'audit:read'];
test('permission list is exactly the contract; roles rank user < support < admin < owner', () => {
  assert.deepEqual([...PERMISSIONS].sort(), [...CONTRACT].sort()); assert.equal(new Set(PERMISSIONS).size, PERMISSIONS.length);
  assert.deepEqual(ROLES, ['user', 'support', 'admin', 'owner']); assert.deepEqual(ROLES.map(rank), [0, 1, 2, 3]); assert.equal(rank('god'), -1);
});
test('role mapping: user none; support read-only set; admin = support + the listed additions; owner everything', () => {
  assert.deepEqual(permissionsFor('user'), []);
  assert.deepEqual([...ROLE_PERMISSIONS.support].sort(), ['content:read', 'ig:read', 'jobs:read', 'orgs:read', 'system:read', 'usage:read', 'users:read'].sort());
  const add = ['audit:read', 'users:suspend', 'users:logout', 'users:unlock', 'orgs:suspend', 'orgs:manage', 'quotas:manage', 'plans:manage', 'killswitch:toggle', 'jobs:manage', 'content:moderate', 'ig:manage', 'flags:manage', 'announcement:manage'];
  assert.deepEqual([...ROLE_PERMISSIONS.admin].sort(), [...ROLE_PERMISSIONS.support, ...add].sort());
  assert.deepEqual([...ROLE_PERMISSIONS.owner].sort(), [...CONTRACT].sort());
  for (const p of ['users:role', 'users:export', 'users:delete', 'users:impersonate', 'orgs:export', 'orgs:delete']) { assert.equal(can('admin', p), false, 'admin lacks ' + p); assert.equal(can('owner', p), true); }
});
test('superset invariants: every role has at least the permissions of the role below; nothing outside the list', () => {
  for (let i = 1; i < ROLES.length; i++) for (const p of ROLE_PERMISSIONS[ROLES[i - 1]]) assert.ok(ROLE_PERMISSIONS[ROLES[i]].includes(p), `${ROLES[i]} has ${p}`);
  for (const r of ROLES) for (const p of ROLE_PERMISSIONS[r]) assert.ok(PERMISSIONS.includes(p), p);
  assert.ok(ROLES.slice(1).every((r, i) => ROLE_PERMISSIONS[r].length > ROLE_PERMISSIONS[ROLES[i]].length || r === 'support'), 'each step up adds powers');
  assert.equal(can('nobody', 'users:read'), false); assert.equal(can('owner', 'made:up'), false); assert.equal(can(undefined, 'users:read'), false);
  assert.equal(isPermission('users:read'), true); assert.equal(isPermission('users:READ'), false);
  assert.deepEqual([isStaffRole('user'), isStaffRole('support'), isStaffRole('admin'), isStaffRole('owner'), isStaffRole('x')], [false, true, true, true, false]);
  const p = permissionsFor('admin'); p.push('hack'); assert.ok(!can('admin', 'hack') && !ROLE_PERMISSIONS.admin.includes('hack'), 'callers cannot mutate the table');
});
test('canActOn: strictly higher rank only, plus owner on admin; unknown roles never', () => {
  const want = { owner: { owner: false, admin: true, support: true, user: true }, admin: { owner: false, admin: false, support: true, user: true }, support: { owner: false, admin: false, support: false, user: true }, user: { owner: false, admin: false, support: false, user: false } };
  for (const a of ROLES) for (const t of ROLES) assert.equal(canActOn(a, t), want[a][t], `${a} on ${t}`);
  for (const bad of [undefined, null, 'root', '']) { assert.equal(canActOn(bad, 'user'), false); assert.equal(canActOn('owner', bad), false); }
});
test('roleChangeGuard: owner only, never yourself, never the last owner, real roles, real change', () => {
  const o = { id: 'o1', role: 'owner' }, o2 = { id: 'o2', role: 'owner' }, a = { id: 'a1', role: 'admin' }, u = { id: 'u1', role: 'user' };
  assert.deepEqual(roleChangeGuard({ actor: o, target: u, newRole: 'support', ownerCount: 1 }), { ok: true });
  assert.deepEqual(roleChangeGuard({ actor: o, target: a, newRole: 'user', ownerCount: 1 }), { ok: true });
  assert.deepEqual(roleChangeGuard({ actor: o, target: u, newRole: 'owner', ownerCount: 1 }), { ok: true }, 'an owner may appoint another owner');
  assert.deepEqual(roleChangeGuard({ actor: o, target: o2, newRole: 'admin', ownerCount: 2 }), { ok: true }, 'two owners: one may demote the other');
  const no = (args, re) => { const r = roleChangeGuard(args); assert.equal(r.ok, false); assert.match(r.reason, re); };
  no({ actor: a, target: u, newRole: 'support', ownerCount: 1 }, /only an owner/); no({ actor: { id: 's', role: 'support' }, target: u, newRole: 'admin', ownerCount: 1 }, /only an owner/); no({ actor: u, target: u, newRole: 'admin', ownerCount: 1 }, /only an owner/);
  no({ actor: o, target: o, newRole: 'admin', ownerCount: 2 }, /your own role/); no({ actor: o, target: { id: 'o1', role: 'owner' }, newRole: 'owner', ownerCount: 3 }, /your own role/);
  no({ actor: o, target: o2, newRole: 'admin', ownerCount: 1 }, /last owner/); no({ actor: o, target: o2, newRole: 'user', ownerCount: 0 }, /last owner/); no({ actor: o, target: o2, newRole: 'user' }, /last owner/);
  no({ actor: o, target: u, newRole: 'superuser', ownerCount: 1 }, /unknown role/); no({ actor: o, target: u, newRole: 'user', ownerCount: 1 }, /already/); no({ actor: o, target: { id: 'x', role: 'wizard' }, newRole: 'user', ownerCount: 1 }, /unknown role/);
  no({ actor: null, target: u, newRole: 'user', ownerCount: 1 }, /required/); no({ target: u, newRole: 'admin' }, /required/);
});

// ---------- session claims and gates ----------
test('claims: the token carries tv; a token without tv counts as 0; junk is refused', () => {
  assert.deepEqual(makeClaims({ id: 'u1', token_version: 3 }), { sub: 'u1', tv: 3 }); assert.deepEqual(makeClaims({ id: 'u1' }), { sub: 'u1', tv: 0 });
  assert.deepEqual(makeClaims({ id: 'u1', token_version: -1 }), { sub: 'u1', tv: 0 }); assert.deepEqual(makeClaims({ id: 'u1', token_version: '4' }), { sub: 'u1', tv: 0 });
  assert.deepEqual(readClaims({ sub: 'u1' }), { sub: 'u1', tv: 0 }, 'a pre-R.0 token'); assert.deepEqual(readClaims({ sub: 'u1', tv: 2, iat: 1 }), { sub: 'u1', tv: 2 });
  for (const bad of [null, undefined, {}, { sub: 5 }, { sub: '' }]) assert.throws(() => readClaims(bad), /bad token/);
});
const row = (o = {}) => ({ id: 'u1', email: 'a@x.com', role: 'user', status: 'active', token_version: 0, pass_hash: 'SECRET-HASH', ...o });
function rbac({ rows = [row()], claims = { sub: 'u1', tv: 0 }, fail } = {}) {
  const sqls = []; const q = async (sql, p) => { sqls.push({ sql, p }); if (fail) throw new Error('db down'); return rows.filter(r => r.id === p[0]); };
  const verify = async h => { if (!h) throw new Error('no token'); if (h === 'Bearer bad') throw new Error('jwt malformed'); return claims; };
  return { ...makeRbac({ q, verify }), sqls };
}
const run = async (h, req) => { const r = res(), rq = { headers: {}, ...req }; let nexted = false, err; await h(rq, r, e => { nexted = true; err = e; }); return { r, nexted, err, rq }; };
test('authProblem: missing, suspended and out-of-date tokens are refused; tv missing on the row counts as 0', () => {
  assert.equal(authProblem(row(), 0), null); assert.equal(authProblem(undefined, 0), 'unknown user'); assert.equal(authProblem(row({ status: 'suspended' }), 0), 'suspended');
  assert.equal(authProblem(row({ token_version: 2 }), 1), 'signed out'); assert.equal(authProblem(row({ token_version: 2 }), 2), null); assert.equal(authProblem(row({ token_version: undefined }), 0), null);
  assert.equal(authProblem(row({ status: undefined }), 0), 'suspended', 'a row without an active status is not trusted');
});
test('requireAuth: loads the user on every request, sets req.user and req.uid, never copies the password hash', async () => {
  const g = rbac({ rows: [row({ role: 'admin' })] });
  const { nexted, rq: req } = await run(g.requireAuth, { headers: { authorization: 'Bearer good' } }); assert.equal(nexted, true);
  assert.deepEqual(req.user, { id: 'u1', email: 'a@x.com', role: 'admin', status: 'active', token_version: 0 }); assert.equal(req.uid, 'u1'); assert.ok(!JSON.stringify(req).includes('SECRET-HASH'));
  await run(g.requireAuth, { headers: { authorization: 'Bearer good' } }); assert.equal(g.sqls.length, 2, 'one lookup per request, no caching');
  assert.ok(!/\*|pass_hash/.test(g.sqls[0].sql), 'explicit columns'); assert.match(g.sqls[0].sql, /FROM users WHERE id=\$1/); assert.deepEqual(g.sqls[0].p, ['u1']);
});
test('requireAuth: 401 for no token, a bad token, an unknown or suspended user, and a stale tv (sign out everywhere)', async () => {
  const cases = { 'no header': [{}, rbac()], 'bad token': [{ authorization: 'Bearer bad' }, rbac()], 'unknown user': [{ authorization: 'Bearer ok' }, rbac({ rows: [] })], 'suspended': [{ authorization: 'Bearer ok' }, rbac({ rows: [row({ status: 'suspended' })] })],
    'tv behind the row': [{ authorization: 'Bearer ok' }, rbac({ rows: [row({ token_version: 1 })], claims: { sub: 'u1', tv: 0 } })], 'tv ahead of the row': [{ authorization: 'Bearer ok' }, rbac({ rows: [row({ token_version: 0 })], claims: { sub: 'u1', tv: 5 } })] };
  for (const [name, [headers, g]] of Object.entries(cases)) { const { r, nexted } = await run(g.requireAuth, { headers }); assert.equal(r.code, 401, name); assert.deepEqual(r.body, { error: 'unauthorized' }, name + ': same answer for every reason'); assert.equal(nexted, false, name); }
  const ok = await run(rbac({ rows: [row({ token_version: 4 })], claims: { sub: 'u1', tv: 4 } }).requireAuth, { headers: { authorization: 'Bearer ok' } }); assert.equal(ok.nexted, true);
  const dead = await run(rbac({ fail: true }).requireAuth, { headers: { authorization: 'Bearer ok' } }); assert.equal(dead.nexted, true); assert.match(dead.err.message, /db down/, 'a database error is an error, not a silent pass');
});
test('requirePermission: tagged with .permission, 403 without it, 401 without a user, unknown names throw at load time', async () => {
  const { requirePermission, requireStaff } = rbac(), m = requirePermission('users:suspend'); assert.equal(m.permission, 'users:suspend');
  for (const [role, want] of [['user', 403], ['support', 403], ['admin', 'next'], ['owner', 'next']]) { const { r, nexted } = await run(m, { user: { role } }); assert.equal(want === 'next' ? nexted : r.code, want === 'next' ? true : want, role); }
  assert.deepEqual((await run(m, { user: { role: 'support' } })).r.body, { error: 'forbidden' }, 'does not name the missing permission'); assert.equal((await run(m, {})).r.code, 401);
  assert.throws(() => requirePermission('users:reed'), /unknown permission/); assert.throws(() => requirePermission(undefined), /unknown permission/);
  for (const [role, want] of [['user', 403], ['support', 'next'], ['admin', 'next'], ['owner', 'next'], ['ghost', 403]]) { const { r, nexted } = await run(requireStaff, { user: { role } }); assert.equal(want === 'next' ? nexted : r.code, want === 'next' ? true : want, 'staff ' + role); }
  assert.equal((await run(requireStaff, {})).r.code, 401); assert.equal(requireStaff.permission, undefined, 'requireStaff is not a permission gate');
});
test('middleware.js exports the real gates without opening a database connection', () => {
  assert.deepEqual(Object.keys(mw).sort(), ['authProblem', 'requireAuth', 'requirePermission', 'requireStaff']); assert.equal(mw.requirePermission('audit:read').permission, 'audit:read');
});
test('login policy: only active accounts get a token', () => {
  assert.equal(loginBlock({ status: 'active' }), null); assert.equal(loginBlock({}), null, 'rows from before the migration'); assert.equal(loginBlock(undefined), null);
  assert.deepEqual(loginBlock({ status: 'suspended' }), { status: 403, error: 'This account is suspended. Contact support.' });
});

// ---------- audit ----------
test('redact: secrets are replaced at any depth, text is cut, dates and arrays are safe', () => {
  const r = redact({ email: 'a@x.com', pass_hash: 'h', password: 'p', token: 't', accessToken: 'x', api_key: 'k', enc: 'e', nested: { Authorization: 'Bearer z', ok: 1, list: [{ secret: 's', fine: 'f' }] }, long: 'x'.repeat(2500), when: new Date('2026-10-25T00:00:00Z'), n: null });
  assert.equal(r.email, 'a@x.com'); for (const k of ['pass_hash', 'password', 'token', 'accessToken', 'api_key', 'enc']) assert.equal(r[k], '[redacted]', k);
  assert.equal(r.nested.Authorization, '[redacted]'); assert.equal(r.nested.ok, 1); assert.deepEqual(r.nested.list, [{ secret: '[redacted]', fine: 'f' }]);
  assert.ok(r.long.length < 2100 && r.long.endsWith('…')); assert.equal(r.when, '2026-10-25T00:00:00.000Z'); assert.equal(r.n, null);
  let deep = { v: 1 }; for (let i = 0; i < 12; i++) deep = { d: deep }; assert.match(JSON.stringify(redact(deep)), /truncated/); assert.equal(redact(undefined), null); assert.equal(redact(5), 5);
});
test('audit writes the actor, role, org, target, redacted before/after and ip; it never throws', async () => {
  const calls = []; const audit = makeAudit({ q: async (sql, p) => { calls.push({ sql, p }); }, log: () => {} });
  await audit({ user: { id: 'a1', role: 'admin' }, org: { id: 'org1' }, ip: '1.2.3.4' }, { action: 'user.suspend', targetType: 'user', targetId: 42, before: { status: 'active', pass_hash: 'x' }, after: { status: 'suspended' }, meta: { reason: 'spam' } });
  const c = calls[0]; assert.match(c.sql, /^INSERT INTO audit_log\(actor_id,actor_role,org_id,action,target_type,target_id,before,after,meta,ip\) VALUES\(\$1,\$2,\$3,\$4,\$5,\$6,\$7::jsonb,\$8::jsonb,\$9::jsonb,\$10\)$/);
  assert.deepEqual(c.p.slice(0, 6), ['a1', 'admin', 'org1', 'user.suspend', 'user', '42']); assert.deepEqual(JSON.parse(c.p[6]), { status: 'active', pass_hash: '[redacted]' }); assert.deepEqual(JSON.parse(c.p[7]), { status: 'suspended' }); assert.deepEqual(JSON.parse(c.p[8]), { reason: 'spam' }); assert.equal(c.p[9], '1.2.3.4');
  await audit({ user: { id: 'a1', role: 'owner' } }, { action: 'x', orgId: 'explicit' }); assert.deepEqual(calls[1].p.slice(0, 3), ['a1', 'owner', 'explicit']); assert.deepEqual(calls[1].p.slice(4), [null, null, null, null, null, null], 'optional parts are NULL');
  await audit(undefined, { action: 'system.job' }); assert.deepEqual(calls[2].p.slice(0, 3), [null, null, null]);
  const logs = []; const bad = makeAudit({ q: async () => { throw new Error('insert failed'); }, log: (...a) => logs.push(a.join(' ')) });
  assert.equal(await bad({ user: { id: 'a' } }, { action: 'y' }), undefined); assert.match(logs[0], /insert failed/);
  assert.equal(await makeAudit({ q: async () => { throw new Error('no'); }, log: () => { throw new Error('log broke'); } })({}, { action: 'z' }), undefined, 'even a failing logger cannot throw');
  await makeAudit({ q: async () => { calls.push('called'); }, log: () => {} })({}, {}); assert.ok(!calls.includes('called'), 'no action: nothing written, nothing thrown');
});

// ---------- flags ----------
test('flags: 10 second cache, setFlag clears it, defaults when missing or unreadable, unknown keys refused', async () => {
  let t = 1000, loads = 0, rows = [{ key: 'ai_enabled', value: true }, { key: 'announcement', value: null }, { key: 'maintenance_mode', value: false }]; const writes = [];
  const q = async (sql, p) => { if (/^SELECT/.test(sql)) { loads++; return rows; } writes.push({ sql, p }); rows = rows.map(r => r.key === p[0] ? { ...r, value: JSON.parse(p[1]) } : r); };
  const f = makeFlags({ q, now: () => t });
  assert.equal(await f.getFlag('ai_enabled', false), true); assert.equal(await f.getFlag('maintenance_mode', true), false); assert.equal(loads, 1, 'second read from the cache');
  assert.equal(await f.getFlag('announcement', 'dflt'), null, 'a stored null is a value'); assert.equal(await f.getFlag('gemini_model', 'gemini-2.5-flash'), 'gemini-2.5-flash', 'absent: the default'); assert.equal(await f.getFlag('nope'), null);
  t += 9999; await f.getFlag('ai_enabled'); assert.equal(loads, 1, 'still cached at 9.999 s'); t += 2; await f.getFlag('ai_enabled'); assert.equal(loads, 2, 'reloaded after 10 s');
  await f.setFlag('ai_enabled', false, 'admin-1'); assert.match(writes[0].sql, /INSERT INTO feature_flags\(key,value,updated_by,updated_at\) VALUES\(\$1,\$2::jsonb,\$3,now\(\)\)\s+ON CONFLICT \(key\) DO UPDATE/); assert.deepEqual(writes[0].p, ['ai_enabled', 'false', 'admin-1']);
  assert.equal(await f.getFlag('ai_enabled', true), false, 'visible at once, no waiting for the TTL'); assert.equal(loads, 3);
  await f.setFlag('announcement', { text: 'Maintenance at 9', level: 'info' }, null); assert.deepEqual(JSON.parse(writes[1].p[1]), { text: 'Maintenance at 9', level: 'info' });
  await assert.rejects(() => f.setFlag('drop_table', 1), /unknown flag/); assert.equal(writes.length, 2); assert.deepEqual(FLAG_KEYS, ['ai_enabled', 'image_generation_enabled', 'maintenance_mode', 'gemini_model', 'announcement']);
  const dead = makeFlags({ q: async () => { throw new Error('down'); } }); assert.equal(await dead.getFlag('ai_enabled', true), true, 'unreadable table: the default, never a throw');
  let n = 0; const slow = makeFlags({ q: async () => { n++; await new Promise(r => setTimeout(r, 5)); return []; } }); await Promise.all([slow.getFlag('a'), slow.getFlag('b'), slow.getFlag('c')]); assert.equal(n, 1, 'concurrent reads share one query');
});

// ---------- owner bootstrap ----------
test('owner bootstrap: only OWNER_EMAIL, only an existing user, idempotent, logged, never throws', async () => {
  const mk = (env, users) => { const calls = [], logs = { warn: [], log: [], error: [] }; const q = async (sql, p) => { calls.push({ sql, p }); if (/^SELECT/.test(sql)) return users.filter(u => u.email === p[0]); return []; };
    const log = { warn: m => logs.warn.push(m), log: m => logs.log.push(m), error: (...m) => logs.error.push(m.join(' ')) }; return { run: makeBootstrap({ q, env, log }), calls, logs }; };
  let b = mk({}, []); assert.deepEqual(await b.run(), { status: 'unset' }); assert.equal(b.calls.length, 0, 'no email: no query, nobody promoted'); assert.match(b.logs.warn[0], /OWNER_EMAIL is not set/);
  b = mk({ OWNER_EMAIL: '   ' }, []); assert.equal((await b.run()).status, 'unset');
  b = mk({ OWNER_EMAIL: 'Boss@Example.com ' }, []); assert.equal((await b.run()).status, 'no-user'); assert.match(b.logs.warn[0], /sign up/i); assert.equal(b.calls.length, 1, 'never creates a user');
  b = mk({ OWNER_EMAIL: 'Boss@Example.com ' }, [{ id: 'u9', email: 'boss@example.com', role: 'user' }]); assert.deepEqual(await b.run(), { status: 'promoted', userId: 'u9', from: 'user' });
  assert.deepEqual(b.calls[0].p, ['boss@example.com']); assert.equal(b.calls[1].sql, "UPDATE users SET role='owner' WHERE id=$1 AND role<>'owner'"); assert.deepEqual(b.calls[1].p, ['u9']); assert.match(b.logs.log[0], /now the platform owner/);
  b = mk({ OWNER_EMAIL: 'boss@example.com' }, [{ id: 'u9', email: 'boss@example.com', role: 'owner' }]); assert.deepEqual(await b.run(), { status: 'already', userId: 'u9' }); assert.equal(b.calls.length, 1, 'already owner: no write');
  const logs = []; assert.deepEqual(await makeBootstrap({ q: async () => { throw new Error('db down'); }, env: { OWNER_EMAIL: 'a@b.c' }, log: { warn() {}, log() {}, error: (...m) => logs.push(m.join(' ')) } })(), { status: 'error' }); assert.match(logs[0], /db down/);
});

// ---------- security counters (pure parts) ----------
test('security counters: hourly UTC keys, only safe event names, lockout patterns cannot match other people', () => {
  assert.equal(securityKey('lockout', new Date('2026-10-25T13:45:10Z')), 'sec:lockout:2026102513'); assert.equal(securityKey('rate_limit', new Date('2026-01-02T00:00:00Z')), 'sec:rate_limit:2026010200');
  assert.deepEqual(hourKeys('x', 3, new Date('2026-10-25T00:10:00Z')), ['sec:x:2026102500', 'sec:x:2026102423', 'sec:x:2026102422']);
  assert.equal(hourKeys('x', 0).length, 1); assert.equal(hourKeys('x', 500).length, 48); assert.equal(hourKeys('x').length, 24);
  for (const ok of ['lockout', 'rate_limit']) assert.equal(isEventType(ok), true, ok); for (const bad of ['', 'Lockout', 'a:b', 'x*', 'a'.repeat(33), undefined, 'a b']) assert.equal(isEventType(bad), false, String(bad));
  assert.equal(lockoutPattern('Boss@Example.com'), 'lf:boss@example.com:*'); assert.equal(lockoutPattern('a*@x.com'), 'lf:a\\*@x.com:*'); assert.equal(lockoutPattern('a[b]?@x.com'), 'lf:a\\[b\\]\\?@x.com:*');
  const rl = src('src/ratelimit.js');
  assert.match(rl, /export async function clearLockout\(identifier\)/); assert.match(rl, /export async function recordSecurityEvent\(type/); assert.match(rl, /export async function securityCounts/);
  assert.match(rl, /if \(!r\.ok\) \{ recordSecurityEvent\('rate_limit'\)/, 'the per-user limiter counts its blocks'); assert.match(rl, /if \(n === MAXF\) recordSecurityEvent\('lockout'\)/, 'a lockout is counted once, when it starts');
  assert.match(rl, /scanStream\(\{ match: lockoutPattern\(identifier\)/); assert.ok(!/\bKEYS\b/.test(rl.replace(/\/\/.*$/gm, '')), 'SCAN, never the blocking KEYS command');
});

// ---------- admin router ----------
// A fake router in Express's shape: stack of layers; route layers carry route.stack[].handle, nested routers carry handle.stack.
const route = (method, p, ...handlers) => ({ route: { path: p, methods: { [method]: true }, stack: handlers.map(h => ({ handle: h })) } });
const gate = perm => Object.assign(() => {}, { permission: perm }), plain = () => {};
const fakeRouter = (...stack) => ({ stack });
test('unguardedRoutes: finds routes without a requirePermission gate; router-level gates and nested routers count', () => {
  assert.deepEqual(unguardedRoutes(fakeRouter(route('get', '/', gate('users:read'), plain), route('post', '/x', plain, gate('users:suspend')))), []);
  assert.deepEqual(unguardedRoutes(fakeRouter(route('get', '/open', plain), route('delete', '/:id', gate('users:delete'), plain), route('put', '/loose', plain))), ['GET /open', 'PUT /loose']);
  assert.deepEqual(unguardedRoutes(fakeRouter(route('get', '/', plain)), '/ping'), ['GET /ping/']);
  assert.deepEqual(unguardedRoutes(fakeRouter({ handle: gate('audit:read') }, route('get', '/a', plain), route('get', '/b', plain))), [], 'router.use(requirePermission(...)) guards what follows');
  assert.deepEqual(unguardedRoutes(fakeRouter(route('get', '/before', plain), { handle: gate('audit:read') }, route('get', '/after', plain))), ['GET /before'], 'a gate added later does not cover earlier routes');
  assert.deepEqual(unguardedRoutes(fakeRouter({ handle: plain }, route('get', '/a', plain))), ['GET /a'], 'an ordinary middleware is not a gate');
  assert.deepEqual(unguardedRoutes(fakeRouter({ name: 'router', handle: fakeRouter(route('get', '/in', plain)) }), '/nested'), ['GET /nested/in']);
  assert.deepEqual(unguardedRoutes(fakeRouter({ handle: gate('users:read') }, { name: 'router', handle: fakeRouter(route('get', '/in', plain)) })), [], 'a parent gate covers a nested router');
  assert.deepEqual(unguardedRoutes(undefined), []); assert.deepEqual(unguardedRoutes(fakeRouter({ route: { path: '/all', methods: {}, stack: [{ handle: plain }] } })), ['ANY /all']);
});
const withRouteFiles = files => { const d = mkdtempSync(path.join(tmpdir(), 'adm-')); for (const [n, c] of Object.entries(files)) writeFileSync(path.join(d, n), c); return d; };
const R = (mount, body = 'export default { stack: [] };') => `export const mount = '${mount}'; ${body}`;
test('admin loader: loads every route file in name order, insists on default router + mount, refuses duplicates', async () => {
  const d = withRouteFiles({ 'b.js': R('/b'), 'a.js': R('/a'), 'notes.txt': 'ignored' });
  assert.deepEqual((await loadAdminRoutes(d)).map(r => [r.file, r.mount]), [['a.js', '/a'], ['b.js', '/b']]);
  await assert.rejects(() => loadAdminRoutes(withRouteFiles({ 'x.js': 'export default { stack: [] };' })), /must export a default router and const mount/);
  await assert.rejects(() => loadAdminRoutes(withRouteFiles({ 'x.js': "export const mount = 'no-slash'; export default {};" })), /must export/); await assert.rejects(() => loadAdminRoutes(withRouteFiles({ 'x.js': "export const mount = '/a/b'; export default {};" })), /must export/);
  await assert.rejects(() => loadAdminRoutes(withRouteFiles({ 'x.js': "export const mount = '/a';" })), /must export/);
  await assert.rejects(() => loadAdminRoutes(withRouteFiles({ 'x.js': R('/same'), 'y.js': R('/same') })), /used twice/);
});
test('makeAdminRouter: refuses to build with an unguarded route; otherwise auth, staff and the rate limiter come first, then each mount, then a JSON 404', async () => {
  const bad = withRouteFiles({ 'open.js': `import {} from 'node:fs'; export const mount='/open'; export default { stack: [{ route: { path: '/', methods: { get: true }, stack: [{ handle(){} }] } }] };` });
  const calls = [], Router = () => ({ use: (...a) => calls.push(a) }), deps = { Router, requireAuth: () => 'A', requireStaff: () => 'S', limiter: () => 'L' };
  await assert.rejects(() => makeAdminRouter({ ...deps, dir: bad }), /admin routes without requirePermission: GET \/open\//);
  const good = withRouteFiles({ 'one.js': `export const mount='/one'; export default { stack: [{ route: { path: '/', methods: { get: true }, stack: [{ handle: Object.assign(()=>{}, { permission: 'users:read' }) }] } }] };`, 'two.js': R('/two') });
  const r = await makeAdminRouter({ ...deps, dir: good }); assert.ok(r && calls.length === 4);
  assert.deepEqual(calls[0].map(f => f()), ['A', 'S', 'L'], 'auth, then staff, then the limiter'); assert.equal(calls[1][0], '/one'); assert.equal(calls[2][0], '/two');
  const out = res(); calls[3][0]({}, out); assert.deepEqual([out.code, out.body], [404, { error: 'not found' }]);
  assert.deepEqual(unguardedIn(await loadAdminRoutes(good)), []);
});
test('the repo\'s own admin routes: every file under src/admin/routes uses requirePermission, the demo route is users:read at /ping', async () => {
  const { readdirSync } = await import('node:fs');
  for (const f of readdirSync(new URL('../src/admin/routes/', import.meta.url)).filter(x => x.endsWith('.js'))) { const s = src('src/admin/routes/' + f); assert.match(s, /requirePermission\(['"][a-z]+:[a-z]+['"]\)/, f); assert.match(s, /export const mount\s*=\s*['"]\/[a-z0-9-]+['"]/, f); assert.match(s, /export default/, f); }
  const ping = src('src/admin/routes/ping.js'); assert.match(ping, /mount='\/ping'/); assert.match(ping, /r\.get\('\/',requirePermission\('users:read'\)/);
  const idx = src('src/admin/index.js'); assert.match(idx, /r\.use\(requireAuth, requireStaff, limiter\)/); assert.match(idx, /windowMs: 60000/); assert.match(idx, /recordSecurityEvent\('rate_limit'\)/);
  const chk = src('scripts/check-admin-guards.js'); assert.match(chk, /process\.exit\(1\)/); assert.ok(!/^#!/.test(chk), 'no shell script: runs with plain node on Windows'); assert.match(src('package.json'), /"check:admin":"node scripts\/check-admin-guards\.js"/);
});

// ---------- GET /api/me ----------
test('GET /api/me: id, email, name, role and the permission list; no secrets; a missing profile table is not an error', async () => {
  const mk = rows => makeMe({ q: async (sql, p) => { assert.match(sql, /FROM business_profile WHERE user_id=\$1/); assert.deepEqual(p, ['u1']); if (rows instanceof Error) throw rows; return rows; } });
  let r = res(); await mk([{ display_name: 'Sam' }])({ user: { id: 'u1', email: 'a@x.com', role: 'admin', status: 'active', token_version: 3, pass_hash: 'x' } }, r);
  assert.deepEqual(Object.keys(r.body).sort(), ['permissions', 'user']); assert.deepEqual(r.body.user, { id: 'u1', email: 'a@x.com', name: 'Sam', role: 'admin' }); assert.deepEqual(r.body.permissions, permissionsFor('admin')); assert.ok(!JSON.stringify(r.body).includes('token_version'));
  r = res(); await mk([])({ user: { id: 'u1', email: 'a@x.com', role: 'user' } }, r); assert.deepEqual([r.body.user.name, r.body.permissions], [null, []]);
  r = res(); await mk(Object.assign(new Error('relation does not exist'), { code: '42P01' }))({ user: { id: 'u1', email: 'a@x.com', role: 'owner' } }, r); assert.equal(r.body.user.name, null); assert.equal(r.body.permissions.length, PERMISSIONS.length);
  await assert.rejects(() => mk(new Error('db down'))({ user: { id: 'u1', email: 'e', role: 'user' } }, res()), /db down/);
});

// ---------- migration ----------
test('migration schema.rbac.sql: idempotent DDL, the columns, append-only audit_log, seeds that never overwrite', () => {
  const s = src('db/schema.rbac.sql'), code = s.replace(/--.*$/gm, '');
  for (const c of ["role text NOT NULL DEFAULT 'user' CHECK (role IN ('user','support','admin','owner'))", "status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended'))", 'token_version int NOT NULL DEFAULT 0', 'last_active_at timestamptz']) assert.ok(code.includes('ALTER TABLE users ADD COLUMN IF NOT EXISTS ' + c), c);
  for (const t of ['audit_log', 'plans', 'usage_events', 'feature_flags']) assert.match(code, new RegExp('CREATE TABLE IF NOT EXISTS ' + t + '\\('), t);
  assert.ok(!/CREATE TABLE(?! IF NOT EXISTS)/.test(code) && !/CREATE (UNIQUE )?INDEX(?! IF NOT EXISTS)/.test(code), 'every CREATE is IF NOT EXISTS'); assert.ok(!/DROP TABLE|DROP COLUMN|TRUNCATE TABLE/i.test(code));
  const audit = code.slice(code.indexOf('CREATE TABLE IF NOT EXISTS audit_log'), code.indexOf(');', code.indexOf('CREATE TABLE IF NOT EXISTS audit_log')));
  for (const col of ['actor_id uuid', 'actor_role text', 'org_id uuid', 'action text NOT NULL', 'target_type text', 'target_id text', 'before jsonb', 'after jsonb', 'meta jsonb', 'ip text', 'created_at timestamptz NOT NULL DEFAULT now()']) assert.ok(audit.includes(col), col);
  assert.ok(!/REFERENCES/.test(audit), 'no foreign keys: deleting a user must never touch an audit row');
  for (const i of ['audit_log_actor ON audit_log(actor_id', 'audit_log_org ON audit_log(org_id', 'audit_log_target ON audit_log(target_type, target_id)', 'audit_log_created ON audit_log(created_at DESC)']) assert.ok(code.includes(i), i);
  assert.match(code, /BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_log_append_only\(\)/); assert.match(code, /RAISE EXCEPTION 'audit_log is append-only/); assert.match(code, /BEFORE TRUNCATE ON audit_log/);
  assert.match(code, /DROP TRIGGER IF EXISTS audit_log_no_change ON audit_log;\s*CREATE TRIGGER audit_log_no_change/, 're-runnable trigger');
  assert.match(code, /INSERT INTO plans\(name,daily_images,daily_chat\) VALUES \('free',5,30\),\('pro',50,300\),\('unlimited',NULL,NULL\) ON CONFLICT \(name\) DO NOTHING/);
  assert.match(code, /INSERT INTO feature_flags\(key,value\) VALUES \('ai_enabled','true'\),\('image_generation_enabled','true'\),\('maintenance_mode','false'\),\('announcement','null'\) ON CONFLICT \(key\) DO NOTHING/);
  for (const ins of code.match(/INSERT INTO[^;]+;/g)) assert.match(ins, /ON CONFLICT[^;]*DO NOTHING/, 'seed never overwrites an admin\'s change');
  assert.match(code, /usage_events\([^;]*user_id uuid REFERENCES users ON DELETE CASCADE[^;]*cost_estimate_usd numeric[^;]*provider text, meta jsonb/); assert.match(code, /CREATE INDEX IF NOT EXISTS usage_events_user ON usage_events\(user_id, created_at\)/);
  for (const c of ["moderation_status text NOT NULL DEFAULT 'ok'", 'removed_at timestamptz', 'removed_by uuid', 'removed_reason text']) { assert.ok(code.includes('ALTER TABLE stored_images ADD COLUMN IF NOT EXISTS ' + c), c); assert.ok(code.includes('ALTER TABLE generated_images ADD COLUMN IF NOT EXISTS ' + c), 'generated_images ' + c); }
  assert.match(code, /IF to_regclass\('generated_images'\) IS NOT NULL THEN/);
  const mig = src('src/migrate.js'); assert.match(mig, /'schema\.sql',\.\.\.fs\.readdirSync\(dir\)\.filter\(f=>\/\^schema\\\..\+\\\.sql\$\/\.test\(f\)\)\.sort\(\)/); assert.match(src('db/schema.sql'), /CREATE TABLE IF NOT EXISTS stored_images/);
});

// ---------- wiring ----------
test('auth.js: tokens carry tv, requireAuth is the DB-backed one, suspended users cannot log in, last_active_at is updated; register grants no role', () => {
  const a = src('src/auth.js'); assert.match(a, /import \{signToken\} from '\.\/rbac\/token\.js'/); assert.match(a, /export const sign=signToken/); assert.match(a, /import \{requireAuth\} from '\.\/rbac\/middleware\.js'/); assert.match(a, /export \{requireAuth\}/);
  assert.match(src('src/rbac/token.js'), /jwt\.sign\(makeClaims\(u\)/); assert.match(src('src/rbac/token.js'), /readClaims\(jwt\.verify/);
  assert.match(a, /const blocked=loginBlock\(u\);if\(blocked\)return res\.status\(blocked\.status\)\.json\(\{error:blocked\.error\}\)/); assert.match(a, /UPDATE users SET last_active_at=now\(\) WHERE id=\$1/);
  assert.ok(a.indexOf('bcrypt.compare') < a.indexOf('loginBlock(u)'), 'the password is checked before the suspension is revealed'); assert.ok(a.indexOf('loginBlock(u)') < a.indexOf('last_active_at'));
  assert.match(a, /INSERT INTO users\(email,pass_hash,tos_accepted_at\) VALUES/); assert.ok(!/role/.test(a.slice(a.indexOf('/register'), a.indexOf('/login'))), 'no request can pick a role at signup');
  assert.match(src('src/routes.js'), /import \{requireAuth\} from '\.\/auth\.js'/, 'routes.js is untouched and still finds requireAuth');
});
test('no request path grants admin or owner: users.role is written only by the OWNER_EMAIL bootstrap', async () => {
  const { readdirSync, statSync } = await import('node:fs'); const files = []; const walk = d => { for (const f of readdirSync(new URL('../' + d, import.meta.url))) { const p = d + '/' + f; statSync(new URL('../' + p, import.meta.url)).isDirectory() ? walk(p) : p.endsWith('.js') && files.push(p); } }; walk('src');
  const writers = files.filter(f => /UPDATE users SET[^;`'"]*\brole\b|INSERT INTO users\([^)]*\brole\b/.test(src(f)));
  assert.deepEqual(writers, ['src/rbac/bootstrap.js']);
});
test('server.js: public router before auth, /api/me and /api/org behind requireAuth, /api/admin built from the guarded router, owner bootstrap, rate-limit blocks counted', () => {
  const s = src('src/server.js'); const i = k => s.indexOf(k);
  assert.match(s, /app\.use\('\/api\/public',publicRoutes\)/); assert.match(s, /app\.use\('\/api\/me',requireAuth,me\);app\.use\('\/api\/org',requireAuth,org\);app\.use\('\/api\/admin',await adminRouter\(\)\)/);
  assert.ok(i("app.use('/api/public'") < i("app.use('/api',api)") && i("app.use('/api/admin'") < i("app.use('/api',api)"), 'specific mounts come before the catch-all /api router');
  assert.match(s, /bootstrapOwner\(\);/); assert.match(s, /handler:\(_q,res,_n,o\)=>\{recordSecurityEvent\('rate_limit'\)/);
  for (const f of ['src/routes/me.js', 'src/routes/org.js', 'src/routes/public.js']) assert.match(src(f), /export default/, f);
  assert.match(src('src/routes/me.js'), /me\.get\('\/',/); assert.ok(!/\.(get|post|put|patch|delete)\(/.test(src('src/routes/org.js') + src('src/routes/public.js')), 'org and public are empty routers');
});
test('docs: OWNER_EMAIL is explained in the README and .env.example; npm scripts and tests are registered', () => {
  for (const f of ['README.md', '.env.example']) { const t = src(f); assert.match(t, /OWNER_EMAIL/, f); assert.match(t, /sign up/i, f + ' says to sign up first'); assert.match(t, /restart/i, f + ' says to restart'); }
  const pk = JSON.parse(src('package.json')); assert.equal(pk.scripts['check:admin'], 'node scripts/check-admin-guards.js'); assert.match(pk.scripts.test, /test\/rbacR0\.test\.js/); assert.match(pk.scripts.test, /test\/rbacR0Ui\.test\.js/);
});
