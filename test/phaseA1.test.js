// Roadmap A.1a (connect + token health) and A.1b (sync + mapping). Everything runs against fakes and hand-written fixtures
// (test/fixtures/graph/*.json: shaped like the documented Graph API responses, NOT recorded from a live account).
// The SQL itself is exercised by scripts/smoke-phaseA1.sh against Postgres.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  makeGraph, buildLoginUrl, usageLevel, IgError, assertMetricsAllowed, BANNED_METRICS, IG_SCOPES, GRAPH_VERSION, expiryFrom,
} from '../src/instagram.js';
import {
  makeIgConnect, makeIgCreds, makeRedisState, pickAccount, needsRefresh, daysLeft, ConnectError, IgNotConnected, STATE_TTL_SEC,
} from '../src/igconnect.js';
import {
  makeIgSync, mapMedia, parseInsights, mediaType, syncDue, staggerMinutes, INSIGHT_LADDER,
  UPDATE_BY_ID_SQL, BACKFILL_SQL, INSERT_SQL,
} from '../src/igsync.js';

const fx = n => JSON.parse(fs.readFileSync(new URL(`./fixtures/graph/${n}.json`, import.meta.url)));
const NOW = Date.parse('2026-10-15T12:00:00Z');
const ENV = { META_APP_ID: 'APP', META_APP_SECRET: 'SECRET', META_REDIRECT_URI: 'https://app.example/api/instagram/connect/callback' };

// ---- fakes ----
const resp = (body, { status = 200, headers = {} } = {}) => ({ ok: status < 400, status, headers: { get: k => headers[k] ?? null }, json: async () => body });
// routes: [[regex on "path?query", (url)=>[body, opts?]]], first match wins. Records every request URL.
function fakeFetch(routes) {
  const calls = [];
  const f = async (url) => {
    const u = new URL(url); calls.push(u);
    for (const [re, h] of routes) if (re.test(u.pathname + u.search)) { const r = h(u); return resp(r[0], r[1]); }
    throw new Error('no route for ' + u.pathname);
  };
  f.calls = calls; return f;
}
const res = () => {
  const r = { code: 200, body: undefined, to: undefined, headers: {} };
  r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; }; r.redirect = u => { r.to = u; return r; };
  r.set = (k, v) => { r.headers[k] = v; return r; }; r.sendStatus = c => { r.code = c; return r; };
  return r;
};
const mem = () => { const m = new Map(); return { m, get: async (u, n) => m.get(u + n) ?? null, set: async (u, n, v) => void m.set(u + n, v), del: async (u, n) => void m.delete(u + n) }; };
const stateStore = () => { const m = new Map(); return { m, put: async (s, u) => void m.set(s, u), take: async s => { const u = m.get(s) ?? null; m.delete(s); return u; } }; };
const recQ = (rows = () => []) => { const calls = []; const q = async (sql, p = []) => { calls.push({ sql, p }); return rows(sql, p); }; q.calls = calls; return q; };
const connectRoutes = (extra = []) => [
  [/oauth\/access_token.*fb_exchange_token/, () => [fx('oauth_long')]],
  [/oauth\/access_token/, () => [fx('oauth_short')]],
  [/me\/accounts/, () => [fx('me_accounts')]],
  [/me\/permissions/, () => [fx('permissions_all')]],
  ...extra,
];
const build = ({ routes = connectRoutes(), rows, env = ENV } = {}) => {
  const fetch = fakeFetch(routes), q = recQ(rows), keys = mem(), state = stateStore();
  const ic = makeIgConnect({ q, graph: makeGraph({ fetch }), state, keys, env, now: () => NOW });
  return { fetch, q, keys, state, ic };
};

// =================== A.1a ===================
test('A.1a login URL carries the app id, redirect, state, response_type and every roadmap scope', () => {
  const u = new URL(buildLoginUrl({ appId: 'APP', redirectUri: ENV.META_REDIRECT_URI, state: 'abc' }));
  assert.match(u.pathname, new RegExp(`/${GRAPH_VERSION}/dialog/oauth`));
  assert.equal(u.searchParams.get('client_id'), 'APP');
  assert.equal(u.searchParams.get('state'), 'abc');
  assert.equal(u.searchParams.get('response_type'), 'code');
  assert.deepEqual(u.searchParams.get('scope').split(','), IG_SCOPES);
  assert.ok(!IG_SCOPES.includes('instagram_content_publish'), 'publish permission is requested later (C)');
});

