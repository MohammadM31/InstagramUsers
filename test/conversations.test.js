// Stream 2 (history-api): src/conversations.js. No Postgres, no Redis: `q` is an in-memory fake that understands exactly the SQL this module sends.
// Run: node --test test/conversations.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { makeConversations, withConversation, registerConversationRoutes, titleFrom, cleanTitle, cleanData } from '../src/conversations.js';

const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
const T0 = Date.parse('2026-10-23T10:00:00Z'), NOW = () => T0 + 120_000; // fixed "now": the fake clock below stays within 2 minutes of T0

/* ---------- fake database ---------- */
function fakeDb() {
  const db = { conversations: [], messages: [], images: [], msgSeq: 0, tick: 0, calls: [], imagesTable: true, failAppend: false };
  const ts = () => new Date(T0 + (++db.tick) * 1000).toISOString();
  const byUpdatedDesc = (a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at) || (a.id < b.id ? 1 : -1);
  db.q = async (sql, p = []) => {
    db.calls.push([sql, p]);
    if (sql.startsWith('SELECT id,title FROM conversations WHERE id=$1')) {
      const c = db.conversations.find(x => x.id === p[0] && x.user_id === p[1]);
      return c ? [{ id: c.id, title: c.title }] : [];
    }
    if (sql.includes('FROM (SELECT id,role,type,text,data,created_at FROM conversation_messages')) {
      const [id, uid, n] = p;
      return structuredClone(db.messages.filter(m => m.conversation_id === id && m.user_id === uid).slice(-n));
    }
    if (sql.includes('FROM conversations c WHERE c.user_id=$1')) {
      const [uid, before, n] = p;
      return db.conversations.filter(c => c.user_id === uid && (before === null || Date.parse(c.updated_at) < Date.parse(before))).sort(byUpdatedDesc).slice(0, n).map(c => {
        const ms = db.messages.filter(m => m.conversation_id === c.id && m.user_id === uid);
        return { id: c.id, title: c.title, created_at: c.created_at, updated_at: c.updated_at, cur: c.updated_at.replace('Z', '000Z'), last_message: ms.length ? ms.at(-1).text.slice(0, 160) : null, message_count: ms.length };
      });
    }
    if (sql.includes('row_number()')) {
      const [uid, ids] = p, rows = [];
      for (const id of ids) {
        const ms = db.messages.filter(m => m.conversation_id === id && m.user_id === uid && m.role === 'assistant' && (m.data.jobId != null || m.data.imageIds?.[0] != null)).reverse().slice(0, 5);
        for (const m of ms) rows.push({ conversation_id: id, id: m.id, job_id: m.data.jobId != null ? String(m.data.jobId) : null, image_id: m.data.imageIds?.[0] ?? null });
      }
      return rows;
    }
    if (sql.includes('FROM generated_images')) {
      if (!db.imagesTable) throw Object.assign(new Error('relation "generated_images" does not exist'), { code: '42P01' });
      const [uid, jobs] = p;
      return db.images.filter(i => i.user_id === uid && jobs.includes(i.job_id)).sort((a, b) => (a.job_id < b.job_id ? -1 : a.job_id > b.job_id ? 1 : a.idx - b.idx)).map(i => ({ job_id: i.job_id, id: i.id }));
    }
    if (sql.startsWith('INSERT INTO conversations(user_id,title)')) {
      const c = { id: randomUUID(), user_id: p[0], title: p[1], created_at: ts() }; c.updated_at = c.created_at; db.conversations.push(c);
      return [{ id: c.id, title: c.title }];
    }
    if (sql.startsWith('UPDATE conversations SET title=$3')) {
      const c = db.conversations.find(x => x.id === p[0] && x.user_id === p[1]);
      if (!c) return [];
      c.title = p[2]; return [{ id: c.id, title: c.title }];
    }
    if (sql.startsWith('DELETE FROM conversations')) {
      const c = db.conversations.find(x => x.id === p[0] && x.user_id === p[1]);
      if (!c) return [];
      db.conversations.splice(db.conversations.indexOf(c), 1); db.messages = db.messages.filter(m => m.conversation_id !== c.id); // ON DELETE CASCADE
      return [{ id: c.id }];
    }
    if (sql.startsWith('WITH c AS')) {
      if (db.failAppend) throw new Error('db down');
      const [id, uid, title] = p; let c = db.conversations.find(x => x.id === id);
      if (sql.includes('INSERT INTO conversations(id,user_id,title)')) {
        if (!c) { c = { id, user_id: uid, title, created_at: ts() }; c.updated_at = c.created_at; db.conversations.push(c); }
        else if (c.user_id === uid) c.updated_at = ts(); else c = null; // ON CONFLICT ... WHERE user_id matches
      } else {
        c = c && c.user_id === uid ? c : null;
        if (c) { if (c.title === 'New chat' && !db.messages.some(m => m.conversation_id === id)) c.title = title; c.updated_at = ts(); }
      }
      if (!c) return [];
      const out = [];
      for (let i = 3; i < p.length; i += 4) {
        const m = { id: String(++db.msgSeq), conversation_id: id, user_id: uid, role: p[i], type: p[i + 1], text: p[i + 2], data: JSON.parse(p[i + 3]), created_at: ts() };
        db.messages.push(m); out.push({ id: m.id, role: m.role });
      }
      return out;
    }
    throw new Error('fake q: unexpected SQL ' + sql.slice(0, 80));
  };
  return db;
}
const mk = (db, extra = {}) => makeConversations({ q: db.q, now: NOW, ...extra });
const seedConv = (db, uid, title = 'Seeded') => { const c = { id: randomUUID(), user_id: uid, title, created_at: new Date(T0).toISOString(), updated_at: new Date(T0).toISOString() }; db.conversations.push(c); return c; };
const seedMsg = (db, c, role, text, data = {}, at = new Date(T0).toISOString(), type = 'info') => { const m = { id: String(++db.msgSeq), conversation_id: c.id, user_id: c.user_id, role, type, text, data, created_at: at }; db.messages.push(m); return m; };
const mkRes = () => { let done; const r = { statusCode: 200, done: new Promise(f => { done = f; }) }; r.status = c => { r.statusCode = c; return r; }; r.json = b => { r.body = b; done(b); return r; }; r.sendStatus = c => { r.statusCode = c; r.body = undefined; done(); return r; }; return r; };
const mkLog = () => { const l = { errors: [], error: (...a) => l.errors.push(a.join(' ')), warn: () => {} }; return l; };
function routes(db) {
  const t = {}, reg = m => (p, ...f) => { t[`${m} ${p}`] = f.at(-1); };
  const store = registerConversationRoutes({ get: reg('GET'), post: reg('POST'), patch: reg('PATCH'), del: reg('DELETE'), q: db.q, limit: () => {} });
  const call = async (key, req) => { const res = mkRes(); await t[key]({ uid: A, params: {}, query: {}, body: {}, ...req }, res); return res; };
  return { t, store, call };
}
// Runs a wrapped handler once and waits for the real response.
async function ask(wrapped, req) { const res = mkRes(); await wrapped({ uid: A, body: {}, ...req }, res); await res.done; return res; }
const handlerSending = (code, body, seen = []) => (req, res) => { seen.push(req.convo); res.status(code).json(body); };

