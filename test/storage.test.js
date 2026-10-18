// Roadmap C.1: public image storage. Everything runs with a fake fetch and a fake JPEG converter: no bucket, no network, no sharp.
// NOT covered here (needs a real bucket and the sharp native module): an actual PUT to S3/R2 and the real PNG -> JPEG conversion.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { storageSettings, signV4, newKey, makeStorage, keyFromUrl, S3_VARS, MAX_BYTES } from '../src/storage.js';
import { makeProcessImage } from '../src/imageresult.js';
import { envProblems } from '../src/config.js';

const sha = b => createHash('sha256').update(b).digest('hex');
const ENV = { S3_ENDPOINT: 'https://s3.example.com/', S3_REGION: 'auto', S3_BUCKET: 'my-bucket', S3_ACCESS_KEY_ID: 'AKID123', S3_SECRET_ACCESS_KEY: 'topsecretvalue', S3_PUBLIC_BASE_URL: 'https://cdn.example.com/' };
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('fake-jpeg-body')]);
const PNG = Buffer.from('89504e470d0a1a0a0000', 'hex');
const convert = async () => JPEG;
function rig(over = {}) {
  const calls = [];
  const fetch = over.fetch || (async (url, init) => { calls.push({ url, ...init }); return { status: 200, text: async () => '' }; });
  const wrapped = async (url, init) => { if (!over.fetch) return fetch(url, init); calls.push({ url, ...init }); return over.fetch(url, init); };
  const st = makeStorage({ env: over.env || ENV, fetch: wrapped, convert: over.convert || convert, now: () => new Date('2026-10-17T12:00:00Z'), rnd: over.rnd });
  return { st, calls };
}

test('C.1 signer reproduces the AWS documentation example (GET Object with a Range header)', () => {
  const h = signV4({ method: 'GET', url: 'https://examplebucket.s3.amazonaws.com/test.txt', headers: { Range: 'bytes=0-9' },
    payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', region: 'us-east-1', accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', date: new Date('2013-05-24T00:00:00Z') });
  assert.match(h.authorization, /SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41$/);
  assert.equal(h['x-amz-date'], '20130524T000000Z');
  assert.equal(h.host, undefined, 'Host is left to fetch');
});
test('C.1 signature changes when the body hash, date, region or secret changes', () => {
  const base = { method: 'PUT', url: 'https://s3.example.com/b/k.jpg', payloadHash: sha('a'), region: 'auto', accessKeyId: 'A', secretAccessKey: 'S', date: new Date('2026-10-17T12:00:00Z') };
  const sig = o => signV4({ ...base, ...o }).authorization.split('Signature=')[1];
  const s0 = sig({});
  for (const o of [{ payloadHash: sha('b') }, { date: new Date('2026-10-18T12:00:00Z') }, { region: 'eu' }, { secretAccessKey: 'T' }, { method: 'DELETE' }, { url: 'https://s3.example.com/b/other.jpg' }]) assert.notEqual(sig(o), s0, JSON.stringify(o));
  assert.equal(sig({}), s0, 'deterministic');
});