test('A.1a graph wrapper maps Meta errors: token, permission, rate limit, network', async () => {
  const g = (body, status = 400) => makeGraph({ fetch: fakeFetch([[/./, () => [body, { status }]]]) });
  const e190 = await g(fx('error_190')).get('x').catch(e => e);
  assert.ok(e190 instanceof IgError && e190.tokenInvalid && !e190.rateLimited);
  for (const error of [{ code: 190 }, { code: 102 }, { code: 1, error_subcode: 463 }]) assert.ok((await g({ error: { message: 'm', ...error } }).get('x').catch(e => e)).tokenInvalid, JSON.stringify(error));
  assert.ok(!(await g({ error: { message: 'm', code: 100 } }).get('x').catch(e => e)).tokenInvalid, 'code 100 (bad parameter) is not a dead token');
  const perm = await g({ error: { message: 'm', code: 10 } }).get('x').catch(e => e);
  assert.ok(perm.permission && !perm.tokenInvalid);
  const rate = await g({ error: { message: 'm', code: 4 } }).get('x').catch(e => e);
  assert.ok(rate.rateLimited);
  const net = await makeGraph({ fetch: async () => { throw new Error('ECONNRESET'); } }).get('x').catch(e => e);
  assert.ok(net instanceof IgError && !net.tokenInvalid && /Could not reach/.test(net.message));
});

test('A.1a graph wrapper puts the token in the query, drops empty params and reports the usage header', async () => {
  const f = fakeFetch([[/./, () => [{ data: [] }, { headers: { 'x-app-usage': '{"call_count":91,"total_time":12}' } }]]]);
  const out = await makeGraph({ fetch: f }).get('IG_1/media', { fields: 'id', after: undefined, limit: 5 }, 'TOK');
  const u = f.calls[0];
  assert.equal(u.searchParams.get('access_token'), 'TOK');
  assert.equal(u.searchParams.get('limit'), '5');
  assert.ok(!u.searchParams.has('after'));
  assert.equal(out._usage, 91);
  assert.ok(!Object.keys(out).includes('_usage'), 'usage must not leak into the data');
  assert.equal(usageLevel({ get: () => '[{"call_count":3},{"call_count":55,"total_cputime":7}]' }), 55);
  assert.equal(usageLevel({ get: () => null }), 0);
});

test('A.1a start: 503 when the server has no Meta app configured, URL + single-use state otherwise', async () => {
  const off = build({ env: {} }); const r0 = res();
  await off.ic.start({ uid: 'u1' }, r0);
  assert.equal(r0.code, 503); assert.match(r0.body.error, /META_APP_ID/);
  const on = build(); const r1 = res();
  await on.ic.start({ uid: 'u1' }, r1);
  const st = new URL(r1.body.url).searchParams.get('state');
  assert.equal(st.length, 48);
  assert.equal(await on.state.take(st), 'u1');
  assert.equal(await on.state.take(st), null, 'state works once');
});

test('A.1a redis state: 10 minute TTL, read-and-delete', async () => {
  const sets = [];
  const redis = { set: async (...a) => void sets.push(a), multi: () => ({ get() { return this; }, del() { return this; }, exec: async () => [[null, 'u9'], [null, 1]] }) };
  const s = makeRedisState(redis);
  await s.put('abc', 'u9');
  assert.deepEqual(sets[0], ['igstate:abc', 'u9', 'EX', STATE_TTL_SEC]);
  assert.equal(await s.take('abc'), 'u9');
});

test('A.1a callback success: token encrypted store, account row, redirect to the app', async () => {
  const t = build(); await t.state.put('S1', 'u1'); const r = res();
  await t.ic.callback({ query: { code: 'CODE', state: 'S1' } }, r);
  assert.equal(r.to, 'https://app.example/?ig=connected');
  assert.equal(t.keys.m.get('u1instagram'), 'LONG_TOKEN', 'long-lived token replaces the short one');
  const ins = t.q.calls.find(c => /INSERT INTO ig_accounts/.test(c.sql));
  const [uid, igId, pageId, username, scopes, expires, followers] = ins.p;
  assert.deepEqual([uid, igId, pageId, username, followers], ['u1', 'IG_1', 'PAGE_1', 'studio.example', 1240]);
  assert.deepEqual(scopes, IG_SCOPES);
  assert.equal(expires.getTime(), NOW + 5184000 * 1000);
  assert.ok(t.fetch.calls.some(u => u.searchParams.get('fb_exchange_token') === 'SHORT_TOKEN'));
});

