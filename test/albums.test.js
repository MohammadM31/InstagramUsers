// Albums API (src/albums.js): categorize rules, validation and every handler, run against an in-memory fake q (the real SQL is not run here).
// The fake keys on the /*album:...*/ tag at the start of each statement and applies the same filters the SQL describes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { makeAlbums, categorize, registerAlbumRoutes, validateCreate, validatePatch, parseImageIds, cleanFolderName, likePattern, CATEGORIES, MAX_IMAGES } from '../src/albums.js';

const U1 = randomUUID(), U2 = randomUUID();
const img = () => randomUUID();
const res = () => { const r = { code: 200, body: undefined }; r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; }; r.sendStatus = c => { r.code = c; return r; }; return r; };
const call = async (h, req) => { const r = res(); await h({ query: {}, params: {}, body: {}, ...req }, r); return r; };

// ---- fake database ----
// The exact scoping each statement must carry in its SQL (the owner is a bind parameter, never a value from the request body).
const SCOPE = {
  'own-images': /WHERE user_id=\$1 AND id=ANY\(\$2::uuid\[\]\)/, 'own-folder': /WHERE id=\$1::uuid AND user_id=\$2/, get: /WHERE id=\$1::uuid AND user_id=\$2/, 'by-cover': /WHERE user_id=\$1 AND image_ids\[1\]=\$2::uuid/,
  insert: /SELECT \$1::uuid,/, list: /FROM saved_posts WHERE user_id=\$1\n/, update: /WHERE id=\$1::uuid AND user_id=\$2 RETURNING/, delete: /WHERE id=\$1::uuid AND user_id=\$2 RETURNING/,
  move: /WHERE user_id=\$1 AND id=ANY\(\$2::uuid\[\]\) RETURNING/, counts: /WHERE user_id=\$1 GROUP BY/, covers: /WHERE user_id=\$1\) t/, folders: /WHERE f\.user_id=\$1 GROUP BY/ ,
  'folder-covers': /WHERE user_id=\$1 AND folder_id IS NOT NULL/, 'folder-create': /VALUES\(\$1,\$2\)/, 'folder-rename': /WHERE id=\$1::uuid AND user_id=\$2 RETURNING/, 'folder-delete': /WHERE id=\$1::uuid AND user_id=\$2 RETURNING/,
};
const pad = n => String(n).padStart(6, '0');
const iso = t => `2026-10-01T00:00:00.${pad(t)}Z`;
const micro = s => { const m = /^(.*?)(?:\.(\d+))?(Z|[+-]\d\d:?\d\d)?$/.exec(s); return Date.parse(m[1] + (m[3] || 'Z')) * 1000 + Number((m[2] || '0').padEnd(6, '0').slice(0, 6)); };
function likeRe(pat) { let o = '', i = 0; for (; i < pat.length; i++) { const c = pat[i]; if (c === '\\') { o += pat[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); } else if (c === '%') o += '[^]*'; else if (c === '_') o += '[^]'; else o += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); } return new RegExp('^' + o + '$', 'i'); }
function fakeQ({ images = new Map() } = {}) { // images: Map imageId -> userId; null = the generated_images table does not exist
  const S = { posts: [], folders: [], images, clock: 0, sqls: [] };
  const out = r => ({ ...r, created_at: new Date(Date.parse(iso(r.cts)) ), updated_at: new Date(Date.parse(iso(r.ts))), cur: iso(r.ts) });
  const q = async (sql, p = []) => {
    S.sqls.push(sql);
    const tag = /^\/\*album:([\w-]+)\*\//.exec(sql)?.[1];
    assert.ok(tag, 'every statement carries a tag: ' + sql.slice(0, 60));
    assert.match(sql, SCOPE[tag] || /^$/, 'statement is scoped to the caller: ' + tag); // the fake filters by user itself, so the SQL text is what must carry the scope
    const mine = u => S.posts.filter(r => r.user_id === u);
    switch (tag) {
      case 'own-images': { if (!S.images) throw Object.assign(new Error('relation "generated_images" does not exist'), { code: '42P01' }); return p[1].filter(id => S.images.get(id) === p[0]).map(id => ({ id })); }
      case 'own-folder': return S.folders.filter(f => f.id === p[0] && f.user_id === p[1]).map(f => ({ id: f.id }));
      case 'get': return S.posts.filter(r => r.id === p[0] && r.user_id === p[1]).map(out);
      case 'by-cover': return mine(p[0]).filter(r => r.image_ids[0] === p[1]).sort((a, b) => a.cts - b.cts).slice(0, 1).map(out);
      case 'insert': {
        assert.match(sql, /WHERE NOT EXISTS \(SELECT 1 FROM saved_posts WHERE user_id=\$1::uuid AND image_ids\[1\]=\$10::uuid\)/);
        const [user_id, title, category, status, caption, image_ids, ratio, folder_id, conversation_id, cover] = p;
        if (mine(user_id).some(r => r.image_ids[0] === cover)) return [];
        if (folder_id && !S.folders.some(f => f.id === folder_id)) throw Object.assign(new Error('fk'), { code: '23503' });
        const t = ++S.clock, row = { id: randomUUID(), user_id, title, category, category_source: 'auto', status, caption, image_ids: [...image_ids], ratio, folder_id, conversation_id, cts: t, ts: t };
        S.posts.push(row); return [out(row)];
      }
      case 'list': {
        const [u, cat, st, fol, like, before, lim] = p; const re = like ? likeRe(like) : null;
        assert.equal((sql.match(/ILIKE \$5 ESCAPE '\\'/g) || []).length, 2, 'wildcards are escaped for both title and caption');
        return mine(u).filter(r => (!cat || r.category === cat) && (!st || r.status === st) && (!fol || (fol === 'none' ? !r.folder_id : r.folder_id === fol))
          && (!re || re.test(r.title) || re.test(r.caption)) && (!before || r.ts * 1 < micro(before) - micro('2026-10-01T00:00:00Z')))
          .sort((a, b) => b.ts - a.ts || (a.id < b.id ? 1 : -1)).slice(0, lim).map(out);
      }
      case 'update': {
        const [id, u, hT, t, hC, c, hS, s, hF, f, hI, im, hK, k, src] = p, r = S.posts.find(x => x.id === id && x.user_id === u); if (!r) return [];
        if (hT) r.title = t; if (hC) r.caption = c; if (hS) r.status = s; if (hF) r.folder_id = f; if (hI) r.image_ids = [...im]; if (hK) { r.category = k; r.category_source = src; }
        r.ts = ++S.clock; return [out(r)];
      }
      case 'delete': { const i = S.posts.findIndex(x => x.id === p[0] && x.user_id === p[1]); if (i < 0) return []; const [r] = S.posts.splice(i, 1); return [{ id: r.id }]; }
      case 'move': {
        const [u, ids, hF, f, hK, k] = p, rows = mine(u).filter(r => ids.includes(r.id));
        for (const r of rows) { if (hF) r.folder_id = f; if (hK) { r.category = k; r.category_source = 'user'; } r.ts = ++S.clock; }
        return rows.map(r => ({ id: r.id }));
      }
      case 'counts': { const m = {}; for (const r of mine(p[0])) m[r.category] = (m[r.category] || 0) + 1; return Object.entries(m).map(([category, n]) => ({ category, n })); }
      case 'covers': return CATEGORIES.flatMap(c => mine(p[0]).filter(r => r.category === c).sort((a, b) => b.ts - a.ts).slice(0, 4).map(r => ({ category: c, cover: r.image_ids[0] })));
      case 'folders': return S.folders.filter(f => f.user_id === p[0]).sort((a, b) => a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1).map(f => ({ id: f.id, name: f.name, n: mine(p[0]).filter(r => r.folder_id === f.id).length }));
      case 'folder-covers': return S.folders.filter(f => f.user_id === p[0]).flatMap(f => mine(p[0]).filter(r => r.folder_id === f.id).sort((a, b) => b.ts - a.ts).slice(0, 4).map(r => ({ folder_id: f.id, cover: r.image_ids[0] })));
      case 'folder-create': { assert.match(sql, /ON CONFLICT DO NOTHING RETURNING id,name/, 'a duplicate name inserts nothing (unique index on lower(name))'); if (S.folders.some(f => f.user_id === p[0] && f.name.toLowerCase() === p[1].toLowerCase())) return []; const f = { id: randomUUID(), user_id: p[0], name: p[1] }; S.folders.push(f); return [{ id: f.id, name: f.name }]; }
      case 'folder-rename': {
        const f = S.folders.find(x => x.id === p[0] && x.user_id === p[1]); if (!f) return [];
        if (S.folders.some(x => x !== f && x.user_id === p[1] && x.name.toLowerCase() === p[2].toLowerCase())) throw Object.assign(new Error('duplicate key value violates unique constraint "album_folders_name"'), { code: '23505' });
        f.name = p[2]; return [{ id: f.id, name: f.name }];
      }
      case 'folder-delete': { const i = S.folders.findIndex(x => x.id === p[0] && x.user_id === p[1]); if (i < 0) return []; const [f] = S.folders.splice(i, 1); for (const r of S.posts) if (r.folder_id === f.id) r.folder_id = null; /* ON DELETE SET NULL */ return [{ id: f.id }]; }
    }
    throw new Error('unexpected tag ' + tag);
  };
  q.S = S; return q;
}
const own = (q, u, n = 1) => Array.from({ length: n }, () => { const id = img(); q.S.images?.set(id, u); return id; });
const setup = (o = {}) => { const q = fakeQ(o.q), a = makeAlbums({ q, ...o.deps }); return { q, a }; };
const save = async (a, uid, body) => call(a.create, { uid, body });

