// C.1 follow-up (decision 97) and A.3 last_error (decision 92). Fake q and fake storage; the real SQL is NOT run here (no Postgres), so each statement is
// pinned by a text check and the behaviour is checked through a small in-memory model of those statements.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeStoredImages, retentionDays, DEFAULT_RETENTION_DAYS } from '../src/storedimages.js';
import { makeProcessImage } from '../src/imageresult.js';
import { makeCompetitors } from '../src/competitors.js';
import { scrapeErrorInfo, NOT_PUBLIC_CODE } from '../src/competitorintel.js';
import { envProblems } from '../src/config.js';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const K = c => 'img/' + c.repeat(32).slice(0, 32) + '.jpg';
const DAY = 864e5;
function model(clock) {
  const rows = []; let seq = 0; const sqls = [];
  const q = async (sql, p = []) => {
    sqls.push({ sql, p });
    if (/^INSERT INTO stored_images/.test(sql)) { if (rows.some(r => r.object_key === p[1])) return []; const r = { id: ++seq, user_id: p[0], object_key: p[1], created_at: clock.t, deleted_at: null }; rows.push(r); return [{ id: r.id }]; }
    if (/FROM stored_images WHERE deleted_at IS NULL AND \(user_id IS NULL OR created_at < now\(\) - make_interval\(days=>\$1\)\)/.test(sql))
      return rows.filter(r => !r.deleted_at && (r.user_id === null || r.created_at < clock.t - p[0] * DAY)).sort((a, b) => a.created_at - b.created_at).slice(0, p[1]).map(({ id, object_key }) => ({ id, object_key }));
    if (/FROM stored_images WHERE user_id=\$1 AND deleted_at IS NULL ORDER BY id/.test(sql)) return rows.filter(r => r.user_id === p[0] && !r.deleted_at).map(({ id, object_key }) => ({ id, object_key }));
    if (/FROM stored_images WHERE user_id=\$1 AND object_key=\$2 AND deleted_at IS NULL/.test(sql)) return rows.filter(r => r.user_id === p[0] && r.object_key === p[1] && !r.deleted_at).map(({ id, object_key }) => ({ id, object_key }));
    if (/^UPDATE stored_images SET deleted_at=now\(\) WHERE id=\$1 AND deleted_at IS NULL/.test(sql)) { const r = rows.find(x => x.id === p[0] && !x.deleted_at); if (r) r.deleted_at = clock.t; return []; }
    throw new Error('unexpected sql ' + sql);
  };
  q.rows = rows; q.sqls = sqls; q.dropUser = uid => rows.forEach(r => { if (r.user_id === uid) r.user_id = null; }); // what ON DELETE SET NULL does
  return q;
}
function fakeStorage({ enabled = true, failOn = new Set() } = {}) {
  const deleted = [];
  return { enabled, deleted,
    keyFromUrl: v => { const m = /^(?:https:\/\/cdn\.example\.com\/)?((?:img)\/[0-9a-f]{32}\.jpg)$/.exec(String(v)); return m ? m[1] : null; },
    deleteImage: async k => { if (failOn.has(k)) throw new Error('Storage DELETE was refused (HTTP 500)'); deleted.push(k); return true; } };
}

test('C.1 retention setting: default 30 days; whole days 1-365; anything else is a boot problem', () => {
  assert.deepEqual(retentionDays({}), { days: 30, problem: null }); assert.equal(DEFAULT_RETENTION_DAYS, 30);
  assert.deepEqual(retentionDays({ IMAGE_RETENTION_DAYS: ' 7 ' }), { days: 7, problem: null });
  assert.equal(retentionDays({ IMAGE_RETENTION_DAYS: '365' }).days, 365);
  for (const bad of ['0', '366', '-1', '1.5', 'abc', '7d', '1e2']) assert.match(retentionDays({ IMAGE_RETENTION_DAYS: bad }).problem, /whole number of days from 1 to 365/, bad);
  const ok = { JWT_SECRET: 'j'.repeat(40), ENCRYPTION_KEY: 'ab'.repeat(32), DATABASE_URL: 'postgres://x' };
  assert.deepEqual(envProblems({ ...ok, IMAGE_RETENTION_DAYS: '14' }), []);
  assert.match(envProblems({ ...ok, IMAGE_RETENTION_DAYS: 'x' }).join(), /IMAGE_RETENTION_DAYS/);
});