/* ---------- schema file ---------- */
test('schema.conversations.sql is idempotent and matches the contract tables', () => {
  const sql = readFileSync(new URL('../db/schema.conversations.sql', import.meta.url), 'utf8');
  for (const s of ['CREATE TABLE IF NOT EXISTS conversations(', 'CREATE TABLE IF NOT EXISTS conversation_messages(', 'CREATE INDEX IF NOT EXISTS conversations_user_updated ON conversations(user_id, updated_at DESC)', 'CREATE INDEX IF NOT EXISTS conversation_messages_conv ON conversation_messages(conversation_id, id)', "CHECK (role IN ('user','assistant'))", 'id bigserial PRIMARY KEY'])
    assert.ok(sql.includes(s), s);
  assert.ok(!/CREATE (TABLE|INDEX|UNIQUE)(?! IF NOT EXISTS)(?! INDEX IF NOT EXISTS)/.test(sql.replace(/CREATE UNIQUE INDEX IF NOT EXISTS/g, '')), 'every CREATE is guarded');
  assert.ok(!/generated_images|album|saved_posts/.test(sql), 'no references to other streams');
});

/* ---------- titles ---------- */
test('titleFrom: short text is kept, whitespace collapsed, empty falls back', () => {
  assert.equal(titleFrom('How is my reach?'), 'How is my reach?');
  assert.equal(titleFrom('  plan\n\n my   week\t'), 'plan my week');
  for (const v of ['', '   ', '\n\t', null, undefined]) assert.equal(titleFrom(v), 'New chat');
});
test('titleFrom: long text is cut at a word boundary, at most 60 chars, never mid-word', () => {
  const t = titleFrom('Write me three caption ideas for a coffee shop reel about our new autumn menu items please');
  assert.ok(t.length <= 60); assert.equal(t, 'Write me three caption ideas for a coffee shop reel about'); // adding " our" would make 61 chars, so "our" is dropped whole
  assert.equal(titleFrom('Write me three caption ideas for a coffee shop reel about it all'), 'Write me three caption ideas for a coffee shop reel about it', 'a word that ends exactly at char 60 is kept');
  const words = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi';
  const c = titleFrom(words); assert.ok(c.length <= 60 && words.startsWith(c) && words[c.length] === ' ', c);
  assert.equal(titleFrom('hello ' + 'a'.repeat(70)), 'hello', 'a word that would be cut is dropped entirely');
  assert.equal(titleFrom('a'.repeat(60) + ' tail'), 'a'.repeat(60), 'exactly 60 chars ending on a word end');
  assert.equal(titleFrom('x'.repeat(59) + ' bbbb'), 'x'.repeat(59));
});
test('titleFrom: one word longer than 60 chars has no boundary, so it falls back; trailing punctuation is trimmed after a cut', () => {
  assert.equal(titleFrom('https://example.com/' + 'a'.repeat(80)), 'New chat');
  const t = titleFrom('word, '.repeat(30)); assert.ok(!/[,\s]$/.test(t) && t.length <= 60, t);
});
test('cleanTitle: trims, 1-120 chars, strings only', () => {
  assert.equal(cleanTitle('  My plan \n'), 'My plan'); assert.equal(cleanTitle('a'.repeat(120)).length, 120);
  for (const v of ['', '   ', 'a'.repeat(121), 5, null, undefined, {}, ['x'], '\u0000\u0001']) assert.equal(cleanTitle(v), null, String(v));
});