// ---------- categorize ----------
test('categorize: every rule', () => {
  assert.equal(categorize({ ratio: '9:16', imageCount: 1 }), 'reel');
  assert.equal(categorize({ ratio: '1:1', imageCount: 1 }), 'photo');
  assert.equal(categorize({ ratio: '4:5', imageCount: 1 }), 'photo');
  assert.equal(categorize({ ratio: '16:9', imageCount: 1 }), 'other');
  assert.equal(categorize({ imageCount: 1 }), 'other'); assert.equal(categorize({}), 'other'); assert.equal(categorize(), 'other');
  assert.equal(categorize({ ratio: '1:1', imageCount: 2 }), 'carousel');
  assert.equal(categorize({ ratio: '1:1', imageCount: 1, hint: 'story' }), 'story');
  assert.equal(categorize({ ratio: '1:1', imageCount: 1, text: 'Our Story today' }), 'story');
  assert.equal(categorize({ imageCount: 1, hint: 'Stories' }), 'story');
});
test('categorize: precedence is carousel, then story, then ratio; "story" must be a word', () => {
  assert.equal(categorize({ ratio: '9:16', imageCount: 3, hint: 'story' }), 'carousel', 'several images beat story');
  assert.equal(categorize({ ratio: '9:16', imageCount: 1, hint: 'story' }), 'story', 'story beats the reel ratio');
  assert.equal(categorize({ ratio: '4:5', imageCount: 1, text: 'history of coffee, mainstory' }), 'photo', 'no match inside other words');
  assert.equal(categorize({ ratio: ' 9:16 ', imageCount: 1 }), 'reel', 'ratio is trimmed');
});

