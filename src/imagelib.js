// Persistent image library (parallel contract sections 3.2, 4.1-4.3, 4.6). Generated and uploaded images are stored per user in
// generated_images and are referenced by id. Library images live until the account is deleted (FK cascade). They deliberately do NOT use
// the bucket-object tracking or its age-based purge: this module only touches generated_images.
// I/O only; deps injected (makeX({q, sharp}) like the rest of the repo) so the logic runs in tests with a fake q and no Postgres.
// sharp is loaded lazily (same as storage.js) so boot checks and tests that never encode an image need no native module.

export const MAX_UPLOAD_BYTES = 6 * 1024 * 1024; // decoded size of an upload (contract 4.3)
export const MAX_GENERATED_BYTES = 40 * 1024 * 1024; // a paid generation must never be refused for size: far above any model output
export const MAX_PIXELS = 50e6; // decompression-bomb guard; covers 48 MP phone photos
export const THUMB_WIDTH = 384, FULL_QUALITY = 95, THUMB_QUALITY = 78;
export const DEFAULT_LIMIT = 40, MAX_LIMIT = 60, MAX_IDS = 40;
export const UPLOAD_LIMIT = { name: 'image-upload', max: 30, windowSec: 3600 }; // contract 4.3: 30 uploads per hour
const FORMATS = ['png', 'jpeg', 'webp']; // what sharp reports for the accepted types
const MIMES = ['image/png', 'image/jpeg', 'image/webp'];
const KINDS = ['generate', 'edit'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const HEAD_RE = /^data:([^;,]{1,60});base64,/;

// Every statement filters by user_id. List and batch statements never select `bytes` (the full image): only thumbs leave in lists.
// The cursor column keeps microseconds (a JS Date would cut them to milliseconds and could skip rows created within the same millisecond).
const LIST_COLS = `id,kind,prompt,instruction,ratio,parent_image_id,conversation_id,created_at,thumb,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') cur`;
export const SQL = {
  // The unique index on (job_id, idx) is partial, so the conflict target must repeat its predicate or Postgres cannot infer it.
  insertGenerated: `INSERT INTO generated_images(user_id,job_id,idx,conversation_id,parent_image_id,kind,prompt,instruction,ratio,model,mime,bytes,thumb,width,height) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'image/jpeg',$11,$12,$13,$14) ON CONFLICT (job_id,idx) WHERE job_id IS NOT NULL DO NOTHING RETURNING id`,
  existing: 'SELECT id FROM generated_images WHERE user_id=$1 AND job_id=$2 AND idx=$3',
  insertUpload: `INSERT INTO generated_images(user_id,kind,ratio,mime,bytes,thumb,width,height) VALUES($1,'upload',$2,'image/jpeg',$3,$4,$5,$6) RETURNING id`,
  list: `SELECT ${LIST_COLS} FROM generated_images WHERE user_id=$1 AND ($2::timestamptz IS NULL OR created_at<$2::timestamptz) ORDER BY created_at DESC,id DESC LIMIT $3`,
  byIds: `SELECT ${LIST_COLS} FROM generated_images WHERE user_id=$1 AND id=ANY($2::uuid[])`,
  one: 'SELECT id,kind,ratio,width,height,prompt,created_at,mime,bytes FROM generated_images WHERE user_id=$1 AND id=$2',
  ref: 'SELECT mime,bytes FROM generated_images WHERE user_id=$1 AND id=$2',
};

// A request problem the person can fix: the routes turn it into a 400 with this message.
const bad = msg => Object.assign(new Error(msg), { status: 400 });
export const isUuid = v => typeof v === 'string' && UUID_RE.test(v);
const uuidOrNull = v => (isUuid(v) ? v.toLowerCase() : null);
const text = (v, n) => (v == null || v === '' ? null : String(v).slice(0, n));
const dataUrl = (mime, buf) => `data:${mime};base64,${Buffer.from(buf).toString('base64')}`;

// "1:1", "4:5" and "9:16" are what generation uses; common photo shapes are named too; anything else becomes "1.37:1" / "1:1.37".
const KNOWN = [['1:1', 1], ['4:5', 0.8], ['9:16', 9 / 16], ['16:9', 16 / 9], ['4:3', 4 / 3], ['3:4', 0.75], ['3:2', 1.5], ['2:3', 2 / 3], ['5:4', 1.25], ['1.91:1', 1.91]];
export function ratioOf(w, h) {
  if (!(w > 0 && h > 0)) return null;
  const r = w / h; let best = null, bd = Infinity;
  for (const [name, v] of KNOWN) { const d = Math.abs(r - v) / v; if (d < bd) { bd = d; best = name; } }
  if (bd <= 0.02) return best; // 1079x1349 is still 4:5
  const t = n => String(+n.toFixed(2));
  return r >= 1 ? `${t(r)}:1` : `1:${t(1 / r)}`;
}

// Parses "data:image/png;base64,...". Checks type and size BEFORE decoding, so an oversized or wrong-type body costs almost nothing.
export function decodeDataUrl(value, { maxBytes = MAX_UPLOAD_BYTES, what = 'Image' } = {}) {
  if (typeof value !== 'string') throw bad('dataUrl is required: a base64 data URL such as data:image/png;base64,...');
  const h = HEAD_RE.exec(value.slice(0, 120));
  if (!h) throw bad('dataUrl must be a base64 data URL such as data:image/png;base64,...');
  const mime = h[1].toLowerCase();
  if (!MIMES.includes(mime)) throw bad(`Only PNG, JPEG or WebP images are accepted (got ${mime.slice(0, 40)}).`);
  const b64 = value.slice(h[0].length);
  const size = Math.floor(b64.length * 3 / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
  if (size > maxBytes) throw bad(`${what} is too large: the limit is ${Math.round(maxBytes / 1048576)} MB.`);
  if (!b64 || !B64_RE.test(b64)) throw bad('The image data is not valid base64.');
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length) throw bad('The image is empty.');
  return { mime, buf };
}

export function makeImageLib({ q, sharp } = {}) {
  let sh = sharp || null;
  const getSharp = async () => (sh ||= (await import('sharp')).default);

  // Full image -> JPEG q95 4:4:4 (no chroma subsampling, so repeated edits lose as little as possible); thumb -> 384 px wide JPEG q78.
  // Transparent PNG/WebP is flattened onto white (JPEG has no alpha; the default would be black). `rotate` applies the EXIF orientation:
  // we never write EXIF back, so the pixels must already be upright.
  async function normalize(buf, { rotate = false, strict = false } = {}) {
    const sharp = await getSharp();
    if (strict) { // uploads: trust the bytes, not the declared mime type
      let meta;
      try { meta = await sharp(buf, { limitInputPixels: MAX_PIXELS }).metadata(); }
      catch { throw bad('That file is not a valid PNG, JPEG or WebP image.'); }
      if (!FORMATS.includes(meta.format)) throw bad('That file is not a PNG, JPEG or WebP image.');
      if ((meta.width || 0) * (meta.height || 0) > MAX_PIXELS) throw bad('The image dimensions are too large (over 50 megapixels).');
    }
    try {
      let p = sharp(buf, { limitInputPixels: MAX_PIXELS });
      if (rotate) p = p.rotate();
      const { data, info } = await p.flatten({ background: '#ffffff' }).jpeg({ quality: FULL_QUALITY, chromaSubsampling: '4:4:4' }).toBuffer({ resolveWithObject: true });
      const thumb = await sharp(data).resize({ width: THUMB_WIDTH }).jpeg({ quality: THUMB_QUALITY }).toBuffer(); // always 384 wide, even if the source is smaller
      return { bytes: data, thumb, width: info.width, height: info.height };
    } catch (e) {
      if (strict) throw bad('That image could not be read. Try saving it again as PNG or JPEG.');
      throw e;
    }
  }

  const card = r => ({
    id: r.id, kind: r.kind, prompt: r.prompt ?? null, instruction: r.instruction ?? null, ratio: r.ratio ?? null,
    parentImageId: r.parent_image_id ?? null, conversationId: r.conversation_id ?? null,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at, thumb: dataUrl('image/jpeg', r.thumb),
  });

  return {
    normalize,

    // Worker path: store every image of one job. All images are encoded first (the part that can fail), then inserted, so a bad image
    // does not leave half a job behind. Inserts are idempotent: a retried job hits ON CONFLICT DO NOTHING and we read back the ids it
    // already has, so imageIds[i] always matches images[i] and a retry never duplicates. Throws on any failure (the caller decides what to do).
    async saveGenerated(userId, { jobId, images, params = {} }) {
      const m = params.meta && typeof params.meta === 'object' ? params.meta : {};
      const kind = KINDS.includes(m.kind) ? m.kind : params.edit ? 'edit' : 'generate';
      const job = jobId == null || jobId === '' ? null : String(jobId);
      const enc = [];
      for (const d of images) {
        const { buf } = decodeDataUrl(d, { maxBytes: MAX_GENERATED_BYTES, what: 'Generated image' });
        enc.push(await normalize(buf));
      }
      const ids = [];
      for (const [i, e] of enc.entries()) {
        // ratio: what was asked for; on an edit with no ratio the image keeps its native aspect, so record the real shape
        const ratio = text(m.ratio ?? params.ratio, 12) || ratioOf(e.width, e.height);
        const row = await q(SQL.insertGenerated, [userId, job, i, uuidOrNull(m.conversationId), uuidOrNull(m.parentImageId), kind,
          text(m.prompt ?? params.prompt, 2000), text(m.instruction ?? params.instruction, 2000), ratio, text(m.model ?? params.model, 100),
          e.bytes, e.thumb, e.width, e.height]);
        let id = row[0]?.id;
        if (!id && job) id = (await q(SQL.existing, [userId, job, i]))[0]?.id; // retry: already stored
        if (!id) throw new Error('image was not stored');
        ids.push(id);
      }
      return ids;
    },

    // POST /images/upload: validate, EXIF-rotate, re-encode, store. Returns what the contract promises: { id, thumb, ratio }.
    async saveUpload(userId, value) {
      const { buf } = decodeDataUrl(value);
      const e = await normalize(buf, { rotate: true, strict: true });
      const ratio = ratioOf(e.width, e.height);
      const [r] = await q(SQL.insertUpload, [userId, ratio, e.bytes, e.thumb, e.width, e.height]);
      return { id: r.id, thumb: dataUrl('image/jpeg', e.thumb), ratio };
    },

    // Full image of one of THIS user's images; null for unknown or foreign ids (the route answers 404 for both).
    async getFull(userId, id) {
      if (!isUuid(id)) return null;
      const [r] = await q(SQL.one, [userId, id.toLowerCase()]);
      if (!r) return null;
      return { id: r.id, kind: r.kind, ratio: r.ratio ?? null, width: r.width ?? null, height: r.height ?? null, prompt: r.prompt ?? null,
        createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at, dataUrl: dataUrl(r.mime || 'image/jpeg', r.bytes) };
    },

    // Newest first. `before` is the `next` value of the previous page. Thumbs only. `next` appears only when there is more.
    async list(userId, { limit, before } = {}) {
      let n = Number.parseInt(limit, 10);
      if (!(n >= 1)) n = DEFAULT_LIMIT;
      n = Math.min(n, MAX_LIMIT);
      let b = null;
      if (before != null && before !== '') {
        if (typeof before !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(before) || Number.isNaN(Date.parse(before))) throw bad('before must be an ISO timestamp, for example the next value of the previous page.');
        b = before;
      }
      const rows = await q(SQL.list, [userId, b, n + 1]);
      const page = rows.slice(0, n);
      const out = { images: page.map(card) };
      if (rows.length > n) out.next = page[page.length - 1].cur;
      return out;
    },

    // Batch thumbs: exactly the requested ids that belong to this user, in the order asked. Unknown and foreign ids are simply absent.
    async thumbsByIds(userId, ids) {
      const want = [...new Set((ids || []).filter(isUuid).map(s => s.toLowerCase()))];
      if (want.length > MAX_IDS) throw bad(`ids accepts at most ${MAX_IDS} ids.`);
      if (!want.length) return [];
      const rows = await q(SQL.byIds, [userId, want]);
      const by = new Map(rows.map(r => [String(r.id).toLowerCase(), r]));
      return want.filter(id => by.has(id)).map(id => card(by.get(id)));
    },

    // Worker: referenceImageId -> data URL of the full image, only if it belongs to userId. null = missing or not owned (same answer on purpose).
    async resolveReference(userId, id) {
      if (!isUuid(id)) return null;
      const [r] = await q(SQL.ref, [userId, id.toLowerCase()]);
      return r ? dataUrl(r.mime || 'image/jpeg', r.bytes) : null;
    },
  };
}

// Contract 4.6. The integrator calls this from routes.js with the route helpers (paths are relative to /api, like every route there).
// There is deliberately no delete or patch route in v1. Every handler filters by req.uid; a foreign id is a 404, never data.
export function registerImageLibraryRoutes({ get, post, q, limit, sharp, lib = makeImageLib({ q, sharp }) }) {
  const fail = (res, e) => { if (e?.status === 400) return res.status(400).json({ error: e.message }); throw e; }; // anything else reaches the error middleware

  get('/images', async (req, res) => {
    try {
      if (req.query.ids !== undefined) {
        const raw = Array.isArray(req.query.ids) ? req.query.ids.join(',') : String(req.query.ids);
        const ids = raw.split(',').map(s => s.trim()).filter(Boolean);
        if (ids.length > MAX_IDS) throw bad(`ids accepts at most ${MAX_IDS} ids.`);
        if (ids.some(s => !isUuid(s))) throw bad('ids must be comma-separated image ids.');
        return res.json({ images: await lib.thumbsByIds(req.uid, ids) });
      }
      res.json(await lib.list(req.uid, { limit: req.query.limit, before: Array.isArray(req.query.before) ? req.query.before[0] : req.query.before }));
    } catch (e) { fail(res, e); }
  });

  get('/images/:id', async (req, res) => {
    const img = await lib.getFull(req.uid, req.params.id);
    if (!img) return res.status(404).json({ error: 'Image not found' });
    res.json(img);
  });

  post('/images/upload', limit(UPLOAD_LIMIT.name, UPLOAD_LIMIT.max, UPLOAD_LIMIT.windowSec), async (req, res) => {
    try { res.status(201).json(await lib.saveUpload(req.uid, req.body?.dataUrl)); } catch (e) { fail(res, e); }
  });

  return lib;
}