test('A.1a callback failures each redirect with a specific reason (O.2 error states)', async () => {
  const cases = [
    ['declined', { query: { error: 'access_denied', state: 'S' } }, connectRoutes(), 'declined'],
    ['unknown state', { query: { code: 'C', state: 'NOPE' } }, connectRoutes(), 'state_invalid'],
    ['no state', { query: { code: 'C' } }, connectRoutes(), 'state_invalid'],
    ['no Page', { query: { code: 'C', state: 'S' } }, [[/me\/accounts/, () => [fx('me_accounts_empty')]], ...connectRoutes()], 'no_page'],
    ['wrong account type', { query: { code: 'C', state: 'S' } }, [[/me\/accounts/, () => [fx('me_accounts_no_ig')]], ...connectRoutes()], 'wrong_type'],
    ['missing permissions', { query: { code: 'C', state: 'S' } }, [[/me\/permissions/, () => [fx('permissions_partial')]], ...connectRoutes()], 'missing_permissions'],
    ['bad code', { query: { code: 'C', state: 'S' } }, [[/oauth\/access_token/, () => [fx('error_declined_code'), { status: 400 }]], ...connectRoutes()], 'token_error'],
  ];
  for (const [name, req, routes, reason] of cases) {
    const t = build({ routes }); await t.state.put('S', 'u1'); const r = res();
    await t.ic.callback(req, r);
    assert.equal(r.to, `https://app.example/?ig=error&reason=${reason}`, name);
    assert.ok(!t.q.calls.some(c => /INSERT INTO ig_accounts/.test(c.sql)), name + ': nothing stored');
    assert.ok(!t.keys.m.has('u1instagram'), name + ': no token stored');
  }
});

test('A.1a callback consumes the state even when the user declined (no replay)', async () => {
  const t = build(); await t.state.put('S', 'u1');
  await t.ic.callback({ query: { error: 'access_denied', state: 'S' } }, res());
  const r = res(); await t.ic.callback({ query: { code: 'C', state: 'S' } }, r);
  assert.match(r.to, /reason=state_invalid/);
});

test('A.1a pickAccount: first Page with an Instagram account; says how many others were ignored (D4)', () => {
  const pages = [{ id: 'P0' }, { id: 'P1', instagram_business_account: { id: 'I1', username: 'a' } }, { id: 'P2', instagram_business_account: { id: 'I2' } }];
  const a = pickAccount(pages);
  assert.deepEqual([a.pageId, a.igUserId, a.username, a.followers, a.others], ['P1', 'I1', 'a', null, 1]);
  assert.throws(() => pickAccount([]), e => e instanceof ConnectError && e.code === 'no_page');
  assert.throws(() => pickAccount([{ id: 'P0' }]), e => e.code === 'wrong_type');
});

test('A.1a status never contains the token and reports expiry, source and state', async () => {
  const exp = new Date(NOW + 40 * 864e5).toISOString();
  const t = build({ rows: () => [{ status: 'connected', username: 'studio.example', followers_at_connect: 1240, last_sync_at: null, last_error: null, token_expires_at: exp, scopes: ['instagram_basic'], token: 'LEAK' }] });
  const r = res(); await t.ic.status({ uid: 'u1' }, r);
  assert.equal(r.body.connected, true); assert.equal(r.body.source, 'oauth'); assert.equal(r.body.daysLeft, 40); assert.equal(r.body.configured, true);
  assert.ok(!JSON.stringify(r.body).includes('LEAK') && !JSON.stringify(r.body).includes('TOKEN'));
  const none = build(); const r2 = res(); await none.ic.status({ uid: 'u1' }, r2);
  assert.equal(r2.body.status, 'not_connected'); assert.equal(r2.body.connected, false);
  const dev = build({ env: { ...ENV, IG_ACCESS_TOKEN: 't', IG_USER_ID: 'i' } }); const r3 = res(); await dev.ic.status({ uid: 'u1' }, r3);
  assert.deepEqual([r3.body.status, r3.body.source], ['dev_env', 'env']);
});