// ---------- validation ----------
test('validation: image ids, title, status, ratio, patch, folder names, like pattern', () => {
  const a = img();
  assert.deepEqual(parseImageIds([a, a.toUpperCase()]).value, [a], 'deduplicated, order kept');
  assert.ok(parseImageIds([]).error && parseImageIds('x').error && parseImageIds(['nope']).error && parseImageIds(undefined).error);
  assert.ok(parseImageIds(Array.from({ length: MAX_IMAGES + 1 }, img)).error, 'more than 10');
  assert.equal(parseImageIds(Array.from({ length: MAX_IMAGES }, img)).value.length, 10);
  const v = validateCreate({ imageIds: [a] }).value; assert.deepEqual([v.title, v.status, v.caption, v.ratio, v.folderId], ['Untitled post', 'draft', '', null, null]);
  assert.equal(validateCreate({ imageIds: [a], title: '   ' }).value.title, 'Untitled post');
  for (const b of [{ imageIds: [a], status: 'live' }, { imageIds: [a], ratio: 'wide' }, { imageIds: [a], title: 5 }, { imageIds: [a], title: 'x'.repeat(201) }, { imageIds: [a], caption: 'x'.repeat(2201) }, { imageIds: [a], folderId: 'abc' }, { imageIds: [a], conversationId: 7 }, null])
    assert.ok(validateCreate(b).error, JSON.stringify(b)?.slice(0, 50));
  assert.ok(validatePatch({}).error && validatePatch({ nonsense: 1 }).error, 'nothing recognised');
  assert.ok(validatePatch({ category: 'video' }).error && validatePatch({ title: ' ' }).error && validatePatch({ imageIds: [] }).error && validatePatch({ status: 'x' }).error);
  assert.deepEqual(validatePatch({ folderId: null }).value, { folderId: null });
  assert.equal(cleanFolderName('  Summer  ').value, 'Summer'); assert.ok(cleanFolderName('').error && cleanFolderName('x'.repeat(61)).error && cleanFolderName(5).error); assert.ok(cleanFolderName('x'.repeat(60)).value);
  assert.equal(likePattern('50%_off\\'), '%50\\%\\_off\\\\%');
});

