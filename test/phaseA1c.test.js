// Roadmap A.1c (follower history, account insights, advisor) and A.1d backend (Meta callbacks, privacy page, persisted Dismiss).
// Fakes and hand-written fixtures only: nothing here proves Meta's real responses look like this. SQL runs in scripts/smoke-phaseA1c.sh / a real Postgres.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { makeGraph, IgError } from '../src/instagram.js';
import {
  parseFollowerSeries, reconstructHistory, parseDaily, parseBreakdown, parseOnline, makeIgAccount, DAILY_METRICS, MIN_FOLLOWERS,
} from '../src/igaccount.js';
import { makeIgSync } from '../src/igsync.js';
import { makeIgConnect } from '../src/igconnect.js';
import { advise, followerGrowth, contextGaps } from '../src/advisor.js';
import { parseSignedRequest, makeCompliance, privacyHtml, sha256 } from '../src/igcompliance.js';
import { makeDismissals } from '../src/dismissals.js';
import { makeInsights } from '../src/insights.js';
import { BANNED_METRICS } from '../src/instagram.js';

const NOW = Date.parse('2026-10-15T12:00:00Z');
const resp = body => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body });
const res = () => { const r = { code: 200, body: undefined, html: undefined }; r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; }; r.type = () => r; r.send = h => { r.html = h; return r; }; return r; };
const recQ = (rows = () => []) => { const calls = []; const q = async (sql, p = []) => { calls.push({ sql, p }); return rows(sql, p); }; q.calls = calls; return q; };
const iso = d => `${d}T07:00:00+0000`;

// ---------- pure parsers ----------
test('A.1c follower_count series: values are NET daily change, mapped to the previous UTC date of end_time; bad rows dropped', () => {
  const s = parseFollowerSeries({ data: [{ name: 'follower_count', values: [{ value: 3, end_time: iso('2026-10-14') }, { value: 'x', end_time: iso('2026-10-15') }, { value: 2 }, { value: -1, end_time: iso('2026-10-15') }] }] });
  assert.deepEqual(s, [{ day: '2026-10-13', value: 3 }, { day: '2026-10-14', value: -1 }]);
  assert.deepEqual(parseFollowerSeries({}), []);
});
test('A.1c reconstructHistory walks back from today\'s total and labels the oldest point with no net change', () => {
  const series = [{ day: '2026-10-12', value: 5 }, { day: '2026-10-13', value: -2 }, { day: '2026-10-14', value: 10 }, { day: '2026-10-15', value: 4 }];
  const h = reconstructHistory(1000, series, '2026-10-15');
  assert.deepEqual(h, [
    { day: '2026-10-11', followers: 983, net_new: null }, { day: '2026-10-12', followers: 988, net_new: 5 },
    { day: '2026-10-13', followers: 986, net_new: -2 }, { day: '2026-10-14', followers: 996, net_new: 10 }]);
  assert.deepEqual(reconstructHistory(1000, [], '2026-10-15'), []);
  assert.deepEqual(reconstructHistory(null, series, '2026-10-15'), []);
  assert.ok(reconstructHistory(3, [{ day: '2026-10-14', value: 50 }], '2026-10-15').every(r => r.followers >= 0)); // never a negative follower count
});
test('A.1c parseDaily: missing metric = NULL, follows/unfollows only with exactly FOLLOWS and UNFOLLOWS labels', () => {
  const ok = parseDaily({ data: [{ name: 'reach', total_value: { value: 900 } }, { name: 'views', total_value: { value: 2000 } },
    { name: 'follows_and_unfollows', total_value: { breakdowns: [{ results: [{ dimension_values: ['FOLLOWS'], value: 7 }, { dimension_values: ['UNFOLLOWS'], value: 2 }] }] } }] });
  assert.deepEqual(ok, { reach: 900, views: 2000, accounts_engaged: null, profile_links_taps: null, follows: 7, unfollows: 2 });
  const odd = parseDaily({ data: [{ name: 'follows_and_unfollows', total_value: { breakdowns: [{ results: [{ dimension_values: ['FOLLOWER'], value: 7 }] }] } }] });
  assert.equal(odd.follows, null); assert.equal(odd.unfollows, null);
  assert.equal(parseDaily(null).reach, null);
});
test('A.1c breakdown and online parsers', () => {
  assert.deepEqual(parseBreakdown({ data: [{ total_value: { breakdowns: [{ dimension_keys: ['age'], results: [{ dimension_values: ['18-24'], value: 40 }, { dimension_values: ['25-34'], value: 'n/a' }] }] } }] }), { age: { '18-24': 40 } });
  assert.deepEqual(parseOnline({ data: [{ name: 'online_followers', values: [{ value: { 0: 5 } }, { value: { 0: 9, 1: 3 } }] }] }), { 0: 9, 1: 3 });
  assert.equal(parseOnline({ data: [] }), null);
});
test('A.1c guard: no retired metric name is ever requested for account insights', () => {
  assert.ok(DAILY_METRICS.every(m => !BANNED_METRICS.includes(m)));
});

