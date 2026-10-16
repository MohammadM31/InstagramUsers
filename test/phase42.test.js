// Roadmap 4.2: editable responses. Server validation and handlers with a fake q (the real SQL is not run here), plus the UI helpers (web/src/resp.ts),
// which are compared with the server's limits. UI tests are skipped, not failed, on Node < 22.18.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeResponses, validateSave, KINDS, MAX_TEXT, MAX_ROWS } from '../src/responses.js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const md5 = s => createHash('md5').update(s).digest('hex');
const res = () => { const r = { code: 200, body: undefined }; r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; }; r.sendStatus = c => { r.code = c; return r; }; return r; };
function fakeQ() {
  const rows = []; let seq = 0, clock = 0; const sqls = [];
  const q = async (sql, p = []) => {
    sqls.push({ sql, p });
    if (/count\(\*\)::int n, coalesce\(bool_or/.test(sql)) { const mine = rows.filter(r => r.user_id === p[0]); return [{ n: mine.length, has: mine.some(r => md5(r.original) === md5(p[1])) }]; }
    if (/^INSERT INTO saved_responses/.test(sql)) {
      assert.match(sql, /ON CONFLICT\(user_id,md5\(original\)\) DO UPDATE SET edited=EXCLUDED\.edited,kind=EXCLUDED\.kind,updated_at=now\(\)/, 'the upsert changes only the edit'); assert.ok(!/SET[^]*\boriginal=/.test(sql.split('DO UPDATE')[1]), 'original is never overwritten');
      const [u, kind, original, edited] = p; let r = rows.find(x => x.user_id === u && md5(x.original) === md5(original));
      if (r) { r.edited = edited; r.kind = kind; r.updated_at = ++clock; } else { r = { id: ++seq, user_id: u, kind, original, edited, created_at: ++clock, updated_at: clock }; rows.push(r); }
      const { user_id, ...out } = r; return [out];
    }
    if (/^SELECT .* FROM saved_responses/.test(sql)) { assert.match(sql, /WHERE user_id=\$1 ORDER BY/, 'list is scoped to the caller'); } 
    if (/^SELECT .* FROM saved_responses/.test(sql)) return rows.filter(r => r.user_id === p[0]).sort((a, b) => b.updated_at - a.updated_at).slice(0, p[1]).map(({ user_id, ...o }) => o);
    if (/^DELETE FROM saved_responses/.test(sql)) { assert.match(sql, /WHERE id=\$1 AND user_id=\$2 RETURNING id/, 'delete is scoped to the owner'); const i = rows.findIndex(r => String(r.id) === String(p[0]) && r.user_id === p[1]); if (i < 0) return []; rows.splice(i, 1); return [{ id: p[0] }]; }
    throw new Error('unexpected sql ' + sql);
  };
  q.rows = rows; q.sqls = sqls; return q;
}
const call = async (h, req) => { const r = res(); await h(req, r); return r; };

test('4.2 validateSave: needs text for both sides, trims, refuses empty, unchanged, too long and unknown kinds', () => {
  assert.deepEqual(validateSave({ original: ' Hello ', edited: ' Hello there ' }).value, { kind: 'assistant', original: 'Hello', edited: 'Hello there' });
  for (const [b, re] of [[{ original: 'a', edited: '  ' }, /empty/], [{ original: '', edited: 'b' }, /original is empty/], [{ original: 'a', edited: ' a ' }, /nothing changed/],
    [{ original: 'a', edited: 'x'.repeat(MAX_TEXT + 1) }, /at most/], [{ original: 'a', edited: 5 }, /must be text/], [{ original: 'a', edited: 'b', kind: 'secret' }, /kind must be/], [undefined, /must be text/]])
    assert.match(validateSave(b).error, re, JSON.stringify(b)?.slice(0, 40));
  assert.ok(validateSave({ original: 'a', edited: 'x'.repeat(MAX_TEXT) }).value);
  assert.ok(KINDS.includes('proposal_caption'), 'C.3 proposal captions use the same table');
});
test('4.2 save stores the original and the edit; saving the same original again updates the one row', async () => {
  const q = fakeQ(), h = makeResponses({ q });
  const a = await call(h.save, { uid: 'u1', body: { original: 'Post more reels.', edited: 'Post more reels on Fridays.' } });
  assert.equal(a.code, 200); assert.equal(a.body.response.original, 'Post more reels.'); assert.equal(a.body.response.edited, 'Post more reels on Fridays.');
  const b = await call(h.save, { uid: 'u1', body: { original: 'Post more reels.', edited: 'Post two reels a week.' } });
  assert.equal(q.rows.length, 1); assert.equal(b.body.response.id, a.body.response.id); assert.equal(b.body.response.edited, 'Post two reels a week.');
  assert.equal(b.body.response.original, 'Post more reels.', 'the original is never overwritten');
});
test('4.2 list is newest edit first, limited, and only shows the caller\'s rows; bad limits are 400', async () => {
  const q = fakeQ(), h = makeResponses({ q });
  for (const t of ['one', 'two', 'three']) await call(h.save, { uid: 'u1', body: { original: t, edited: t + '!' } });
  await call(h.save, { uid: 'u2', body: { original: 'other', edited: 'other!' } });
  const l = await call(h.list, { uid: 'u1', query: {} }); assert.deepEqual(l.body.responses.map(r => r.original), ['three', 'two', 'one']);
  assert.equal((await call(h.list, { uid: 'u1', query: { limit: '2' } })).body.responses.length, 2);
  for (const limit of ['0', '201', 'x', '1.5']) assert.equal((await call(h.list, { uid: 'u1', query: { limit } })).code, 400, limit);
  assert.ok(!JSON.stringify(l.body).includes('other'), 'no other user rows');
  assert.ok(!('user_id' in l.body.responses[0]));
});
test('4.2 the row cap blocks new rows but still lets an existing one be edited', async () => {
  const q = fakeQ(), h = makeResponses({ q });
  for (let i = 0; i < MAX_ROWS; i++) q.rows.push({ id: i + 1, user_id: 'u1', kind: 'assistant', original: 'o' + i, edited: 'e' + i, created_at: 0, updated_at: 0 });
  assert.equal((await call(h.save, { uid: 'u1', body: { original: 'brand new', edited: 'x' } })).code, 409);
  assert.equal((await call(h.save, { uid: 'u1', body: { original: 'o5', edited: 'changed' } })).code, 200);
  assert.equal((await call(h.save, { uid: 'u2', body: { original: 'brand new', edited: 'x' } })).code, 200, 'another user is unaffected');
});
test('4.2 delete is scoped to the owner: 404 for someone else\'s row, 400 for a bad id', async () => {
  const q = fakeQ(), h = makeResponses({ q });
  const a = await call(h.save, { uid: 'u1', body: { original: 'a', edited: 'b' } }), id = String(a.body.response.id);
  assert.equal((await call(h.remove, { uid: 'u2', params: { id } })).code, 404); assert.equal(q.rows.length, 1);
  assert.equal((await call(h.remove, { uid: 'u1', params: { id: 'abc' } })).code, 400);
  assert.equal((await call(h.remove, { uid: 'u1', params: { id } })).body.ok, true); assert.equal(q.rows.length, 0);
});
test('4.2 schema, GDPR export and routes cover saved_responses', () => {
  const schema = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'), routes = readFileSync(new URL('../src/routes.js', import.meta.url), 'utf8');
  assert.match(schema, /CREATE TABLE IF NOT EXISTS saved_responses\(.*user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE/s);
  assert.match(schema, /CREATE UNIQUE INDEX IF NOT EXISTS saved_responses_orig ON saved_responses\(user_id,md5\(original\)\)/);
  assert.match(routes, /'notifications','saved_responses'\]/); assert.match(routes, /post\('\/responses\/save'/); assert.match(routes, /get\('\/responses'/);
});

// ---------- UI helpers ----------
let ui = null; try { ui = await import('../web/src/resp.ts'); } catch { /* old Node */ }
const t = (name, fn) => ui ? test(name, fn) : test(name, { skip: 'needs Node 22.18+ to import web/src/resp.ts' }, () => {});
t('4.2 UI: only plain text replies are editable (not images, charts, the finance split, or a reply still generating)', () => {
  const { canEditResponse } = ui;
  assert.equal(canEditResponse({ type: 'info', text: 'Hi' }), true);
  for (const type of ['image', 'analytics', 'finance']) assert.equal(canEditResponse({ type, text: 'x' }), false, type);
  assert.equal(canEditResponse({ type: 'info', text: '  ' }), false); assert.equal(canEditResponse(null), false);
  assert.equal(canEditResponse({ type: 'info', text: 'x', data: { jobId: 'j' } }), false);
});
t('4.2 UI: checkEdit uses the server\'s limit and rejects what the server rejects', () => {
  const { checkEdit, MAX_TEXT: UI_MAX } = ui; assert.equal(UI_MAX, MAX_TEXT);
  for (const [o, d] of [['a', ' '], ['a', ' a '], ['a', 'x'.repeat(MAX_TEXT + 1)]]) { assert.ok(checkEdit(o, d).error, d.slice(0, 5)); assert.ok(validateSave({ original: o, edited: d }).error); }
  assert.deepEqual(checkEdit('a', ' b '), { text: 'b' }); assert.ok(validateSave({ original: 'a', edited: ' b ' }).value);
});
t('4.2 UI: applyEdit marks the reply edited and keeps the FIRST original across several edits', () => {
  const { applyEdit } = ui, r1 = applyEdit({ type: 'info', text: 'v0' }, 'v1'), r2 = applyEdit(r1, 'v2');
  assert.deepEqual([r1.edited, r1.original, r1.text], [true, 'v0', 'v1']); assert.deepEqual([r2.original, r2.text], ['v0', 'v2']);
});
