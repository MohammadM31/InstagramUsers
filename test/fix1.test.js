// Phase 1 fix patch: one test group per fixed bug. All pure (no Postgres, no Redis, no network).
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../src/csv.js';
import { normalizePosts, parseDate, dedupeRows, METRICS } from '../src/importer.js';
import { makeProcessImport, INSERT_SQL, REFRESH_SQL } from '../src/importjob.js';
import { makeSchedule, parseWhen } from '../src/schedule.js';
import { envProblems } from '../src/config.js';

// ---------- fake pg pool: records every statement and its parameters ----------
function fakePool({ failOn } = {}) {
  const calls = [];
  const client = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (failOn && sql.includes(failOn)) throw new Error('boom');
      return { rowCount: 1, rows: [] };
    },
    release() { calls.push({ released: true }); },
  };
  return { calls, db: { connect: async () => client } };
}
const logs = [];
const run = (pool, job) => makeProcessImport({ db: pool.db, q: async (s, p) => { logs.push([s, p]); return []; }, own: async () => [] })(job);
const col = (params, name) => params[1 + ['type', 'posted_at', ...METRICS, 'caption'].indexOf(name)]; // params[0] is the user id

// ============ 1. 0.1b: a missing metric must never overwrite a stored one ============
test('0.1b normalize: columns absent from the file are listed as missing; explicit 0 is not', () => {
  const { rows } = normalizePosts(parseCsv('date,type,likes,reach,caption\n2026-10-01,reel,50,1000,hi\n'));
  assert.deepEqual(rows[0].missing.sort(), ['comments', 'impressions', 'saves', 'shares', 'watch_s']);
  const z = normalizePosts([{ posted_at: '2026-10-01', type: 'reel', likes: 5, saves: 0, shares: null, reach: 100 }]).rows[0];
  assert.ok(!z.missing.includes('saves'), 'an explicit 0 is a real value');
  assert.ok(z.missing.includes('shares'), 'null means missing');
  assert.equal(z.saves, 0);
});
test('0.1b refresh import sends NULL (not 0) for every metric the file lacked, and the SQL keeps the stored value for NULL', async () => {
  const pool = fakePool();
  const r = await run(pool, { userId: 'u1', source: 'csv', update: true, rows: parseCsv('date,type,likes,reach,caption\n2026-10-01,reel,50,1000,hi\n') });
  const stmts = pool.calls.filter(c => c.sql);
  const refresh = stmts.find(c => c.sql === REFRESH_SQL);
  assert.ok(refresh, 'refresh statement ran');
  for (const k of ['comments', 'saves', 'shares', 'impressions', 'watch_s']) assert.deepEqual(col(refresh.params, k), [null], k + ' must be NULL = "do not change"');
  assert.deepEqual(col(refresh.params, 'likes'), [50]); assert.deepEqual(col(refresh.params, 'reach'), [1000]);
  for (const k of METRICS) assert.match(REFRESH_SQL, new RegExp(`${k}=coalesce\\(v\\.${k},p\\.${k}\\)`), k);
  assert.doesNotMatch(REFRESH_SQL, /EXCLUDED/i); assert.doesNotMatch(REFRESH_SQL, /ON CONFLICT/i);
  // brand-new posts still get 0 for absent metrics (engagement sums must not hit NULL)
  const ins = stmts.find(c => c.sql === INSERT_SQL);
  assert.deepEqual(col(ins.params, 'saves'), [0]);
  assert.equal(r.mode, 'update');
});
test('0.1b refresh import: an explicit 0 in the file still overwrites (it is a real value)', async () => {
  const pool = fakePool();
  await run(pool, { userId: 'u1', source: 'json', update: true, rows: [{ posted_at: '2026-10-01T10:00:00Z', type: 'REEL', likes: 5, saves: 0, reach: 100, caption: 'x' }] });
  const refresh = pool.calls.find(c => c.sql === REFRESH_SQL);
  assert.deepEqual(col(refresh.params, 'saves'), [0]);
  assert.deepEqual(col(refresh.params, 'shares'), [null]);
});
test('0.1b duplicates inside one refresh file merge: a later row that lacks a metric keeps the earlier value', () => {
  const a = normalizePosts([{ posted_at: '2026-10-01T10:00:00Z', type: 'REEL', likes: 5, saves: 9, reach: 100, caption: 'x' }]).rows[0];
  const b = normalizePosts([{ posted_at: '2026-10-01T10:00:00Z', type: 'REEL', likes: 7, reach: 120, caption: 'x' }]).rows[0];
  const [m] = dedupeRows([a, b], true);
  assert.equal(m.likes, 7); assert.equal(m.reach, 120); assert.equal(m.saves, 9);
  assert.ok(!m.missing.includes('saves')); assert.ok(m.missing.includes('shares'));
});
test('0.1b skip mode never runs the refresh statement; failures roll back and release the connection', async () => {
  const skip = fakePool();
  const r = await run(skip, { userId: 'u1', source: 'json', rows: [{ posted_at: '2026-10-01T10:00:00Z', type: 'REEL', likes: 5, reach: 100, caption: 'x' }] });
  assert.ok(!skip.calls.some(c => c.sql === REFRESH_SQL)); assert.equal(r.mode, 'skip');
  const bad = fakePool({ failOn: 'INSERT INTO posts' });
  await assert.rejects(run(bad, { userId: 'u1', source: 'json', rows: [{ posted_at: '2026-10-01T10:00:00Z', type: 'REEL', reach: 100 }] }), /boom/);
  assert.ok(bad.calls.some(c => c.sql === 'ROLLBACK')); assert.ok(bad.calls.some(c => c.released));
});