// ---------- account sync with a fake Graph ----------
const graphFor = routes => { const calls = []; const f = async url => { const u = new URL(url); calls.push(u); for (const [re, h] of routes) if (re.test(u.pathname + u.search)) { const r = h(u); if (r instanceof Error) throw r; return resp(r); } throw new Error('no route ' + u.pathname); }; f.calls = calls; return f; };
const seriesBody = { data: [{ name: 'follower_count', values: [{ value: 4, end_time: iso('2026-10-14') }, { value: 6, end_time: iso('2026-10-15') }] }] };
const acctRoutes = (followers = 1240) => [
  [/\/IG_1\?fields=followers_count/, () => ({ followers_count: followers, media_count: 87 })],
  [/metric=follower_count/, () => seriesBody],
  [/metric=reach%2Cviews/, () => ({ data: [{ name: 'reach', total_value: { value: 500 } }] })],
  [/metric=follower_demographics/, () => ({ data: [{ name: 'follower_demographics', total_value: { breakdowns: [{ dimension_keys: ['age'], results: [{ dimension_values: ['18-24'], value: 10 }] }] } }] })],
  [/metric=online_followers/, () => ({ data: [{ name: 'online_followers', values: [{ value: { 9: 4 } }] }] })],
];
const creds = { token: 'T', igUserId: 'IG_1', source: 'oauth' };