test('A.1a disconnect: removes the token, marks disconnected; data=delete also removes Instagram-linked posts; bad value 400', async () => {
  const t = build({ rows: sql => (/DELETE FROM posts/.test(sql) ? [{ id: 1 }, { id: 2 }] : []) }); t.keys.m.set('u1instagram', 'X');
  const keep = res(); await t.ic.disconnect({ uid: 'u1', query: {} }, keep);
  assert.deepEqual(keep.body, { ok: true, data: 'keep', postsDeleted: 0 });
  assert.ok(!t.keys.m.has('u1instagram'));
  assert.ok(t.q.calls.some(c => /status='disconnected'/.test(c.sql)));
  assert.ok(!t.q.calls.some(c => /DELETE FROM posts/.test(c.sql)));
  const del = res(); await t.ic.disconnect({ uid: 'u1', query: { data: 'delete' } }, del);
  assert.equal(del.body.postsDeleted, 2);
  const bad = res(); await t.ic.disconnect({ uid: 'u1', query: { data: 'nuke' } }, bad);
  assert.equal(bad.code, 400);
});

test('A.1a token health helpers', () => {
  assert.equal(daysLeft(new Date(NOW + 10 * 864e5), NOW), 10);
  assert.equal(needsRefresh(new Date(NOW + 14 * 864e5), NOW), true);
  assert.equal(needsRefresh(new Date(NOW + 15 * 864e5), NOW), false);
  assert.equal(needsRefresh(null, NOW), false);
  assert.equal(expiryFrom(undefined, NOW).getTime(), NOW + 60 * 864e5, 'missing expires_in = documented 60 days');
});

function refreshHarness({ accounts, routes, token = 'OLD' }) {
  const t = build({ routes, rows: sql => (/FROM ig_accounts WHERE status='connected'/.test(sql) ? accounts : /UPDATE ig_accounts SET status='reconnect_needed'/.test(sql) ? [{ conn: 1700000000 }] : []) });
  for (const a of accounts) if (token) t.keys.m.set(a.user_id + 'instagram', token);
  return t;
}
test('A.1a refresh: token with 40 days left is not touched', async () => {
  const t = refreshHarness({ accounts: [{ user_id: 'u1', token_expires_at: new Date(NOW + 40 * 864e5) }] });
  const out = await t.ic.refreshTokens();
  assert.deepEqual(out, { checked: 1, refreshed: 0, reconnect: 0, errors: 0 });
  assert.equal(t.fetch.calls.length, 0);
});
test('A.1a refresh: token with 10 days left is exchanged and the new expiry stored', async () => {
  const t = refreshHarness({ accounts: [{ user_id: 'u1', token_expires_at: new Date(NOW + 10 * 864e5) }] });
  const out = await t.ic.refreshTokens();
  assert.equal(out.refreshed, 1);
  assert.equal(t.keys.m.get('u1instagram'), 'LONG_TOKEN');
  const up = t.q.calls.find(c => /SET token_expires_at=\$2,last_error=NULL/.test(c.sql));
  assert.equal(up.p[1].getTime(), NOW + 5184000 * 1000);
});
test('A.1a refresh: Meta says the token is dead -> reconnect_needed + one notification', async () => {
  const t = refreshHarness({ accounts: [{ user_id: 'u1', token_expires_at: new Date(NOW + 5 * 864e5) }], routes: [[/oauth\/access_token/, () => [fx('error_190'), { status: 400 }]]] });
  const out = await t.ic.refreshTokens();
  assert.equal(out.reconnect, 1);
  const n = t.q.calls.find(c => /INSERT INTO notifications/.test(c.sql));
  assert.ok(n && /ON CONFLICT \(user_id,dedupe_key\) DO NOTHING/.test(n.sql));
  assert.deepEqual([n.p[0], n.p[3]], ['u1', 'ig-reconnect:1700000000']);
});
test('A.1a refresh: already expired -> reconnect_needed without calling Meta', async () => {
  const t = refreshHarness({ accounts: [{ user_id: 'u1', token_expires_at: new Date(NOW - 864e5) }] });
  assert.equal((await t.ic.refreshTokens()).reconnect, 1);
  assert.equal(t.fetch.calls.length, 0);
});
test('A.1a refresh: a network error keeps the account connected and retries later', async () => {
  const t = refreshHarness({ accounts: [{ user_id: 'u1', token_expires_at: new Date(NOW + 5 * 864e5) }], routes: [[/./, () => { throw new Error('ETIMEDOUT'); }]] });
  const out = await t.ic.refreshTokens();
  assert.deepEqual([out.errors, out.reconnect], [1, 0]);
  assert.ok(t.q.calls.some(c => /SET last_error=\$2/.test(c.sql) && /will retry/.test(c.p[1])));
  assert.ok(!t.q.calls.some(c => /reconnect_needed/.test(c.sql)));
});
test('A.1a refresh: missing/unreadable stored token -> reconnect_needed', async () => {
  const t = refreshHarness({ accounts: [{ user_id: 'u1', token_expires_at: new Date(NOW + 5 * 864e5) }], token: null });
  assert.equal((await t.ic.refreshTokens()).reconnect, 1);
});

