// Albums the page and the assistant share: folders (Templates) and saved drafts.
// `q` is injected. Cover is a data URL or http URL; image library ids stay in image_ids when they exist.

const CATS = ['reel', 'photo', 'carousel', 'story', 'other'];
const COVER_MAX = 4_000_000;

const item = r => ({
  id: r.id, title: r.title, category: r.category, categorySource: r.category_source, status: r.status,
  caption: r.caption, imageIds: r.image_ids || [], ratio: r.ratio, folderId: r.folder_id,
  conversationId: r.conversation_id, cover: r.cover || null,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

export function coverOf(v) {
  if (typeof v !== 'string') return null;
  if (v.length > COVER_MAX) return null;
  if (v.startsWith('data:image/') || /^https?:\/\//.test(v)) return v;
  return null;
}

export function makeAlbums({ q }) {
  const findFolder = async (uid, name) => {
    const [r] = await q('SELECT id, name FROM album_folders WHERE user_id=$1 AND lower(name)=lower($2)', [uid, name]);
    return r || null;
  };
  const listFolders = uid => q('SELECT id, name FROM album_folders WHERE user_id=$1 ORDER BY lower(name)', [uid]);
  const createFolder = async (uid, name) => {
    const clean = String(name || '').trim().slice(0, 80);
    if (!clean) { const e = new Error('Folder name is required'); e.status = 400; throw e; }
    try {
      const [r] = await q('INSERT INTO album_folders(user_id, name) VALUES($1,$2) RETURNING id, name', [uid, clean]);
      return r;
    } catch (e) {
      if (e.code === '23505') { const err = new Error('A folder with that name already exists'); err.status = 409; throw err; }
      throw e;
    }
  };
  const saveDraft = async (uid, { title, caption, category, folderId, ratio, cover }) => {
    const cat = CATS.includes(category) ? category : 'photo';
    const [r] = await q(
      `INSERT INTO saved_posts(user_id, title, category, caption, folder_id, ratio, cover)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id, title, category, folder_id`,
      [uid, String(title || 'Untitled post').slice(0, 140), cat, String(caption || '').slice(0, 4000), folderId || null, ratio || null, coverOf(cover)]);
    return r;
  };
  return { findFolder, listFolders, createFolder, saveDraft };
}

function fail(res, e) {
  const code = e.status || (e.code === '42P01' ? 503 : 500);
  res.status(code).json({ error: e.code === '42P01' ? 'Albums are not set up yet. Restart the server so the database can migrate.' : (e.message || 'Album request failed') });
}

export function registerAlbumRoutes({ get, post, patch, del, q }) {
  const albums = makeAlbums({ q });
  get('/albums', async (req, res) => {
    try {
      const folders = await q(`SELECT f.id, f.name, count(p.id)::int AS count
        FROM album_folders f LEFT JOIN saved_posts p ON p.folder_id=f.id AND p.user_id=f.user_id
        WHERE f.user_id=$1 GROUP BY f.id ORDER BY lower(f.name)`, [req.uid]);
      const counts = await q('SELECT category, count(*)::int AS n FROM saved_posts WHERE user_id=$1 GROUP BY category', [req.uid]);
      const by = Object.fromEntries(counts.map(r => [r.category, r.n]));
      const total = counts.reduce((n, r) => n + r.n, 0);
      res.json({
        albums: CATS.map(category => ({ category, count: by[category] || 0, coverImageIds: [] })),
        folders: folders.map(f => ({ id: f.id, name: f.name, count: f.count, coverImageIds: [] })),
        total,
      });
    } catch (e) { fail(res, e); }
  });
  get('/albums/items', async (req, res) => {
    try {
      const where = ['user_id=$1'];
      const p = [req.uid];
      if (CATS.includes(req.query.category)) { p.push(req.query.category); where.push('category=$' + p.length); }
      if (req.query.folderId === 'none') where.push('folder_id IS NULL');
      else if (req.query.folderId) { p.push(req.query.folderId); where.push('folder_id=$' + p.length + '::uuid'); }
      if (req.query.status === 'draft' || req.query.status === 'ready') { p.push(req.query.status); where.push('status=$' + p.length); }
      if (req.query.q) { p.push('%' + String(req.query.q).slice(0, 80) + '%'); where.push(`(title ILIKE $${p.length} OR caption ILIKE $${p.length})`); }
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
      p.push(limit);
      const rows = await q(`SELECT * FROM saved_posts WHERE ${where.join(' AND ')} ORDER BY updated_at DESC LIMIT $${p.length}`, p);
      res.json({ items: rows.map(item) });
    } catch (e) { fail(res, e); }
  });
  post('/albums/folders', async (req, res) => {
    try { res.status(201).json({ folder: await albums.createFolder(req.uid, req.body?.name) }); }
    catch (e) { fail(res, e); }
  });
  patch('/albums/folders/:id', async (req, res) => {
    try {
      const name = String(req.body?.name || '').trim().slice(0, 80);
      if (!name) return res.status(400).json({ error: 'Folder name is required' });
      const [r] = await q('UPDATE album_folders SET name=$3 WHERE id=$1 AND user_id=$2 RETURNING id, name', [req.params.id, req.uid, name]);
      if (!r) return res.sendStatus(404);
      res.json({ folder: r });
    } catch (e) { fail(res, e); }
  });
  del('/albums/folders/:id', async (req, res) => {
    try {
      const [r] = await q('DELETE FROM album_folders WHERE id=$1 AND user_id=$2 RETURNING id', [req.params.id, req.uid]);
      if (!r) return res.sendStatus(404);
      res.sendStatus(204);
    } catch (e) { fail(res, e); }
  });
  post('/albums/items', async (req, res) => {
    try {
      const b = req.body || {};
      const row = await albums.saveDraft(req.uid, { title: b.title, caption: b.caption, category: b.category, folderId: b.folderId, ratio: b.ratio, cover: b.cover });
      res.status(201).json({ item: row });
    } catch (e) { fail(res, e); }
  });
  patch('/albums/items/:id', async (req, res) => {
    try {
      const b = req.body || {};
      const [r] = await q(`UPDATE saved_posts SET
        title=COALESCE($3, title), caption=COALESCE($4, caption), category=COALESCE($5, category),
        folder_id=CASE WHEN $6::bool THEN $7::uuid ELSE folder_id END, status=COALESCE($8, status), updated_at=now()
        WHERE id=$1 AND user_id=$2 RETURNING *`,
        [req.params.id, req.uid, b.title ?? null, b.caption ?? null, b.category ?? null, b.folderId !== undefined, b.folderId ?? null, b.status ?? null]);
      if (!r) return res.sendStatus(404);
      res.json({ item: item(r) });
    } catch (e) { fail(res, e); }
  });
  del('/albums/items/:id', async (req, res) => {
    try {
      const [r] = await q('DELETE FROM saved_posts WHERE id=$1 AND user_id=$2 RETURNING id', [req.params.id, req.uid]);
      if (!r) return res.sendStatus(404);
      res.sendStatus(204);
    } catch (e) { fail(res, e); }
  });
  post('/albums/items/move', async (req, res) => {
    try {
      const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
      if (!ids.length) return res.status(400).json({ error: 'ids required' });
      const sets = ['updated_at=now()'];
      const p = [req.uid, ids];
      if (req.body?.folderId !== undefined) { p.push(req.body.folderId); sets.push('folder_id=$' + p.length + '::uuid'); }
      if (CATS.includes(req.body?.category)) { p.push(req.body.category); sets.push('category=$' + p.length); }
      const rows = await q(`UPDATE saved_posts SET ${sets.join(', ')} WHERE user_id=$1 AND id=ANY($2::uuid[]) RETURNING id`, p);
      res.json({ moved: rows.length });
    } catch (e) { fail(res, e); }
  });
  return albums;
}