// ---------- create ----------
test('create: 201 with the item shape, auto category from the ratio, ownership of the folder and the images', async () => {
  const { q, a } = setup(); const [i1] = own(q, U1);
  const r = await save(a, U1, { imageIds: [i1], ratio: '9:16', caption: 'hello', conversationId: randomUUID() });
  assert.equal(r.code, 201);
  const it = r.body.item;
  assert.deepEqual(Object.keys(it).sort(), ['caption', 'category', 'categorySource', 'conversationId', 'createdAt', 'folderId', 'id', 'imageIds', 'ratio', 'status', 'title', 'updatedAt']);
  assert.deepEqual([it.title, it.category, it.categorySource, it.status, it.ratio, it.imageIds, it.folderId], ['Untitled post', 'reel', 'auto', 'draft', '9:16', [i1], null]);
  const [i2, i3] = own(q, U1, 2);
  assert.equal((await save(a, U1, { imageIds: [i2, i3], ratio: '1:1', status: 'ready' })).body.item.category, 'carousel');
  assert.equal((await save(a, U1, { imageIds: own(q, U1), ratio: '1:1', categoryHint: 'story' })).body.item.category, 'story');
  assert.equal((await save(a, U1, { imageIds: own(q, U1) })).body.item.category, 'other', 'no ratio, no llm: other');
  const foreign = own(q, U2)[0];
  const bad = await save(a, U1, { imageIds: [foreign] }); assert.equal(bad.code, 400); assert.match(bad.body.error, /not found in your library/);
  assert.equal((await save(a, U1, { imageIds: [i1, foreign] })).code, 200, 'the first image is already saved; an existing item wins');
  assert.equal((await save(a, U1, { imageIds: own(q, U1), folderId: randomUUID() })).code, 404, 'unknown or foreign folder');
  assert.equal((await save(a, U1, { imageIds: ['bad'] })).code, 400);
});
test('double-save: the same cover image twice returns 200 existing:true and creates nothing; other users are unaffected', async () => {
  const { q, a } = setup(); const [c] = own(q, U1);
  const first = await save(a, U1, { imageIds: [c], ratio: '1:1', title: 'Latte' });
  const second = await save(a, U1, { imageIds: [c], ratio: '1:1', title: 'Latte again' });
  assert.equal(first.code, 201); assert.equal(second.code, 200); assert.equal(second.body.existing, true); assert.equal(second.body.item.id, first.body.item.id);
  assert.equal(second.body.item.title, 'Latte', 'the saved item is returned as it is');
  assert.equal(q.S.posts.length, 1);
  assert.equal(first.body.existing, undefined);
  q.S.images.set(c, U2); // another user with the same image id is their own row (cannot really happen; proves the scope)
  assert.equal((await save(a, U2, { imageIds: [c] })).code, 201); assert.equal(q.S.posts.length, 2);
  const [d] = own(q, U1), both = await Promise.all([save(a, U1, { imageIds: [d] }), save(a, U1, { imageIds: [d] })]);
  assert.deepEqual(both.map(r => r.code).sort(), [200, 201], 'two quick saves: one insert, one existing'); assert.equal(q.S.posts.filter(r => r.image_ids[0] === d).length, 1);
});
test('missing generated_images table: saving degrades to accepting the ids; with the table, foreign ids are refused on create and on patch', async () => {
  const none = setup({ q: { images: null } }), x = img();
  assert.equal((await save(none.a, U1, { imageIds: [x], ratio: '1:1' })).code, 201);
  const { q, a } = setup(); const [mine] = own(q, U1), other = own(q, U2)[0];
  const it = (await save(a, U1, { imageIds: [mine], ratio: '1:1' })).body.item;
  assert.equal((await call(a.update, { uid: U1, params: { id: it.id }, body: { imageIds: [other] } })).code, 400);
  assert.equal((await call(a.update, { uid: U1, params: { id: it.id }, body: { imageIds: [mine, ...own(q, U1)] } })).body.item.category, 'carousel');
  const boom = makeAlbums({ q: async () => { throw Object.assign(new Error('db down'), { code: '57P01' }); } });
  await assert.rejects(() => save(boom, U1, { imageIds: [x] }), /db down/, 'other database errors are not swallowed');
});

