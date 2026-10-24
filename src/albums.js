// Albums API: the "phone album" of saved posts (contract sections 3.3 and 4.5). Dependencies are injected (same pattern as responses.js),
// so the logic runs against a fake q in test/albums.test.js. Every query that touches user data filters by req.uid; another user's id is a 404.
export const CATEGORIES = ['reel', 'photo', 'carousel', 'story', 'other']; // the order GET /api/albums returns them in
export const STATUSES = ['draft', 'ready'];
export const MAX_IMAGES = 10, MAX_TITLE = 200, MAX_CAPTION = 2200, MAX_FOLDER = 60, DEFAULT_LIMIT = 50, MAX_LIMIT = 100, MAX_MOVE = 200, LLM_TIMEOUT_MS = 5000;
const DEFAULT_TITLE = 'Untitled post';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RATIO = /^\d{1,2}:\d{1,2}$/;
const STORY = /\bstor(?:y|ies)\b/i;
const isId = s => typeof s === 'string' && UUID.test(s);

// The swap point for smarter logic. Precedence: several images -> carousel; "story" in the hint or text -> story; then the ratio.
export function categorize({ ratio, imageCount, hint, text } = {}) {
  if (Number(imageCount) > 1) return 'carousel';
  if (STORY.test(String(hint ?? '')) || STORY.test(String(text ?? ''))) return 'story';
  const r = String(ratio ?? '').trim();
  if (r === '9:16') return 'reel';
  if (r === '1:1' || r === '4:5') return 'photo';
  return 'other';
}

// ---- validation (pure) ----
export function parseImageIds(v) {
  if (!Array.isArray(v) || v.length < 1 || v.length > 50) return { error: `imageIds must be a list of 1 to ${MAX_IMAGES} image ids` };
  if (!v.every(isId)) return { error: 'imageIds must be image ids' };
  const ids = [...new Set(v.map(x => x.toLowerCase()))];
  if (ids.length > MAX_IMAGES) return { error: `imageIds can hold at most ${MAX_IMAGES} images` };
  return { value: ids };
}
const optId = (v, name) => v === undefined || v === null ? { value: null } : isId(v) ? { value: v } : { error: `${name} must be an id` };
function cleanTitle(v) {
  if (typeof v !== 'string') return { error: 'title must be text' };
  const t = v.trim();
  if (t.length > MAX_TITLE) return { error: `title can be at most ${MAX_TITLE} characters` };
  return { value: t };
}
function cleanCaption(v) {
  if (typeof v !== 'string') return { error: 'caption must be text' };
  if (v.length > MAX_CAPTION) return { error: `caption can be at most ${MAX_CAPTION} characters` };
  return { value: v };
}
export function validateCreate(b) {
  b = b && typeof b === 'object' ? b : {};
  const im = parseImageIds(b.imageIds); if (im.error) return im;
  let title = DEFAULT_TITLE;
  if (b.title !== undefined && b.title !== null) { const t = cleanTitle(b.title); if (t.error) return t; title = t.value || DEFAULT_TITLE; }
  let caption = '';
  if (b.caption !== undefined && b.caption !== null) { const c = cleanCaption(b.caption); if (c.error) return c; caption = c.value; }
  let ratio = null;
  if (b.ratio !== undefined && b.ratio !== null) { if (typeof b.ratio !== 'string' || !RATIO.test(b.ratio.trim())) return { error: 'ratio must look like 4:5' }; ratio = b.ratio.trim(); }
  const conv = optId(b.conversationId, 'conversationId'); if (conv.error) return conv;
  const folder = optId(b.folderId, 'folderId'); if (folder.error) return folder;
  const status = b.status === undefined || b.status === null ? 'draft' : b.status;
  if (!STATUSES.includes(status)) return { error: `status must be one of ${STATUSES.join(', ')}` };
  const hint = typeof b.categoryHint === 'string' ? b.categoryHint.trim().slice(0, 60) : '';
  return { value: { imageIds: im.value, title, caption, ratio, conversationId: conv.value, folderId: folder.value, status, hint } };
}
export function validatePatch(b) {
  b = b && typeof b === 'object' ? b : {};
  const v = {};
  if (b.title !== undefined) { const t = cleanTitle(b.title); if (t.error) return t; if (!t.value) return { error: 'title cannot be empty' }; v.title = t.value; }
  if (b.caption !== undefined) { const c = cleanCaption(b.caption); if (c.error) return c; v.caption = c.value; }
  if (b.category !== undefined) { if (!CATEGORIES.includes(b.category)) return { error: `category must be one of ${CATEGORIES.join(', ')}` }; v.category = b.category; }
  if (b.status !== undefined) { if (!STATUSES.includes(b.status)) return { error: `status must be one of ${STATUSES.join(', ')}` }; v.status = b.status; }
  if (b.folderId !== undefined) { const f = optId(b.folderId, 'folderId'); if (f.error) return f; v.folderId = f.value; }
  if (b.imageIds !== undefined) { const im = parseImageIds(b.imageIds); if (im.error) return im; v.imageIds = im.value; }
  if (!Object.keys(v).length) return { error: 'nothing to update' };
  return { value: v };
}
export function cleanFolderName(v) {
  if (typeof v !== 'string') return { error: 'name must be text' };
  const n = v.trim();
  if (!n) return { error: 'name is empty' };
  if (n.length > MAX_FOLDER) return { error: `name can be at most ${MAX_FOLDER} characters` };
  return { value: n };
}
// ILIKE pattern for the q filter: the person's %, _ and \ are literal text, not wildcards.
export const likePattern = s => '%' + String(s).replace(/[\\%_]/g, '\\$&') + '%';

