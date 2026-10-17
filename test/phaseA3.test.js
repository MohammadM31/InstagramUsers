// Roadmap A.3: competitor history. Pure rules, the I/O factory with a fake q, and the real Graph wrapper against scripts/mock-graph.js over HTTP.
// NOT covered here: any SQL (no Postgres in the unit tests) and anything real Meta does.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { historyRow, parseDiscovery, classifyDiscoveryError, notPublicError, NOT_PUBLIC_CODE, PUBLIC_NOTE, utcDay } from '../src/competitorintel.js';
import { competitorMomentum, momentumAlert, followerGrowth, ALERT_RULES } from '../src/advisor.js';
import { makeCompetitors } from '../src/competitors.js';
import { makeGraph, IgError } from '../src/instagram.js';

const NOW = Date.parse('2026-10-17T12:00:00Z');
const fx = n => JSON.parse(fs.readFileSync(new URL(`./fixtures/graph/${n}.json`, import.meta.url)));
const dayAgo = k => new Date(NOW - k * 864e5).toISOString().slice(0, 10);
const series = (n, start, step) => Array.from({ length: n }, (_, i) => ({ day: dayAgo(n - 1 - i), followers: start + i * step })); // oldest first, last = today
const res = () => { const r = {}; r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; }; r.sendStatus = c => { r.code = c; return r; }; return r; };