test('A.1a getIgCreds: connected > reconnect_needed throws > dev env > production has no env fallback', async () => {
  const keys = mem(); keys.m.set('u1instagram', 'USERTOK');
  const mk = (rows, env = {}) => makeIgCreds({ q: async () => rows, keys, env });
  assert.deepEqual(await mk([{ ig_user_id: 'IG_1', status: 'connected', username: 'x' }])('u1'), { token: 'USERTOK', igUserId: 'IG_1', username: 'x', source: 'oauth' });
  await assert.rejects(mk([{ ig_user_id: 'IG_1', status: 'reconnect_needed' }], { IG_ACCESS_TOKEN: 'E', IG_USER_ID: 'EI' })('u1'), e => e instanceof IgNotConnected && e.reason === 'reconnect_needed');
  await assert.rejects(mk([{ ig_user_id: 'IG_1', status: 'disconnected' }])('u1'), IgNotConnected);
  const keys2 = mem(); const bare = env => makeIgCreds({ q: async () => [], keys: keys2, env });
  assert.deepEqual(await bare({ IG_ACCESS_TOKEN: 'E', IG_USER_ID: 'EI' })('u1'), { token: 'E', igUserId: 'EI', source: 'env' });
  assert.equal(await bare({ NODE_ENV: 'production', IG_ACCESS_TOKEN: 'E', IG_USER_ID: 'EI' })('u1'), null);
  assert.equal((await bare({ NODE_ENV: 'production', IG_ACCESS_TOKEN: 'E', IG_USER_ID: 'EI', IG_ALLOW_ENV_FALLBACK: '1' })('u1')).source, 'env');
  assert.equal(await bare({})('u1'), null);
  const manual = makeIgCreds({ q: async () => [], keys, env: { IG_USER_ID: 'EI' } });
  assert.deepEqual(await manual('u1'), { token: 'USERTOK', igUserId: 'EI', source: 'manual' });
});

// =================== A.1b ===================
test('A.1b mapping: unavailable metrics are NULL, never 0 and never a rejection', () => {
  const m = mapMedia(fx('media_page1').data[1], {}); // feed image, insights failed
  assert.deepEqual([m.ig_media_id, m.type, m.likes, m.comments], ['M2', 'IMAGE', 80, 4]);
  for (const k of ['saves', 'shares', 'reach', 'views', 'watch_s']) assert.equal(m[k], null, k);
  const hidden = mapMedia({ id: 'H', timestamp: '2026-10-01T00:00:00+0000', media_type: 'IMAGE' }, parseInsights(fx('insights_core')));
  assert.equal(hidden.likes, null, 'hidden like count stays NULL');
  assert.deepEqual([hidden.reach, hidden.saves, hidden.shares, hidden.views], [900, 3, 1, null]);
});
test('A.1b mapping: reels convert watch time ms -> whole seconds; VIDEO is REEL; stories are skipped', () => {
  const reel = mapMedia(fx('media_page1').data[0], parseInsights(fx('insights_reel')));
  assert.deepEqual([reel.type, reel.watch_s, reel.reach, reel.views, reel.saves, reel.shares], ['REEL', 5, 5000, 7200, 40, 25]);
  assert.equal(mediaType({ media_type: 'VIDEO' }), 'REEL');
  assert.equal(mediaType({ media_type: 'CAROUSEL_ALBUM', media_product_type: 'FEED' }), 'CAROUSEL_ALBUM');
  assert.equal(mapMedia(fx('media_page1').data[2], {}), null);
  assert.equal(mapMedia({ id: 'x' }, {}), null, 'no timestamp -> nothing to store');
});
test('A.1b guard: retired metric names can never be requested', () => {
  for (const [kind, ladder] of Object.entries(INSIGHT_LADDER)) for (const list of ladder) for (const name of list) assert.ok(!BANNED_METRICS.includes(name), `${kind} requests ${name}`);
  for (const bad of ['impressions', 'plays', 'video_views', 'clips_replays_count', 'ig_reels_aggregated_all_plays_count']) assert.throws(() => assertMetricsAllowed(['reach', bad]), /Retired/);
});