test('C.1 settings: none set = off; half set = a problem naming what is missing; bad urls and bucket names are reported', () => {
  assert.deepEqual(storageSettings({}), { settings: null, problems: [] });
  assert.deepEqual(storageSettings({ S3_ENDPOINT: '', S3_BUCKET: '  ' }), { settings: null, problems: [] }, 'blank counts as unset');
  const half = storageSettings({ S3_BUCKET: 'b', S3_REGION: 'r' });
  assert.equal(half.settings, null); assert.match(half.problems[0], /half configured.*S3_ENDPOINT.*S3_ACCESS_KEY_ID.*S3_SECRET_ACCESS_KEY.*S3_PUBLIC_BASE_URL/);
  assert.match(storageSettings({ ...ENV, S3_ENDPOINT: 'not a url' }).problems.join(), /S3_ENDPOINT must be/);
  assert.match(storageSettings({ ...ENV, S3_PUBLIC_BASE_URL: 'ftp://x' }).problems.join(), /S3_PUBLIC_BASE_URL must be/);
  assert.match(storageSettings({ ...ENV, S3_BUCKET: 'Bad Bucket!' }).problems.join(), /bucket name/);
  assert.match(storageSettings({ ...ENV, NODE_ENV: 'production', S3_ENDPOINT: 'http://s3.example.com' }).problems.join(), /https/);
  assert.match(storageSettings({ ...ENV, NODE_ENV: 'production', S3_PUBLIC_BASE_URL: 'http://cdn.example.com' }).problems.join(), /https/);
  assert.equal(storageSettings({ ...ENV, S3_ENDPOINT: 'http://localhost:9000' }).problems.length, 0, 'plain http is fine for local MinIO outside production');
  const ok = storageSettings(ENV).settings;
  assert.equal(ok.endpoint, 'https://s3.example.com'); assert.equal(ok.publicBase, 'https://cdn.example.com', 'trailing slashes trimmed');
  assert.equal(S3_VARS.length, 6);
});
test('C.1 boot check: config.envProblems reports a half-set S3 config and stays quiet otherwise', () => {
  const ok = { JWT_SECRET: 'j'.repeat(40), ENCRYPTION_KEY: 'ab'.repeat(32), DATABASE_URL: 'postgres://x' };
  assert.deepEqual(envProblems(ok), []);
  assert.deepEqual(envProblems({ ...ok, ...ENV }), []);
  assert.match(envProblems({ ...ok, S3_BUCKET: 'b' }).join(), /half configured/);
});

test('C.1 keys: unguessable random name under a validated prefix, always .jpg', () => {
  const a = newKey('img'), b = newKey('img');
  assert.match(a, /^img\/[0-9a-f]{32}\.jpg$/); assert.notEqual(a, b);
  assert.equal(newKey('u/ab-1', () => Buffer.alloc(16, 1)), 'u/ab-1/' + '01'.repeat(16) + '.jpg');
  for (const bad of ['', '../x', 'a/../b', '/abs', 'UPPER', 'a b', 'a//b', 'a/b/c/d', 'x'.repeat(40)]) assert.throws(() => newKey(bad), /prefix/, bad);
});