test('A.1c first sync of a 100+ account: back-fills reconstructed history (never overwriting), writes today as live, daily rows, one audience snapshot', async () => {
  const f = graphFor(acctRoutes()), q = recQ(sql => (/count\(\*\)::int n FROM follower_history/.test(sql) ? [{ n: 0 }] : /FROM ig_audience/.test(sql) ? [{ n: 0 }] : [{ id: 1 }]));
  const out = await makeIgAccount({ q, graph: makeGraph({ fetch: f }), now: () => NOW }).sync('u1', creds);
  assert.equal(out.followers, 1240); assert.equal(out.daily, 2); assert.equal(out.audience, true);
  const rec = q.calls.filter(c => /'reconstructed'/.test(c.sql)), live = q.calls.filter(c => /'live'/.test(c.sql));
  assert.equal(rec.length, 3); // two net-change days + the anchor point before them assert.ok(rec.every(c => /ON CONFLICT DO NOTHING/.test(c.sql)));
  assert.equal(live.length, 1); assert.deepEqual(live[0].p, ['u1', 1240, null]); // the series has no value for today yet
  assert.ok(/ON CONFLICT \(user_id,\(\(captured_at AT TIME ZONE 'UTC'\)::date\)\) DO UPDATE/.test(live[0].sql));
  assert.ok(q.calls.some(c => /INSERT INTO ig_audience/.test(c.sql)));
  const asked = f.calls.map(u => u.searchParams.get('metric')).filter(Boolean).join(',');
  for (const b of BANNED_METRICS) assert.ok(!asked.split(',').includes(b), b);
});
test('A.1c second sync the same day: no back-fill, no second audience snapshot this week', async () => {
  const q = recQ(sql => (/count\(\*\)::int n FROM follower_history/.test(sql) ? [{ n: 5 }] : /FROM ig_audience/.test(sql) ? [{ n: 1 }] : [{ id: 1 }]));
  const out = await makeIgAccount({ q, graph: makeGraph({ fetch: graphFor(acctRoutes()) }), now: () => NOW }).sync('u1', creds);
  assert.ok(!q.calls.some(c => /'reconstructed'/.test(c.sql))); assert.ok(!q.calls.some(c => /INSERT INTO ig_audience/.test(c.sql))); assert.equal(out.audience, false);
});
test('A.1c under 100 followers: today\'s total only, no insights call that needs 100+, and a note says why', async () => {
  const f = graphFor(acctRoutes(MIN_FOLLOWERS - 1)), q = recQ(sql => (/count\(\*\)::int n FROM follower_history/.test(sql) ? [{ n: 0 }] : [{ id: 1 }]));
  const out = await makeIgAccount({ q, graph: makeGraph({ fetch: f }), now: () => NOW }).sync('u1', creds);
  const asked = f.calls.map(u => u.searchParams.get('metric'));
  assert.ok(!asked.includes('follower_count') && !asked.includes('follower_demographics') && !asked.includes('online_followers'));
  assert.ok(!q.calls.some(c => /'reconstructed'/.test(c.sql)));
  assert.deepEqual(q.calls.find(c => /'live'/.test(c.sql)).p, ['u1', 99, null]);
  assert.match(out.notes.join(), /Under 100 followers/);
});
test('A.1c an insights error becomes a note; a dead token or rate limit is rethrown for the caller', async () => {
  const q = recQ(sql => (/count\(\*\)::int n FROM follower_history/.test(sql) ? [{ n: 0 }] : [{ id: 1 }]));
  const bad = [[/\/IG_1\?fields=/, () => ({ followers_count: 500 })], [/metric=follower_count/, () => seriesBody], [/metric=reach/, () => { throw new Error('boom'); }], [/follower_demographics|online/, () => ({ data: [] })]];
  const out = await makeIgAccount({ q, graph: makeGraph({ fetch: graphFor(bad) }), now: () => NOW }).sync('u1', creds);
  assert.match(out.notes.join(), /Account insights unavailable/);
  const dead = [[/\/IG_1\?fields=/, () => new IgError('expired', { code: 190 })]];
  const g = { get: async () => { throw new IgError('expired', { code: 190 }); } };
  await assert.rejects(makeIgAccount({ q, graph: g, now: () => NOW }).sync('u1', creds), e => e.tokenInvalid);
  void dead;
});
test('A.1c a failing account part never stops the post sync: it is reported as a warning in last_error', async () => {
  const q = recQ(sql => (/count\(\*\)::int n FROM posts/.test(sql) ? [{ n: 1 }] : [])); // known>0 -> not first run
  const graph = { get: async p => (/media$/.test(p) ? { data: [], paging: {} } : (() => { throw new IgError('Insights are down'); })()) };
  const account = makeIgAccount({ q, graph, now: () => NOW });
  const s = makeIgSync({ q, graph, getIgCreds: async () => creds, account, now: () => NOW });
  const r = await s.syncUser('u1');
  assert.equal(r.fetched, 0);
  const upd = q.calls.find(c => /last_sync_at=now\(\)/.test(c.sql));
  assert.match(upd.p[1], /Account data skipped: Insights are down/);
});

// ---------- advisor ----------
const day = n => new Date(Date.parse('2026-10-15T00:00:00Z') - n * 864e5).toISOString().slice(0, 10);
const series = pts => pts.map(([n, followers, source = 'live']) => ({ day: day(n), followers, source }));
const base = { hasData: true, reach30d: 1000, reachChange: 0, er: 2, postsPerWeek: 1, posts30d: 4, totalPosts: 20, mentions30d: 0, collabs30d: 0, types: [{ type: 'REEL', er: 6, share: 0.1 }], topCompetitor: null };