test('C.1 record: stores owner and key once; recordUrl accepts only urls this storage made', async () => {
  const clock = { t: 1e12 }, q = model(clock), s = fakeStorage(), si = makeStoredImages({ q, storage: s });
  await si.record('u1', K('a')); await si.record('u1', K('a'));
  assert.equal(q.rows.length, 1);
  assert.equal(await si.recordUrl('u2', 'https://cdn.example.com/' + K('b')), K('b')); assert.equal(q.rows[1].user_id, 'u2');
  await assert.rejects(si.recordUrl('u1', 'https://evil.example.com/' + K('c')), /Not an image url/);
  assert.equal(q.rows.length, 2);
});

test('C.1 retention purge: deletes objects older than the period and orphans; keeps fresh ones; marks deleted_at', async () => {
  const clock = { t: 100 * DAY }, q = model(clock), s = fakeStorage(), si = makeStoredImages({ q, storage: s, env: { IMAGE_RETENTION_DAYS: '30' } });
  q.rows.push({ id: 1, user_id: 'u1', object_key: K('1'), created_at: clock.t - 31 * DAY, deleted_at: null },   // old
    { id: 2, user_id: 'u1', object_key: K('2'), created_at: clock.t - 29 * DAY, deleted_at: null },              // fresh
    { id: 3, user_id: null, object_key: K('3'), created_at: clock.t - 1 * DAY, deleted_at: null },               // account gone
    { id: 4, user_id: 'u1', object_key: K('4'), created_at: clock.t - 90 * DAY, deleted_at: clock.t - DAY });    // already deleted
  const r = await si.purgeDue();
  assert.deepEqual(s.deleted.sort(), [K('1'), K('3')]); assert.equal(r.removed, 2); assert.equal(r.errors, 0);
  assert.ok(q.rows[0].deleted_at && q.rows[2].deleted_at); assert.equal(q.rows[1].deleted_at, null);
  assert.deepEqual(await si.purgeDue(), { total: 0, removed: 0, errors: 0, firstError: null }, 'nothing left to do');
  // the period is configurable: 7 days now catches the "fresh" 29-day-old one
  const si7 = makeStoredImages({ q, storage: s, env: { IMAGE_RETENTION_DAYS: '7' } }); await si7.purgeDue(); assert.ok(q.rows[1].deleted_at);
  assert.deepEqual(q.sqls.find(x => /make_interval/.test(x.sql)).p, [30, 100]);
});
test('C.1 retention purge: one failed delete keeps its row for the next pass and does not stop the others', async () => {
  const clock = { t: 100 * DAY }, q = model(clock), s = fakeStorage({ failOn: new Set([K('1')]) }), si = makeStoredImages({ q, storage: s });
  for (const [i, c] of ['1', '2', '3'].entries()) q.rows.push({ id: i + 1, user_id: null, object_key: K(c), created_at: clock.t - i, deleted_at: null });
  const r = await si.purgeDue();
  assert.equal(r.removed, 2); assert.equal(r.errors, 1); assert.match(r.firstError, /HTTP 500/);
  assert.equal(q.rows[0].deleted_at, null, 'failed one stays listed'); assert.ok(q.rows[1].deleted_at && q.rows[2].deleted_at);
  s.deleted.length = 0; makeStoredImages({ q, storage: fakeStorage() }); // retry with a healthy storage
  const r2 = await makeStoredImages({ q, storage: fakeStorage() }).purgeDue(); assert.equal(r2.removed, 1);
});
test('C.1 retention purge: storage switched off with images due is an error (not silent); with nothing due it is quiet', async () => {
  const clock = { t: 100 * DAY }, q = model(clock), si = makeStoredImages({ q, storage: fakeStorage({ enabled: false }) });
  assert.equal((await si.purgeDue()).removed, 0);
  q.rows.push({ id: 1, user_id: null, object_key: K('1'), created_at: clock.t, deleted_at: null });
  await assert.rejects(si.purgeDue(), /not configured.*1 stored image/);
  assert.equal(q.rows[0].deleted_at, null);
  assert.equal(await makeStoredImages({ q, storage: undefined }).purgeDue().catch(e => 'err'), 'err');
});

