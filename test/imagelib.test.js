// Image library (parallel contract 3.2, 4.1-4.3, 4.6). Fake q (an in-memory model of the exact statements in imagelib.js SQL) and REAL sharp on tiny
// generated images. NOT covered here (needs real services): the SQL itself against Postgres (each statement is pinned by a text check and
// executed through the model instead), Redis/BullMQ, Replicate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { makeImageLib, registerImageLibraryRoutes, ratioOf, decodeDataUrl, SQL, MAX_UPLOAD_BYTES, MAX_IDS, THUMB_WIDTH } from '../src/imagelib.js';
import { makeProcessImage } from '../src/imageresult.js';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const png = async (w = 100, h = 60, bg = { r: 200, g: 30, b: 30 }) => sharp({ create: { width: w, height: h, channels: 3, background: bg } }).png().toBuffer();
const url = (buf, mime = 'image/png') => `data:${mime};base64,${buf.toString('base64')}`;
const pngUrl = async (...a) => url(await png(...a));

// JPEG component sampling factors from the SOF marker: 4:4:4 = every component 0x11, 4:2:0 = first component 0x22.
function sampling(buf) {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) { const n = buf[i + 9]; return Array.from({ length: n }, (_, c) => buf[i + 10 + c * 3 + 1]); }
    i += 2 + buf.readUInt16BE(i + 2);
  }
}

// In-memory model of the statements in SQL. Time is an integer of microseconds so cursor precision is testable.
function model() {
  const rows = []; let t = 1_700_000_000_000_000; const log = [];
  const cur = us => { const ms = Math.floor(us / 1000), frac = String(us % 1_000_000).padStart(6, '0'); return new Date(ms).toISOString().slice(0, 19) + '.' + frac + 'Z'; };
  const parse = s => Date.parse(s.slice(0, 19) + 'Z') * 1000 + Number(s.slice(20, 26));
  const out = r => ({ id: r.id, kind: r.kind, prompt: r.prompt, instruction: r.instruction, ratio: r.ratio, parent_image_id: r.parent_image_id, conversation_id: r.conversation_id, created_at: new Date(Math.floor(r.t / 1000)), thumb: r.thumb, cur: cur(r.t) });
  const q = async (sql, p = []) => {
    log.push({ sql, p });
    if (q.fail) throw new Error(q.fail);
    if (sql === SQL.insertGenerated) {
      const [user_id, job_id, idx, conversation_id, parent_image_id, kind, prompt, instruction, ratio, mdl, bytes, thumb, width, height] = p;
      if (job_id != null && rows.some(r => r.job_id === job_id && r.idx === idx)) return []; // ON CONFLICT (job_id,idx) WHERE job_id IS NOT NULL DO NOTHING
      const r = { id: randomUUID(), user_id, job_id, idx, conversation_id, parent_image_id, kind, prompt, instruction, ratio, model: mdl, mime: 'image/jpeg', bytes, thumb, width, height, t: t += q.step ?? 1000 };
      rows.push(r); return [{ id: r.id }];
    }
    if (sql === SQL.existing) return rows.filter(r => r.user_id === p[0] && r.job_id === p[1] && r.idx === p[2]).map(r => ({ id: r.id }));
    if (sql === SQL.insertUpload) {
      const [user_id, ratio, bytes, thumb, width, height] = p;
      const r = { id: randomUUID(), user_id, job_id: null, idx: 0, conversation_id: null, parent_image_id: null, kind: 'upload', prompt: null, instruction: null, ratio, model: null, mime: 'image/jpeg', bytes, thumb, width, height, t: t += q.step ?? 1000 };
      rows.push(r); return [{ id: r.id }];
    }
    if (sql === SQL.list) {
      const [uid, before, n] = p, b = before == null ? null : parse(before);
      return rows.filter(r => r.user_id === uid && (b === null || r.t < b)).sort((x, y) => y.t - x.t || (y.id < x.id ? -1 : 1)).slice(0, n).map(out);
    }
    if (sql === SQL.byIds) return rows.filter(r => r.user_id === p[0] && p[1].includes(r.id)).map(out);
    if (sql === SQL.one) return rows.filter(r => r.user_id === p[0] && r.id === p[1]).map(r => ({ id: r.id, kind: r.kind, ratio: r.ratio, width: r.width, height: r.height, prompt: r.prompt, created_at: new Date(Math.floor(r.t / 1000)), mime: r.mime, bytes: r.bytes }));
    if (sql === SQL.ref) return rows.filter(r => r.user_id === p[0] && r.id === p[1]).map(r => ({ mime: r.mime, bytes: r.bytes }));
    throw new Error('unexpected sql ' + sql);
  };
  q.rows = rows; q.log = log; return q;
}

