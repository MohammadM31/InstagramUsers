// Roadmap C.1: public image storage. Instagram publishing needs a PUBLIC, JPEG-ONLY url that Meta can fetch (PDF section 5).
// Talks to any S3-compatible bucket (AWS S3, Cloudflare R2, MinIO, Backblaze) with a path-style PUT/DELETE signed with AWS Signature V4,
// so no new dependency is added. Pure parts (settings, signer, key and url helpers) are unit-tested; I/O gets injected fetch + convert.
import { createHash, createHmac, randomBytes } from 'node:crypto';

export const S3_VARS = ['S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_PUBLIC_BASE_URL'];
export const INPUT_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']; // what sharp can turn into JPEG for us
export const MAX_BYTES = 8 * 1024 * 1024; // Instagram's own limit for JPEG feed images is 8 MB
const PREFIX_RE = /^[a-z0-9][a-z0-9_-]{0,30}(\/[a-z0-9][a-z0-9_-]{0,30}){0,2}$/;
const KEY_RE = /^[a-z0-9_\/-]+\/[0-9a-f]{32}\.jpg$/;

const sha256 = d => createHash('sha256').update(d).digest('hex');
const hmac = (k, d) => createHmac('sha256', k).update(d).digest();
const isUrl = (s, https) => { try { const u = new URL(s); return https ? u.protocol === 'https:' : /^https?:$/.test(u.protocol); } catch { return false; } };

// Returns { settings } when fully configured, { settings: null } when not configured at all, and { problems } for a half-set config.
// A half-set config is a boot error (config.js), never a silent fallback to "no storage".
export function storageSettings(env = process.env) {
  const set = S3_VARS.filter(k => String(env[k] ?? '').trim() !== '');
  if (!set.length) return { settings: null, problems: [] };
  const problems = [];
  const missing = S3_VARS.filter(k => !set.includes(k));
  if (missing.length) problems.push(`S3 storage is half configured: also set ${missing.join(', ')} (or clear all S3_* variables)`);
  const prod = env.NODE_ENV === 'production';
  if (env.S3_ENDPOINT && !isUrl(env.S3_ENDPOINT.trim(), prod)) problems.push(`S3_ENDPOINT must be a ${prod ? 'https ' : ''}URL`);
  if (env.S3_PUBLIC_BASE_URL && !isUrl(env.S3_PUBLIC_BASE_URL.trim(), prod)) problems.push(`S3_PUBLIC_BASE_URL must be a ${prod ? 'https ' : ''}URL that anyone (Instagram) can open`);
  if (env.S3_BUCKET && !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(env.S3_BUCKET.trim())) problems.push('S3_BUCKET is not a valid bucket name');
  if (problems.length) return { settings: null, problems };
  const t = k => env[k].trim().replace(/\/+$/, '');
  return { settings: { endpoint: t('S3_ENDPOINT'), region: env.S3_REGION.trim(), bucket: env.S3_BUCKET.trim(), accessKeyId: env.S3_ACCESS_KEY_ID.trim(), secretAccessKey: env.S3_SECRET_ACCESS_KEY.trim(), publicBase: t('S3_PUBLIC_BASE_URL') }, problems: [] };
}