// ============ 2. ambiguous slash dates are rejected, never guessed ============
test('dates: ambiguous day/month is rejected with a message that suggests ISO', () => {
  for (const v of ['01/10/2026', '1/10/2026', '01-10-2026', '01.10.2026', '12/11/2026 10:30']) {
    const r = parseDate(v); assert.ok(r.error && !r.date, v); assert.match(r.error, /ISO|2026-10-01/, v);
  }
  assert.match(parseDate('01/10/2026').error, /ambiguous/);
  for (const v of ['01/10/26', '1/2/3']) { const r = parseDate(v); assert.ok(!r.date || r.date.getFullYear() < 2010, v); }
  assert.ok(parseDate('01/10/26').error);
  const { rows, invalid } = normalizePosts([{ posted_at: '01/10/2026', type: 'reel', reach: 10 }]);
  assert.equal(rows.length, 0); assert.equal(invalid.length, 1); assert.match(invalid[0].reason, /ambiguous/);
});
test('dates: unambiguous slash dates and ISO dates are accepted', () => {
  const iso = s => parseDate(s).date?.toISOString();
  assert.equal(iso('13/10/2026'), '2026-10-13T00:00:00.000Z');       // day-first, 13 cannot be a month
  assert.equal(iso('10/13/2026'), '2026-10-13T00:00:00.000Z');       // month-first, 13 cannot be a month
  assert.equal(iso('05/05/2026'), '2026-05-05T00:00:00.000Z');       // same either way
  assert.equal(iso('13/10/2026 6:30 PM'), '2026-10-13T18:30:00.000Z');
  assert.equal(iso('13.10.2026 18:30'), '2026-10-13T18:30:00.000Z');
  assert.equal(iso('2026-10-01'), '2026-10-01T00:00:00.000Z');
  assert.equal(iso('2026/10/01'), '2026-10-01T00:00:00.000Z');
  assert.equal(iso('2026-10-01T10:00:00Z'), '2026-10-01T10:00:00.000Z');
  assert.ok(parseDate('31/02/2026').error, 'no such day');
  assert.ok(parseDate('13/10/2026 25:00').error, 'bad time');
  assert.ok(parseDate('nope').error); assert.ok(parseDate(undefined).error);
});