/* ---------- never store base64 ---------- */
test('cleanData drops data: URLs, base64 inside strings and oversized strings; keeps ids and small values', () => {
  const o = cleanData({ jobId: 'j1', imageIds: [A, B], ratio: '1:1', n: 2, ok: true, none: null,
    thumb: 'data:image/jpeg;base64,' + 'A'.repeat(200), md: 'see ![x](data:image/png;base64,AAAA) here', big: 'z'.repeat(4001),
    nested: { img: ' data:image/png;base64,AAAA', keep: 'yes', list: ['data:x;base64,AA', 'fine'] }, nul: 'a\u0000b' });
  assert.deepEqual(o, { jobId: 'j1', imageIds: [A, B], ratio: '1:1', n: 2, ok: true, none: null, nested: { keep: 'yes', list: ['fine'] }, nul: 'ab' });
  assert.ok(!JSON.stringify(o).includes('base64'));
  assert.deepEqual(cleanData(undefined), {}); assert.deepEqual(cleanData('str'), {}); assert.deepEqual(cleanData([1]), {});
});
test('cleanData: a body still huge after scrubbing is reduced to the small whitelisted keys', () => {
  const big = { jobId: 'j', ratio: '4:5', kind: 'edit', imageIds: [A] }; for (let i = 0; i < 12; i++) big['k' + i] = 'y'.repeat(3500);
  assert.deepEqual(cleanData(big), { jobId: 'j', ratio: '4:5', kind: 'edit', imageIds: [A] });
});

/* ---------- store: ownership ---------- */
test('ownership: user B can neither read, rename, delete nor write to user A\'s conversation', async () => {
  const db = fakeDb(), s = mk(db), { id } = await s.create(A, 'Private');
  await s.appendMessages(A, id, [{ role: 'user', text: 'hi' }, { role: 'assistant', type: 'info', text: 'hello', data: {} }]);
  assert.equal(await s.get(B, id), null);
  assert.equal(await s.rename(B, id, 'Hacked'), null);
  assert.equal(await s.remove(B, id), false);
  assert.equal(await s.appendMessages(B, id, [{ role: 'user', text: 'x' }, { role: 'assistant', text: 'y' }]), null);
  assert.equal(await s.appendMessages(B, id, [{ role: 'user', text: 'x' }, { role: 'assistant', text: 'y' }], { create: true }), null, 'create:true cannot take over a foreign id either');
  assert.deepEqual(await s.history(B, id), []); assert.equal(await s.owns(B, id), false); assert.deepEqual((await s.list(B)).conversations, []);
  const a = await s.get(A, id); assert.equal(a.title, 'Private'); assert.equal(a.messages.length, 2);
  assert.equal(await s.get(A, 'not-a-uuid'), null); assert.equal(await s.remove(A, 'not-a-uuid'), false);
});
test('ownership over HTTP handlers: foreign and unknown ids are 404, nothing leaks', async () => {
  const db = fakeDb(), { call } = routes(db);
  const { body: made } = await call('POST /conversations', { uid: A, body: { title: 'Mine' } });
  for (const [key, extra] of [['GET /conversations/:id', {}], ['PATCH /conversations/:id', { body: { title: 'x' } }], ['DELETE /conversations/:id', {}]]) {
    assert.equal((await call(key, { uid: B, params: { id: made.id }, ...extra })).statusCode, 404, key + ' foreign');
    assert.equal((await call(key, { uid: A, params: { id: randomUUID() }, ...extra })).statusCode, 404, key + ' unknown');
    assert.equal((await call(key, { uid: A, params: { id: 'zzz' }, ...extra })).statusCode, 404, key + ' malformed');
  }
  assert.equal(db.conversations.length, 1); assert.equal(db.conversations[0].title, 'Mine');
});
test('every query that touches conversation data filters by user_id', async () => {
  const db = fakeDb(), s = mk(db), c = await s.create(A);
  await s.appendMessages(A, c.id, [{ role: 'user', text: 'a' }, { role: 'assistant', type: 'image', text: 'b', data: { jobId: 'j' } }]);
  await s.list(A); await s.get(A, c.id); await s.history(A, c.id); await s.owns(A, c.id); await s.rename(A, c.id, 'n'); await s.remove(A, c.id);
  const seen = db.calls.filter(([sql]) => /conversations|conversation_messages|generated_images/.test(sql));
  assert.ok(seen.length >= 8);
  for (const [sql, p] of seen) { assert.match(sql, /user_id/, sql.slice(0, 60)); assert.ok(p.includes(A), 'uid is a bound parameter'); }
});