test('A.1c followerGrowth: windows only when a point that old exists; direction follows the 7-day change', () => {
  const g = followerGrowth({ followerSeries: series([[30, 1000, 'reconstructed'], [7, 1100], [0, 1050]]) });
  assert.deepEqual([g.value30d, g.pct30d, g.value7d, g.pct7d, g.direction, g.reconstructed], [50, 5, -50, -4.5, 'down', true]);
  const young = followerGrowth({ followerSeries: series([[2, 1000], [0, 1010]]) });
  assert.equal(young.value30d, null); assert.equal(young.value7d, null); assert.equal(young.direction, null); assert.equal(young.followers, 1010);
  assert.equal(followerGrowth({}).hasData, false); assert.equal(followerGrowth({ followerSeries: [] }).followers, null);
});
test('A.1c follower_drop tip fires only for a fall of more than 1% in 7 days, and explains itself', () => {
  const drop = advise({ ...base, followerSeries: series([[7, 1000], [0, 980]]) }), t = drop.find(x => x.kind === 'follower_drop');
  assert.ok(t && t.why && t.watch && drop[0].kind === 'follower_drop'); assert.match(t.why, /not its cause/);
  assert.ok(!advise({ ...base, followerSeries: series([[7, 1000], [0, 995]]) }).some(x => x.kind === 'follower_drop')); // -0.5%
  assert.ok(!advise(base).some(x => x.kind === 'follower_drop'));
});
test('A.1c growth = followers when history exists, reach otherwise (collab and giveaway tips)', () => {
  const reachUp = { ...base, reachChange: 30, collabs30d: 0 };
  assert.ok(!advise(reachUp).some(x => x.kind === 'collab'));                                  // reach +30% -> no collab tip (old behaviour)
  const flat = advise({ ...reachUp, followerSeries: series([[30, 1000], [0, 1010]]) });          // followers +1% -> collab tip fires
  assert.match(flat.find(x => x.kind === 'collab').why, /followers changed 1% over 30 days/);
  const falling = advise({ ...reachUp, followerSeries: series([[30, 1000], [0, 990]]) });
  assert.match(falling.find(x => x.kind === 'giveaway').why, /Followers changed -1%/);
  const solid = advise({ ...base, reachChange: 0, collabs30d: 0, followerSeries: series([[30, 1000], [0, 1030]]) }); // followers +3%: above the 2% bar, so no collab tip although reach 0% alone would trigger it
  assert.ok(!solid.some(x => x.kind === 'collab'));
  assert.match(advise({ ...base, reachChange: -5 }).find(x => x.kind === 'giveaway').why, /Reach is -5%/); // reach path unchanged
});
test('A.1c contextGaps: the growth sentence follows the data, and under-100 accounts are told why history is missing', () => {
  const s = { posts: 30, spanDays: 90, competitors: 1, scrapedCompetitors: 1, imports: 1, snapshotDays: 5 };
  assert.match(contextGaps({ followerSeries: series([[30, 1000], [0, 1100]]) }, s).at(-1), /Growth is follower count/);
  assert.match(contextGaps({}, s).at(-1), /growth is reach change, not followers/);
  assert.match(contextGaps({}, { ...s, igConnected: true, followersAtLastSync: 40 }).join(), /Under 100 followers/);
});