test('C.1 account delete: purgeUser removes only that user\'s objects, never throws, and leftovers become orphans the hourly job finishes', async () => {
  const clock = { t: 100 * DAY }, q = model(clock), s = fakeStorage({ failOn: new Set([K('2')]) }), si = makeStoredImages({ q, storage: s });
  await si.record('u1', K('1')); await si.record('u1', K('2')); await si.record('u2', K('3'));
  const r = await si.purgeUser('u1');
  assert.deepEqual([r.total, r.removed, r.pending], [2, 1, 1]); assert.deepEqual(s.deleted, [K('1')]);
  assert.equal(q.rows[2].deleted_at, null, 'another user\'s image is untouched');
  q.dropUser('u1'); // DELETE FROM users -> ON DELETE SET NULL
  assert.equal(q.rows[1].user_id, null);
  const healthy = fakeStorage(); const r2 = await makeStoredImages({ q, storage: healthy }).purgeDue();
  assert.deepEqual(healthy.deleted, [K('2')]); assert.equal(r2.removed, 1); assert.equal(q.rows[2].deleted_at, null, 'u2 still within retention');
  // storage off: counted as pending, no throw
  const off = makeStoredImages({ q, storage: fakeStorage({ enabled: false }) }); const r3 = await off.purgeUser('u2'); assert.deepEqual([r3.total, r3.removed, r3.pending], [1, 0, 1]);
  // db error: no throw
  const broken = makeStoredImages({ q: async () => { throw new Error('db down'); }, storage: s }); const r4 = await broken.purgeUser('u1'); assert.equal(r4.errors, 1);
  assert.deepEqual(await si.purgeUser('nobody'), { total: 0, removed: 0, pending: 0, errors: 0, firstError: null });
});

test('C.2 hook: releaseAfterPublish deletes the owner\'s object once; others, unknown and foreign urls are refused', async () => {
  const clock = { t: 100 * DAY }, q = model(clock), s = fakeStorage(), si = makeStoredImages({ q, storage: s });
  await si.record('u1', K('1'));
  assert.deepEqual(await si.releaseAfterPublish('u2', K('1')), { released: false, reason: 'not_found' }, 'not the owner');
  assert.deepEqual(await si.releaseAfterPublish('u1', 'https://evil.example.com/x.jpg'), { released: false, reason: 'not_ours' });
  assert.deepEqual(await si.releaseAfterPublish('u1', 'https://cdn.example.com/' + K('1')), { released: true, reason: null });
  assert.deepEqual(s.deleted, [K('1')]); assert.ok(q.rows[0].deleted_at);
  assert.deepEqual(await si.releaseAfterPublish('u1', K('1')), { released: false, reason: 'not_found' }, 'already gone');
  const off = makeStoredImages({ q, storage: fakeStorage({ enabled: false }) }); assert.equal((await off.releaseAfterPublish('u1', K('1'))).reason, 'storage_not_configured');
  await si.record('u1', K('2')); const bad = makeStoredImages({ q, storage: fakeStorage({ failOn: new Set([K('2')]) }) });
  const f = await bad.releaseAfterPublish('u1', K('2')); assert.equal(f.released, false); assert.equal(f.reason, 'delete_failed'); assert.equal(q.rows[1].deleted_at, null, 'kept for the retention job');
});

test('C.1 image job tracks every upload; if tracking fails the object is removed and the job fails', async () => {
  const tracked = [], deleted = [];
  const storage = { enabled: true, uploadImage: async () => 'https://cdn.example.com/' + K('9'), deleteImage: async u => { deleted.push(u); } };
  const gen = async () => ['data:image/png;base64,QUJD'];
  const r = await makeProcessImage({ generate: gen, storage, track: async (u, url) => { tracked.push([u, url]); } })({ userId: 'u1', params: {} });
  assert.deepEqual(tracked, [['u1', 'https://cdn.example.com/' + K('9')]]); assert.equal(r.urls.length, 1);
  await assert.rejects(makeProcessImage({ generate: gen, storage, track: async () => { throw new Error('db down'); } })({ userId: 'u1', params: {} }), /could not be recorded, so it was removed: db down/);
  assert.deepEqual(deleted, ['https://cdn.example.com/' + K('9')]);
  const r2 = await makeProcessImage({ generate: gen, storage: { ...storage, deleteImage: async () => { throw new Error('x'); } }, track: async () => { throw new Error('db down'); } })({ userId: 'u1', params: {} }).catch(e => e.message);
  assert.match(r2, /could not be recorded/, 'a failed cleanup does not hide the real error');
});