function harness(q) {
  const routes = {}, limits = [];
  const reg = m => (p, ...f) => { routes[m + ' ' + p] = f; };
  const lib = registerImageLibraryRoutes({ get: reg('GET'), post: reg('POST'), patch: () => { throw new Error('no patch route in v1'); }, del: () => { throw new Error('no delete route in v1'); }, q, sharp, limit: (n, max, w) => { limits.push([n, max, w]); return 'LIMIT_MW'; } });
  async function call(key, { uid = A, query = {}, params = {}, body } = {}) {
    const f = routes[key]; const res = { statusCode: 200, body: undefined, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    await f[f.length - 1]({ uid, query, params, body }, res); return res;
  }
  return { routes, limits, lib, call };
}

test('ratioOf: supported ratios, near-misses, common shapes and a fallback', () => {
  assert.equal(ratioOf(1080, 1080), '1:1'); assert.equal(ratioOf(1080, 1350), '4:5'); assert.equal(ratioOf(1080, 1920), '9:16');
  assert.equal(ratioOf(1079, 1349), '4:5', 'a pixel off is still 4:5'); assert.equal(ratioOf(1920, 1080), '16:9'); assert.equal(ratioOf(4000, 3000), '4:3');
  assert.equal(ratioOf(1000, 600), '1.67:1'); assert.equal(ratioOf(600, 1000), '1:1.67');
  assert.equal(ratioOf(0, 10), null); assert.equal(ratioOf(undefined, 10), null);
});

test('upload: full image is JPEG 4:4:4 q95 with real size, thumb is 384 wide JPEG, response is { id, thumb, ratio }', async () => {
  const q = model(), lib = makeImageLib({ q, sharp });
  const r = await lib.saveUpload(A, await pngUrl(100, 60));
  assert.deepEqual(Object.keys(r).sort(), ['id', 'ratio', 'thumb']); assert.match(r.thumb, /^data:image\/jpeg;base64,/); assert.equal(r.ratio, '1.67:1');
  const row = q.rows[0];
  assert.equal(row.kind, 'upload'); assert.equal(row.job_id, null); assert.equal(row.user_id, A); assert.equal(row.mime, 'image/jpeg');
  assert.deepEqual([row.width, row.height], [100, 60], 'dimensions recorded');
  assert.deepEqual([row.bytes[0], row.bytes[1]], [0xff, 0xd8], 'JPEG, not the uploaded PNG');
  const fm = await sharp(row.bytes).metadata(); assert.equal(fm.format, 'jpeg'); assert.deepEqual([fm.width, fm.height], [100, 60], 'full image is not resized');
  assert.deepEqual(sampling(row.bytes), [0x11, 0x11, 0x11], 'no chroma subsampling (4:4:4)');
  const control = await sharp(await png()).jpeg({ quality: 80, chromaSubsampling: '4:2:0' }).toBuffer(); assert.equal(sampling(control)[0], 0x22, 'the sampling helper really tells 4:2:0 apart');
  const tm = await sharp(row.thumb).metadata(); assert.equal(tm.format, 'jpeg'); assert.equal(tm.width, THUMB_WIDTH); assert.equal(THUMB_WIDTH, 384);
  assert.equal(tm.height, Math.round(384 * 60 / 100));
  // quality: q95 is clearly higher fidelity than the q78 thumb encoding of the same pixels
  const noisy = await sharp({ create: { width: 200, height: 200, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 40 } } }).png().toBuffer();
  const q2 = model(); await makeImageLib({ q: q2, sharp }).saveUpload(A, url(noisy));
  const q95 = await sharp(noisy).jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).toBuffer();
  assert.ok(Math.abs(q2.rows[0].bytes.length - q95.length) < q95.length * 0.05, 'stored size matches a q95 4:4:4 encode');
});