// ---------- A.1d: Meta callbacks ----------
const SECRET = 'app-secret';
const sign = (obj, secret = SECRET) => { const p = Buffer.from(JSON.stringify(obj)).toString('base64url'); return crypto.createHmac('sha256', secret).update(p).digest('base64url') + '.' + p; };
test('A.1d signed_request: valid HMAC accepted; tampered payload, wrong secret, wrong algorithm, junk all rejected', () => {
  assert.equal(parseSignedRequest(sign({ algorithm: 'HMAC-SHA256', user_id: '42' }), SECRET).user_id, '42');
  const good = sign({ algorithm: 'HMAC-SHA256', user_id: '42' }), [sig] = good.split('.');
  assert.equal(parseSignedRequest(sig + '.' + Buffer.from(JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: '43' })).toString('base64url'), SECRET), null);
  assert.equal(parseSignedRequest(good, 'other'), null);
  assert.equal(parseSignedRequest(sign({ algorithm: 'none', user_id: '42' }), SECRET), null);
  assert.equal(parseSignedRequest(sign({ algorithm: 'HMAC-SHA256' }), SECRET), null);
  for (const j of [undefined, '', 'a', 'a.b.c', 5, 'x.y']) assert.equal(parseSignedRequest(j, SECRET), null);
  assert.equal(parseSignedRequest(good, undefined), null);
});
const compl = (rows, env = {}) => { const q = recQ(rows), keys = { del: [], async del_(u, n) { this.del.push([u, n]); } }; const kd = { del: async (u, n) => keys.del.push([u, n]) }; return { q, keys, c: makeCompliance({ q, keys: kd, env: { META_APP_SECRET: SECRET, META_REDIRECT_URI: 'https://app.example/api/instagram/connect/callback', ...env }, now: () => NOW }) }; };
test('A.1d deauthorize: bad signature 400 and nothing touched; good one disconnects that account and removes its token, keeps data', async () => {
  const t = compl(sql => (/UPDATE ig_accounts/.test(sql) ? [{ user_id: 'u1' }] : []));
  const bad = res(); await t.c.deauthorize({ body: { signed_request: 'x.y' } }, bad); assert.equal(bad.code, 400); assert.equal(t.q.calls.length, 0);
  const ok = res(); await t.c.deauthorize({ body: { signed_request: sign({ algorithm: 'HMAC-SHA256', user_id: '42' }) } }, ok);
  assert.deepEqual(ok.body, { ok: true }); assert.deepEqual(t.keys.del, [['u1', 'instagram']]);
  assert.deepEqual(t.q.calls[0].p, ['42']); assert.ok(!t.q.calls.some(c => /DELETE/.test(c.sql)));
});
test('A.1d data-deletion: deletes every Instagram table for the account, stores only a hash, answers with url + code', async () => {
  const t = compl(sql => (/SELECT user_id FROM ig_accounts/.test(sql) ? [{ user_id: 'u1' }] : /DELETE/.test(sql) ? [{ id: 1 }, { id: 2 }] : []));
  const r = res(); await t.c.dataDeletion({ body: { signed_request: sign({ algorithm: 'HMAC-SHA256', user_id: '42' }) } }, r);
  assert.match(r.body.confirmation_code, /^[a-f0-9]{24}$/); assert.equal(r.body.url, `https://app.example/api/instagram/deletion-status?code=${r.body.confirmation_code}`);
  for (const tb of ['posts', 'follower_history', 'ig_account_daily', 'ig_audience', 'ig_accounts']) assert.ok(t.q.calls.some(c => new RegExp('DELETE FROM ' + tb).test(c.sql)), tb);
  assert.ok(t.q.calls.some(c => /DELETE FROM posts/.test(c.sql) && /ig_media_id IS NOT NULL/.test(c.sql)));
  const ins = t.q.calls.find(c => /INSERT INTO ig_deletion_requests/.test(c.sql));
  assert.equal(ins.p[1], sha256('42')); assert.ok(!JSON.stringify(ins.p).includes('"42"') && !ins.p.includes('42') && !ins.p.includes('u1'));
  assert.deepEqual(t.keys.del, [['u1', 'instagram']]);
});
test('A.1d data-deletion for an unknown Facebook id still answers, and says nothing was stored', async () => {
  const t = compl(() => []); const r = res(); await t.c.dataDeletion({ body: { signed_request: sign({ algorithm: 'HMAC-SHA256', user_id: '99' }) } }, r);
  assert.ok(r.body.confirmation_code); assert.match(t.q.calls.find(c => /INSERT INTO ig_deletion_requests/.test(c.sql)).p[2], /No Instagram data/);
  const bad = res(); await t.c.dataDeletion({ body: {} }, bad); assert.equal(bad.code, 400);
});
test('A.1d status page: bad code 404 without a query, unknown 404, known shows the result with HTML escaped', async () => {
  const t = compl(sql => (/FROM ig_deletion_requests/.test(sql) ? [{ status: 'completed', detail: '<b>x</b>', requested_at: '2026-10-15T00:00:00Z' }] : []));
  const bad = res(); await t.c.deletionStatus({ query: { code: "1' OR 1=1" } }, bad); assert.equal(bad.code, 404); assert.equal(t.q.calls.length, 0);
  const ok = res(); await t.c.deletionStatus({ query: { code: 'a'.repeat(24) } }, ok); assert.equal(ok.code, 200); assert.match(ok.html, /completed/); assert.ok(!ok.html.includes('<b>x</b>')); assert.match(ok.html, /&lt;b&gt;/);
});
test('A.1d privacy page is public, says what is stored, and shows a loud DRAFT banner until operator + contact are set', () => {
  assert.match(privacyHtml({}), /DRAFT/);
  const h = privacyHtml({ PRIVACY_OPERATOR: 'Acme <Ltd>', PRIVACY_CONTACT_EMAIL: 'p@acme.test' });
  assert.ok(!/DRAFT/.test(h)); assert.match(h, /Acme &lt;Ltd&gt;/); assert.match(h, /p@acme\.test/);
  for (const w of ['follower', 'encrypted', 'direct messages', 'deletion']) assert.match(h, new RegExp(w));
});
test('A.1d connect callback stores the Facebook user id (best effort: a failing /me call does not fail the connect)', async () => {
  const mk = meOk => { const f = graphFor([[/oauth\/access_token.*fb_exchange/, () => ({ access_token: 'LONG', expires_in: 5184000 })], [/oauth\/access_token/, () => ({ access_token: 'SHORT' })], [/\/me\/accounts/, () => ({ data: [{ id: 'P1', instagram_business_account: { id: 'IG_1', username: 'u', followers_count: 10 } }] })],
    [/\/me\/permissions/, () => ({ data: ['instagram_basic', 'instagram_manage_insights', 'instagram_manage_comments', 'pages_show_list', 'pages_read_engagement'].map(permission => ({ permission, status: 'granted' })) })], [/\/me\?fields=id/, () => (meOk ? { id: 'FB_42' } : new Error('x'))]]);
    const q = recQ(), st = { take: async () => 'u1' }, kk = { set: async () => {} };
    return { q, run: async () => { let to; await makeIgConnect({ q, graph: makeGraph({ fetch: f }), state: st, keys: kk, env: { META_APP_ID: 'A', META_APP_SECRET: 'S', META_REDIRECT_URI: 'https://app.example/cb' }, now: () => NOW }).callback({ query: { code: 'c', state: 's' } }, { redirect: u => { to = u; } }); return to; } }; };
  const a = mk(true); assert.match(await a.run(), /ig=connected/); assert.equal(a.q.calls.find(c => /INSERT INTO ig_accounts/.test(c.sql)).p.at(-1), 'FB_42');
  const b = mk(false); assert.match(await b.run(), /ig=connected/); assert.equal(b.q.calls.find(c => /INSERT INTO ig_accounts/.test(c.sql)).p.at(-1), null);
  assert.match(b.q.calls.find(c => /INSERT INTO ig_accounts/.test(c.sql)).sql, /fb_user_id=coalesce\(\$8,ig_accounts\.fb_user_id\)/); // a reconnect whose /me call failed must not erase the stored id (SQL itself: smoke-phaseA1c.sh)
});