test('C.1 wiring: schema, GDPR export, account delete, worker job, config', () => {
  const sc = read('db/schema.sql'), ro = read('src/routes.js'), w = read('src/worker.js');
  assert.match(sc, /CREATE TABLE IF NOT EXISTS stored_images\(id serial PRIMARY KEY,user_id uuid REFERENCES users ON DELETE SET NULL,object_key text NOT NULL UNIQUE,/);
  assert.match(sc, /CREATE INDEX IF NOT EXISTS stored_images_due ON stored_images\(created_at\) WHERE deleted_at IS NULL/);
  assert.match(ro, /o\.stored_images=await q\('SELECT \* FROM stored_images WHERE user_id=\$1 ORDER BY id',\[req\.uid\]\)/, 'GDPR export lists stored_images');
  const del = ro.slice(ro.indexOf("del('/gdpr/account'")); assert.ok(del.indexOf('storedImages.purgeUser(req.uid)') > 0 && del.indexOf('storedImages.purgeUser(req.uid)') < del.indexOf("DELETE FROM users WHERE id=$1"), 'objects are purged before the user row is deleted');
  assert.match(w, /setInterval\(guard\('imagePurge',\(\)=>storedImages\.purgeDue\(\)\),36e5\)/); assert.match(w, /startImageJobs\(\);/);
  assert.match(w, /makeProcessImage\(\{generate:generateImage,storage,track:\(uid,url\)=>storedImages\.recordUrl\(uid,url\)\}\)/);
});

test('A.3 last_error: safe messages by failure type; never the raw error text', () => {
  const np = Object.assign(new Error('@x is not a public business or creator account (or the username does not exist), so Instagram does not share its public metrics.'), { code: NOT_PUBLIC_CODE });
  assert.deepEqual(scrapeErrorInfo(np), { code: NOT_PUBLIC_CODE, message: np.message });
  class IgNotConnected extends Error {}
  assert.equal(scrapeErrorInfo(new IgNotConnected('reconnect_needed')).code, 'instagram_reconnect');
  assert.equal(scrapeErrorInfo(Object.assign(new Error('Invalid OAuth access token EAAB123SECRET'), { tokenInvalid: true })).code, 'instagram_reconnect');
  assert.equal(scrapeErrorInfo(Object.assign(new Error('x'), { permission: true })).code, 'instagram_permission');
  assert.equal(scrapeErrorInfo(Object.assign(new Error('x'), { rateLimited: true })).code, 'instagram_rate_limited');
  for (const e of [new Error('connect ECONNREFUSED 10.0.0.5:5432 token=EAAB123SECRET'), null, undefined, 'str']) { const i = scrapeErrorInfo(e); assert.equal(i.code, 'scrape_failed'); assert.ok(!/ECONN|EAAB|10\.0/.test(i.message)); }
  assert.ok(scrapeErrorInfo(Object.assign(new Error('x'.repeat(900)), { code: NOT_PUBLIC_CODE })).message.length <= 300);
});
test('A.3 last_error: recordError writes code + safe message for that competitor and never throws; worker clears it on success and records on failure; UI shows it', async () => {
  const calls = []; const c = makeCompetitors({ q: async (sql, p) => { calls.push({ sql, p }); } });
  const r = await c.recordError(5, Object.assign(new Error('boom'), { code: NOT_PUBLIC_CODE }));
  assert.deepEqual(r, { stored: true, code: NOT_PUBLIC_CODE }); assert.match(calls[0].sql, /^UPDATE competitors SET last_error=\$2,last_error_code=\$3,last_error_at=now\(\) WHERE id=\$1$/); assert.equal(calls[0].p[0], 5); assert.equal(calls[0].p[2], NOT_PUBLIC_CODE);
  const bad = makeCompetitors({ q: async () => { throw new Error('db down'); } }); assert.deepEqual(await bad.recordError(5, new Error('x')), { stored: false, code: 'scrape_failed' });
  const w = read('src/worker.js'), ui = read('web/src/pages/Competitors.tsx'), sc = read('db/schema.sql');
  assert.match(w, /UPDATE competitors SET followers=\$1,last_scraped=now\(\),last_error=NULL,last_error_code=NULL,last_error_at=NULL WHERE id=\$2/);
  assert.match(w, /\.catch\(async e=>\{await competitors\.recordError\(j\.data\.competitorId,e\);throw e\.code===NOT_PUBLIC_CODE\?new UnrecoverableError\(e\.message\):e\}\)/);
  assert.match(sc, /ALTER TABLE competitors ADD COLUMN IF NOT EXISTS last_error text;/); assert.match(sc, /ADD COLUMN IF NOT EXISTS last_error_code text;/); assert.match(sc, /ADD COLUMN IF NOT EXISTS last_error_at timestamptz;/);
  assert.match(ui, /\{k:'last_error',l:'Status'/);
});
test('web/index.html title is RaidTechs', () => assert.match(read('web/index.html'), /<title>RaidTechs<\/title>/));