// ============ 3. type aliases ============
test('types: IG Reel, Reel and Story are accepted; the old mappings and rejections still hold', () => {
  const t = v => { const r = normalizePosts([{ posted_at: '2026-10-01', type: v, reach: 10 }]); return r.rows[0]?.type ?? 'REJECTED'; };
  assert.equal(t('IG Reel'), 'REEL'); assert.equal(t('Reel'), 'REEL'); assert.equal(t('Reels'), 'REEL');
  assert.equal(t('Story'), 'IMAGE'); assert.equal(t('stories'), 'IMAGE');
  assert.equal(t('Carousel'), 'CAROUSEL_ALBUM'); assert.equal(t('CAROUSEL_ALBUM'), 'CAROUSEL_ALBUM');
  assert.equal(t('Photo'), 'IMAGE'); assert.equal(t('VIDEO'), 'REEL');
  assert.equal(t('podcast'), 'REJECTED');
});

// ============ 4. /schedule validates dates (400, not 500) ============
const res = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; } });
test('/schedule POST: an invalid date is a 400 and never reaches the database', async () => {
  const calls = []; const { create } = makeSchedule({ q: async (...a) => { calls.push(a); return [{ id: 1 }]; } });
  for (const scheduledAt of ['not a date', '2026-13-45', '31/31/2026', {}, 12345, ' ']) {
    const r = res(); await create({ uid: 'u', body: { caption: 'hi', scheduledAt } }, r);
    assert.equal(r.code, 400, JSON.stringify(scheduledAt)); assert.ok(r.body.error);
  }
  assert.equal(calls.length, 0);
  const r = res(); await create({ uid: 'u', body: { caption: 'hi' } }, r); assert.equal(r.code, 400); // still required
});
test('/schedule POST: a valid date is stored as an ISO string', async () => {
  const calls = []; const { create } = makeSchedule({ q: async (...a) => { calls.push(a); return [{ id: 7 }]; } });
  const r = res(); await create({ uid: 'u', body: { caption: 'hi', scheduledAt: '2026-10-20T09:00:00+03:00' } }, r);
  assert.equal(r.code, 200); assert.deepEqual(r.body, { id: 7 });
  assert.equal(calls[0][1][4], '2026-10-20T06:00:00.000Z');
});
test('/schedule PATCH: invalid date is a 400; omitted date still means "now"', async () => {
  const calls = []; const { update } = makeSchedule({ q: async (...a) => { calls.push(a); return []; } });
  let r = res(); await update({ uid: 'u', params: { id: '3' }, body: { scheduledAt: 'garbage' } }, r);
  assert.equal(r.code, 400); assert.equal(calls.length, 0);
  r = res(); await update({ uid: 'u', params: { id: '3' }, body: {} }, r);
  assert.equal(r.code, 200); assert.equal(calls[0][1][2], null);
  assert.equal(parseWhen('2026-10-01T10:00:00Z'), '2026-10-01T10:00:00.000Z'); assert.equal(parseWhen(null), null);
});

// ============ small fixes ============
test('error row numbers are the real ones: CSV = file line (header is line 1, blank lines and quoted newlines counted), JSON = position from 1', () => {
  const csv = 'date,type,likes,reach,caption\r\n\r\n2026-10-01,reel,5,100,"two\nlines"\r\n01/10/2026,reel,5,100,x\r\n2026-10-02,reel,5,0,y\r\n';
  const { invalid } = normalizePosts(parseCsv(csv));
  assert.deepEqual(invalid.map(x => x.row), [5, 6]);
  const j = normalizePosts([{ posted_at: '2026-10-01', type: 'reel', reach: 5 }, { posted_at: 'nope', reach: 5 }]).invalid;
  assert.deepEqual(j.map(x => x.row), [2]);
});
test('config: a REPLACE_ME placeholder JWT_SECRET is rejected in every environment (it is longer than 32 chars)', () => {
  const ok = { JWT_SECRET: 'j'.repeat(40), ENCRYPTION_KEY: 'ab'.repeat(32), DATABASE_URL: 'postgres://x' };
  const js = 'REPLACE_ME_WITH_A_RANDOM_STRING_OF_32_OR_MORE_CHARS';
  assert.ok(js.length >= 32);
  assert.match(envProblems({ ...ok, JWT_SECRET: js }).join(), /placeholder/);
  assert.match(envProblems({ ...ok, ENCRYPTION_KEY: 'REPLACE_ME_WITH_64_HEX_CHARS' }).join(), /ENCRYPTION_KEY is malformed/);
  assert.deepEqual(envProblems(ok), []);
});