// ---------- pure ----------
test('A.3 historyRow: averages come from the sampled posts; a hidden like count is left out, not counted as 0', () => {
  const r = historyRow(parseDiscovery(fx('discovery_ok'), 'rival'));
  assert.deepEqual(r, { followers: 52000, posts_count: 412, avg_likes: 1000, avg_comments: 30 });
  const h = historyRow(parseDiscovery(fx('discovery_hidden_likes'), 'rival'));
  assert.equal(h.avg_likes, 300);       // only the post that shows likes
  assert.equal(h.avg_comments, 15);
});
test('A.3 historyRow stores nothing for demo data, a missing follower count, or an unknown source', () => {
  assert.equal(historyRow({ source: 'demo', followers: 5000, posts: [] }), null);
  assert.equal(historyRow({ source: 'business_discovery', followers: undefined, posts: [] }), null);
  assert.equal(historyRow({ source: 'scraper', followers: 10, posts: [] }), null);
  assert.equal(historyRow(null), null);
  assert.deepEqual(historyRow({ source: 'business_discovery', followers: 10, posts: [] }), { followers: 10, posts_count: null, avg_likes: null, avg_comments: null });
});
test('A.3 parseDiscovery: a response without business_discovery is a clear "not public" error', () => {
  assert.throws(() => parseDiscovery({}, 'jane'), e => e.code === NOT_PUBLIC_CODE && /@jane is not a public business or creator account/.test(e.message));
  const d = parseDiscovery(fx('discovery_ok'), 'rival');
  assert.equal(d.source, 'business_discovery'); assert.equal(d.followers, 52000); assert.equal(d.postsCount, 412); assert.equal(d.posts.length, 3);
  assert.equal(d.posts[0].type, 'VIDEO');
});
test('A.3 classifyDiscoveryError: invalid-user becomes "not public"; token, permission and rate-limit errors are never disguised', () => {
  const mk = (code, msg = 'x') => new IgError(msg, { status: 400, code });
  assert.equal(classifyDiscoveryError(mk(110, 'Invalid user id'), 'jane').code, NOT_PUBLIC_CODE);
  assert.equal(classifyDiscoveryError(mk(100, 'Invalid user id'), 'jane').code, NOT_PUBLIC_CODE);      // message match
  assert.equal(classifyDiscoveryError(mk(110, 'Something Meta reworded'), 'jane').code, NOT_PUBLIC_CODE); // the code alone is enough
  const other = mk(100, 'Unsupported get request'); assert.equal(classifyDiscoveryError(other, 'jane'), other, 'unrelated 100 errors are not disguised');
  for (const code of [190, 10, 200, 4, 17, 613]) { const e = mk(code, 'Invalid user id'); assert.equal(classifyDiscoveryError(e, 'jane'), e, 'code ' + code); }
  const plain = new Error('socket hang up'); assert.equal(classifyDiscoveryError(plain, 'jane'), plain);
  assert.equal(notPublicError('a').code, NOT_PUBLIC_CODE);
});
test('A.3 competitorMomentum: 7 and 30 day changes need a point at or before that distance; nothing is guessed', () => {
  const m = competitorMomentum({ handle: 'rival', history: series(31, 50000, 100) }, { value7d: 100 });
  assert.equal(m.followers, 53000); assert.equal(m.followersChange7d, 700); assert.equal(m.followersChange30d, 3000); assert.equal(m.pct7d, 1.3);
  assert.equal(m.outPacing, true); assert.equal(m.publicMetricsOnly, true); assert.equal(m.lastDay, dayAgo(0));
  const short = competitorMomentum({ handle: 'r', history: series(5, 100, 10) }, { value7d: 1 });
  assert.equal(short.followersChange7d, null); assert.equal(short.followersChange30d, null); assert.equal(short.outPacing, false);
  assert.equal(competitorMomentum({ handle: 'r', history: [] }).followers, null);
  const unsorted = competitorMomentum({ handle: 'r', history: series(31, 50000, 100).reverse() }, null);
  assert.equal(unsorted.followersChange7d, 700);
});
test('A.3 outPacing needs both 7-day changes, a competitor gain, and a bigger gain than yours', () => {
  const h = series(31, 50000, 100);
  assert.equal(competitorMomentum({ handle: 'r', history: h }, null).outPacing, false, 'own change unknown');
  assert.equal(competitorMomentum({ handle: 'r', history: h }, { value7d: null }).outPacing, false);
  assert.equal(competitorMomentum({ handle: 'r', history: h }, { value7d: 700 }).outPacing, false, 'equal is not ahead');
  assert.equal(competitorMomentum({ handle: 'r', history: h }, { value7d: 5000 }).outPacing, false);
  assert.equal(competitorMomentum({ handle: 'r', history: h }, { value7d: -20 }).outPacing, true);
  assert.equal(competitorMomentum({ handle: 'r', history: series(31, 50000, -100) }, { value7d: -900 }).outPacing, false, 'competitor lost followers');
});
test('A.3 momentumAlert text, threshold, freshness and weekly dedupe key', () => {
  const m = competitorMomentum({ handle: 'rival', history: series(31, 50000, 100) }, { value7d: 100 });
  const a = momentumAlert(m, NOW);
  assert.equal(a.kind, 'competitor_growth');
  assert.match(a.body, /Competitor @rival gained 700 followers this week; you gained 100\./);
  assert.match(a.body, /Public metrics only/);
  assert.equal(a.key, `competitor_growth:rival:w${Math.floor(NOW / 6048e5)}`);
  const nextWeek = momentumAlert({ ...m, lastDay: dayAgo(-7) }, NOW + 7 * 864e5); // fresh data one week later
  assert.ok(nextWeek && nextWeek.key !== a.key, 'a later week gets its own dedupe key');
  assert.match(momentumAlert({ ...m, ownChange7d: -30 }, NOW).body, /you lost 30\./);
  // below 1 percent of their audience: silent
  const big = competitorMomentum({ handle: 'giant', history: [{ day: dayAgo(7), followers: 1000000 }, { day: dayAgo(0), followers: 1000700 }] }, { value7d: 100 });
  assert.equal(big.outPacing, true); assert.equal(momentumAlert(big, NOW), null);
  assert.equal(ALERT_RULES.momentumMinPct, 1);
  // stale data: the last point is older than 3 days
  const stale = competitorMomentum({ handle: 'rival', history: series(31, 50000, 100).map(x => ({ ...x, day: new Date(Date.parse(x.day) - 5 * 864e5).toISOString().slice(0, 10) })) }, { value7d: 100 });
  assert.equal(momentumAlert(stale, NOW), null);
  assert.equal(momentumAlert(null, NOW), null);
  assert.equal(momentumAlert({ ...m, outPacing: false }, NOW), null);
});

// ---------- I/O with a fake q ----------
const fakeQ = (rules) => { const calls = []; const q = async (sql, params = []) => { calls.push({ sql, params }); for (const [re, fn] of rules) if (re.test(sql)) return typeof fn === 'function' ? fn(params, sql) : fn; return []; }; q.calls = calls; return q; };