test('upload: EXIF orientation is applied (pixels upright, no orientation tag left); transparency is flattened onto white', async () => {
  const q = model(), lib = makeImageLib({ q, sharp });
  const exif = await sharp({ create: { width: 40, height: 20, channels: 3, background: { r: 0, g: 0, b: 255 } } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  assert.equal((await sharp(exif).metadata()).orientation, 6, 'test image really carries orientation 6');
  const r = await lib.saveUpload(A, url(exif, 'image/jpeg'));
  assert.deepEqual([q.rows[0].width, q.rows[0].height], [20, 40], 'landscape with orientation 6 is stored portrait');
  assert.equal(r.ratio, '1:2', 'ratio is computed from the rotated shape'); assert.equal((await sharp(q.rows[0].bytes).metadata()).orientation, undefined);
  const clear = await sharp({ create: { width: 10, height: 10, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  await lib.saveUpload(A, url(clear));
  const { data } = await sharp(q.rows[1].bytes).raw().toBuffer({ resolveWithObject: true });
  assert.ok(data[0] > 250 && data[1] > 250 && data[2] > 250, 'fully transparent pixels become white, not black');
  const webp = await sharp({ create: { width: 30, height: 30, channels: 3, background: '#00ff00' } }).webp().toBuffer();
  await lib.saveUpload(A, url(webp, 'image/webp')); assert.equal(q.rows.length, 3, 'webp accepted');
});

test('upload: wrong type, wrong bytes, bad base64, over 6 MB and missing input are 400 with a clear message and store nothing', async () => {
  const q = model(), lib = makeImageLib({ q, sharp }); const good = (await png()).toString('base64');
  const cases = [
    [`data:image/gif;base64,${good}`, /Only PNG, JPEG or WebP/], [`data:image/svg+xml;base64,${good}`, /Only PNG, JPEG or WebP/], [`data:application/pdf;base64,${good}`, /Only PNG, JPEG or WebP/],
    ['not a data url', /base64 data URL/], [`data:image/png,${good}`, /base64 data URL/], [undefined, /dataUrl is required/], [42, /dataUrl is required/], ['', /dataUrl is required|base64 data URL/],
    ['data:image/png;base64,', /not valid base64|empty/], ['data:image/png;base64,@@@@', /not valid base64/],
    ['data:image/png;base64,' + Buffer.from('this is plain text, not an image').toString('base64'), /not a valid PNG, JPEG or WebP/],
    ['data:image/png;base64,' + 'A'.repeat(Math.ceil((MAX_UPLOAD_BYTES + 100) / 3) * 4), /too large.*6 MB/],
  ];
  for (const [v, re] of cases) await assert.rejects(lib.saveUpload(A, v), e => { assert.equal(e.status, 400, String(v).slice(0, 40)); assert.match(e.message, re, String(v).slice(0, 40)); return true; });
  const gifAsPng = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).gif().toBuffer();
  await assert.rejects(lib.saveUpload(A, url(gifAsPng, 'image/png')), e => e.status === 400 && /not a PNG, JPEG or WebP/.test(e.message), 'the bytes are checked, not just the declared type');
  assert.equal(q.rows.length, 0); assert.equal(q.log.length, 0, 'rejected before any database call');
  // exactly at the limit is fine for the size check itself
  assert.doesNotThrow(() => decodeDataUrl('data:image/png;base64,' + 'A'.repeat(100)));
});

test('saveGenerated: stores job_id, idx, kind, prompt, instruction, ratio, model, conversation and parent from meta; retries are idempotent and ids align', async () => {
  const q = model(), lib = makeImageLib({ q, sharp }); const conv = randomUUID(), parent = randomUUID();
  const images = [await pngUrl(120, 150), await pngUrl(120, 150, { r: 0, g: 200, b: 0 })];
  const params = { prompt: 'ignored: meta wins', ratio: '4:5', model: 'flux-kontext-pro', edit: true, meta: { kind: 'edit', prompt: 'cafe photo', instruction: 'make the drink hot', conversationId: conv, parentImageId: parent } };
  const ids = await lib.saveGenerated(A, { jobId: '17', images, params });
  assert.equal(ids.length, 2); assert.notEqual(ids[0], ids[1]); assert.equal(q.rows.length, 2);
  const [r0, r1] = q.rows;
  assert.deepEqual([r0.id, r1.id], ids, 'imageIds[i] is the row of images[i]');
  assert.deepEqual([r0.job_id, r0.idx, r1.idx], ['17', 0, 1]);
  assert.deepEqual([r0.kind, r0.prompt, r0.instruction, r0.ratio, r0.model, r0.conversation_id, r0.parent_image_id], ['edit', 'cafe photo', 'make the drink hot', '4:5', 'flux-kontext-pro', conv, parent]);
  assert.deepEqual([r0.width, r0.height], [120, 150]); assert.deepEqual(sampling(r0.bytes), [0x11, 0x11, 0x11]); assert.equal((await sharp(r0.thumb).metadata()).width, 384);
  // BullMQ retry of the same job: same ids back, no new rows
  const again = await lib.saveGenerated(A, { jobId: '17', images, params });
  assert.deepEqual(again, ids); assert.equal(q.rows.length, 2, 'no duplicates');
  assert.match(SQL.insertGenerated, /ON CONFLICT \(job_id,idx\) WHERE job_id IS NOT NULL DO NOTHING RETURNING id$/);
  // no meta: kind from params.edit, ratio computed from the real shape when nothing was asked for, junk uuids are dropped instead of failing the insert
  const q2 = model(), l2 = makeImageLib({ q: q2, sharp });
  await l2.saveGenerated(A, { jobId: 'j2', images: [await pngUrl(200, 100)], params: { prompt: 'p', edit: true, meta: { conversationId: 'not-a-uuid', parentImageId: 5 } } });
  assert.deepEqual([q2.rows[0].kind, q2.rows[0].ratio, q2.rows[0].conversation_id, q2.rows[0].parent_image_id, q2.rows[0].prompt], ['edit', ratioOf(200, 100), null, null, 'p']);
  assert.equal((await l2.saveGenerated(A, { jobId: undefined, images: [await pngUrl(10, 10)], params: {} })).length, 1);
  assert.equal(q2.rows[1].job_id, null, 'no job id: stored without a job key');
  // a bad image anywhere means nothing is stored for the job (all encoded before the first insert)
  const q3 = model(), l3 = makeImageLib({ q: q3, sharp });
  await assert.rejects(l3.saveGenerated(A, { jobId: 'j3', images: [await pngUrl(10, 10), 'data:image/png;base64,QUJD'], params: {} })); assert.equal(q3.rows.length, 0);
});

test('ownership: every read is scoped to the user; foreign and unknown ids are absent (404 at the route), never data', async () => {
  const q = model(), h = harness(q);
  const mine = await h.lib.saveUpload(A, await pngUrl()), theirs = await h.lib.saveUpload(B, await pngUrl(60, 100));
  assert.equal(await h.lib.getFull(B, mine.id), null); assert.equal(await h.lib.resolveReference(B, mine.id), null); assert.equal(await h.lib.getFull(A, theirs.id), null);
  assert.equal(await h.lib.getFull(A, 'not-a-uuid'), null); assert.equal(await h.lib.getFull(A, randomUUID()), null);
  const full = await h.call('GET /images/:id', { uid: A, params: { id: mine.id } });
  assert.equal(full.statusCode, 200); assert.deepEqual(Object.keys(full.body).sort(), ['createdAt', 'dataUrl', 'height', 'id', 'kind', 'prompt', 'ratio', 'width']);
  assert.match(full.body.dataUrl, /^data:image\/jpeg;base64,/); assert.equal(full.body.width, 100); assert.equal(full.body.kind, 'upload');
  for (const [uid, id] of [[B, mine.id], [A, theirs.id], [A, randomUUID()], [A, 'nope'], [A, "' OR 1=1 --"]]) {
    const r = await h.call('GET /images/:id', { uid, params: { id } }); assert.equal(r.statusCode, 404); assert.ok(!JSON.stringify(r.body).includes('base64'));
  }
  assert.equal((await h.lib.list(B)).images.length, 1); assert.equal((await h.lib.list(B)).images[0].id, theirs.id);
  for (const st of ['list', 'byIds', 'one', 'ref', 'existing']) assert.match(SQL[st], /user_id=\$1/, st + ' filters by the user');
  assert.ok(Object.entries(SQL).filter(([k]) => !k.startsWith('insert')).every(([, s]) => /user_id=\$1/.test(s)), 'no read statement without a user filter');
});

test('GET /images?ids=: exactly the owned ones in the order asked, duplicates collapsed, max 40, malformed ids are 400', async () => {
  const q = model(), h = harness(q);
  const a1 = await h.lib.saveUpload(A, await pngUrl()), a2 = await h.lib.saveUpload(A, await pngUrl()), b1 = await h.lib.saveUpload(B, await pngUrl());
  const r = await h.call('GET /images', { uid: A, query: { ids: [a2.id, b1.id, randomUUID(), a1.id, a2.id].join(',') } });
  assert.equal(r.statusCode, 200); assert.deepEqual(r.body.images.map(x => x.id), [a2.id, a1.id]); assert.equal(r.body.next, undefined);
  assert.ok(r.body.images.every(x => /^data:image\/jpeg;base64,/.test(x.thumb) && !('dataUrl' in x)));
  assert.deepEqual((await h.call('GET /images', { uid: A, query: { ids: b1.id } })).body, { images: [] }, 'someone else\'s id returns nothing, not an error');
  assert.deepEqual((await h.call('GET /images', { uid: A, query: { ids: '' } })).body, { images: [] });
  const many = Array.from({ length: MAX_IDS + 1 }, () => randomUUID()).join(',');
  const tooMany = await h.call('GET /images', { uid: A, query: { ids: many } }); assert.equal(tooMany.statusCode, 400); assert.match(tooMany.body.error, /at most 40/);
  const exactly = await h.call('GET /images', { uid: A, query: { ids: many.split(',').slice(0, 40).join(',') } }); assert.equal(exactly.statusCode, 200);
  const junk = await h.call('GET /images', { uid: A, query: { ids: a1.id + ',drop table' } }); assert.equal(junk.statusCode, 400); assert.match(junk.body.error, /ids must be/);
  assert.equal(MAX_IDS, 40);
});

test('GET /images pagination: default 40, newest first, next only when more, cursor keeps microseconds, never full bytes', async () => {
  const q = model(), h = harness(q); q.step = 1; // 1 microsecond apart: several rows share one millisecond
  const ids = []; for (let i = 0; i < 5; i++) ids.push((await h.lib.saveUpload(A, await pngUrl(20 + i, 20))).id);
  await h.lib.saveUpload(B, await pngUrl());
  const seen = []; let before; let pages = 0;
  for (;;) {
    const r = await h.call('GET /images', { uid: A, query: { limit: '2', ...(before ? { before } : {}) } }); pages++;
    assert.equal(r.statusCode, 200); seen.push(...r.body.images.map(x => x.id));
    if (!r.body.next) break;
    assert.match(r.body.next, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/); assert.equal(r.body.images.length, 2); before = r.body.next;
  }
  assert.deepEqual(seen, [...ids].reverse(), 'every row exactly once, newest first, even inside the same millisecond'); assert.equal(pages, 3);
  const all = await h.call('GET /images', { uid: A }); assert.equal(all.body.images.length, 5); assert.equal(all.body.next, undefined, 'no next when everything fit');
  assert.equal(q.log.at(-1).p[2], 41, 'default limit 40 (+1 to detect more)');
  await h.call('GET /images', { uid: A, query: { limit: '9999' } }); assert.equal(q.log.at(-1).p[2], 61, 'limit is capped at 60');
  await h.call('GET /images', { uid: A, query: { limit: 'abc' } }); assert.equal(q.log.at(-1).p[2], 41);
  const first = all.body.images[0]; assert.deepEqual(Object.keys(first).sort(), ['conversationId', 'createdAt', 'id', 'instruction', 'kind', 'parentImageId', 'prompt', 'ratio', 'thumb']);
  assert.ok(!JSON.stringify(all.body).includes('dataUrl'));
  for (const s of [SQL.list, SQL.byIds]) assert.ok(!/\bbytes\b/.test(s), 'list statements never select the full image');
  const badBefore = await h.call('GET /images', { uid: A, query: { before: 'yesterday' } }); assert.equal(badBefore.statusCode, 400); assert.match(badBefore.body.error, /before must be an ISO timestamp/);
});

test('POST /images/upload: 30 per hour limit on the route, 201 { id, thumb, ratio }, 400 on bad input, DB errors are not disguised as 400', async () => {
  const q = model(), h = harness(q);
  assert.deepEqual(h.limits, [['image-upload', 30, 3600]]); assert.equal(h.routes['POST /images/upload'][0], 'LIMIT_MW', 'limiter runs before the handler');
  const ok = await h.call('POST /images/upload', { uid: A, body: { dataUrl: await pngUrl(100, 125) } });
  assert.equal(ok.statusCode, 201); assert.deepEqual(Object.keys(ok.body).sort(), ['id', 'ratio', 'thumb']); assert.equal(ok.body.ratio, '4:5');
  const no = await h.call('POST /images/upload', { uid: A, body: { dataUrl: 'data:image/gif;base64,R0lGOD' } }); assert.equal(no.statusCode, 400); assert.match(no.body.error, /PNG, JPEG or WebP/);
  assert.equal((await h.call('POST /images/upload', { uid: A, body: undefined })).statusCode, 400);
  q.fail = 'db down'; await assert.rejects(h.call('POST /images/upload', { uid: A, body: { dataUrl: await pngUrl() } }), /db down/);
  assert.deepEqual(Object.keys(h.routes).sort(), ['GET /images', 'GET /images/:id', 'POST /images/upload'], 'no delete or patch route in v1');
});

// ---- worker: makeProcessImage with the real library on the model ----
async function workerRig({ lib: l = true, storage, log } = {}) {
  const q = model(), lib = makeImageLib({ q, sharp }), calls = [], logs = [];
  const generate = async p => { calls.push(p); return [await pngUrl(108, 135), await pngUrl(108, 135, { r: 5, g: 5, b: 200 })].slice(0, p.n || 1); };
  const proc = makeProcessImage({ generate, storage, lib: l ? lib : undefined, log: log || (m => logs.push(m)) });
  return { q, lib, calls, logs, proc };
}

test('worker: persists every image and returns { images, imageIds } aligned; urls are added when storage is on', async () => {
  const w = await workerRig(); const conv = randomUUID();
  const r = await w.proc({ userId: A, jobId: '55', params: { prompt: 'a latte', ratio: '4:5', n: 2, meta: { kind: 'generate', prompt: 'a latte', conversationId: conv } } });
  assert.deepEqual(Object.keys(r), ['images', 'imageIds']); assert.equal(r.images.length, 2); assert.equal(r.imageIds.length, 2);
  assert.deepEqual(w.q.rows.map(x => x.id), r.imageIds); assert.deepEqual(w.q.rows.map(x => [x.job_id, x.idx, x.kind, x.conversation_id]), [['55', 0, 'generate', conv], ['55', 1, 'generate', conv]]);
  assert.deepEqual(w.calls[0], { prompt: 'a latte', ratio: '4:5', n: 2, meta: { kind: 'generate', prompt: 'a latte', conversationId: conv }, uid: A }, 'generate got the params untouched plus uid');
  const again = await w.proc({ userId: A, jobId: '55', params: { prompt: 'a latte', ratio: '4:5', n: 2, meta: { kind: 'generate' } } });
  assert.deepEqual(again.imageIds, r.imageIds); assert.equal(w.q.rows.length, 2, 'a retried job adds no rows');
  const up = []; const s = await workerRig({ storage: { enabled: true, uploadImage: async () => { up.push(1); return 'https://cdn.example.com/img/' + up.length + '.jpg'; } } });
  const r2 = await s.proc({ userId: A, jobId: '56', params: { prompt: 'x', n: 2 } });
  assert.deepEqual(Object.keys(r2), ['images', 'urls', 'imageIds']); assert.equal(r2.urls.length, 2); assert.equal(r2.imageIds.length, 2);
  const failing = await workerRig({ storage: { enabled: true, uploadImage: async () => { throw new Error('Storage PUT was refused (HTTP 403)'); } } });
  await assert.rejects(failing.proc({ userId: A, jobId: '57', params: { prompt: 'x' } }), /HTTP 403/); assert.equal(failing.q.rows.length, 1, 'the image is in the library even though the bucket refused it');
});

test('worker: a referenceImageId owned by the user is resolved to referenceImage before generating; no default ratio is added on edits', async () => {
  const w = await workerRig(); const ref = await w.lib.saveUpload(A, await pngUrl(100, 125));
  const full = (await w.lib.getFull(A, ref.id)).dataUrl;
  const r = await w.proc({ userId: A, jobId: '60', params: { prompt: 'make it green', edit: true, referenceImageId: ref.id, referenceImage: 'data:image/png;base64,LEGACY', meta: { kind: 'edit', parentImageId: ref.id, instruction: 'make it green' } } });
  assert.equal(w.calls.length, 1); assert.equal(w.calls[0].referenceImage, full, 'the stored full image is what generation receives (the id wins over a legacy inline image)');
  assert.ok(!('ratio' in w.calls[0]), 'no ratio injected on an edit'); assert.equal(w.calls[0].uid, A);
  assert.equal(r.imageIds.length, 1); const row = w.q.rows.find(x => x.id === r.imageIds[0]);
  assert.deepEqual([row.kind, row.parent_image_id, row.instruction], ['edit', ref.id, 'make it green']); assert.equal(row.ratio, ratioOf(108, 135), 'no ratio asked: the real shape is recorded');
  await w.proc({ userId: A, jobId: '61', params: { prompt: 'x' } }); assert.ok(!('referenceImage' in w.calls[1]) && !('ratio' in w.calls[1]), 'no reference id: nothing is added');
});

test('worker: a missing, not-owned or malformed reference FAILS the job with a clear error and never generates (no spend)', async () => {
  const w = await workerRig(); const theirs = await w.lib.saveUpload(B, await pngUrl());
  for (const id of [randomUUID(), theirs.id, 'not-a-uuid']) {
    await assert.rejects(w.proc({ userId: A, jobId: '70', params: { prompt: 'edit', edit: true, referenceImageId: id } }), e => { assert.match(e.message, /reference image was not found in your library, so no image was generated/); assert.ok(!e.message.includes(theirs.id)); return true; }, id);
  }
  assert.equal(w.calls.length, 0, 'generate was never called'); assert.equal(w.q.rows.length, 1, 'nothing stored');
  const dbDown = await workerRig(); dbDown.q.fail = 'connection refused';
  await assert.rejects(dbDown.proc({ userId: A, jobId: '71', params: { prompt: 'e', referenceImageId: randomUUID() } }), /Could not load the reference image, so no image was generated: connection refused/); assert.equal(dbDown.calls.length, 0);
  const noLib = await workerRig({ lib: false });
  await assert.rejects(noLib.proc({ userId: A, jobId: '72', params: { prompt: 'e', referenceImageId: randomUUID() } }), /library is not available.*no image was generated/); assert.equal(noLib.calls.length, 0);
});

test('worker: if the library cannot store the images the job still returns them (never lose a paid generation) with empty imageIds, and logs', async () => {
  const w = await workerRig(); await w.proc({ userId: A, jobId: '80', params: { prompt: 'warm up' } }); w.q.fail = 'db down';
  const r = await w.proc({ userId: A, jobId: '81', params: { prompt: 'x', n: 2 } });
  assert.equal(r.images.length, 2); assert.deepEqual(r.imageIds, []); assert.equal(w.logs.length, 1); assert.match(w.logs[0], /could not store the images of job 81: db down/);
  const odd = makeProcessImage({ generate: async () => ['data:image/png;base64,QUJD', await pngUrl()], lib: { saveGenerated: async () => ['only-one'] }, log: m => w.logs.push(m) });
  const r2 = await odd({ userId: A, jobId: '82', params: {} }); assert.deepEqual(r2.imageIds, [], 'a mismatched id list is never returned'); assert.equal(r2.images.length, 2);
  const junkImage = await workerRig(); const r3 = await makeProcessImage({ generate: async () => ['data:image/png;base64,QUJD'], lib: junkImage.lib, log: m => junkImage.logs.push(m) })({ userId: A, jobId: '83', params: {} });
  assert.deepEqual(r3, { images: ['data:image/png;base64,QUJD'], imageIds: [] }); assert.equal(junkImage.q.rows.length, 0);
});

test('worker: without a library the result is exactly the old shape (no imageIds key)', async () => {
  const w = await workerRig({ lib: false }); const r = await w.proc({ userId: A, params: { prompt: 'x' } });
  assert.deepEqual(Object.keys(r), ['images']); assert.deepEqual(w.calls[0], { prompt: 'x', uid: A });
});

test('wiring guards: schema is exactly contract 3.2 and idempotent, worker uses the library and job id, the library never touches bucket retention', () => {
  const norm = s => s.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').trim();
  const contract = read('docs/parallel/Contract.md'), sec = contract.slice(contract.indexOf('### 3.2'));
  const ddl = /```sql\n([\s\S]*?)```/.exec(sec)[1]; const schema = read('db/schema.imagelib.sql');
  assert.equal(norm(schema), norm(ddl), 'db/schema.imagelib.sql is the contract DDL, comments aside');
  assert.ok(/CREATE TABLE IF NOT EXISTS generated_images/.test(schema) && (schema.match(/CREATE (UNIQUE )?INDEX/g) || []).length === (schema.match(/CREATE (UNIQUE )?INDEX IF NOT EXISTS/g) || []).length, 'idempotent');
  const w = read('src/worker.js'), lib = read('src/imagelib.js'), res = read('src/imageresult.js');
  assert.match(w, /export const processImage=makeProcessImage\(\{generate:generateImage,storage,track:\(uid,url\)=>storedImages\.recordUrl\(uid,url\),lib:imageLib\}\);/);
  assert.match(w, /export const imageLib=makeImageLib\(\{q\}\);/); assert.match(w, /new Worker\('image',j=>processImage\(\{\.\.\.j\.data,jobId:String\(j\.id\)\}\)/);
  assert.ok(!/stored_images|IMAGE_RETENTION|storedimages|purgeDue|retentionDays/i.test(lib), 'the library has no dependency on the bucket retention purge');
  assert.ok(!/^import .*sharp/m.test(lib) && /await import\('sharp'\)/.test(lib), 'sharp is loaded lazily');
  assert.ok(!/Cache-Control|\.set\(|setHeader/.test(lib), 'no cache headers: the repo has none elsewhere');
  const pk = JSON.parse(read('package.json')); assert.ok(!('sharp-extra' in pk.dependencies)); assert.equal(Object.keys(pk.dependencies).length, 10, 'no new dependency');
});