const withTimeout = (p, ms) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('timeout')), ms);
  Promise.resolve(p).then(v => { clearTimeout(t); res(v); }, e => { clearTimeout(t); rej(e); });
});
// keys.js pulls in the database and crypto modules, so it is loaded only when an LLM call is really needed.
const defaultLlmConfig = async uid => (await import('./keys.js')).llmConfig(uid);
const defaultLlmChat = async (cfg, body, ms) => (await import('./keys.js')).llmChat(cfg, body, ms);

const COLS = 'id,title,category,category_source,status,caption,image_ids,ratio,folder_id,conversation_id,created_at,updated_at';
const CUR = `to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') cur`; // microsecond cursor: JS Dates would round to milliseconds
export const toItem = r => ({
  id: r.id, title: r.title, category: r.category, categorySource: r.category_source, status: r.status, caption: r.caption,
  imageIds: r.image_ids || [], ratio: r.ratio ?? null, folderId: r.folder_id ?? null, conversationId: r.conversation_id ?? null,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

export function makeAlbums({ q, llmConfig, llmChat, timeoutMs = LLM_TIMEOUT_MS }) {
  // ---- categorization: rules first; the LLM may only refine "other", with a hard timeout, and any failure falls back to the rules ----
  async function refine(uid, input) {
    try {
      return await withTimeout((async () => {
        const cfg = await (llmConfig || defaultLlmConfig)(uid);
        if (!cfg) return null;
        const j = await (llmChat || defaultLlmChat)(cfg, {
          temperature: 0, max_tokens: 5,
          messages: [
            { role: 'system', content: 'Classify an Instagram post as one of: reel, photo, carousel, story, other. Answer with that one word only.' },
            { role: 'user', content: JSON.stringify({ title: String(input.text ?? '').slice(0, 200), ratio: input.ratio ?? null, imageCount: input.imageCount, hint: input.hint || null }) },
          ],
        }, timeoutMs);
        const w = String(j?.choices?.[0]?.message?.content ?? '').toLowerCase().match(/\b(reel|photo|carousel|story|other)\b/);
        return w ? w[1] : null;
      })(), timeoutMs);
    } catch { return null; }
  }
  const decide = async (uid, input) => {
    const r = categorize(input);
    return r !== 'other' ? r : (await refine(uid, input)) || r;
  };

  // ---- ownership helpers ----
  // generated_images belongs to the image-library stream. When it exists, only the user's own images may be saved; when it does not exist
  // yet (42P01 undefined_table) the check is skipped so this module runs standalone, before that stream's migration.
  async function ownsImages(uid, ids) {
    try {
      const rows = await q('/*album:own-images*/ SELECT id FROM generated_images WHERE user_id=$1 AND id=ANY($2::uuid[])', [uid, ids]);
      return rows.length === ids.length;
    } catch (e) { if (e?.code === '42P01') return true; throw e; }
  }
  const ownsFolder = async (uid, id) => (await q('/*album:own-folder*/ SELECT id FROM album_folders WHERE id=$1::uuid AND user_id=$2', [id, uid])).length > 0;
  const getRow = async (uid, id) => (await q(`/*album:get*/ SELECT ${COLS} FROM saved_posts WHERE id=$1::uuid AND user_id=$2`, [id, uid]))[0];
  const byCover = async (uid, cover) => (await q(`/*album:by-cover*/ SELECT ${COLS} FROM saved_posts WHERE user_id=$1 AND image_ids[1]=$2::uuid ORDER BY created_at,id LIMIT 1`, [uid, cover]))[0];
  const bad = (res, error) => res.status(400).json({ error });

  // POST /api/albums/items
  const create = async (req, res) => {
    const v = validateCreate(req.body); if (v.error) return bad(res, v.error);
    const { imageIds, title, caption, ratio, conversationId, folderId, status, hint } = v.value;
    const cover = imageIds[0];
    const dup = await byCover(req.uid, cover); // same user + same cover image: nothing new is created (double-click safe)
    if (dup) return res.status(200).json({ item: toItem(dup), existing: true });
    if (folderId && !(await ownsFolder(req.uid, folderId))) return res.status(404).json({ error: 'Folder not found' });
    if (!(await ownsImages(req.uid, imageIds))) return bad(res, 'One or more images were not found in your library');
    const category = await decide(req.uid, { ratio, imageCount: imageIds.length, hint, text: title });
    // One statement: insert only if no item with this cover exists yet, so two quick saves cannot both insert.
    const rows = await q(`/*album:insert*/ INSERT INTO saved_posts(user_id,title,category,category_source,status,caption,image_ids,ratio,folder_id,conversation_id)
      SELECT $1::uuid,$2::text,$3::text,'auto',$4::text,$5::text,$6::uuid[],$7::text,$8::uuid,$9::uuid
      WHERE NOT EXISTS (SELECT 1 FROM saved_posts WHERE user_id=$1::uuid AND image_ids[1]=$10::uuid) RETURNING ${COLS}`,
      [req.uid, title, category, status, caption, imageIds, ratio, folderId, conversationId, cover]);
    if (!rows.length) { const again = await byCover(req.uid, cover); if (again) return res.status(200).json({ item: toItem(again), existing: true }); return res.status(409).json({ error: 'Could not save, try again' }); }
    res.status(201).json({ item: toItem(rows[0]) });
  };

  // GET /api/albums/items?category=&folderId=&status=&q=&limit=50&before=<iso>   (folderId=none -> not in any folder)
  const list = async (req, res) => {
    const x = req.query || {};
    const one = k => (Array.isArray(x[k]) ? x[k][0] : x[k]);
    const category = one('category') || null, status = one('status') || null, folderId = one('folderId') || null, search = String(one('q') ?? '').trim(), before = one('before') || null;
    if (category && !CATEGORIES.includes(category)) return bad(res, `category must be one of ${CATEGORIES.join(', ')}`);
    if (status && !STATUSES.includes(status)) return bad(res, `status must be one of ${STATUSES.join(', ')}`);
    if (folderId && folderId !== 'none' && !isId(folderId)) return bad(res, 'folderId must be an id or "none"');
    if (search.length > 100) return bad(res, 'q can be at most 100 characters');
    if (before && !(/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})?$/.test(before) && Number.isFinite(Date.parse(before)))) return bad(res, 'before must be an ISO date');
    const raw = one('limit'), n = raw === undefined || raw === '' ? DEFAULT_LIMIT : Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) return bad(res, `limit must be a whole number from 1 to ${MAX_LIMIT}`);
    const rows = await q(`/*album:list*/ SELECT ${COLS},${CUR} FROM saved_posts WHERE user_id=$1
      AND ($2::text IS NULL OR category=$2) AND ($3::text IS NULL OR status=$3)
      AND (CASE WHEN $4::text IS NULL THEN true WHEN $4='none' THEN folder_id IS NULL ELSE folder_id=$4::uuid END)
      AND ($5::text IS NULL OR title ILIKE $5 ESCAPE '\\' OR caption ILIKE $5 ESCAPE '\\')
      AND ($6::timestamptz IS NULL OR updated_at<$6::timestamptz)
      ORDER BY updated_at DESC,id DESC LIMIT $7`, [req.uid, category, status, folderId, search ? likePattern(search) : null, before, n + 1]);
    const page = rows.slice(0, n), out = { items: page.map(toItem) };
    if (rows.length > n) out.next = page[page.length - 1].cur;
    res.json(out);
  };

  // GET /api/albums/items/:id
  const getOne = async (req, res) => {
    if (!isId(req.params.id)) return res.sendStatus(404);
    const r = await getRow(req.uid, req.params.id);
    if (!r) return res.sendStatus(404);
    res.json({ item: toItem(r) });
  };

  // PATCH /api/albums/items/:id
  const update = async (req, res) => {
    if (!isId(req.params.id)) return res.sendStatus(404);
    const cur = await getRow(req.uid, req.params.id);
    if (!cur) return res.sendStatus(404); // before validating, so a foreign id learns nothing
    const v = validatePatch(req.body); if (v.error) return bad(res, v.error);
    const p = v.value;
    if (p.folderId && !(await ownsFolder(req.uid, p.folderId))) return res.status(404).json({ error: 'Folder not found' });
    if (p.imageIds && !(await ownsImages(req.uid, p.imageIds))) return bad(res, 'One or more images were not found in your library');
    let category = null, source = null;
    if (p.category !== undefined) { category = p.category; source = 'user'; } // the person's choice: auto rules never touch it again
    else if (p.imageIds && cur.category_source !== 'user') { category = await decide(req.uid, { ratio: cur.ratio, imageCount: p.imageIds.length, hint: '', text: p.title ?? cur.title }); source = 'auto'; }
    const has = k => p[k] !== undefined;
    const rows = await q(`/*album:update*/ UPDATE saved_posts SET
      title=CASE WHEN $3::boolean THEN $4::text ELSE title END, caption=CASE WHEN $5::boolean THEN $6::text ELSE caption END,
      status=CASE WHEN $7::boolean THEN $8::text ELSE status END, folder_id=CASE WHEN $9::boolean THEN $10::uuid ELSE folder_id END,
      image_ids=CASE WHEN $11::boolean THEN $12::uuid[] ELSE image_ids END,
      category=CASE WHEN $13::boolean THEN $14::text ELSE category END, category_source=CASE WHEN $13::boolean THEN $15::text ELSE category_source END,
      updated_at=now() WHERE id=$1::uuid AND user_id=$2 RETURNING ${COLS}`,
      [req.params.id, req.uid, has('title'), p.title ?? null, has('caption'), p.caption ?? null, has('status'), p.status ?? null, has('folderId'), p.folderId ?? null,
        has('imageIds'), p.imageIds ?? null, category !== null, category, source]);
    if (!rows.length) return res.sendStatus(404);
    res.json({ item: toItem(rows[0]) });
  };

  // DELETE /api/albums/items/:id
  const remove = async (req, res) => {
    if (!isId(req.params.id)) return res.sendStatus(404);
    const r = await q('/*album:delete*/ DELETE FROM saved_posts WHERE id=$1::uuid AND user_id=$2 RETURNING id', [req.params.id, req.uid]);
    if (!r.length) return res.sendStatus(404);
    res.sendStatus(204);
  };

  // POST /api/albums/items/move  { ids:[uuid], folderId?: uuid|null, category? }  -> { moved:n }; only the caller's own ids count
  const move = async (req, res) => {
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    if (!Array.isArray(b.ids) || b.ids.length < 1 || b.ids.length > MAX_MOVE || !b.ids.every(isId)) return bad(res, `ids must be a list of 1 to ${MAX_MOVE} item ids`);
    const hasFolder = b.folderId !== undefined, hasCat = b.category !== undefined;
    if (!hasFolder && !hasCat) return bad(res, 'give a folderId (or null) and/or a category');
    if (hasCat && !CATEGORIES.includes(b.category)) return bad(res, `category must be one of ${CATEGORIES.join(', ')}`);
    const f = optId(b.folderId, 'folderId'); if (f.error) return bad(res, f.error);
    if (hasFolder && f.value && !(await ownsFolder(req.uid, f.value))) return res.status(404).json({ error: 'Folder not found' });
    const rows = await q(`/*album:move*/ UPDATE saved_posts SET folder_id=CASE WHEN $3::boolean THEN $4::uuid ELSE folder_id END,
      category=CASE WHEN $5::boolean THEN $6::text ELSE category END, category_source=CASE WHEN $5::boolean THEN 'user' ELSE category_source END, updated_at=now()
      WHERE user_id=$1 AND id=ANY($2::uuid[]) RETURNING id`, [req.uid, [...new Set(b.ids)], hasFolder, f.value, hasCat, hasCat ? b.category : null]);
    res.json({ moved: rows.length });
  };

  // GET /api/albums: all five categories in a fixed order (zero counts included), folders with counts, covers = first image of the newest items
  const overview = async (req, res) => {
    const [counts, covers, folders, fcovers] = await Promise.all([
      q('/*album:counts*/ SELECT category, count(*)::int n FROM saved_posts WHERE user_id=$1 GROUP BY category', [req.uid]),
      q(`/*album:covers*/ SELECT category, cover FROM (SELECT category, image_ids[1] cover, row_number() OVER (PARTITION BY category ORDER BY updated_at DESC,id DESC) rn
        FROM saved_posts WHERE user_id=$1) t WHERE rn<=4 ORDER BY category, rn`, [req.uid]),
      q(`/*album:folders*/ SELECT f.id, f.name, count(p.id)::int n FROM album_folders f LEFT JOIN saved_posts p ON p.folder_id=f.id AND p.user_id=f.user_id
        WHERE f.user_id=$1 GROUP BY f.id, f.name ORDER BY lower(f.name), f.id`, [req.uid]),
      q(`/*album:folder-covers*/ SELECT folder_id, cover FROM (SELECT folder_id, image_ids[1] cover, row_number() OVER (PARTITION BY folder_id ORDER BY updated_at DESC,id DESC) rn
        FROM saved_posts WHERE user_id=$1 AND folder_id IS NOT NULL) t WHERE rn<=4 ORDER BY folder_id, rn`, [req.uid]),
    ]);
    const n = Object.fromEntries(counts.map(r => [r.category, r.n]));
    const cv = (rows, key, k) => rows.filter(r => r[key] === k && r.cover).map(r => r.cover).slice(0, 4);
    const albums = CATEGORIES.map(category => ({ category, count: n[category] || 0, coverImageIds: cv(covers, 'category', category) }));
    res.json({ albums, folders: folders.map(f => ({ id: f.id, name: f.name, count: f.n, coverImageIds: cv(fcovers, 'folder_id', f.id) })), total: albums.reduce((s, a) => s + a.count, 0) });
  };

  // ---- folders ----
  const createFolder = async (req, res) => {
    const v = cleanFolderName(req.body?.name); if (v.error) return bad(res, v.error);
    const rows = await q('/*album:folder-create*/ INSERT INTO album_folders(user_id,name) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING id,name', [req.uid, v.value]); // the unique index is on (user, lower(name))
    if (!rows.length) return res.status(409).json({ error: 'You already have a folder with that name' });
    res.status(201).json({ folder: { id: rows[0].id, name: rows[0].name } });
  };
  const renameFolder = async (req, res) => {
    if (!isId(req.params.id)) return res.sendStatus(404);
    const v = cleanFolderName(req.body?.name);
    if (v.error) { if (!(await ownsFolder(req.uid, req.params.id))) return res.sendStatus(404); return bad(res, v.error); }
    try {
      const rows = await q('/*album:folder-rename*/ UPDATE album_folders SET name=$3 WHERE id=$1::uuid AND user_id=$2 RETURNING id,name', [req.params.id, req.uid, v.value]);
      if (!rows.length) return res.sendStatus(404);
      res.json({ folder: { id: rows[0].id, name: rows[0].name } });
    } catch (e) { if (e?.code === '23505') return res.status(409).json({ error: 'You already have a folder with that name' }); throw e; }
  };
  // Deleting a folder never deletes posts: saved_posts.folder_id is ON DELETE SET NULL, so its items simply become unfiled.
  const removeFolder = async (req, res) => {
    if (!isId(req.params.id)) return res.sendStatus(404);
    const r = await q('/*album:folder-delete*/ DELETE FROM album_folders WHERE id=$1::uuid AND user_id=$2 RETURNING id', [req.params.id, req.uid]);
    if (!r.length) return res.sendStatus(404);
    res.sendStatus(204);
  };

  return { create, list, getOne, update, remove, move, overview, createFolder, renameFolder, removeFolder, decide };
}

// Contract 4.6. The integrator calls this once from routes.js with the route helpers. (The rate limiter is not used: saving must not depend on Redis.)
export function registerAlbumRoutes({ get, post, patch, del, q }) {
  const a = makeAlbums({ q });
  get('/albums', a.overview);
  get('/albums/items', a.list);
  post('/albums/items', a.create);
  post('/albums/items/move', a.move); // literal path, registered before the :id routes
  get('/albums/items/:id', a.getOne);
  patch('/albums/items/:id', a.update);
  del('/albums/items/:id', a.remove);
  post('/albums/folders', a.createFolder);
  patch('/albums/folders/:id', a.renameFolder);
  del('/albums/folders/:id', a.removeFolder);
  return a;
}