/* ---------- endpoints ---------- */
test('registrar wires exactly the five routes and returns the store', () => {
  const { t, store } = routes(fakeDb());
  assert.deepEqual(Object.keys(t).sort(), ['DELETE /conversations/:id', 'GET /conversations', 'GET /conversations/:id', 'PATCH /conversations/:id', 'POST /conversations']);
  for (const k of ['create', 'list', 'get', 'rename', 'remove', 'appendMessages', 'history', 'resolvePending']) assert.equal(typeof store[k], 'function', k);
});
test('POST/PATCH validate the title; POST defaults to "New chat"; DELETE is 204 and cascades', async () => {
  const db = fakeDb(), { call } = routes(db);
  let r = await call('POST /conversations', { body: {} }); assert.equal(r.statusCode, 201); assert.equal(r.body.title, 'New chat'); assert.match(r.body.id, /^[0-9a-f-]{36}$/);
  r = await call('POST /conversations', { body: { title: '  Weekly plan  ' } }); assert.deepEqual([r.statusCode, r.body.title], [201, 'Weekly plan']);
  for (const bad of ['', '   ', 'a'.repeat(121), 7]) assert.equal((await call('POST /conversations', { body: { title: bad } })).statusCode, 400, 'POST ' + bad);
  const id = r.body.id;
  r = await call('PATCH /conversations/:id', { params: { id }, body: { title: ' Renamed ' } }); assert.deepEqual(r.body, { id, title: 'Renamed' });
  for (const bad of [{}, { title: '' }, { title: 'a'.repeat(121) }, { title: 42 }]) assert.equal((await call('PATCH /conversations/:id', { params: { id }, body: bad })).statusCode, 400);
  assert.equal(db.conversations.find(c => c.id === id).title, 'Renamed');
  await mk(db).appendMessages(A, id, [{ role: 'user', text: 'q' }, { role: 'assistant', text: 'a' }]);
  r = await call('DELETE /conversations/:id', { params: { id } }); assert.equal(r.statusCode, 204);
  assert.ok(!db.conversations.some(c => c.id === id)); assert.equal(db.messages.filter(m => m.conversation_id === id).length, 0);
});
test('GET /conversations/:id returns {id,title,messages} oldest to newest with string ids and ISO dates', async () => {
  const db = fakeDb(), s = mk(db), c = seedConv(db, A, 'T');
  seedMsg(db, c, 'user', 'first'); seedMsg(db, c, 'assistant', 'second', { more: [] }, new Date(T0 + 1000).toISOString(), 'tip');
  const r = await s.get(A, c.id);
  assert.deepEqual(Object.keys(r), ['id', 'title', 'messages']);
  assert.deepEqual(r.messages.map(m => [m.id, m.role, m.type, m.text]), [['1', 'user', 'info', 'first'], ['2', 'assistant', 'tip', 'second']]);
  assert.deepEqual(Object.keys(r.messages[1]), ['id', 'role', 'type', 'text', 'data', 'createdAt']); assert.equal(r.messages[1].createdAt, '2026-10-23T10:00:01.000Z');
});
test('GET /conversations/:id returns at most 300 messages: the newest 300, oldest first', async () => {
  const db = fakeDb(), s = mk(db), c = seedConv(db, A);
  for (let i = 1; i <= 350; i++) seedMsg(db, c, i % 2 ? 'user' : 'assistant', 'm' + i);
  const r = await s.get(A, c.id); assert.equal(r.messages.length, 300); assert.equal(r.messages[0].id, '51'); assert.equal(r.messages.at(-1).id, '350');
});