// In-memory stand-in for the three posts statements, matched by the exported SQL constants. It proves the ORDER (id, then date+type+caption, then insert)
// and the NULL-keeps-stored rule; the real SQL runs in smoke-phaseA1.sh.
function fakeDb(seed = []) {
  const posts = seed.map((p, i) => ({ id: i + 1, ig_media_id: null, ...p }));
  const sameDay = (a, b) => new Date(a).toISOString().slice(0, 10) === new Date(b).toISOString().slice(0, 10);
  const METRIC = ['likes', 'comments', 'saves', 'shares', 'reach', 'views', 'watch_s', 'permalink', 'thumbnail_url', 'media_product_type'];
  const apply = (row, p) => METRIC.forEach((k, i) => { if (p[2 + i] !== null) row[k] = p[2 + i]; });
  const extra = [];
  const q = async (sql, p = []) => {
    if (sql === UPDATE_BY_ID_SQL) { const r = posts.find(x => x.user_id === p[0] && x.ig_media_id === p[1]); if (r) apply(r, p); return r ? [{ id: r.id }] : []; }
    if (sql === BACKFILL_SQL) {
      const r = posts.find(x => x.user_id === p[0] && !x.ig_media_id && x.type === p[13] && sameDay(x.posted_at, p[14]) && (x.caption || '') === p[12]);
      if (r) { r.ig_media_id = p[1]; apply(r, p); } return r ? [{ id: r.id }] : [];
    }
    if (sql === INSERT_SQL) {
      if (posts.some(x => x.user_id === p[0] && x.type === p[13] && x.posted_at === p[14] && (x.caption || '') === p[12])) return [];
      const row = { id: posts.length + 1, user_id: p[0], ig_media_id: p[1], caption: p[12], type: p[13], posted_at: p[14] }; apply(row, p); posts.push(row); return [{ id: row.id }];
    }
    if (/count\(\*\)::int n FROM posts/.test(sql)) return [{ n: posts.filter(x => x.user_id === p[0] && x.ig_media_id).length }];
    extra.push({ sql, p }); return [];
  };
  return { posts, q, extra };
}
const insightsRoute = [/\/insights/, u => {
  const id = u.pathname.split('/').at(-2), metric = u.searchParams.get('metric');
  return id === 'M3' ? [fx('insights_reel')] : id === 'M2' ? [fx('insights_feed')] : [fx('insights_core')];
}];
const mediaRoute = [/\/IG_1\/media/, u => [u.searchParams.get('after') === 'CUR1' ? fx('media_page2') : fx('media_page1')]];
const syncHarness = ({ routes = [mediaRoute, insightsRoute], seed = [], creds = { token: 'TOK', igUserId: 'IG_1', source: 'oauth' } } = {}) => {
  const fetch = fakeFetch(routes), db = fakeDb(seed); let snaps = 0;
  const s = makeIgSync({ q: db.q, graph: makeGraph({ fetch }), getIgCreds: async () => creds, afterSync: async () => { snaps++; }, now: () => NOW, hit: async () => ({ ok: true }), enqueue: async () => 'J1', getJob: async () => null });
  return { s, fetch, db, snaps: () => snaps };
};