// AWS Signature V4 for S3 (UNSIGNED chunking not used: the body hash is sent in x-amz-content-sha256). Returns the headers to send.
// `headers` are signed too (lower-cased names). Verified against the AWS documentation example in test/storage.test.js.
export function signV4({ method, url, headers = {}, payloadHash, region, service = 's3', accessKeyId, secretAccessKey, date }) {
  const u = new URL(url);
  const amz = date.toISOString().replace(/[:-]|\.\d{3}/g, ''), day = amz.slice(0, 8);
  const h = { host: u.host };
  for (const [k, v] of Object.entries(headers)) h[k.toLowerCase()] = String(v).trim().replace(/\s+/g, ' ');
  h['x-amz-content-sha256'] = payloadHash; h['x-amz-date'] = amz;
  const names = Object.keys(h).sort();
  const canonQuery = [...u.searchParams.entries()].map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)]).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1).map(p => p.join('=')).join('&');
  const canonical = [method, u.pathname, canonQuery, names.map(n => `${n}:${h[n]}\n`).join(''), names.join(';'), payloadHash].join('\n');
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amz, scope, sha256(canonical)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac('AWS4' + secretAccessKey, day), region), service), 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(toSign).digest('hex');
  const out = { ...h, authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}` };
  delete out.host; // fetch sets Host itself
  return out;
}

export const newKey = (prefix, rnd = randomBytes) => {
  if (!PREFIX_RE.test(prefix) || prefix.includes('..')) throw new Error('storage prefix must be lowercase letters, digits, - or _ (up to 3 levels)');
  return `${prefix}/${rnd(16).toString('hex')}.jpg`; // 128 random bits: unguessable, so a public url is not enumerable
};

// Default converter: any supported image -> JPEG (Instagram accepts JPEG only). sharp is loaded lazily so that tests and boot checks need no native module.
async function sharpJpeg(buffer) {
  const sharp = (await import('sharp')).default;
  return sharp(buffer).rotate().flatten({ background: '#ffffff' }).jpeg({ quality: 90, mozjpeg: true }).toBuffer(); // flatten: JPEG has no alpha; rotate: honour EXIF
}

export function makeStorage({ env = process.env, fetch: f = globalThis.fetch, convert = sharpJpeg, now = () => new Date(), rnd = randomBytes } = {}) {
  const { settings, problems } = storageSettings(env);
  const enabled = !!settings;
  const need = () => { if (!settings) throw Object.assign(new Error(problems[0] || 'Image storage is not configured (set the S3_* variables)'), { status: 503 }); return settings; };
  const objectUrl = (s, key) => `${s.endpoint}/${s.bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;
  const publicUrl = (s, key) => `${s.publicBase}/${key}`;
  const call = async (s, method, key, body, headers) => {
    const url = objectUrl(s, key);
    const h = signV4({ method, url, headers, payloadHash: sha256(body || ''), region: s.region, accessKeyId: s.accessKeyId, secretAccessKey: s.secretAccessKey, date: now() });
    let r;
    try { r = await f(url, { method, headers: h, body: body || undefined, signal: AbortSignal.timeout(20000) }); }
    catch (e) { throw new Error(`Storage ${method} failed: ${e.message}`); }
    if (!(r.status >= 200 && r.status < 300)) { // 404 on delete is fine: the goal (gone) is reached
      if (method === 'DELETE' && r.status === 404) return r;
      let t = ''; try { t = (await r.text()).replace(/\s+/g, ' ').slice(0, 200); } catch {}
      throw new Error(`Storage ${method} was refused (HTTP ${r.status}${t ? ': ' + t : ''}). Check the S3_* settings and the bucket permissions.`);
    }
    return r;
  };
  return {
    enabled,
    // Returns the public https url of a JPEG copy. Throws (never returns a data URI or a half result) when storage is off or refuses.
    async uploadImage(buffer, mime, prefix = 'img') {
      const s = need();
      if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('uploadImage needs a non-empty Buffer');
      if (!INPUT_MIMES.includes(mime)) throw new Error(`Unsupported image type ${mime}: use ${INPUT_MIMES.join(', ')}`);
      if (buffer.length > 25 * 1024 * 1024) throw new Error('Image is too large to convert');
      const key = newKey(prefix, rnd);
      const jpeg = await convert(buffer, mime);
      if (!Buffer.isBuffer(jpeg) || jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('Conversion did not produce a JPEG');
      if (jpeg.length > MAX_BYTES) throw new Error('Converted image is over 8 MB, which Instagram refuses');
      await call(s, 'PUT', key, jpeg, { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable' });
      return publicUrl(s, key);
    },
    // Accepts the key or the public url this module returned. Refuses anything that is not one of its own keys.
    async deleteImage(keyOrUrl) {
      const s = need();
      const key = keyFromUrl(s, keyOrUrl);
      if (!key) throw new Error('deleteImage: not a key or url created by this storage');
      await call(s, 'DELETE', key);
      return true;
    },
    keyFromUrl: u => (settings ? keyFromUrl(settings, u) : null),
  };
}

export function keyFromUrl(settings, v) {
  let key = String(v || '');
  const base = settings.publicBase + '/';
  if (key.startsWith(base)) key = key.slice(base.length);
  return KEY_RE.test(key) ? key : null;
}