test('A.3 record(): one upsert per competitor per UTC day; demo data never reaches the database', async () => {
  const q = fakeQ([]); const c = makeCompetitors({ q });
  assert.deepEqual(await c.record(5, { source: 'demo', followers: 9000, posts: [] }), { stored: false, reason: 'demo' });
  assert.deepEqual(await c.record(5, { source: 'business_discovery', followers: undefined, posts: [] }), { stored: false, reason: 'no_followers' });
  assert.equal(q.calls.length, 0);
  assert.deepEqual(await c.record(5, { source: 'business_discovery', followers: 100, postsCount: 3, posts: [{ likes: 10, comments: 2 }] }), { stored: true });
  assert.equal(q.calls.length, 1);
  assert.match(q.calls[0].sql, /INSERT INTO competitor_history/);
  assert.match(q.calls[0].sql, /ON CONFLICT \(competitor_id,\(\(captured_at AT TIME ZONE 'UTC'\)::date\)\) DO UPDATE/);
  assert.deepEqual(q.calls[0].params, [5, 100, 3, 10, 2]);
  assert.match(q.calls[0].sql, /coalesce\(EXCLUDED\.avg_likes/); // a later scrape with hidden likes never wipes a stored average
});

const histRows = () => series(31, 50000, 100).map(x => ({ day: x.day, followers: x.followers, posts_count: 400, avg_likes: '1000.0', avg_comments: '30.5' }));
const ownRows = () => series(8, 1000, 10).map(x => ({ ...x, source: 'live' }));
const handlerQ = (opts = {}) => fakeQ([
  [/FROM competitors WHERE id=\$1 AND user_id=\$2/, p => (p[1] === 'u1' ? [{ id: 7, handle: 'rival' }] : [])],
  [/FROM competitor_history/, () => opts.hist ?? histRows()],
  [/FROM follower_history/, () => opts.own ?? ownRows()],
]);
test('A.3 GET history: shape, numbers, momentum and the public-metrics label', async () => {
  const q = handlerQ(); const r = res();
  await makeCompetitors({ q, now: () => NOW }).history({ uid: 'u1', params: { id: '7' }, query: {} }, r);
  assert.equal(r.code, undefined); const b = r.body;
  assert.equal(b.handle, 'rival'); assert.equal(b.days, 30); assert.equal(b.source, 'business_discovery'); assert.equal(b.note, PUBLIC_NOTE);
  assert.equal(b.points.length, 31); assert.ok(b.points.every(p => p.day >= dayAgo(30)));
  assert.equal(typeof b.points[0].avg_likes, 'number'); assert.equal(b.points[0].avg_comments, 30.5);
  assert.equal(b.momentum.followersChange7d, 700); assert.equal(b.momentum.ownChange7d, 70); assert.equal(b.momentum.outPacing, true);
  assert.equal(b.ownFollowersKnown, true); assert.equal(b.reason, null);
  assert.deepEqual(q.calls.find(c => /FROM competitors WHERE/.test(c.sql)).params, [7, 'u1']);          // scoped to the user
});
test('A.3 GET history: days only shortens the chart, momentum still sees 30 days; days is bounded', async () => {
  const q = handlerQ(); const r = res();
  await makeCompetitors({ q, now: () => NOW }).history({ uid: 'u1', params: { id: '7' }, query: { days: '7' } }, r);
  assert.equal(r.body.days, 7); assert.equal(r.body.points.length, 8); assert.equal(r.body.momentum.followersChange30d, 3000);
  assert.equal(q.calls.find(c => /FROM competitor_history/.test(c.sql)).params[1], 35);
  const big = res(); await makeCompetitors({ q: handlerQ(), now: () => NOW }).history({ uid: 'u1', params: { id: '7' }, query: { days: '999' } }, big);
  assert.equal(big.body.days, 365);
  const zero = res(); await makeCompetitors({ q: handlerQ(), now: () => NOW }).history({ uid: 'u1', params: { id: '7' }, query: { days: '0' } }, zero);
  assert.equal(zero.body.days, 1);
  for (const bad of ['abc', '-1', '1.5', '1000', '']) { const x = res(); await makeCompetitors({ q: handlerQ(), now: () => NOW }).history({ uid: 'u1', params: { id: '7' }, query: { days: bad } }, x); assert.equal(x.code, 400, 'days=' + bad); }
});
test('A.3 GET history: bad id 400, another user\'s competitor 404, no rows = reason no_history', async () => {
  const c = makeCompetitors({ q: handlerQ(), now: () => NOW });
  for (const id of ['abc', '1;DROP', '', '-3', '12345678901']) { const r = res(); await c.history({ uid: 'u1', params: { id }, query: {} }, r); assert.equal(r.code, 400, id); }
  const other = res(); await c.history({ uid: 'u2', params: { id: '7' }, query: {} }, other); assert.equal(other.code, 404);
  const empty = res(); await makeCompetitors({ q: handlerQ({ hist: [] }), now: () => NOW }).history({ uid: 'u1', params: { id: '7' }, query: {} }, empty);
  assert.equal(empty.body.reason, 'no_history'); assert.deepEqual(empty.body.points, []); assert.equal(empty.body.momentum.followersChange7d, null);
  const noOwn = res(); await makeCompetitors({ q: handlerQ({ own: [] }), now: () => NOW }).history({ uid: 'u1', params: { id: '7' }, query: {} }, noOwn);
  assert.equal(noOwn.body.ownFollowersKnown, false); assert.equal(noOwn.body.momentum.outPacing, false);
});
test('A.3 scrapeDue: only users with a working Instagram connection are queued; one credentials lookup per user; same-day job ids', async () => {
  const due = [{ id: 1, user_id: 'a', handle: 'x' }, { id: 2, user_id: 'a', handle: 'y' }, { id: 3, user_id: 'b', handle: 'z' }, { id: 4, user_id: 'c', handle: 'w' }];
  const q = fakeQ([[/FROM competitors c/, due]]); const asked = [], jobs = [];
  const getIgCreds = async uid => { asked.push(uid); if (uid === 'b') return null; if (uid === 'c') throw new Error('reconnect needed'); return { token: 't', igUserId: 'IG_1' }; };
  const r = await makeCompetitors({ q, getIgCreds, enqueue: async (d, id) => { jobs.push([d, id]); }, now: () => NOW }).scrapeDue();
  assert.deepEqual(r, { due: 4, queued: 2, skipped: { not_connected: 1, reconnect_needed: 1 }, errors: 0 });
  assert.deepEqual(asked, ['a', 'b', 'c']);
  assert.deepEqual(jobs.map(j => j[1]), ['dc-1-2026-10-17', 'dc-2-2026-10-17']); assert.ok(jobs.every(j => !j[1].includes(':')));
  assert.deepEqual(jobs[0][0], { userId: 'a', competitorId: 1, handle: 'x' });
  assert.match(q.calls[0].sql, /NOT EXISTS \(SELECT 1 FROM competitor_history/);
  const failing = await makeCompetitors({ q, getIgCreds: async () => ({}), enqueue: async () => { throw new Error('redis down'); }, now: () => NOW }).scrapeDue();
  assert.equal(failing.errors, 4); assert.equal(failing.queued, 0);
});
test('A.3 runMomentum: notifies only when your own change is known and smaller; one row per rival per week', async () => {
  const h = (uid, handle) => histRows().map(r => ({ user_id: uid, handle, day: r.day, followers: r.followers }));
  const notified = [];
  const q = fakeQ([[/FROM competitors c\s+JOIN competitor_history/, [...h('u1', 'rival'), ...h('u2', 'other')]],
    [/FROM follower_history/, ownRows().map(r => ({ ...r, user_id: 'u1' }))],
    [/INSERT INTO notifications/, p => { notified.push(p); return [{ id: notified.length }]; }]]);
  const r = await makeCompetitors({ q, now: () => NOW }).runMomentum();
  assert.deepEqual(r, { competitors: 2, created: 1 });
  assert.equal(notified.length, 1); assert.equal(notified[0][0], 'u1'); assert.equal(notified[0][1], 'competitor_growth');
  assert.match(notified[0][3], /Competitor @rival gained 700 followers this week; you gained 70/);
  assert.match(q.calls.find(c => /INSERT INTO notifications/.test(c.sql)).sql, /ON CONFLICT \(user_id,dedupe_key\) DO NOTHING/);
  // a duplicate insert (dedupe) is not counted as created
  const q2 = fakeQ([[/FROM competitors c\s+JOIN competitor_history/, h('u1', 'rival')], [/FROM follower_history/, ownRows().map(r => ({ ...r, user_id: 'u1' }))], [/INSERT INTO notifications/, []]]);
  assert.equal((await makeCompetitors({ q: q2, now: () => NOW }).runMomentum()).created, 0);
});

// ---------- the real Graph wrapper against the mock server over HTTP ----------
test('A.3 over HTTP: mock Business Discovery -> parseDiscovery -> historyRow; invalid user -> "not public"; the request asks for no retired metrics', async () => {
  const port = 3197, child = spawn(process.execPath, ['scripts/mock-graph.js', String(port)], { stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    await new Promise((ok, no) => { const t = setTimeout(() => no(new Error('mock did not start')), 5000); child.stdout.on('data', d => { if (/mock graph on/.test(String(d))) { clearTimeout(t); ok(); } }); child.on('error', no); });
    const graph = makeGraph({ base: `http://127.0.0.1:${port}` });
    const fields = h => `business_discovery.username(${h}){followers_count,media_count,media.limit(25){like_count,comments_count,media_type,timestamp,caption}}`;
    const ok = parseDiscovery(await graph.get('IG_1', { fields: fields('rival') }, 'TOKEN'), 'rival');
    assert.deepEqual(historyRow(ok), { followers: 52000, posts_count: 412, avg_likes: 1000, avg_comments: 30 });
    const hidden = historyRow(parseDiscovery(await graph.get('IG_1', { fields: fields('hidden_likes') }, 'TOKEN'), 'hidden_likes'));
    assert.equal(hidden.avg_likes, 300);
    await assert.rejects(graph.get('IG_1', { fields: fields('private_acct') }, 'TOKEN').catch(e => { throw classifyDiscoveryError(e, 'private_acct'); }), e => e.code === NOT_PUBLIC_CODE);
    assert.ok(!/impressions|plays|video_views/.test(fields('x')));
  } finally { child.kill(); }
});

// ---------- wiring (source checks: worker.js cannot be imported without Postgres and Redis) ----------
test('A.3 wiring: schema, GDPR export, cascade, route, worker', () => {
  const schema = fs.readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
  assert.match(schema, /CREATE TABLE IF NOT EXISTS competitor_history\(id serial PRIMARY KEY,competitor_id int NOT NULL REFERENCES competitors ON DELETE CASCADE/);
  assert.match(schema, /CREATE UNIQUE INDEX IF NOT EXISTS competitor_history_day ON competitor_history\(competitor_id,\(\(captured_at AT TIME ZONE 'UTC'\)::date\)\)/);
  for (const col of ['followers', 'posts_count', 'avg_likes', 'avg_comments', 'captured_at']) assert.match(schema.split('competitor_history(')[1].split(';')[0], new RegExp(col));
  const routes = fs.readFileSync(new URL('../src/routes.js', import.meta.url), 'utf8');
  assert.match(routes, /get\('\/competitors\/:id\/history'/);
  assert.match(routes, /o\.competitor_history=await q\('SELECT h\.\* FROM competitor_history h JOIN competitors c ON c\.id=h\.competitor_id WHERE c\.user_id=\$1/);
  const worker = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
  assert.match(worker, /await competitors\.record\(competitorId,d\)/);
  assert.match(worker, /competitors\.scrapeDue\(\)/); assert.match(worker, /competitors\.runMomentum\(\)/);
  assert.match(worker, /UnrecoverableError/);
  const fields = worker.match(/business_discovery\.username\([^`]*`/)[0];
  assert.match(fields, /followers_count,media_count,media\.limit\(25\)/); assert.ok(!/impressions|plays|video_views|reach/.test(fields));
  assert.ok(!/demo/i.test(fs.readFileSync(new URL('../src/competitors.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '').replace(/'demo'/g, '')), 'competitors.js has no demo fallback of its own');
  assert.equal(utcDay(NOW), '2026-10-17');
});