test('C.1 upload: converts, PUTs a signed JPEG to a path-style url, returns the public url', async () => {
  const { st, calls } = rig({ rnd: () => Buffer.alloc(16, 0xab) });
  const url = await st.uploadImage(PNG, 'image/png', 'img');
  const key = 'img/' + 'ab'.repeat(16) + '.jpg';
  assert.equal(url, 'https://cdn.example.com/' + key);
  assert.equal(calls.length, 1); const c = calls[0];
  assert.equal(c.method, 'PUT'); assert.equal(c.url, 'https://s3.example.com/my-bucket/' + key);
  assert.deepEqual(c.body, JPEG, 'the converted JPEG is uploaded, not the PNG');
  assert.equal(c.headers['content-type'], 'image/jpeg');
  assert.equal(c.headers['x-amz-content-sha256'], sha(JPEG), 'signed body hash matches the bytes sent');
  assert.match(c.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKID123\/20261017\/auto\/s3\/aws4_request, SignedHeaders=cache-control;content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(c.headers).includes('topsecretvalue'), 'the secret key is never sent');
});
test('C.1 upload: two uploads never share a key (real randomness)', async () => {
  const { st } = rig(); const seen = new Set();
  for (let i = 0; i < 20; i++) seen.add(await st.uploadImage(PNG, 'image/png'));
  assert.equal(seen.size, 20);
});
test('C.1 upload refuses bad input before any network call', async () => {
  const { st, calls } = rig();
  await assert.rejects(st.uploadImage(PNG, 'image/svg+xml'), /Unsupported image type/);
  await assert.rejects(st.uploadImage(PNG, 'application/pdf'), /Unsupported image type/);
  await assert.rejects(st.uploadImage(Buffer.alloc(0), 'image/png'), /non-empty Buffer/);
  await assert.rejects(st.uploadImage('data:image/png;base64,xx', 'image/png'), /non-empty Buffer/);
  await assert.rejects(st.uploadImage(PNG, 'image/png', '../evil'), /prefix/);
  assert.equal(calls.length, 0);
});
test('C.1 upload refuses a converter result that is not a JPEG or is over 8 MB (Instagram would reject it later)', async () => {
  for (const [conv, re] of [[async () => Buffer.from('<html>'), /did not produce a JPEG/], [async () => 'nope', /did not produce a JPEG/],
    [async () => Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(MAX_BYTES)]), /over 8 MB/]]) {
    const { st, calls } = rig({ convert: conv });
    await assert.rejects(st.uploadImage(PNG, 'image/png'), re); assert.equal(calls.length, 0);
  }
});
test('C.1 upload fails loudly: refusal shows the HTTP status and a short reason, never the secret; network errors are named', async () => {
  const { st } = rig({ fetch: async () => ({ status: 403, text: async () => '<Error><Code>AccessDenied</Code>\n<Message>Access   Denied</Message></Error>' + 'x'.repeat(500) }) });
  await assert.rejects(st.uploadImage(PNG, 'image/png'), e => { assert.match(e.message, /refused \(HTTP 403: <Error><Code>AccessDenied<\/Code> <Message>Access Denied/); assert.ok(e.message.length < 400); assert.ok(!e.message.includes('topsecretvalue')); return true; });
  const r2 = rig({ fetch: async () => { throw new Error('ECONNREFUSED'); } });
  await assert.rejects(r2.st.uploadImage(PNG, 'image/png'), /Storage PUT failed: ECONNREFUSED/);
  const r3 = rig({ fetch: async () => ({ status: 500, text: async () => { throw new Error('boom'); } }) });
  await assert.rejects(r3.st.uploadImage(PNG, 'image/png'), /HTTP 500/);
});
test('C.1 not configured: enabled=false and every call fails with a 503 that says what to set (no silent data-URI fallback)', async () => {
  const { st, calls } = rig({ env: {} });
  assert.equal(st.enabled, false);
  await assert.rejects(st.uploadImage(PNG, 'image/png'), e => e.status === 503 && /S3_\*/.test(e.message));
  await assert.rejects(st.deleteImage('img/' + 'a'.repeat(32) + '.jpg'), e => e.status === 503);
  const half = rig({ env: { S3_BUCKET: 'b' } });
  assert.equal(half.st.enabled, false); await assert.rejects(half.st.uploadImage(PNG, 'image/png'), /half configured/);
  assert.equal(calls.length, 0);
});

test('C.1 delete: signed DELETE of our own key or url; 404 is fine; foreign keys and urls are refused', async () => {
  const key = 'img/' + 'cd'.repeat(16) + '.jpg';
  const { st, calls } = rig();
  assert.equal(await st.deleteImage(key), true); assert.equal(await st.deleteImage('https://cdn.example.com/' + key), true);
  assert.equal(calls[0].method, 'DELETE'); assert.equal(calls[0].url, 'https://s3.example.com/my-bucket/' + key); assert.equal(calls[0].body, undefined);
  assert.equal(calls[0].headers['x-amz-content-sha256'], sha(''));
  assert.equal(calls[1].url, calls[0].url);
  for (const bad of ['', 'img/../../x.jpg', 'https://evil.com/' + key, 'img/short.jpg', 'img/' + 'cd'.repeat(16) + '.png', '/etc/passwd']) await assert.rejects(st.deleteImage(bad), /not a key or url/, bad);
  assert.equal(calls.length, 2, 'refused deletes made no request');
  const gone = rig({ fetch: async () => ({ status: 404, text: async () => '' }) }); assert.equal(await gone.st.deleteImage(key), true);
  const denied = rig({ fetch: async () => ({ status: 403, text: async () => 'no' }) }); await assert.rejects(denied.st.deleteImage(key), /HTTP 403/);
  assert.equal(keyFromUrl({ publicBase: 'https://cdn.example.com' }, 'https://cdn.example.com/' + key), key);
  assert.equal(st.keyFromUrl('https://cdn.example.com/' + key), key); assert.equal(rig({ env: {} }).st.keyFromUrl(key), null);
});

test('C.1 image job: without storage the result is exactly the old shape', async () => {
  const gen = async p => { gen.p = p; return ['data:image/png;base64,QUJD']; };
  for (const storage of [undefined, null, { enabled: false, uploadImage: async () => { throw new Error('must not be called'); } }]) {
    const r = await makeProcessImage({ generate: gen, storage })({ userId: 7, params: { prompt: 'x' } });
    assert.deepEqual(r, { images: ['data:image/png;base64,QUJD'] }); assert.deepEqual(gen.p, { prompt: 'x', uid: 7 });
  }
});
test('C.1 image job: with storage each image is uploaded and urls line up with images (additive field)', async () => {
  const up = [];
  const storage = { enabled: true, uploadImage: async (buf, mime, prefix) => { up.push({ s: buf.toString(), mime, prefix }); return 'https://cdn.example.com/img/' + up.length + '.jpg'; } };
  const r = await makeProcessImage({ generate: async () => ['data:image/png;base64,QUJD', 'data:image/png;base64,REVG'], storage })({ userId: 1, params: {} });
  assert.deepEqual(r.images, ['data:image/png;base64,QUJD', 'data:image/png;base64,REVG']);
  assert.deepEqual(r.urls, ['https://cdn.example.com/img/1.jpg', 'https://cdn.example.com/img/2.jpg']);
  assert.deepEqual(up, [{ s: 'ABC', mime: 'image/png', prefix: 'img' }, { s: 'DEF', mime: 'image/png', prefix: 'img' }]);
});
test('C.1 image job: a refused upload fails the job; a non-data-URI result is not uploaded', async () => {
  const bad = { enabled: true, uploadImage: async () => { throw new Error('Storage PUT was refused (HTTP 403)'); } };
  await assert.rejects(makeProcessImage({ generate: async () => ['data:image/png;base64,QUJD'], storage: bad })({ userId: 1, params: {} }), /HTTP 403/);
  await assert.rejects(makeProcessImage({ generate: async () => ['https://x/y.png'], storage: { enabled: true, uploadImage: async () => 'u' } })({ userId: 1, params: {} }), /not a data URI/);
});

test('C.1 wiring guards: worker uses the factory, route adds urls only when present, sharp is loaded lazily, no new table or dependency', () => {
  const w = readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8'), r = readFileSync(new URL('../src/routes.js', import.meta.url), 'utf8');
  const s = readFileSync(new URL('../src/storage.js', import.meta.url), 'utf8'), pk = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(w, /export const processImage=makeProcessImage\(\{generate:generateImage,storage:makeStorage\(\)\}\)/);
  assert.match(r, /images:j\.returnvalue\.images,\.\.\.\(j\.returnvalue\.urls\?\{urls:j\.returnvalue\.urls\}:\{\}\)/);
  assert.ok(!/^import .*sharp/m.test(s) && /await import\('sharp'\)/.test(s), 'sharp is imported lazily so boot checks and tests need no native module');
  assert.ok(!/accessKeyId|secretAccessKey|SECRET/.test(r), 'routes never touch the credentials');
  assert.deepEqual(Object.keys(pk.dependencies).sort(), ['bcryptjs', 'bullmq', 'cors', 'express', 'express-rate-limit', 'helmet', 'ioredis', 'jsonwebtoken', 'pg', 'sharp']);
  assert.ok(pk.scripts.test.includes('test/storage.test.js'));
});
