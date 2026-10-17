// Roadmap A.2 tests: pure comment rules, the Graph pull with a fake graph built from recorded-by-hand fixtures, retention, the questions alert and the endpoint.
// The fake q records every statement and models only what the tests assert. The real SQL has NOT been run by this file (no Postgres in the session that wrote it).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { IgError } from '../src/instagram.js';
import {
  mapComment, looksLikeQuestion, questionsFromComments, sentimentHeuristic, topCommenters, themesFromComments, commentInsights, questionAlert, withinRetention, RETENTION_DAYS,
} from '../src/commentintel.js';
import { makeComments, postsDue, UPSERT_SQL, RETENTION_SQL, POSTS_SQL, ALERT_ROWS_SQL, COMMENT_FIELDS } from '../src/comments.js';

const fx = n => JSON.parse(fs.readFileSync(new URL(`./fixtures/graph/${n}.json`, import.meta.url)));
const OWNER = 'studio.example', NOW = Date.parse('2026-10-14T20:00:00Z'); // the fixture post M3 is 10.5 h old at NOW
const flat = [...fx('comments_M3_p1').data, ...fx('comments_M3_p2').data];

// ---------- pure rules ----------
test('A.2 mapComment: owner comments, blank text and missing ids are dropped; owner reply matched case-insensitively', () => {
  const rows = flat.map(c => mapComment(c, OWNER)).filter(Boolean);
  assert.deepEqual(rows.map(r => r.ig_comment_id), ['C1', 'C2', 'C3', 'C5', 'C6', 'C7', 'C8']); // C4 is the owner, C9 is blank
  assert.equal(rows.find(r => r.ig_comment_id === 'C3').owner_replied, true); // reply by "Studio.Example"
  assert.equal(rows.find(r => r.ig_comment_id === 'C2').owner_replied, false);
  assert.equal(mapComment({ id: 'x', text: 'hi', username: 'a' }, OWNER), null); // no timestamp
  assert.equal(mapComment(null, OWNER), null);
});
test('A.2 mapComment: a missing like count is NULL, never 0; without an owner name nothing is skipped as the owner', () => {
  assert.equal(mapComment(flat.find(c => c.id === 'C5'), OWNER).likes, null);
  assert.equal(mapComment(flat.find(c => c.id === 'C2'), OWNER).likes, 0);
  assert.ok(mapComment(flat.find(c => c.id === 'C4'), null));
});
test('A.2 mapComment truncates huge text and usernames', () => {
  const r = mapComment({ id: '1', text: 'x'.repeat(5000), username: 'u'.repeat(200), timestamp: '2026-10-14T10:00:00Z' }, OWNER);
  assert.equal(r.text.length, 2200); assert.equal(r.username.length, 60);
});
test('A.2 questions: a question mark (Latin or Arabic) or an opening question word; "Do it!" is not one', () => {
  for (const t of ['How much is the large one?', 'price?', 'كم السعر', 'متوفر بالحجم الكبير؟', 'where to buy this', 'Is it vegan?']) assert.ok(looksLikeQuestion(t), t);
  for (const t of ['Do it!', 'Love this 😍', 'price', 'what', '', null]) assert.ok(!looksLikeQuestion(t), String(t));
});
test('A.2 questionsFromComments keeps only the unanswered ones', () => {
  const rows = flat.map(c => mapComment(c, OWNER)).filter(Boolean);
  assert.deepEqual(questionsFromComments(rows).map(r => r.ig_comment_id), ['C2', 'C6', 'C7']); // C3 is a question but already answered
});
test('A.2 sentiment: words, negation, emoji, Arabic, neutral', () => {
  assert.equal(sentimentHeuristic('Love this!'), 'positive');
  assert.equal(sentimentHeuristic('Overpriced and bad quality'), 'negative');
  assert.equal(sentimentHeuristic('not good at all'), 'negative');
  assert.equal(sentimentHeuristic('not bad'), 'positive');
  assert.equal(sentimentHeuristic('🔥🔥'), 'positive');
  assert.equal(sentimentHeuristic('😡'), 'negative');
  assert.equal(sentimentHeuristic('شو هالحلو رائع'), 'positive');
  assert.equal(sentimentHeuristic('see you at 5'), 'neutral');
  assert.equal(sentimentHeuristic(''), 'neutral');
});
test('A.2 topCommenters: by count, then likes, then name; accounts without a name are ignored', () => {
  const t = topCommenters([{ username: 'b', likes: 1 }, { username: 'a', likes: 1 }, { username: 'c', likes: 9 }, { username: 'b', likes: 0 }, { username: null, likes: 5 }, { username: 'a', likes: 0 }], 2);
  assert.deepEqual(t, [{ username: 'a', comments: 2, likes: 1 }, { username: 'b', comments: 2, likes: 1 }]);
  assert.deepEqual(topCommenters([]), []);
});
test('A.2 themes: a word must appear in at least 2 different comments; stop words and numbers are ignored; one comment repeating a word counts once', () => {
  const t = themesFromComments([{ text: 'shipping to Lebanon please' }, { text: 'shipping cost?' }, { text: 'shipping shipping shipping' }, { text: 'lebanon 2026 2026' }, { text: 'the and for' }]);
  assert.deepEqual(t, [{ word: 'shipping', comments: 3 }, { word: 'lebanon', comments: 2 }]);
  assert.deepEqual(themesFromComments([{ text: 'one' }, { text: 'two' }]), []);
});
test('A.2 commentInsights: counts, labelled as an estimate, plain summary; empty input says so', () => {
  const rows = flat.map(c => mapComment(c, OWNER)).filter(Boolean);
  const i = commentInsights(rows);
  assert.equal(i.total, 7); assert.equal(i.accounts, 5);
  assert.equal(i.sentiment.positive + i.sentiment.negative + i.sentiment.neutral, 7);
  assert.equal(i.sentimentIsEstimate, true); assert.match(i.sentimentNote, /not a reading of tone/);
  assert.equal(i.themesAreKeywordCounts, true);
  assert.deepEqual(i.questions, { total: 4, unanswered: 3 });
  assert.match(i.summary, /Keyword estimate/); assert.match(i.summary, /3 are not answered by you yet/);
  const e = commentInsights([]);
  assert.equal(e.total, 0); assert.match(e.summary, /No comments stored/); assert.equal(e.sentimentIsEstimate, true);
});
test('A.2 alert: 3+ unanswered questions on a post under 24 h; not at 2, not at 25 h, not for answered ones', () => {
  const post = { id: 7, caption: 'New reel', posted_at: '2026-10-14T09:30:00Z' };
  const q = n => Array.from({ length: n }, (_, i) => ({ text: `how much #${i}?`, owner_replied: false }));
  const a = questionAlert(post, q(3), NOW);
  assert.equal(a.kind, 'questions'); assert.equal(a.key, 'questions:7'); assert.match(a.title, /^3 unanswered questions/); assert.match(a.body, /"New reel"/);
  assert.equal(questionAlert(post, q(2), NOW), null);
  assert.equal(questionAlert(post, q(3).map(c => ({ ...c, owner_replied: true })), NOW), null);
  assert.equal(questionAlert(post, q(3), Date.parse('2026-10-15T09:31:00Z')), null); // 24 h 1 min old
  assert.ok(questionAlert(post, q(3), Date.parse('2026-10-15T09:29:00Z')));
  assert.equal(questionAlert({ ...post, posted_at: '2026-10-15T00:00:00Z' }, q(3), NOW), null); // post "in the future"
  assert.equal(questionAlert({ ...post, posted_at: 'garbage' }, q(3), NOW), null);
});
test('A.2 retention window is 90 days', () => {
  assert.equal(RETENTION_DAYS, 90);
  assert.ok(withinRetention('2026-07-20T00:00:00Z', NOW)); assert.ok(!withinRetention('2026-06-01T00:00:00Z', NOW));
  assert.match(RETENTION_SQL, /interval '90 days'/);
});
test('A.2 postsDue: recent posts always; older ones only when never fetched or stale (20 h)', () => {
  const d = (days, fetchedHAgo) => ({ posted_at: new Date(NOW - days * 864e5).toISOString(), last_fetch: fetchedHAgo === null ? null : new Date(NOW - fetchedHAgo * 36e5).toISOString() });
  assert.equal(postsDue([d(2, 1)], NOW).length, 1); // recent, fetched an hour ago: still asked
  assert.equal(postsDue([d(20, 1)], NOW).length, 0);
  assert.equal(postsDue([d(20, 21)], NOW).length, 1);
  assert.equal(postsDue([d(20, null)], NOW).length, 1);
});