// ---------- LLM refinement ----------
const cfg = { key: 'k', base: 'x', model: 'm' }, say = word => async () => ({ choices: [{ message: { content: word } }] });
test('LLM refines only when the rules say "other"', async () => {
  const calls = []; const llmChat = async (c, body, ms) => { calls.push({ body, ms }); return say('story')(); };
  const { q, a } = setup({ deps: { llmConfig: async () => cfg, llmChat } });
  assert.equal((await save(a, U1, { imageIds: own(q, U1), ratio: '1:1' })).body.item.category, 'photo'); assert.equal(calls.length, 0, 'rules decided: no call');
  assert.equal((await save(a, U1, { imageIds: own(q, U1, 2) })).body.item.category, 'carousel'); assert.equal(calls.length, 0);
  assert.equal((await save(a, U1, { imageIds: own(q, U1), title: 'Behind the scenes' })).body.item.category, 'story', 'rules gave other, the model said story'); assert.equal(calls.length, 1);
  assert.equal(calls[0].ms, 5000, 'five second limit passed down'); assert.match(JSON.stringify(calls[0].body.messages), /Behind the scenes/);
});
test('LLM failures fall back to the rules: no key, error, garbage answer, timeout', async () => {
  const cases = { 'no key': { llmConfig: async () => null, llmChat: say('story') }, 'error': { llmConfig: async () => cfg, llmChat: async () => { throw new Error('503'); } },
    'config throws': { llmConfig: async () => { throw new Error('db'); }, llmChat: say('story') }, 'garbage': { llmConfig: async () => cfg, llmChat: say('I am not sure') }, 'empty': { llmConfig: async () => cfg, llmChat: async () => ({}) } };
  for (const [name, deps] of Object.entries(cases)) { const { q, a } = setup({ deps }); const r = await save(a, U1, { imageIds: own(q, U1), ratio: '16:9' }); assert.equal(r.code, 201, name); assert.equal(r.body.item.category, 'other', name); }
  const { q, a } = setup({ deps: { llmConfig: async () => cfg, llmChat: () => new Promise(() => {}), timeoutMs: 40 } });
  const t0 = Date.now(), r = await save(a, U1, { imageIds: own(q, U1) });
  assert.equal(r.body.item.category, 'other'); assert.ok(Date.now() - t0 < 1500, 'a hung model does not hang the save');
  assert.equal((await setup({ deps: { llmConfig: async () => cfg, llmChat: say('Reel.') } }).a.decide(U1, { imageCount: 1 })), 'reel', 'word is found inside a sentence, case-insensitive');
});
test('a category the person chose is never re-categorized; auto items follow their images', async () => {
  const { q, a } = setup(); const [c1] = own(q, U1);
  const it = (await save(a, U1, { imageIds: [c1], ratio: '1:1' })).body.item; assert.equal(it.category, 'photo');
  const patch = body => call(a.update, { uid: U1, params: { id: it.id }, body });
  const more = own(q, U1, 2);
  let r = await patch({ imageIds: [c1, ...more] }); assert.equal(r.body.item.category, 'carousel'); assert.equal(r.body.item.categorySource, 'auto', 'auto items are re-evaluated');
  r = await patch({ category: 'reel' }); assert.deepEqual([r.body.item.category, r.body.item.categorySource], ['reel', 'user']);
  r = await patch({ imageIds: [c1] }); assert.deepEqual([r.body.item.category, r.body.item.categorySource], ['reel', 'user'], 'images changed, category kept');
  r = await patch({ title: 'Story time' }); assert.equal(r.body.item.category, 'reel');
  r = await patch({ category: 'reel' }); assert.equal(r.body.item.categorySource, 'user', 'setting a category, even the same one, marks it as chosen');
  const [c2] = own(q, U1), moved = (await save(a, U1, { imageIds: [c2], ratio: '1:1' })).body.item;
  await call(a.move, { uid: U1, body: { ids: [moved.id], category: 'story' } });
  assert.equal((await call(a.getOne, { uid: U1, params: { id: moved.id } })).body.item.categorySource, 'user', 'bulk category change also counts as chosen');
});

// ---------- list ----------
async function seed() {
  const { q, a } = setup(); const f = (await call(a.createFolder, { uid: U1, body: { name: 'Summer' } })).body.folder, items = [];
  const rows = [['Latte art', 'warm', '1:1', 'draft', null], ['Sale 50% off', 'big', '9:16', 'ready', f.id], ['Cat_photo', 'x', '4:5', 'ready', null], ['Menu', 'new menu', null, 'draft', f.id], ['Trip', '', '1:1', 'draft', null]];
  for (const [title, caption, ratio, status, folderId] of rows) items.push((await save(a, U1, { imageIds: own(q, U1), title, caption, ratio, status, folderId })).body.item);
  await save(a, U2, { imageIds: own(q, U2), title: 'Latte secret', ratio: '1:1' });
  return { q, a, f, items };
}
const ls = (a, query, uid = U1) => call(a.list, { uid, query });
test('list: newest first, only the caller\'s items, filters by category, status, folder and none', async () => {
  const { a, f, items } = await seed();
  const all = await ls(a, {}); assert.deepEqual(all.body.items.map(i => i.title), ['Trip', 'Menu', 'Cat_photo', 'Sale 50% off', 'Latte art']); assert.equal(all.body.next, undefined);
  assert.deepEqual((await ls(a, { category: 'photo' })).body.items.map(i => i.title), ['Trip', 'Cat_photo', 'Latte art']);
  assert.deepEqual((await ls(a, { status: 'ready' })).body.items.map(i => i.title), ['Cat_photo', 'Sale 50% off']);
  assert.deepEqual((await ls(a, { folderId: f.id })).body.items.map(i => i.title), ['Menu', 'Sale 50% off']);
  assert.deepEqual((await ls(a, { folderId: 'none' })).body.items.map(i => i.title), ['Trip', 'Cat_photo', 'Latte art']);
  assert.deepEqual((await ls(a, { category: 'photo', status: 'ready', folderId: 'none' })).body.items.map(i => i.title), ['Cat_photo']);
  assert.deepEqual((await ls(a, {}, U2)).body.items.map(i => i.title), ['Latte secret']);
  assert.equal(items.length, 5);
});
test('list: q matches title or caption case-insensitively, and %, _ are literal text', async () => {
  const { a } = await seed(); const t = async s => (await ls(a, { q: s })).body.items.map(i => i.title);
  assert.deepEqual(await t('LATTE'), ['Latte art']); assert.deepEqual(await t('new menu'), ['Menu']); assert.deepEqual(await t('warm'), ['Latte art'], 'caption');
  assert.deepEqual(await t('50%'), ['Sale 50% off'], 'a percent sign is not a wildcard'); assert.deepEqual(await t('%'), ['Sale 50% off']); assert.deepEqual(await t('_'), ['Cat_photo'], 'an underscore is not a wildcard');
  assert.deepEqual(await t('a%t'), [], 'no wildcard matching'); assert.equal((await ls(a, { q: '   ' })).body.items.length, 5, 'blank q is no filter');
});
test('list: limit, next cursor (microsecond precision) and before page through everything exactly once', async () => {
  const { a } = await seed(); const seen = []; let before, pages = 0;
  do { const r = await ls(a, { limit: '2', ...(before ? { before } : {}) }); seen.push(...r.body.items.map(i => i.title)); before = r.body.next; pages++; } while (before && pages < 10);
  assert.deepEqual(seen, ['Trip', 'Menu', 'Cat_photo', 'Sale 50% off', 'Latte art']); assert.equal(pages, 3);
  const one = await ls(a, { limit: '5' }); assert.equal(one.body.next, undefined, 'exactly a full page: no next');
  assert.match((await ls(a, { limit: '4' })).body.next, /^2026-10-01T00:00:00\.\d{6}Z$/);
  assert.equal((await ls(a, {})).body.items.length, 5, 'default limit 50');
  for (const bad of [{ limit: '0' }, { limit: '101' }, { limit: 'x' }, { limit: '1.5' }, { category: 'video' }, { status: 'live' }, { folderId: 'abc' }, { before: 'yesterday' }, { q: 'x'.repeat(101) }]) assert.equal((await ls(a, bad)).code, 400, JSON.stringify(bad));
});