// ---------- A.1d: persisted Dismiss ----------
test('A.1d dismiss: default 14 days, 1-365 whole days only, key validated, undo deletes', async () => {
  const q = recQ(() => [{ tip_key: 'collab', until: '2026-10-29T00:00:00Z' }]), d = makeDismissals({ q });
  let r = res(); await d.dismiss({ uid: 'u', params: { key: 'collab' }, body: {} }, r); assert.equal(r.body.days, 14); assert.deepEqual(q.calls[0].p, ['u', 'collab', 14]);
  r = res(); await d.dismiss({ uid: 'u', params: { key: 'collab' }, body: { days: 365 } }, r); assert.equal(r.body.days, 365);
  for (const days of [0, 366, 1.5, 'x', -3]) { r = res(); await d.dismiss({ uid: 'u', params: { key: 'collab' }, body: { days } }, r); assert.equal(r.code, 400, String(days)); }
  r = res(); await d.dismiss({ uid: 'u', params: { key: 'a b;--' }, body: {} }, r); assert.equal(r.code, 400);
  const n = q.calls.length; r = res(); await d.undo({ uid: 'u', params: { key: 'collab' } }, r); assert.deepEqual(r.body, { ok: true }); assert.match(q.calls[n].sql, /DELETE FROM priority_dismissals/); assert.deepEqual(q.calls[n].p, ['u', 'collab']);
  r = res(); await d.undo({ uid: 'u', params: { key: '../x' } }, r); assert.equal(r.code, 400);
});
test('A.1d priorities hides dismissed tips and lists them as snoozed (additive fields)', async () => {
  const q = recQ(sql => (/priority_dismissals/.test(sql) ? [{ key: 'collab', until: '2026-10-29T00:00:00Z' }] : []));
  const h = makeInsights({ q, pageMetrics: async () => base }); const r = res(); await h.priorities({ uid: 'u' }, r);
  assert.ok(!r.body.priorities.some(t => t.kind === 'collab')); assert.ok(r.body.priorities.some(t => t.kind === 'mention'));
  assert.deepEqual(r.body.snoozed.map(s => s.key), ['collab']); assert.ok(r.body.updatedAt);
  assert.match(q.calls[0].sql, /until>now\(\)/); assert.deepEqual(q.calls[0].p, ['u']);
});