// ---------- the pull ----------
// Fake graph: serves the fixtures by path and `after`. A path can be told to throw.
function fakeGraph({ throwFor = {}, usage = 0 } = {}) {
  const calls = [];
  return {
    calls,
    get: async (path, params, token) => {
      calls.push({ path, params, token });
      const id = path.split('/')[0];
      if (throwFor[id]) throw throwFor[id];
      const body = id === 'M3' ? fx(params.after === 'CC1' ? 'comments_M3_p2' : 'comments_M3_p1') : fx('comments_empty');
      return Object.defineProperty({ ...body }, '_usage', { value: usage, enumerable: false });
    },
  };
}
// Fake q: stores comment rows by (user, ig_comment_id) the way the UPSERT is documented to behave, and records everything.
function fakeQ({ posts = [{ id: 1, ig_media_id: 'M3', posted_at: '2026-10-14T09:30:00Z', last_fetch: null }], owner = OWNER, accounts = [], alertRows = [] } = {}) {
  const log = [], store = new Map();
  const q = async (sql, p = []) => {
    log.push({ sql, p });
    if (sql === POSTS_SQL) return posts;
    if (/SELECT username FROM ig_accounts/.test(sql)) return owner === null ? [] : [{ username: owner }];
    if (sql === UPSERT_SQL) {
      const key = p[0] + '|' + p[2], old = store.get(key);
      store.set(key, { user: p[0], post: p[1], id: p[2], username: p[3], text: p[4], likes: p[5] ?? old?.likes ?? null, posted_at: p[6], replied: !!(old?.replied || p[7]) });
      return [];
    }
    if (/SELECT user_id FROM ig_accounts/.test(sql)) return accounts;
    if (sql.startsWith(RETENTION_SQL)) return [];
    if (sql === ALERT_ROWS_SQL) return alertRows;
    if (/INSERT INTO notifications/.test(sql)) return [{ id: 1 }];
    if (/UPDATE ig_accounts SET status='reconnect_needed'/.test(sql)) return [{ conn: 5 }];
    return [];
  };
  return { q, log, store };
}
const creds = { token: 'TOK', igUserId: 'IG_1', source: 'oauth' };