/* ---------- list + pagination ---------- */
test('list: newest updated_at first, with lastMessage and messageCount; a new message moves a conversation to the top', async () => {
  const db = fakeDb(), s = mk(db), c1 = await s.create(A, 'one'), c2 = await s.create(A, 'two'), c3 = await s.create(A, 'three');
  assert.deepEqual((await s.list(A)).conversations.map(c => c.title), ['three', 'two', 'one']);
  await s.appendMessages(A, c1.id, [{ role: 'user', text: 'ping' }, { role: 'assistant', type: 'tip', text: 'pong', data: {} }]);
  const r = await s.list(A); assert.deepEqual(r.conversations.map(c => c.title), ['one', 'three', 'two']);
  assert.equal(r.conversations[0].lastMessage, 'pong'); assert.equal(r.conversations[0].messageCount, 2);
  assert.equal(r.conversations[1].lastMessage, ''); assert.equal(r.conversations[1].messageCount, 0);
  assert.deepEqual(Object.keys(r.conversations[1]), ['id', 'title', 'createdAt', 'updatedAt', 'lastMessage', 'messageCount']);
  assert.ok(!('next' in r)); void c2; void c3;
});
test('list: limit/before pagination, `next` only when more exist', async () => {
  const db = fakeDb(), s = mk(db); const ids = []; for (let i = 1; i <= 5; i++) ids.push((await s.create(A, 'c' + i)).id);
  const p1 = await s.list(A, { limit: 2 }); assert.deepEqual(p1.conversations.map(c => c.title), ['c5', 'c4']); assert.ok(p1.next);
  const p2 = await s.list(A, { limit: 2, before: p1.next }); assert.deepEqual(p2.conversations.map(c => c.title), ['c3', 'c2']); assert.ok(p2.next);
  const p3 = await s.list(A, { limit: 2, before: p2.next }); assert.deepEqual(p3.conversations.map(c => c.title), ['c1']); assert.ok(!('next' in p3));
  const db2 = fakeDb(), s2 = mk(db2); for (let i = 1; i <= 4; i++) await s2.create(A, 'd' + i);
  const q1 = await s2.list(A, { limit: 2 }), q2 = await s2.list(A, { limit: 2, before: q1.next });
  assert.deepEqual(q2.conversations.map(c => c.title), ['d2', 'd1']); assert.ok(!('next' in q2), 'exactly `limit` rows left means no next');
});
test('list: limit is clamped to 1..100 and defaults to 30; the HTTP handler rejects a malformed before', async () => {
  const db = fakeDb(), { call, store } = routes(db);
  await store.list(A, { limit: 1000 }); assert.equal(db.calls.at(-1)[1][2], 101);
  await store.list(A, { limit: 'abc' }); assert.equal(db.calls.at(-1)[1][2], 31);
  await store.list(A, { limit: 0 }); assert.equal(db.calls.at(-1)[1][2], 31);
  assert.equal((await call('GET /conversations', { query: { before: "2026-01-01'; DROP TABLE x;--" } })).statusCode, 400);
  assert.equal((await call('GET /conversations', { query: { before: '2026-13-45T99:99:99Z' } })).statusCode, 400);
  const ok = await call('GET /conversations', { query: { limit: '5', before: '2026-10-23T10:00:00.123456Z' } }); assert.equal(ok.statusCode, 200); assert.deepEqual(ok.body, { conversations: [] });
});
test('list: coverImageId is the most recent image id (stored, or resolved through job_id); absent when none', async () => {
  const db = fakeDb(), s = mk(db), I1 = randomUUID(), I2 = randomUUID(), I3 = randomUUID();
  const withStored = seedConv(db, A, 'stored'), withJob = seedConv(db, A, 'job'), none = seedConv(db, A, 'none'), mixed = seedConv(db, A, 'mixed'), other = seedConv(db, B, 'other');
  seedMsg(db, withStored, 'assistant', 'img', { imageIds: [I1], jobId: 'js' }, undefined, 'image');
  seedMsg(db, withJob, 'assistant', 'img', { jobId: 'jj' }, undefined, 'image'); db.images.push({ user_id: A, job_id: 'jj', idx: 1, id: I3 }, { user_id: A, job_id: 'jj', idx: 0, id: I2 });
  seedMsg(db, none, 'assistant', 'plain', {}); seedMsg(db, none, 'assistant', 'unfinished', { jobId: 'never' }, undefined, 'image');
  seedMsg(db, mixed, 'assistant', 'old done', { imageIds: [I1] }, undefined, 'image'); seedMsg(db, mixed, 'assistant', 'new pending', { jobId: 'never2' }, undefined, 'image');
  seedMsg(db, other, 'assistant', 'b', { imageIds: [I3] });
  const byTitle = Object.fromEntries((await s.list(A)).conversations.map(c => [c.title, c]));
  assert.equal(byTitle.stored.coverImageId, I1); assert.equal(byTitle.job.coverImageId, I2, 'first image of the job (idx 0)');
  assert.ok(!('coverImageId' in byTitle.none)); assert.equal(byTitle.mixed.coverImageId, I1, 'newest message is unfinished, so the newest resolvable image wins');
  assert.ok(!('other' in byTitle));
});
test('list: still works when generated_images does not exist (no cover, no throw)', async () => {
  const db = fakeDb(), s = mk(db); db.imagesTable = false; const c = seedConv(db, A); seedMsg(db, c, 'assistant', 'img', { jobId: 'jj' }, undefined, 'image');
  const r = await s.list(A); assert.equal(r.conversations.length, 1); assert.ok(!('coverImageId' in r.conversations[0]));
});