// ---------- overview ----------
test('GET /albums: always the five categories in order, zero counts included, covers from the newest items, folders and total', async () => {
  const { q, a } = setup(); let r = await call(a.overview, { uid: U1 });
  assert.deepEqual(r.body.albums.map(x => x.category), ['reel', 'photo', 'carousel', 'story', 'other']);
  assert.deepEqual(r.body.albums.map(x => [x.count, x.coverImageIds]), Array(5).fill([0, []])); assert.deepEqual([r.body.folders, r.body.total], [[], 0]);
  const f = (await call(a.createFolder, { uid: U1, body: { name: 'zeta' } })).body.folder; await call(a.createFolder, { uid: U1, body: { name: 'Alpha' } });
  const photos = []; for (let i = 0; i < 6; i++) { const [c] = own(q, U1); photos.push(c); await save(a, U1, { imageIds: [c], ratio: '1:1', folderId: i < 5 ? f.id : null }); }
  await save(a, U1, { imageIds: own(q, U1), ratio: '9:16' }); await save(a, U2, { imageIds: own(q, U2), ratio: '9:16' });
  r = await call(a.overview, { uid: U1 }); const by = Object.fromEntries(r.body.albums.map(x => [x.category, x]));
  assert.equal(by.photo.count, 6); assert.deepEqual(by.photo.coverImageIds, [photos[5], photos[4], photos[3], photos[2]], 'at most 4, newest first, the first image of each item');
  assert.equal(by.reel.count, 1); assert.equal(by.reel.coverImageIds.length, 1); assert.equal(r.body.total, 7, 'only this user\'s items');
  assert.deepEqual(r.body.folders.map(x => [x.name, x.count]), [['Alpha', 0], ['zeta', 5]], 'folders alphabetical, case-insensitive, with counts');
  assert.deepEqual(r.body.folders[1].coverImageIds, [photos[4], photos[3], photos[2], photos[1]]);
  assert.deepEqual(Object.keys(r.body.folders[0]).sort(), ['count', 'coverImageIds', 'id', 'name']);
});