test('A.2 pull: pages through comments, stores the right rows, requests exactly the documented fields', async () => {
  const g = fakeGraph(), f = fakeQ();
  const c = makeComments({ q: f.q, graph: g, getIgCreds: async () => creds, now: () => NOW });
  const r = await c.pullUser('u1');
  assert.equal(g.calls.length, 2);
  assert.equal(g.calls[0].path, 'M3/comments'); assert.equal(g.calls[0].params.fields, COMMENT_FIELDS); assert.equal(g.calls[0].params.after, undefined);
  assert.equal(g.calls[1].params.after, 'CC1'); assert.equal(g.calls[0].token, 'TOK');
  assert.deepEqual([...f.store.values()].map(x => x.id), ['C1', 'C2', 'C3', 'C5', 'C6', 'C7']); // not C4 (owner), C8 (older than 90 days), C9 (blank)
  assert.equal(r.comments, 6); assert.equal(r.stoppedEarly, null);
  assert.equal(f.store.get('u1|C3').replied, true); assert.equal(f.store.get('u1|C2').replied, false);
  assert.ok([...f.store.values()].every(x => x.post === 1 && x.user === 'u1'));
  assert.doesNotMatch(COMMENT_FIELDS, /impressions|plays|video_views/);
});
test('A.2 pull is idempotent: a second run changes no row count; a like count updates; owner_replied never flips back', async () => {
  const g = fakeGraph(), f = fakeQ();
  const c = makeComments({ q: f.q, graph: g, getIgCreds: async () => creds, now: () => NOW });
  await c.pullUser('u1'); const n = f.store.size;
  await c.pullUser('u1'); assert.equal(f.store.size, n);
  // the statement's conflict target and the never-unset rule are in the SQL text itself
  assert.match(UPSERT_SQL, /ON CONFLICT\(user_id,ig_comment_id\) DO UPDATE/); assert.match(UPSERT_SQL, /owner_replied=post_comments\.owner_replied OR EXCLUDED\.owner_replied/);
});
test('A.2 pull: with no owner username on record nothing is skipped as the owner', async () => {
  const f = fakeQ({ owner: null });
  await makeComments({ q: f.q, graph: fakeGraph(), getIgCreds: async () => creds, now: () => NOW }).pullUser('u1');
  assert.ok(f.store.has('u1|C4'));
});
test('A.2 pull: not connected throws IgNotConnected and asks Instagram nothing', async () => {
  const g = fakeGraph();
  await assert.rejects(makeComments({ q: fakeQ().q, graph: g, getIgCreds: async () => null }).pullUser('u1'), e => e.name === 'Error' && /not connected/i.test(e.message));
  assert.equal(g.calls.length, 0);
});
test('A.2 pull: a dead token flips the account to reconnect_needed (once, with a notification) and rethrows', async () => {
  const g = fakeGraph({ throwFor: { M3: new IgError('Invalid OAuth access token', { code: 190 }) } }), f = fakeQ();
  await assert.rejects(makeComments({ q: f.q, graph: g, getIgCreds: async () => creds, now: () => NOW }).pullUser('u1'), e => e.tokenInvalid);
  assert.ok(f.log.some(l => /reconnect_needed/.test(l.sql))); assert.ok(f.log.some(l => /ig_reconnect/.test(l.sql)));
});
test('A.2 pull: env-credential (dev) accounts are never flipped to reconnect_needed', async () => {
  const g = fakeGraph({ throwFor: { M3: new IgError('bad', { code: 190 }) } }), f = fakeQ();
  await assert.rejects(makeComments({ q: f.q, graph: g, getIgCreds: async () => ({ ...creds, source: 'env' }) }).pullUser('u1'));
  assert.ok(!f.log.some(l => /reconnect_needed/.test(l.sql)));
});
test('A.2 pull: a missing permission stops the run with a plain message and does not throw', async () => {
  const g = fakeGraph({ throwFor: { M3: new IgError('(#10) permission', { code: 10 }) } });
  const r = await makeComments({ q: fakeQ().q, graph: g, getIgCreds: async () => creds, now: () => NOW }).pullUser('u1');
  assert.match(r.stoppedEarly, /comments permission/); assert.equal(r.comments, 0);
});
test('A.2 pull: rate limiting stops the run quietly', async () => {
  const g = fakeGraph({ throwFor: { M3: new IgError('limit', { code: 4 }) } });
  const r = await makeComments({ q: fakeQ().q, graph: g, getIgCreds: async () => creds, now: () => NOW }).pullUser('u1');
  assert.match(r.stoppedEarly, /slow down/);
});
test('A.2 pull: one post that refuses (comments off) is skipped and the next post is still read', async () => {
  const posts = [{ id: 2, ig_media_id: 'OFF', posted_at: '2026-10-14T10:00:00Z', last_fetch: null }, { id: 1, ig_media_id: 'M3', posted_at: '2026-10-14T09:30:00Z', last_fetch: null }];
  const g = fakeGraph({ throwFor: { OFF: new IgError('comments disabled', { code: 100 }) } });
  const r = await makeComments({ q: fakeQ({ posts }).q, graph: g, getIgCreds: async () => creds, now: () => NOW }).pullUser('u1');
  assert.equal(r.skippedPosts, 1); assert.equal(r.comments, 6);
});
test('A.2 pull: a plain network error is not swallowed', async () => {
  const g = fakeGraph({ throwFor: { M3: new TypeError('boom') } });
  await assert.rejects(makeComments({ q: fakeQ().q, graph: g, getIgCreds: async () => creds }).pullUser('u1'), /boom/);
});
test('A.2 pull: high Instagram usage stops after the current page', async () => {
  const g = fakeGraph({ usage: 85 });
  const r = await makeComments({ q: fakeQ().q, graph: g, getIgCreds: async () => creds, now: () => NOW }).pullUser('u1');
  assert.equal(g.calls.length, 1); assert.match(r.stoppedEarly, /usage at 85%/);
});
test('A.2 pull: at most 4 pages per post', async () => {
  let n = 0;
  const g = { get: async () => { n++; return Object.defineProperty({ data: [], paging: { next: 'x', cursors: { after: 'A' + n } } }, '_usage', { value: 0, enumerable: false }); } };
  await makeComments({ q: fakeQ().q, graph: g, getIgCreds: async () => creds }).pullUser('u1');
  assert.equal(n, 4);
});
test('A.2 posts query only takes the user\'s own Instagram-linked posts, newest 30', () => {
  assert.match(POSTS_SQL, /WHERE p\.user_id=\$1 AND p\.ig_media_id IS NOT NULL/); assert.match(POSTS_SQL, /LIMIT 30/);
});