/* ---------- pending image resolution ---------- */
const at = min => new Date(Date.parse('2026-10-23T12:00:00Z') - min * 60000).toISOString(); // `min` minutes before the fixed NOW below
const T12 = () => Date.parse('2026-10-23T12:00:00Z');
test('pending resolution: done / failed after 10 minutes / pending', async () => {
  const db = fakeDb(), s = makeConversations({ q: db.q, now: T12 }), c = seedConv(db, A), I1 = randomUUID(), I2 = randomUUID();
  db.images.push({ user_id: A, job_id: 'done', idx: 1, id: I2 }, { user_id: A, job_id: 'done', idx: 0, id: I1 });
  seedMsg(db, c, 'assistant', 'a', { jobId: 'done', ratio: '1:1' }, at(1), 'image');
  seedMsg(db, c, 'assistant', 'b', { jobId: 'lost' }, at(11), 'image');
  seedMsg(db, c, 'assistant', 'c', { jobId: 'fresh' }, at(2), 'image');
  seedMsg(db, c, 'assistant', 'd', { jobId: 'edge' }, at(10), 'image');
  seedMsg(db, c, 'assistant', 'e', { jobId: 'doneold' }, at(300), 'image'); db.images.push({ user_id: A, job_id: 'doneold', idx: 0, id: I1 });
  const m = (await s.get(A, c.id)).messages;
  assert.deepEqual(m[0].data, { jobId: 'done', ratio: '1:1', imageIds: [I1, I2], status: 'done' });
  assert.deepEqual(m[1].data, { jobId: 'lost', imageIds: [], status: 'failed', error: 'Generation did not finish' });
  assert.deepEqual(m[2].data, { jobId: 'fresh', imageIds: [], status: 'pending' });
  assert.equal(m[3].data.status, 'pending', 'exactly 10 minutes is not yet older than 10 minutes');
  assert.equal(m[4].data.status, 'done', 'a finished job stays done however old the message is');
  assert.equal(db.messages[0].data.status, undefined, 'resolution is read-only: nothing is written back');
});
test('pending resolution is scoped to the user: another user\'s image with the same job id does not count', async () => {
  const db = fakeDb(), s = makeConversations({ q: db.q, now: T12 }), c = seedConv(db, A);
  db.images.push({ user_id: B, job_id: 'j', idx: 0, id: randomUUID() }); seedMsg(db, c, 'assistant', 'x', { jobId: 'j' }, at(1), 'image');
  assert.equal((await s.get(A, c.id)).messages[0].data.status, 'pending');
});
test('messages that already have imageIds, and user messages, trigger no generated_images lookup', async () => {
  const db = fakeDb(), s = makeConversations({ q: db.q, now: T12 }), c = seedConv(db, A), I = randomUUID();
  seedMsg(db, c, 'assistant', 'x', { jobId: 'j', imageIds: [I] }, at(500), 'image'); seedMsg(db, c, 'user', 'u', { jobId: 'weird' }, at(500));
  const m = (await s.get(A, c.id)).messages; assert.deepEqual(m[0].data, { jobId: 'j', imageIds: [I] }); assert.deepEqual(m[1].data, { jobId: 'weird' });
  assert.ok(!db.calls.some(([sql]) => sql.includes('generated_images')));
});
test('missing generated_images table degrades to the age rule instead of throwing (read and history)', async () => {
  const db = fakeDb(), s = makeConversations({ q: db.q, now: T12 }), c = seedConv(db, A); db.imagesTable = false;
  seedMsg(db, c, 'assistant', 'old', { jobId: 'a' }, at(30), 'image'); seedMsg(db, c, 'assistant', 'new', { jobId: 'b' }, at(1), 'image');
  const m = (await s.get(A, c.id)).messages; assert.equal(m[0].data.status, 'failed'); assert.equal(m[0].data.error, 'Generation did not finish'); assert.equal(m[1].data.status, 'pending');
  const h = await s.history(A, c.id); assert.deepEqual(h.map(x => x.data.imageIds), [[], []]);
  db.imagesTable = true; db.q = async () => { throw Object.assign(new Error('connection reset'), { code: '08006' }); };
  const warned = []; const s2 = makeConversations({ q: db.q, now: T12, log: { warn: (...a) => warned.push(a), error() {} } });
  assert.equal((await s2.resolvePending(A, [{ id: '1', role: 'assistant', type: 'image', text: '', data: { jobId: 'a' }, createdAt: at(30) }]))[0].data.status, 'failed');
  assert.equal(warned.length, 1, 'only a missing table is silent; other errors are logged');
});

/* ---------- history for the brain ---------- */
test('history: last 12 messages oldest to newest, text cut to 300, data reduced to {imageIds, ratio, kind, jobId}', async () => {
  const db = fakeDb(), s = mk(db), c = await s.create(A);
  for (let i = 1; i <= 10; i++) await s.appendMessages(A, c.id, [{ role: 'user', text: `u${i} ` + 'x'.repeat(500) }, { role: 'assistant', type: 'tip', text: 'a' + i, data: { more: [{ text: 'z' }], metrics: { a: 1 } } }]);
  const h = await s.history(A, c.id); assert.equal(h.length, 12); assert.deepEqual(h.map(m => m.id), ['9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20']);
  assert.equal(h[0].role, 'user'); assert.equal(h[0].text.length, 300); assert.equal(h.at(-1).text, 'a10'); assert.deepEqual(h.at(-1).data, {});
  assert.deepEqual(Object.keys(h[0]), ['id', 'role', 'type', 'text', 'data', 'createdAt']);
  assert.equal((await s.history(A, c.id, 3)).length, 3);
});
test('history: image messages carry resolved imageIds ([] while pending) and only the four allowed data keys', async () => {
  const db = fakeDb(), s = makeConversations({ q: db.q, now: T12 }), c = seedConv(db, A), I = randomUUID();
  db.images.push({ user_id: A, job_id: 'j1', idx: 0, id: I });
  seedMsg(db, c, 'assistant', 'done', { jobId: 'j1', ratio: '4:5', kind: 'edit', summary: 'x', instruction: 'y', parentImageId: randomUUID() }, at(3), 'image');
  seedMsg(db, c, 'assistant', 'pending', { jobId: 'j2', ratio: '1:1', kind: 'generate' }, at(1), 'image');
  const [d, p] = await s.history(A, c.id);
  assert.deepEqual(d.data, { jobId: 'j1', imageIds: [I], ratio: '4:5', kind: 'edit' }); assert.deepEqual(p.data, { jobId: 'j2', imageIds: [], ratio: '1:1', kind: 'generate' });
});