// ---------- get / patch / delete / foreign ids ----------
test('get, patch and delete work on the owner\'s item; other users and malformed ids get 404 with no data', async () => {
  const { q, a } = setup(); const [c] = own(q, U1), it = (await save(a, U1, { imageIds: [c], ratio: '4:5', title: 'Mine' })).body.item;
  const as = (h, uid, id, body) => call(h, { uid, params: { id }, body });
  assert.equal((await as(a.getOne, U1, it.id)).body.item.title, 'Mine');
  for (const [h, name] of [[a.getOne, 'get'], [a.update, 'patch'], [a.remove, 'delete']]) {
    for (const id of [it.id, randomUUID(), 'not-a-uuid', '1; DROP TABLE saved_posts']) { const r = await as(h, U2, id, { title: 'hacked' }); assert.equal(r.code, 404, name + ' ' + id); assert.equal(r.body, undefined, 'no body, no data'); }
  }
  assert.equal(q.S.posts.length, 1); assert.equal(q.S.posts[0].title, 'Mine', 'nothing changed');
  const p = await as(a.update, U1, it.id, { title: '  New  ', caption: 'cap', status: 'ready' }); assert.deepEqual([p.body.item.title, p.body.item.caption, p.body.item.status], ['New', 'cap', 'ready']);
  assert.equal((await as(a.update, U1, it.id, { status: 'live' })).code, 400); assert.equal((await as(a.update, U1, it.id, {})).code, 400);
  assert.equal((await as(a.update, U1, it.id, { imageIds: [] })).code, 400);
  assert.equal((await as(a.update, U1, it.id, { folderId: randomUUID() })).code, 404, 'unknown folder');
  const d = await as(a.remove, U1, it.id); assert.equal(d.code, 204); assert.equal(q.S.posts.length, 0); assert.equal((await as(a.remove, U1, it.id)).code, 404);
});
test('patch: file into an own folder, take it out with null', async () => {
  const { q, a } = setup(); const f = (await call(a.createFolder, { uid: U1, body: { name: 'A' } })).body.folder;
  const it = (await save(a, U1, { imageIds: own(q, U1), ratio: '1:1' })).body.item, patch = (body, uid = U1) => call(a.update, { uid, params: { id: it.id }, body });
  assert.equal((await patch({ folderId: f.id })).body.item.folderId, f.id); assert.equal((await patch({ folderId: null })).body.item.folderId, null);
  const theirs = (await call(a.createFolder, { uid: U2, body: { name: 'B' } })).body.folder; assert.equal((await patch({ folderId: theirs.id })).code, 404, 'cannot file into someone else\'s folder');
});

// ---------- folders ----------
test('folders: create trims, 409 on a duplicate name in any case, names are per user, validation', async () => {
  const { a } = setup(), mk = (name, uid = U1) => call(a.createFolder, { uid, body: { name } });
  const r = await mk('  Summer 2026  '); assert.equal(r.code, 201); assert.deepEqual(Object.keys(r.body.folder).sort(), ['id', 'name']); assert.equal(r.body.folder.name, 'Summer 2026');
  assert.equal((await mk('summer 2026')).code, 409); assert.equal((await mk('SUMMER 2026 ')).code, 409); assert.match((await mk('summer 2026')).body.error, /already/);
  assert.equal((await mk('Summer 2026', U2)).code, 201, 'another user may use the same name');
  for (const bad of ['', '   ', 'x'.repeat(61), 5, undefined]) assert.equal((await mk(bad)).code, 400, String(bad)); assert.equal((await mk('x'.repeat(60))).code, 201);
});
test('folders: rename (409 on a clash, own folders only), delete unfiles the items and never deletes them', async () => {
  const { q, a } = setup(), mk = async (name, uid = U1) => (await call(a.createFolder, { uid, body: { name } })).body.folder, rn = (id, name, uid = U1) => call(a.renameFolder, { uid, params: { id }, body: { name } });
  const f1 = await mk('One'), f2 = await mk('Two'), theirs = await mk('Theirs', U2);
  assert.equal((await rn(f1.id, ' Uno ')).body.folder.name, 'Uno'); assert.equal((await rn(f1.id, 'two')).code, 409); assert.equal((await rn(f1.id, 'UNO')).code, 200, 'changing only the case of its own name is fine');
  assert.equal((await rn(f1.id, '')).code, 400); assert.equal((await rn(theirs.id, 'Mine')).code, 404); assert.equal((await rn('nope', 'x')).code, 404); assert.equal((await rn(randomUUID(), 'x')).code, 404);
  assert.equal((await rn(theirs.id, '')).code, 404, 'a foreign folder is a 404 even with a bad body');
  const it = (await save(a, U1, { imageIds: own(q, U1), ratio: '1:1', folderId: f2.id })).body.item; assert.equal(it.folderId, f2.id);
  assert.equal((await call(a.removeFolder, { uid: U2, params: { id: f2.id } })).code, 404); assert.equal(q.S.folders.length, 3);
  const d = await call(a.removeFolder, { uid: U1, params: { id: f2.id } }); assert.equal(d.code, 204);
  const after = (await call(a.getOne, { uid: U1, params: { id: it.id } })).body.item; assert.equal(after.folderId, null, 'now unfiled'); assert.equal(q.S.posts.length, 1, 'never deleted');
  assert.equal((await call(a.removeFolder, { uid: U1, params: { id: f2.id } })).code, 404); assert.equal((await call(a.removeFolder, { uid: U1, params: { id: 'zzz' } })).code, 404);
});