// ---------- scheduler, retention, alerts ----------
test('A.2 runAll: one failing account does not stop the next; retention and alerts still run', async () => {
  const f = fakeQ({ accounts: [{ user_id: 'bad' }, { user_id: 'good' }] });
  const c = makeComments({ q: f.q, graph: fakeGraph(), getIgCreds: async uid => (uid === 'bad' ? null : creds), now: () => NOW });
  const orig = console.error; console.error = () => {};
  let r; try { r = await c.runAll(); } finally { console.error = orig; }
  assert.equal(r.users, 2); assert.equal(r.ok, 1); assert.equal(r.failed, 1); assert.equal(r.comments, 6);
  assert.ok(f.log.some(l => l.sql.startsWith(RETENTION_SQL)));
  assert.ok(f.log.some(l => l.sql === ALERT_ROWS_SQL));
});
test('A.2 runAlerts: one notification for the post with 3 unanswered questions; none for 2; the dedupe key is per post', async () => {
  const mk = (id, text, replied = false, at = '2026-10-14T09:30:00Z') => ({ id, user_id: 'u1', caption: 'Cap ' + id, posted_at: at, text, username: 'x', owner_replied: replied });
  const alertRows = [mk(1, 'a?'), mk(1, 'b?'), mk(1, 'c?'), mk(1, 'nice'), mk(2, 'a?'), mk(2, 'b?'), mk(2, 'c?', true), mk(3, 'a?', false, '2026-10-12T09:30:00Z'), mk(3, 'b?', false, '2026-10-12T09:30:00Z'), mk(3, 'c?', false, '2026-10-12T09:30:00Z')];
  const f = fakeQ({ alertRows });
  const created = await makeComments({ q: f.q, graph: fakeGraph(), getIgCreds: async () => creds, now: () => NOW }).runAlerts();
  assert.equal(created, 1);
  const ins = f.log.filter(l => /INSERT INTO notifications/.test(l.sql));
  assert.equal(ins.length, 1); assert.deepEqual([ins[0].p[0], ins[0].p[1], ins[0].p[5]], ['u1', 'questions', 'questions:1']);
  assert.match(ins[0].sql, /ON CONFLICT \(user_id,dedupe_key\) DO NOTHING/);
  assert.match(ALERT_ROWS_SQL, /interval '24 hours'/); assert.match(ALERT_ROWS_SQL, /NOT c\.owner_replied/);
});