test('A.1b first sync pages through media, skips stories, fills metrics and runs the snapshot job', async () => {
  const t = syncHarness(); const out = await t.s.syncUser('u1');
  assert.deepEqual([out.fetched, out.inserted, out.updated, out.linked], [3, 3, 0, 0]);
  assert.deepEqual(t.db.posts.map(p => p.ig_media_id).sort(), ['M1', 'M2', 'M3']);
  const reel = t.db.posts.find(p => p.ig_media_id === 'M3');
  assert.deepEqual([reel.reach, reel.views, reel.watch_s, reel.permalink], [5000, 7200, 5, 'https://www.instagram.com/reel/M3/']);
  assert.equal(t.snaps(), 1, 'snapshots run after a sync');
  assert.ok(t.db.extra.some(c => /UPDATE ig_accounts SET last_sync_at=now\(\)/.test(c.sql)));
  assert.ok(!t.fetch.calls.some(u => u.pathname.endsWith('/S1/insights')), 'no insights call for a story');
});
test('A.1b re-sync is idempotent: same media again adds no rows', async () => {
  const t = syncHarness(); await t.s.syncUser('u1'); const before = t.db.posts.length;
  const out = await t.s.syncUser('u1');
  assert.equal(t.db.posts.length, before);
  assert.equal(out.inserted, 0);
  assert.ok(out.updated >= 1);
});
test('A.1b later runs only re-pull the last 3 days (insights can lag 48 h)', async () => {
  const t = syncHarness({ seed: [{ user_id: 'u1', type: 'IMAGE', posted_at: '2026-09-01T10:00:00.000Z', caption: 'Old', ig_media_id: 'OLD' }] });
  const out = await t.s.syncUser('u1');
  assert.deepEqual(out.fetched, 2, 'M3 and M2 only; M1 (Sept) is older than 3 days');
  assert.ok(!t.fetch.calls.some(u => u.searchParams.get('after') === 'CUR2'), 'stops paginating once a page reaches old media');
});
test('A.1b the same post from a CSV import and the API is ONE row, and the CSV row gets the Instagram id', async () => {
  const t = syncHarness({ seed: [{ user_id: 'u1', type: 'IMAGE', posted_at: '2026-10-13T00:00:00.000Z', caption: 'Fresh batch', likes: 70, comments: 3, saves: 9, reach: 1800 }] });
  const out = await t.s.syncUser('u1');
  assert.equal(out.linked, 1);
  assert.equal(t.db.posts.filter(p => p.caption === 'Fresh batch').length, 1);
  const row = t.db.posts.find(p => p.caption === 'Fresh batch');
  assert.deepEqual([row.ig_media_id, row.likes, row.reach, row.saves], ['M2', 80, 2000, 15], 'API numbers refresh the CSV row');
});
test('A.1b a metric Meta does not return keeps the stored value instead of being overwritten with NULL/0', async () => {
  const t = syncHarness({ seed: [{ user_id: 'u1', type: 'IMAGE', posted_at: '2026-10-13T16:00:00.000Z', caption: 'Fresh batch', ig_media_id: 'M2', shares: 99, watch_s: 12 }],
    routes: [mediaRoute, [/\/insights/, () => [{ data: [{ name: 'reach', values: [{ value: 10 }] }] }]]] });
  await t.s.syncUser('u1');
  const r = t.db.posts.find(p => p.ig_media_id === 'M2');
  assert.deepEqual([r.reach, r.shares, r.watch_s], [10, 99, 12]);
});
test('A.1b insights fallback: unsupported metric -> shorter core list -> still stored; requested names are never retired ones', async () => {
  const t = syncHarness({ routes: [mediaRoute, [/\/insights/, u => (u.searchParams.get('metric').includes('views') ? [fx('error_100_metric'), { status: 400 }] : [fx('insights_core')])]] });
  const out = await t.s.syncUser('u1');
  assert.equal(out.noInsights, 0);
  assert.equal(t.db.posts.find(p => p.ig_media_id === 'M2').reach, 900);
  const asked = t.fetch.calls.filter(u => u.pathname.endsWith('/insights')).flatMap(u => u.searchParams.get('metric').split(','));
  assert.ok(asked.length > 0);
  for (const m of asked) assert.ok(!BANNED_METRICS.includes(m), m);
});
test('A.1b every insights call failing still stores the posts (NULL metrics) and warns', async () => {
  const t = syncHarness({ routes: [mediaRoute, [/\/insights/, () => [fx('error_100_metric'), { status: 400 }]]] });
  const out = await t.s.syncUser('u1');
  assert.deepEqual([out.inserted, out.noInsights], [3, 3]);
  assert.equal(t.db.posts.find(p => p.ig_media_id === 'M2').reach, undefined);
  const up = t.db.extra.find(c => /last_sync_at=now\(\)/.test(c.sql));
  assert.match(up.p[1], /no insights/);
});
test('A.1b token error mid-sync: account flips to reconnect_needed and the error is raised', async () => {
  const t = syncHarness({ routes: [[/\/media/, () => [fx('error_190'), { status: 400 }]]] });
  await assert.rejects(t.s.syncUser('u1'), e => e instanceof IgError && e.tokenInvalid);
  assert.ok(t.db.extra.some(c => /status='reconnect_needed'/.test(c.sql)));
});
test('A.1b rate limit error stops the run without marking the account dead', async () => {
  const t = syncHarness({ routes: [[/\/media/, () => [{ error: { message: 'limit', code: 4 } }, { status: 400 }]]] });
  await assert.rejects(t.s.syncUser('u1'), e => e.rateLimited);
  assert.ok(!t.db.extra.some(c => /reconnect_needed/.test(c.sql)));
  assert.ok(t.db.extra.some(c => /SET last_error=\$2/.test(c.sql)));
});
test('A.1b high usage header stops paging early and says so', async () => {
  const t = syncHarness({ routes: [[/\/IG_1\/media/, () => [fx('media_page1'), { headers: { 'x-app-usage': '{"call_count":85}' } }]], insightsRoute] });
  const out = await t.s.syncUser('u1');
  assert.match(out.stoppedEarly, /85%/);
  assert.ok(!t.fetch.calls.some(u => u.searchParams.get('after') === 'CUR1'));
});
test('A.1b not connected anywhere -> IgNotConnected', async () => {
  const t = syncHarness({ creds: null });
  await assert.rejects(t.s.syncUser('u1'), IgNotConnected);
});

