// Stream 6 (albums-ui): hash router, Albums page, thumbnail batching. Source-grep style like the other UI tests; the pure helpers
// (web/src/albums/{hash,model,thumbs}.ts) are imported and exercised directly. Skipped on Node < 22.18 (no .ts import).
// Run: node --test test/albumsUi.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = p => fs.readFileSync(new URL('../web/src/' + p, import.meta.url), 'utf8');
const albumFiles = fs.readdirSync(new URL('../web/src/albums/', import.meta.url)).map(f => 'albums/' + f);
const pageSources = ['pages/Albums.tsx', ...albumFiles].map(f => [f, read(f)]);
const allAlbumSrc = pageSources.map(([, s]) => s).join('\n');

let hash = null, model = null, thumbs = null;
try { hash = await import('../web/src/albums/hash.ts'); model = await import('../web/src/albums/model.ts'); thumbs = await import('../web/src/albums/thumbs.ts'); } catch { /* old Node */ }
const t = (name, fn) => hash ? test(name, fn) : test(name, { skip: 'needs Node 22.18+ to import web/src/albums/*.ts' }, () => {});

/* ---------- hash router ---------- */
t('hash: #albums, #settings and #cc(=...) map to pages; anything else is not ours', () => {
  const { pageFromHash } = hash;
  assert.equal(pageFromHash('#albums'), 'Albums'); assert.equal(pageFromHash('#Albums'), 'Albums');
  assert.equal(pageFromHash('#settings'), 'Settings');
  assert.equal(pageFromHash('#cc=abc'), 'Dashboard'); assert.equal(pageFromHash('#cc=abc&ref=def'), 'Dashboard'); assert.equal(pageFromHash('#cc'), 'Dashboard');
  for (const h of ['', '#', '#other', '#ccc', '#albumsx', '#/albums']) assert.equal(pageFromHash(h), null, h);
});
t('hash: #cc=<id>&ref=<id> is parsed and built symmetrically; no ref when there is no image', () => {
  const { parseCc, ccHash } = hash, c = '3f2b8c1e-0000-4000-8000-000000000001', i = '3f2b8c1e-0000-4000-8000-000000000002';
  assert.equal(ccHash(c, i), `#cc=${c}&ref=${i}`); assert.equal(ccHash(c), `#cc=${c}`); assert.equal(ccHash(c, null), `#cc=${c}`);
  assert.deepEqual(parseCc(ccHash(c, i)), { id: c, ref: i }); assert.deepEqual(parseCc(ccHash(c)), { id: c, ref: null });
  assert.deepEqual(parseCc('#albums'), { id: null, ref: null }); assert.deepEqual(parseCc(''), { id: null, ref: null });
  assert.equal(ccHash('a b&c', 'x/y'), '#cc=a%20b%26c&ref=x%2Fy');
});
t('hash: clicking a nav item updates the address bar, but never clears a pending #cc=', () => {
  const { hashAfterNav, hashForPage } = hash;
  assert.equal(hashForPage('Albums'), '#albums'); assert.equal(hashForPage('Settings'), '#settings'); assert.equal(hashForPage('Statistics'), '');
  assert.equal(hashAfterNav('Dashboard', '#cc=abc&ref=def'), null, 'the Command Center clears its own hash');
  assert.equal(hashAfterNav('Dashboard', '#albums'), ''); assert.equal(hashAfterNav('Statistics', '#albums'), ''); assert.equal(hashAfterNav('Albums', ''), '#albums');
  assert.equal(hashAfterNav('Albums', '#albums'), null); assert.equal(hashAfterNav('Statistics', ''), null); assert.equal(hashAfterNav('Statistics', '#'), null);
  assert.equal(hashAfterNav('Settings', '#albums'), '#settings');
});
test('App.tsx: routes #albums, #settings and #cc=, listens to hashchange AND nav, and removes both listeners', () => {
  const app = read('App.tsx');
  assert.match(app, /from '\.\/albums\/hash'/); assert.match(app, /pageFromHash\(location\.hash\)/);
  for (const ev of ['hashchange', 'nav']) { assert.match(app, new RegExp(`window\\.addEventListener\\('${ev}'`)); assert.match(app, new RegExp(`window\\.removeEventListener\\('${ev}'`)); }
  assert.match(app, /import Albums from '\.\/pages\/Albums'/); assert.match(app, /^\s*Albums,$/m);
  assert.match(app, /\{label:'Albums',page:'Albums',icon:'albums'\}/);
  assert.match(app, /hashAfterNav\(page,location\.hash\)/, 'nav clicks keep the hash in step');
  assert.match(app, /fromNav/, 'an empty hash on a bare nav event must not change the page');
  assert.ok(!/location\.hash\s*=\s*['"`]{2}/.test(app) && !/location\.hash\s*=\s*['"`]#?['"`]/.test(app), 'App never wipes the hash itself');
  assert.match(app, /cc \? <CommandCenter\/> : <P go=\{go\}\/>/, 'the Command Center is mounted only on the Dashboard, exactly as before');
});
test('icons.tsx: the Albums icon and every icon the Albums files use exist', () => {
  const icons = read('icons.tsx'), body = icons.slice(icons.indexOf('const PATHS = {'), icons.indexOf('} as const'));
  const defined = new Set([...body.matchAll(/^\s*(?:'([^']+)'|([A-Za-z][\w]*)):\s*'/gm)].map(m => m[1] || m[2]));
  assert.ok(defined.has('albums'));
  const used = new Set([...allAlbumSrc.matchAll(/<Icon name="([^"]+)"/g)].map(m => m[1])); used.add('albums');
  for (const u of used) assert.ok(defined.has(u), `icon "${u}" is not defined in icons.tsx`);
  assert.ok(defined.has('home') && defined.has('Roadmap'), 'existing icons are still there');
});

/* ---------- categories, ratio helpers, query ---------- */
t('categories render in the fixed order Reels, Photos, Carousels, Stories, Other, whatever the server sends', () => {
  const { CATEGORIES, orderedAlbums } = model;
  assert.deepEqual(CATEGORIES.map(c => c.key), ['reel', 'photo', 'carousel', 'story', 'other']);
  assert.deepEqual(CATEGORIES.map(c => c.label), ['Reels', 'Photos', 'Carousels', 'Stories', 'Other']);
  const o = orderedAlbums([{ category: 'other', count: 1, coverImageIds: ['a'] }, { category: 'reel', count: 5, coverImageIds: ['1', '2', '3', '4', '5', '6'] }, { category: 'bogus', count: 9 }]);
  assert.deepEqual(o.map(a => a.category), ['reel', 'photo', 'carousel', 'story', 'other']);
  assert.deepEqual(o.map(a => a.count), [5, 0, 0, 0, 1]); assert.equal(o[0].coverImageIds.length, 4, 'a cover collage shows at most 4 thumbs');
  assert.deepEqual(orderedAlbums(null).map(a => a.count), [0, 0, 0, 0, 0]);
  assert.match(read('pages/Albums.tsx'), /orderedAlbums\(ov\?\.albums\)/);
});
t('items query: only set filters are sent, values are encoded, limit is capped at 100', () => {
  const { itemsQuery } = model;
  assert.equal(itemsQuery({ limit: 50 }), '?limit=50'); assert.equal(itemsQuery({}), '?limit=50');
  assert.equal(itemsQuery({ category: 'reel', status: 'draft', q: 'a b&c', before: '2026-10-01T00:00:00.000Z', limit: 20 }), '?category=reel&status=draft&q=a%20b%26c&before=2026-10-01T00%3A00%3A00.000Z&limit=20');
  assert.equal(itemsQuery({ folderId: 'f1', status: undefined, q: '' }), '?folderId=f1&limit=50'); assert.equal(itemsQuery({ limit: 5000 }), '?limit=100');
});
t('ratio helpers: CSS aspect-ratio, outline shape, unknown ratios fall back to square', () => {
  const { ratioCss, ratioShape } = model;
  assert.equal(ratioCss('4:5'), '4 / 5'); assert.equal(ratioCss('9:16'), '9 / 16'); assert.equal(ratioCss(null), '1 / 1'); assert.equal(ratioCss('wide'), '1 / 1'); assert.equal(ratioCss('0:5'), '1 / 1');
  assert.deepEqual(ratioShape('1:1'), { w: 14, h: 14 }); assert.deepEqual(ratioShape('4:5'), { w: 11, h: 14 }); assert.deepEqual(ratioShape('9:16'), { w: 8, h: 14 }); assert.deepEqual(ratioShape('16:9'), { w: 14, h: 8 });
});

/* ---------- thumbnails ---------- */
t('chunk splits ids into groups of at most 40', () => {
  const { chunk, BATCH } = thumbs; assert.equal(BATCH, 40);
  const ids = Array.from({ length: 95 }, (_, i) => 'i' + i);
  assert.deepEqual(chunk(ids).map(c => c.length), [40, 40, 15]); assert.deepEqual(chunk([]), []); assert.deepEqual(chunk(ids.slice(0, 40)).map(c => c.length), [40]);
});
t('thumb store: batches of 40, session cache, no duplicate requests, in-flight dedupe', async () => {
  const calls = [], fetchBatch = async ids => { calls.push(ids); return ids.map(id => ({ id, thumb: 'data:image/jpeg;base64,' + id })); };
  const s = thumbs.makeThumbStore(fetchBatch), ids = Array.from({ length: 100 }, (_, i) => 'i' + i);
  await s.load(ids); assert.deepEqual(calls.map(c => c.length), [40, 40, 20]); assert.ok(calls.every(c => c.length <= 40));
  assert.equal(s.get('i7'), 'data:image/jpeg;base64,i7');
  await s.load(ids); assert.equal(calls.length, 3, 'everything is cached for the session');
  await s.load([...ids, 'n1', 'n1', '']); assert.deepEqual(calls.at(-1), ['n1'], 'only the new id, once');
  const calls2 = [], slow = thumbs.makeThumbStore(async ids => { calls2.push(ids); await new Promise(r => setTimeout(r, 10)); return ids.map(id => ({ id, thumb: 'x' + id })); });
  await Promise.all([slow.load(['a', 'b']), slow.load(['b', 'c']), slow.load(['a'])]);
  assert.equal(calls2.flat().filter(x => x === 'b').length, 1, 'an id already being fetched is not requested again');
});
t('thumb store: ids the server does not return are remembered as missing; a failed request is retried next time and never throws', async () => {
  let fail = true; const calls = [];
  const s = thumbs.makeThumbStore(async ids => { calls.push(ids); if (fail) throw new Error('network'); return ids.filter(id => id !== 'gone').map(id => ({ id, thumb: 't' + id })); });
  await s.load(['a', 'gone']); assert.ok(s.isFailed('a')); assert.equal(s.get('a'), undefined);
  fail = false; await s.load(['a', 'gone']); assert.equal(s.get('a'), 'ta'); assert.ok(s.isMissing('gone')); assert.ok(!s.isFailed('a'));
  const n = calls.length; await s.load(['a', 'gone']); assert.equal(calls.length, n, 'neither cached nor missing ids are asked again');
});
t('thumb store: notifies subscribers, and the cache is bounded (oldest dropped first)', async () => {
  const s = thumbs.makeThumbStore(async ids => ids.map(id => ({ id, thumb: 't' + id })), 3); let n = 0; const off = s.subscribe(() => n++);
  await s.load(['a', 'b', 'c', 'd']); assert.ok(n >= 1); assert.equal(s.size(), 3); assert.equal(s.get('a'), undefined); assert.equal(s.get('d'), 'td');
  off(); const before = n; await s.load(['e']); assert.equal(n, before);
});
t('full-image cache: fetched once per image, concurrent opens share one request, a failure is not cached, only a few are kept', async () => {
  let calls = 0, fail = false; const c = thumbs.makeFullCache(async id => { calls++; if (fail) throw new Error('boom'); return 'data:' + id; }, 2);
  const [a, b] = await Promise.all([c.load('x'), c.load('x')]); assert.equal(a, b); assert.equal(calls, 1);
  await c.load('x'); assert.equal(calls, 1);
  await c.load('y'); await c.load('z'); assert.equal(c.get('x'), undefined, 'least recently used is dropped'); assert.equal(c.get('z'), 'data:z');
  fail = true; await assert.rejects(c.load('w'), /boom/); fail = false; assert.equal(await c.load('w'), 'data:w');
  const empty = thumbs.makeFullCache(async () => ''); await assert.rejects(empty.load('q'), /empty/);
});
test('thumbnails are prefetched in batches by the parent and fetched through GET /api/images?ids=; full image only on open', () => {
  const store = read('albums/thumbstore.ts'), page = read('pages/Albums.tsx'), sheet = read('albums/ItemSheet.tsx'), thumb = read('albums/Thumb.tsx');
  assert.match(store, /'\/images\?ids='\+ids\.map\(encodeURIComponent\)\.join\(','\)/); assert.match(store, /makeThumbStore/);
  assert.match(page, /usePrefetch\(covers\)/); assert.match(page, /usePrefetch\(useMemo\(\(\)=>items\.map/);
  assert.match(thumb, /useThumb/); assert.ok(!/thumbStore\.load|usePrefetch/.test(thumb), 'single <Img> components never fire their own request');
  assert.match(store, /'\/images\/'\+encodeURIComponent\(id\)/); assert.match(sheet, /fullImages\.load\(id\)/);
});

/* ---------- the page ---------- */
test('Albums page and client call every album endpoint of contract 4.5 with the right method', () => {
  const client = read('albums/client.ts');
  assert.match(client, /api<Overview>\('\/albums'\)/);
  assert.match(client, /'\/albums\/items'\+itemsQuery\(p\)/);
  assert.match(client, /'\/albums\/items\/'\+enc\(id\),\{method:'PATCH',body\}/);
  assert.match(client, /'\/albums\/items\/'\+enc\(id\),\{method:'DELETE'\}/);
  assert.match(client, /'\/albums\/items\/move',\{method:'POST',body\}/);
  assert.match(client, /'\/albums\/folders',\{method:'POST',body:\{name\}\}/);
  assert.match(client, /'\/albums\/folders\/'\+enc\(id\),\{method:'PATCH',body:\{name\}\}/);
  assert.match(client, /'\/albums\/folders\/'\+enc\(id\),\{method:'DELETE'\}/);
  const page = read('pages/Albums.tsx');
  for (const fn of ['getOverview', 'getItems', 'patchItem', 'deleteItem', 'moveItems', 'createFolder', 'renameFolder', 'deleteFolder']) assert.match(page, new RegExp(`A\\.${fn}\\(`), fn);
  assert.match(page, /import '\.\.\/albums\.css'/);
});
test('Albums page: tiles for categories + folders with "New folder", search, status filter, Load more, multi-select with bulk move', () => {
  const p = read('pages/Albums.tsx');
  for (const s of ['New folder', 'Search titles and captions', 'Filter by status', 'Load more', 'Select all loaded', 'Move selected posts to', 'All posts']) assert.ok(p.includes(s), s);
  assert.match(p, /before:next/); assert.match(p, /ids,folderId:/); assert.match(p, /ids,category:/);
  assert.match(p, /<Collage ids=\{a\.coverImageIds\}/); assert.match(p, /ratioShape\(it\.ratio\)/); assert.match(p, /alb-status/);
});
test('Albums page: loading, empty and error states exist for the overview and the list', () => {
  const p = read('pages/Albums.tsx');
  assert.match(p, /aria-label="Loading albums"/); assert.match(p, /aria-label="Loading posts"/); assert.match(p, /Nothing saved yet/); assert.match(p, /No posts here yet/); assert.match(p, /No posts match/);
  assert.ok((p.match(/Try again/g) || []).length >= 2); assert.match(p, /className="alb-state" role="alert"/); assert.match(p, /moreErr/);
});
test('optimistic updates (edit, delete, move, rename, delete folder) all roll back on failure', () => {
  const p = read('pages/Albums.tsx');
  assert.ok((p.match(/\/\/ optimistic/g) || []).length >= 5, 'five optimistic updates'); assert.ok((p.match(/\/\/ rollback/g) || []).length >= 5, 'five rollbacks');
  assert.match(p, /setItems\(snapshot\)/); assert.match(p, /setOv\(before\)/); assert.match(p, /splice\(Math\.min\(at,c\.length\),0,it\)/);
});
test('folder delete says it only unfiles the posts; item delete asks for confirmation', () => {
  const p = read('pages/Albums.tsx'), sheet = read('albums/ItemSheet.tsx');
  assert.match(p, /become unfiled: nothing is deleted/); assert.match(p, /Delete the folder/);
  assert.match(sheet, /<Confirm title="Delete this post\?"/); assert.match(sheet, /onConfirm=\{\(\)=>\{setAsk\(false\);onDelete\(\)\}\}/);
});
test('item sheet: gallery with arrows/swipe, editable title + caption, category, folder, status, and Continue editing', () => {
  const s = read('albums/ItemSheet.tsx');
  for (const x of ['Previous image', 'Next image', 'onTouchStart', 'onTouchEnd', 'ArrowLeft', 'ArrowRight', 'label"><span>Title', 'Caption', 'Category', 'Folder', 'Status', 'No folder', 'aria-pressed']) assert.ok(s.includes(x.replace('label"><span>', '<span>')), x);
  assert.match(s, /onPatch\(\{title:t\}\)/); assert.match(s, /onPatch\(\{caption\}\)/); assert.match(s, /onPatch\(\{category:/); assert.match(s, /onPatch\(\{folderId:/); assert.match(s, /onPatch\(\{status:s\}\)/);
});
test('Continue editing: sets #cc=<conversationId>&ref=<coverImageId>, dispatches nav, and is disabled with a tooltip without a conversation', () => {
  const s = read('albums/ItemSheet.tsx');
  assert.match(s, /location\.hash=ccHash\(item\.conversationId,item\.imageIds\?\.\[0\]\)/); assert.match(s, /window\.dispatchEvent\(new Event\('nav'\)\)/);
  assert.ok(s.indexOf('location.hash=ccHash') < s.indexOf("dispatchEvent(new Event('nav'))"), 'hash first, then nav');
  assert.match(s, /disabled=\{!canContinue\}/); assert.match(s, /title=\{canContinue\?'Reopen the chat this post came from':why\}/); assert.match(s, /const canContinue=!!item\.conversationId/);
  assert.match(s, /import \{ccHash\} from '\.\/hash'/);
});
test('streams share no code: nothing in Albums imports from chat/, cc.ts, Assistant or CommandCenter; styles.css is not imported or edited by the page', () => {
  for (const [f, src] of [...pageSources, ['App.tsx', read('App.tsx')]]) {
    assert.ok(!/from\s+['"][^'"]*\/chat\//.test(src), f + ' imports from chat/');
    if (f !== 'App.tsx') { assert.ok(!/from\s+['"][^'"]*(\/cc|Assistant|CommandCenter|styles\.css)['"]/.test(src), f + ' imports another stream\'s file'); }
  }
});
test('albums.css: colors come from the existing CSS variables only, every rule is .alb-prefixed, and it has a mobile layout', () => {
  const css = read('albums.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(css), 'no hard-coded hex colors');
  assert.ok(!/(^|[;{\s])--[\w-]+\s*:/.test(css), 'no new custom properties are defined');
  const used = new Set([...css.matchAll(/var\((--[\w-]+)/g)].map(m => m[1])); const known = new Set(['--bg', '--pn', '--bd', '--tx', '--mu', '--hv', '--bub', '--card', '--soft', '--ac', '--up', '--dn', '--rd', '--gn', '--grad', '--font', '--dv']);
  for (const v of used) assert.ok(known.has(v), v + ' is not an existing variable');
  assert.ok(used.has('--bd') && used.has('--tx') && used.has('--pn'));
  for (const sel of css.replace(/@media[^{]*\{/g, '').matchAll(/(?:^|\})\s*([^{}]+)\{/g)) for (const part of sel[1].split(',')) assert.match(part.trim(), /\.alb|^@keyframes|^from|^to|^\d+%/, 'unprefixed selector: ' + part.trim());
  assert.match(css, /@media\(max-width:700px\)/);
});
test('Dialog: Esc closes only the topmost modal, focus is trapped and restored', () => {
  const d = read('albums/Dialog.tsx');
  assert.match(d, /stack\[stack\.length-1\]!==me/); assert.match(d, /e\.key==='Escape'/); assert.match(d, /e\.key!=='Tab'/); assert.match(d, /prev\?\.focus/); assert.match(d, /role="dialog" aria-modal="true"/);
});