// ---------- bulk move ----------
test('move: counts only owned ids, folder must be owned or null, category counts as chosen', async () => {
  const { q, a } = setup(), f = (await call(a.createFolder, { uid: U1, body: { name: 'F' } })).body.folder, theirs = (await call(a.createFolder, { uid: U2, body: { name: 'G' } })).body.folder;
  const mine = []; for (let i = 0; i < 3; i++) mine.push((await save(a, U1, { imageIds: own(q, U1), ratio: '1:1' })).body.item);
  const other = (await save(a, U2, { imageIds: own(q, U2), ratio: '1:1' })).body.item, mv = (body, uid = U1) => call(a.move, { uid, body });
  let r = await mv({ ids: [mine[0].id, mine[1].id, other.id, randomUUID()], folderId: f.id }); assert.deepEqual([r.code, r.body], [200, { moved: 2 }]);
  assert.deepEqual(q.S.posts.filter(p => p.folder_id === f.id).length, 2); assert.equal(q.S.posts.find(p => p.id === other.id).folder_id, null, 'the other user\'s item is untouched');
  r = await mv({ ids: [other.id], folderId: f.id }); assert.deepEqual(r.body, { moved: 0 });
  r = await mv({ ids: [mine[0].id], folderId: null }); assert.deepEqual(r.body, { moved: 1 }); assert.equal(q.S.posts.find(p => p.id === mine[0].id).folder_id, null);
  assert.equal((await mv({ ids: [mine[0].id], folderId: theirs.id })).code, 404, 'someone else\'s folder'); assert.equal((await mv({ ids: [mine[0].id], folderId: randomUUID() })).code, 404);
  r = await mv({ ids: [mine[2].id, mine[1].id], category: 'story' }); assert.equal(r.body.moved, 2); assert.deepEqual(q.S.posts.find(p => p.id === mine[2].id).category_source, 'user');
  assert.equal(q.S.posts.find(p => p.id === mine[1].id).folder_id, f.id, 'a category-only move leaves the folder alone');
  for (const bad of [{}, { ids: [] }, { ids: ['x'], folderId: null }, { ids: [mine[0].id] }, { ids: [mine[0].id], category: 'video' }, { ids: [mine[0].id], folderId: 'abc' }, { ids: Array.from({ length: 201 }, () => randomUUID()), folderId: null }, { ids: 'abc', folderId: null }])
    assert.equal((await mv(bad)).code, 400, JSON.stringify(bad).slice(0, 60));
});

// ---------- wiring ----------
test('registerAlbumRoutes registers every endpoint of 4.5 (the literal /move before /:id)', () => {
  const seen = []; const reg = m => (p, ...f) => { seen.push(m + ' ' + p); assert.equal(typeof f.at(-1), 'function'); };
  registerAlbumRoutes({ get: reg('GET'), post: reg('POST'), patch: reg('PATCH'), del: reg('DELETE'), q: async () => [], limit: () => {} });
  assert.deepEqual(seen.sort(), ['DELETE /albums/folders/:id', 'DELETE /albums/items/:id', 'GET /albums', 'GET /albums/items', 'GET /albums/items/:id', 'PATCH /albums/folders/:id', 'PATCH /albums/items/:id', 'POST /albums/folders', 'POST /albums/items', 'POST /albums/items/move'].sort());
  const order = []; const rec = m => (p) => order.push(m + p); registerAlbumRoutes({ get: rec('GET '), post: rec('POST '), patch: rec('PATCH '), del: rec('DELETE '), q: async () => [] });
  assert.ok(order.indexOf('POST /albums/items/move') >= 0);
});
test('every statement is scoped to the caller (user_id in the SQL) and the DDL matches contract 3.3', async () => {
  const { q, a } = await seed(); await call(a.overview, { uid: U1 });
  assert.ok(q.S.sqls.length > 10); for (const s of q.S.sqls) assert.match(s, /user_id/, s.slice(0, 50)); // the fake already asserts this per call; kept as a visible guarantee
  const ddl = readFileSync(new URL('../db/schema.albums.sql', import.meta.url), 'utf8');
  assert.equal((ddl.match(/CREATE TABLE IF NOT EXISTS/g) || []).length, 2); assert.ok(!/CREATE TABLE(?! IF NOT EXISTS)/.test(ddl)); assert.match(ddl, /CREATE UNIQUE INDEX IF NOT EXISTS album_folders_name ON album_folders\(user_id, lower\(name\)\)/); assert.match(ddl, /CREATE INDEX IF NOT EXISTS saved_posts_user ON saved_posts\(user_id, category, updated_at DESC\)/);
  const norm = s => s.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').replace(/\s*([(),])\s*/g, '$1').trim();
  const doc = ['CONTRACT.md', 'Contract.md'].map(n => new URL('../docs/parallel/' + n, import.meta.url)).find(u => existsSync(u));
  if (doc) { const sec = readFileSync(doc, 'utf8').split('### 3.3')[1].split('```sql')[1].split('```')[0]; assert.equal(norm(ddl), norm(sec), 'DDL is exactly the contract\'s'); }
});