test('A.1b schedule: stable 0-359 minute offset per user, due once per day after the slot, not before, not twice', () => {
  const a = staggerMinutes('user-a'), b = staggerMinutes('user-b');
  assert.ok(a >= 0 && a < 360 && b >= 0 && b < 360);
  assert.equal(a, staggerMinutes('user-a'));
  const slot = Date.UTC(2026, 9, 15, 2, 0) + a * 60000;
  const acct = { user_id: 'user-a', status: 'connected', last_sync_at: null };
  assert.equal(syncDue(acct, slot - 1), false);
  assert.equal(syncDue(acct, slot), true);
  assert.equal(syncDue({ ...acct, last_sync_at: new Date(slot + 1000) }, slot + 3600e3), false);
  assert.equal(syncDue({ ...acct, last_sync_at: new Date(slot - 864e5 + 1000) }, slot), true, 'yesterday\'s sync does not count');
  assert.equal(syncDue({ ...acct, status: 'reconnect_needed' }, slot + 1e6), false);
  const spread = new Set(Array.from({ length: 200 }, (_, i) => staggerMinutes('u' + i)));
  assert.ok(spread.size > 100, 'offsets are well spread');
  // user in UTC+3: their 02:00 local is 23:00 UTC the previous day
  const slotTz = Date.UTC(2026, 9, 14, 23, 0) + a * 60000;
  assert.equal(syncDue(acct, slotTz, 180), true);
  assert.equal(syncDue(acct, slotTz - 1, 180), false);
});

test('A.1b requestSync: 409 when not connected, 409 when reconnect needed, 429 inside the cooldown, 202 with a job id', async () => {
  const mk = (rows, h = { ok: true }) => makeIgSync({ q: async () => rows, graph: {}, getIgCreds: async () => null, hit: async () => h, enqueue: async () => 'J7', getJob: async () => null });
  const r1 = res(); await mk([]).requestSync({ uid: 'u' }, r1); assert.equal(r1.code, 409);
  const r2 = res(); await mk([{ status: 'reconnect_needed' }]).requestSync({ uid: 'u' }, r2); assert.equal(r2.code, 409); assert.match(r2.body.error, /reconnected/);
  const r3 = res(); await mk([{ status: 'connected' }], { ok: false, ttl: 130 }).requestSync({ uid: 'u' }, r3);
  assert.equal(r3.code, 429); assert.equal(r3.headers['Retry-After'], '130'); assert.match(r3.body.error, /3 min/);
  const r4 = res(); await mk([{ status: 'connected' }]).requestSync({ uid: 'u' }, r4); assert.deepEqual([r4.code, r4.body], [202, { jobId: 'J7' }]);
});
test('A.1b jobStatus only shows a user their own job', async () => {
  const job = (uid, st) => ({ data: { userId: uid }, getState: async () => st, returnvalue: { fetched: 3 }, failedReason: 'boom' });
  const mk = j => makeIgSync({ q: async () => [], graph: {}, getIgCreds: async () => null, hit: async () => ({ ok: true }), enqueue: async () => 'x', getJob: async () => j });
  const own = res(); await mk(job('u', 'completed')).jobStatus({ uid: 'u', params: { jobId: '1' } }, own); assert.deepEqual(own.body, { status: 'done', fetched: 3 });
  const other = res(); await mk(job('someone', 'completed')).jobStatus({ uid: 'u', params: { jobId: '1' } }, other); assert.equal(other.code, 404);
  const none = res(); await mk(null).jobStatus({ uid: 'u', params: { jobId: '1' } }, none); assert.equal(none.code, 404);
  const failed = res(); await mk(job('u', 'failed')).jobStatus({ uid: 'u', params: { jobId: '1' } }, failed); assert.deepEqual(failed.body, { status: 'failed', error: 'boom' });
});