/* ---------- withConversation ---------- */
test('withConversation happy path: new chat, saves both messages, adds conversationId + messageId, title from the first message', async () => {
  const db = fakeDb(), s = mk(db), seen = [];
  const res = await ask(withConversation(s, handlerSending(200, { type: 'tip', text: 'Post a reel', data: { more: [] } }, seen)), { body: { message: 'What should I post next week to grow faster?' } });
  assert.equal(seen[0].history.length, 0); assert.match(seen[0].id, /^[0-9a-f-]{36}$/); assert.deepEqual(Object.keys(seen[0]), ['id', 'history']);
  assert.equal(res.statusCode, 200); assert.deepEqual(res.body, { type: 'tip', text: 'Post a reel', data: { more: [] }, conversationId: seen[0].id, messageId: '2' });
  assert.equal(typeof res.body.messageId, 'string');
  assert.equal(db.conversations.length, 1); assert.equal(db.conversations[0].title, 'What should I post next week to grow faster?'); assert.equal(db.conversations[0].user_id, A);
  assert.deepEqual(db.messages.map(m => [m.role, m.type, m.text]), [['user', 'info', 'What should I post next week to grow faster?'], ['assistant', 'tip', 'Post a reel']]);
});
test('withConversation continues an owned conversation: history is passed in, updated_at is bumped, the title is kept', async () => {
  const db = fakeDb(), s = mk(db), seen = [], w = withConversation(s, handlerSending(200, { type: 'info', text: 'ok', data: {} }, seen));
  const r1 = await ask(w, { body: { message: 'first question' } }), before = db.conversations[0].updated_at;
  const r2 = await ask(w, { body: { message: 'second question', conversationId: r1.body.conversationId } });
  assert.equal(r2.body.conversationId, r1.body.conversationId); assert.equal(db.conversations.length, 1);
  assert.deepEqual(seen[1].history.map(m => [m.role, m.text]), [['user', 'first question'], ['assistant', 'ok']]);
  assert.ok(Date.parse(db.conversations[0].updated_at) > Date.parse(before)); assert.equal(db.conversations[0].title, 'first question'); assert.equal(db.messages.length, 4);
});
test('withConversation gives an empty "New chat" its title from the first message but never overwrites a real title', async () => {
  const db = fakeDb(), s = mk(db), fresh = await s.create(A), named = await s.create(A, 'My plan'), w = withConversation(s, handlerSending(200, { type: 'info', text: 'ok' }));
  await ask(w, { body: { message: 'Plan my week', conversationId: fresh.id } }); await ask(w, { body: { message: 'something else', conversationId: named.id } });
  assert.equal(db.conversations.find(c => c.id === fresh.id).title, 'Plan my week'); assert.equal(db.conversations.find(c => c.id === named.id).title, 'My plan');
  await ask(w, { body: { message: 'later message', conversationId: fresh.id } }); assert.equal(db.conversations.find(c => c.id === fresh.id).title, 'Plan my week');
});
test('withConversation: non-2xx responses store nothing and leave the body alone (no empty conversation either)', async () => {
  for (const code of [400, 404, 429, 500, 503]) {
    const db = fakeDb(), s = mk(db), res = await ask(withConversation(s, handlerSending(code, { error: 'nope', type: 'info', text: 'x' })), { body: { message: 'hello' } });
    assert.equal(res.statusCode, code); assert.deepEqual(res.body, { error: 'nope', type: 'info', text: 'x' });
    assert.equal(db.conversations.length, 0, 'status ' + code); assert.equal(db.messages.length, 0);
  }
  const db = fakeDb(), s = mk(db), c = await s.create(A), res = await ask(withConversation(s, handlerSending(400, { error: 'message required' })), { body: { message: '', conversationId: c.id } });
  assert.deepEqual(res.body, { error: 'message required' }); assert.equal(db.messages.length, 0);
});
test('withConversation: bodies that are not assistant messages (no type/text, arrays, sendStatus) are passed through untouched', async () => {
  const db = fakeDb(), s = mk(db);
  assert.deepEqual((await ask(withConversation(s, handlerSending(200, { ok: true })), { body: { message: 'x' } })).body, { ok: true });
  assert.deepEqual((await ask(withConversation(s, handlerSending(200, [1, 2])), { body: { message: 'x' } })).body, [1, 2]);
  const res = mkRes(); await withConversation(s, (req, r) => r.sendStatus(204))({ uid: A, body: { message: 'x' } }, res); await res.done; assert.equal(res.statusCode, 204);
  assert.equal(db.messages.length, 0);
});
test('withConversation: a persistence error is logged and never changes or blocks the response', async () => {
  const db = fakeDb(), s = mk(db), log = mkLog(); db.failAppend = true;
  const res = await ask(withConversation(s, handlerSending(200, { type: 'tip', text: 'still here', data: {} }), { log }), { body: { message: 'hi' } });
  assert.equal(res.statusCode, 200); assert.deepEqual(res.body, { type: 'tip', text: 'still here', data: {} }); assert.equal(log.errors.length, 1); assert.match(log.errors[0], /db down/);
});
test('withConversation: a hanging database delays the reply by at most timeoutMs; a failing open still lets the handler run', async () => {
  const hang = { owns: async () => false, history: async () => [], appendMessages: () => new Promise(() => {}) }, log = mkLog(), t0 = Date.now();
  const res = await ask(withConversation(hang, handlerSending(200, { type: 'info', text: 'ok' }), { log, timeoutMs: 30 }), { body: { message: 'x' } });
  assert.deepEqual(res.body, { type: 'info', text: 'ok' }); assert.ok(Date.now() - t0 < 1000); assert.match(log.errors[0], /timed out/);
  const broken = { owns: async () => { throw new Error('boom'); }, history: async () => [], appendMessages: async () => null }, seen = [], log2 = mkLog();
  const r2 = await ask(withConversation(broken, handlerSending(200, { type: 'info', text: 'ok' }, seen), { log: log2 }), { body: { message: 'x', conversationId: randomUUID() } });
  assert.deepEqual(r2.body, { type: 'info', text: 'ok' }); assert.equal(seen[0].history.length, 0); assert.ok(log2.errors.length >= 1);
});
test('withConversation: unknown, malformed and other users\' conversation ids start a new chat and never reveal the foreign id', async () => {
  const db = fakeDb(), s = mk(db), foreign = await s.create(B, 'Bs chat'); await s.appendMessages(B, foreign.id, [{ role: 'user', text: 'secret' }, { role: 'assistant', text: 'reply' }]);
  const seen = [], w = withConversation(s, handlerSending(200, { type: 'info', text: 'ok' }, seen)), bMessages = db.messages.length;
  for (const bad of [randomUUID(), 'garbage', 42, foreign.id, '']) {
    const res = await ask(w, { uid: A, body: { message: 'hello', conversationId: bad } });
    const last = seen.at(-1); assert.notEqual(last.id, foreign.id); assert.notEqual(last.id, bad); assert.deepEqual(last.history, [], 'no foreign history is ever handed over');
    assert.equal(res.body.conversationId, last.id); assert.ok(db.conversations.find(c => c.id === last.id && c.user_id === A));
  }
  assert.equal(db.messages.filter(m => m.conversation_id === foreign.id).length, 2, 'B\'s conversation was not written to'); assert.equal(db.messages.length, bMessages + 10);
  assert.equal(db.conversations.filter(c => c.user_id === A).length, 5);
});
test('withConversation: base64 never reaches the table (data URLs stripped from data; legacy referenceImage not stored)', async () => {
  const db = fakeDb(), s = mk(db), ref = randomUUID(), png = 'data:image/png;base64,' + 'A'.repeat(500);
  const res = await ask(withConversation(s, handlerSending(200, { type: 'image', text: 'Generating', data: { jobId: 'j9', ratio: '4:5', kind: 'edit', thumb: png, images: [png], blob: 'x'.repeat(5000), nested: { img: png, ok: 1 } } })),
    { body: { message: 'make it hot', mode: 'image', ratio: '4:5', referenceImageId: ref, referenceImage: png } });
  assert.deepEqual(db.messages[1].data, { jobId: 'j9', ratio: '4:5', kind: 'edit', images: [], nested: { ok: 1 } });
  assert.deepEqual(db.messages[0].data, { referenceImageId: ref, ratio: '4:5', mode: 'image' });
  assert.ok(!JSON.stringify(db.messages).includes('base64')); assert.ok(!db.calls.some(([, p]) => p.some(x => typeof x === 'string' && x.includes('base64'))), 'not even sent to the database');
  assert.equal(res.body.data.thumb, png, 'the response itself is unchanged apart from the two added ids');
});
test('withConversation: a handler that throws is propagated and stores nothing', async () => {
  const db = fakeDb(), s = mk(db);
  await assert.rejects(withConversation(s, async () => { throw new Error('handler blew up'); })({ uid: A, body: { message: 'x' } }, mkRes()), /handler blew up/);
  assert.equal(db.conversations.length, 0);
});
test('withConversation: history for the brain resolves finished image jobs through the same job_id lookup', async () => {
  const db = fakeDb(), s = makeConversations({ q: db.q, now: T12 }), c = seedConv(db, A), I = randomUUID(), seen = [];
  seedMsg(db, c, 'user', 'make a latte image', {}, at(5)); seedMsg(db, c, 'assistant', 'Generating', { jobId: 'jx', ratio: '1:1', kind: 'generate' }, at(5), 'image'); db.images.push({ user_id: A, job_id: 'jx', idx: 0, id: I });
  await ask(withConversation(s, handlerSending(200, { type: 'info', text: 'ok' }, seen)), { body: { message: 'make it hot', conversationId: c.id } });
  assert.deepEqual(seen[0].history[1].data, { jobId: 'jx', imageIds: [I], ratio: '1:1', kind: 'generate' });
});