// ---------- endpoint ----------
function resMock() { const r = { code: 200, body: undefined }; r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; }; r.sendStatus = c => { r.code = c; return r; }; return r; }
function listQ({ post, rows = [], acct }) {
  const log = [];
  return { log, q: async (sql, p) => { log.push({ sql, p }); if (/FROM posts WHERE id/.test(sql)) return post && p[1] === 'u1' ? [post] : []; if (/FROM post_comments/.test(sql)) return rows; if (/FROM ig_accounts/.test(sql)) return acct ? [acct] : []; return []; } };
}
const call = async (q, id, uid = 'u1') => { const res = resMock(); await makeComments({ q, graph: null, getIgCreds: null }).list({ uid, params: { id } }, res); return res; };

test('A.2 endpoint: bad id 400, other user\'s post 404, nothing is read for the 404', async () => {
  assert.equal((await call(listQ({}).q, 'abc')).code, 400);
  const l = listQ({ post: { id: 5, ig_media_id: 'M3' } });
  assert.equal((await call(l.q, '5', 'u2')).code, 404);
  assert.ok(!l.log.some(x => /FROM post_comments/.test(x.sql)));
});
test('A.2 endpoint: shape, flags and scoping to the user and post', async () => {
  const rows = flat.map(c => mapComment(c, OWNER)).filter(Boolean).map(r => ({ ...r, fetched_at: '2026-10-14T20:00:00Z' }));
  const l = listQ({ post: { id: 5, ig_media_id: 'M3' }, rows, acct: { status: 'connected' } });
  const r = await call(l.q, '5');
  assert.equal(r.code, 200); assert.equal(r.body.postId, 5); assert.equal(r.body.connected, true); assert.equal(r.body.reason, null);
  assert.equal(r.body.retentionDays, 90); assert.equal(r.body.lastFetchedAt, '2026-10-14T20:00:00Z');
  assert.equal(r.body.insights.sentimentIsEstimate, true); assert.equal(r.body.insights.questions.unanswered, 3);
  assert.equal(r.body.comments.length, 7); assert.equal(r.body.comments.find(c => c.text === 'price?').question, true);
  assert.ok(r.body.comments.every(c => !('ig_comment_id' in c) && !('fetched_at' in c)));
  const sel = l.log.find(x => /FROM post_comments/.test(x.sql));
  assert.match(sel.sql, /WHERE post_id=\$1 AND user_id=\$2/); assert.deepEqual(sel.p, [5, 'u1']);
});
test('A.2 endpoint: at most 50 comments listed, insights still count all of them', async () => {
  const rows = Array.from({ length: 80 }, (_, i) => ({ username: 'u' + i, text: 'hi ' + i, likes: 0, posted_at: '2026-10-14T10:00:00Z', owner_replied: false, fetched_at: '2026-10-14T20:00:00Z' }));
  const r = await call(listQ({ post: { id: 5, ig_media_id: 'M3' }, rows, acct: { status: 'connected' } }).q, '5');
  assert.equal(r.body.comments.length, 50); assert.equal(r.body.insights.total, 80);
});
test('A.2 endpoint: empty states say why (not from Instagram / not connected / reconnect / none stored)', async () => {
  const why = async (post, acct) => (await call(listQ({ post, acct }).q, '5')).body.reason;
  assert.equal(await why({ id: 5, ig_media_id: null }, { status: 'connected' }), 'not_from_instagram');
  assert.equal(await why({ id: 5, ig_media_id: 'M3' }, null), 'not_connected');
  assert.equal(await why({ id: 5, ig_media_id: 'M3' }, { status: 'reconnect_needed' }), 'reconnect_needed');
  assert.equal(await why({ id: 5, ig_media_id: 'M3' }, { status: 'connected' }), 'none_stored');
});

// ---------- wiring and schema (source checks) ----------
const src = f => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
test('A.2 schema: table, per-user unique key, cascades on user and post, age index', () => {
  const s = src('db/schema.sql');
  assert.match(s, /CREATE TABLE IF NOT EXISTS post_comments/);
  assert.match(s, /UNIQUE\(user_id,ig_comment_id\)/);
  assert.match(s, /user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,post_id int NOT NULL REFERENCES posts ON DELETE CASCADE/);
  assert.match(s, /CREATE INDEX IF NOT EXISTS post_comments_age/);
});
test('A.2 wiring: route registered, GDPR export covers comments, worker starts the job, comments use the user\'s own credentials', () => {
  const r = src('src/routes.js'), w = src('src/worker.js'), c = src('src/comments.js');
  assert.match(r, /get\('\/posts\/:id\/comments',comments\.list\)/);
  assert.match(r, /'voice_samples','post_comments'\]/);
  assert.match(w, /startComments\(comments\)/);
  assert.match(c, /getIgCreds\(uid\)/); assert.doesNotMatch(c, /process\.env/);
});
test('A.2 nothing here writes to Instagram', () => assert.doesNotMatch(src('src/comments.js'), /graph\.post\(/));
