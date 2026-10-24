// Command Center chat UI (web/src/Assistant.tsx, pages/CommandCenter.tsx, chat/*, styles.css).
// Two kinds of test: unit tests of the pure helpers in web/src/chat/helpers.ts (imported straight from the .ts file, skipped on a Node
// without type stripping), and source-grep checks of the React wiring, which has never run in a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL('../web/src/' + p, import.meta.url), 'utf8');
let h = null; try { h = await import('../web/src/chat/helpers.ts'); } catch { /* old Node without type stripping */ }
const T = h ? test : test.skip;

// ---------- pure helpers ----------
T('stick-to-bottom: follows only while near the bottom, unless the person just sent something', () => {
  const el = (top, total = 2000, view = 500) => ({ scrollHeight: total, scrollTop: top, clientHeight: view });
  assert.equal(h.nearBottom(el(1500)), true, 'exactly at the bottom');
  assert.equal(h.nearBottom(el(1430)), true, 'within 80px counts as near');
  assert.equal(h.nearBottom(el(1000)), false, 'scrolled up');
  assert.equal(h.nearBottom(null), true);
  assert.equal(h.shouldStick(el(1000)), false, 'scrolled up: do not yank them down (show "jump to latest")');
  assert.equal(h.shouldStick(el(1000), true), true, 'their own send always scrolls');
});
T('message ids: server id when present, otherwise a unique client id; never an index', () => {
  assert.equal(h.messageId(42), 'm42'); assert.equal(h.messageId('9007199254740993'), 'm9007199254740993');
  const a = h.messageId(), b = h.messageId(undefined), c = h.messageId(null), d = h.messageId('  ');
  assert.equal(new Set([a, b, c, d]).size, 4);
  for (const x of [a, b, c, d]) assert.match(x, /^c/);
  assert.notEqual(h.messageId(1), h.messageId(2));
});
T('patchMessage touches exactly one message by id and leaves the rest identical', () => {
  const list = [{ id: 'a', role: 'user', type: 'info', text: 'hi' }, { id: 'b', role: 'assistant', type: 'analytics', text: 'x', data: { health: { score: 5 } } },
    { id: 'c', role: 'assistant', type: 'image', text: '', data: { status: 'pending', imageIds: [], ratio: '1:1' } }];
  const out = h.patchMessage(list, 'c', { data: { status: 'done', imageIds: ['i1'] } });
  assert.notEqual(out, list); assert.strictEqual(out[0], list[0]); assert.strictEqual(out[1], list[1], 'an older assistant answer is the very same object');
  assert.deepEqual(out[2].data, { status: 'done', imageIds: ['i1'], ratio: '1:1' }, 'data is merged, not replaced');
  assert.equal(list[2].data.status, 'pending', 'input not mutated');
  assert.strictEqual(h.patchMessage(list, 'nope', { text: 'x' }), list, 'unknown id (late poll for a removed message) changes nothing');
});
T('appendMessage never overwrites: a repeated id is ignored', () => {
  const l = [{ id: 'a', role: 'user', type: 'info', text: '1' }];
  assert.equal(h.appendMessage(l, { id: 'b', role: 'user', type: 'info', text: '2' }).length, 2);
  assert.strictEqual(h.appendMessage(l, { id: 'a', role: 'user', type: 'info', text: 'other' }), l);
});
T('two pending images merge independently by id (a newer send does not orphan an older poll)', () => {
  let list = [{ id: 'p1', role: 'assistant', type: 'image', text: '', data: { status: 'pending', imageIds: [] } },
    { id: 'u2', role: 'user', type: 'info', text: 'another' },
    { id: 'p2', role: 'assistant', type: 'image', text: '', data: { status: 'pending', imageIds: [] } }];
  let r = h.mergePolled(list, 'p2', { status: 'done', imageIds: ['B'], images: ['data:x'] }, 8); list = r.list;
  assert.equal(r.done, true); assert.deepEqual(list[2].data.imageIds, ['B']); assert.equal(list[0].data.status, 'pending', 'the older one is still waiting');
  r = h.mergePolled(list, 'p1', { status: 'active' }, 4); list = r.list;
  assert.equal(r.done, false); assert.equal(list[0].data.elapsed, 4);
  r = h.mergePolled(list, 'p1', { status: 'done', imageIds: ['A'] }, 10); list = r.list;
  assert.deepEqual([list[0].data.imageIds, list[2].data.imageIds], [['A'], ['B']]);
});
T('pollPatch: failed keeps the error text; done without ids falls back to inline images; done with nothing is a failure', () => {
  assert.deepEqual(h.pollPatch({ status: 'failed', error: 'Replicate said no' }, 3).patch.data, { status: 'failed', error: 'Replicate said no', elapsed: 3 });
  assert.match(h.pollPatch({ status: 'failed' }, 1).patch.data.error, /failed/);
  const legacy = h.pollPatch({ status: 'done', images: ['data:image/png;base64,AA'] }, 2);
  assert.deepEqual(legacy.patch.data.inline, ['data:image/png;base64,AA']); assert.equal(legacy.patch.data.status, 'done');
  assert.equal(h.pollPatch({ status: 'done' }, 2).patch.data.status, 'failed');
  assert.equal(h.pollPatch({ status: 'waiting' }, 0).done, false);
});
T('request body: image mode sends mode:image, ratio, referenceImageId and overlayText; chat mode sends none of the image keys', () => {
  const img = h.buildAssistantBody({ text: 'make the drink hot', conversationId: 'c1', image: true, ratio: '4:5', referenceImageId: 'ref1', overlayText: '  Fresh  ' });
  assert.deepEqual(img, { message: 'make the drink hot', conversationId: 'c1', mode: 'image', ratio: '4:5', overlayText: 'Fresh', referenceImageId: 'ref1' });
  assert.equal(h.buildAssistantBody({ text: 'x', image: true, ratio: '3:2' }).ratio, '1:1', 'unknown ratio falls back');
  const chat = h.buildAssistantBody({ text: 'how am I doing?' });
  assert.deepEqual(chat, { message: 'how am I doing?' });
  assert.ok(!('referenceImage' in img), 'no base64 reference is sent any more');
});
T('retryParams: re-sends the user line before the failed image with the same ratio and reference; null when there is nothing to send', () => {
  const list = [{ id: 'u', role: 'user', type: 'info', text: 'green background' }, { id: 'a', role: 'assistant', type: 'image', text: '', data: { status: 'failed', ratio: '9:16', parentImageId: 'P' } }];
  assert.deepEqual(h.retryParams(list, 'a'), { text: 'green background', ratio: '9:16', referenceImageId: 'P', overlayText: undefined });
  assert.equal(h.retryParams(list, 'zzz'), null);
  assert.equal(h.retryParams([{ id: 'a', role: 'assistant', type: 'image', text: '', data: {} }], 'a'), null);
  assert.equal(h.retryParams([{ id: 'a', role: 'assistant', type: 'image', text: '', data: { instruction: 'hot drink' } }], 'a').text, 'hot drink');
});
T('fromServerMessage: stable ids from the server, image messages always carry imageIds and a status', () => {
  const u = h.fromServerMessage({ id: '7', role: 'user', type: 'info', text: 'hi', data: {} });
  assert.deepEqual([u.id, u.serverId, u.role, u.type], ['m7', '7', 'user', 'info']);
  const done = h.fromServerMessage({ id: '8', role: 'assistant', type: 'image', text: 't', data: { imageIds: ['a'], status: 'done' } });
  assert.deepEqual([done.data.imageIds, done.data.status], [['a'], 'done']);
  const pend = h.fromServerMessage({ id: '9', role: 'assistant', type: 'image', text: '', data: { jobId: 'j' } });
  assert.deepEqual([pend.data.imageIds, pend.data.status, pend.data.jobId], [[], 'pending', 'j']);
  assert.equal(h.fromServerMessage({ id: '10', role: 'assistant', type: 'image', data: { imageIds: ['z'] } }).data.status, 'done');
  assert.equal(h.fromServerMessage(null).role, 'assistant');
});
T('relTime: short Instagram-style ages', () => {
  const now = Date.parse('2026-10-23T12:00:00Z'), ago = s => new Date(now - s * 1000).toISOString();
  assert.equal(h.relTime(ago(10), now), 'now'); assert.equal(h.relTime(ago(5 * 60), now), '5m'); assert.equal(h.relTime(ago(3 * 3600), now), '3h');
  assert.equal(h.relTime(ago(2 * 86400), now), '2d'); assert.equal(h.relTime(ago(14 * 86400), now), '2w');
  assert.match(h.relTime(ago(90 * 86400), now), /^[A-Z][a-z]{2} \d{1,2}$/); assert.equal(h.relTime('junk', now), ''); assert.equal(h.relTime(null, now), '');
});
T('parseHash: #cc=<id>&ref=<imageId>; anything else is not ours', () => {
  assert.deepEqual(h.parseHash('#cc=abc12345-6789&ref=img_0001'), { cc: 'abc12345-6789', ref: 'img_0001' });
  assert.deepEqual(h.parseHash('#cc=3f2b8c1e-aaaa-bbbb-cccc-1234567890ab'), { cc: '3f2b8c1e-aaaa-bbbb-cccc-1234567890ab' });
  assert.deepEqual(h.parseHash('ref=img_0001&cc=abc12345'), { cc: 'abc12345', ref: 'img_0001' }, 'order does not matter, # is optional');
  for (const bad of ['', '#', '#settings', '#albums', '#cc=', '#cc=a', '#cc=<script>', '#cc=%E0%A4%A', '#x=1', null, undefined]) assert.equal(h.parseHash(bad), null, String(bad));
  assert.deepEqual(h.parseHash('#cc=abc12345&evil=1'), { cc: 'abc12345' }, 'unknown keys are ignored');
});

// ---------- source checks (wiring) ----------
const A = read('Assistant.tsx'), CC = read('pages/CommandCenter.tsx'), CSS = read('styles.css');
const IM = read('chat/ImageMessage.tsx'), HD = read('chat/HistoryDrawer.tsx'), IP = read('chat/ImagePicker.tsx');
const code = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('messages are keyed by their stable id, never by array index', () => {
  assert.match(A, /msgs\.map\(msg=><Message key=\{msg\.id\}/);
  for (const [n, s] of [['Assistant', A], ['ImageMessage', IM], ['HistoryDrawer', HD], ['ImagePicker', IP]]) assert.ok(!/key=\{i\}/.test(s), n + ' has key={i}');
  assert.match(A, /newClientId\(\)/); assert.match(A, /messageId\(serverId\)/);
});
test('no "walk back to the last assistant message and overwrite it" code', () => {
  const a = code(A);
  assert.ok(!/for\(let k=copy\.length-1/.test(a) && !/copy\[k\]/.test(a), 'the overwrite loop is gone');
  assert.ok(!/last assistant/i.test(a));
  assert.ok(!/Generating your image…'\+i\*2/.test(a), 'the overwriting placeholder text is gone');
  assert.ok(!/seq\.current/.test(a), 'no shared sequence number that cancels older polls');
  assert.match(a, /patchMessage\(l,msgId,r\.patch\)/, 'polling patches one message by id');
  assert.match(a, /polling\.current/, 'each pending image polls independently');
});
test('an image request appends its own placeholder and goes through /assistant, not /content/image', () => {
  const a = code(A);
  assert.match(a, /appendMessage\(l,\{id:phId,role:'assistant',type:'image'/);
  assert.match(a, /api<any>\('\/assistant'/); assert.ok(!/api<any>\('\/content\/image',\{method/.test(a), 'does not call /content/image to generate');
  assert.match(a, /api<any>\('\/content\/image\/'\+encodeURIComponent\(jobId\)\)/, 'it still polls the job');
  assert.match(read('chat/helpers.ts'), /b\.mode = 'image'/); assert.match(read('chat/helpers.ts'), /b\.referenceImageId = o\.referenceImageId/); assert.match(read('chat/helpers.ts'), /b\.overlayText/);
  assert.match(a, /buildAssistantBody\(\{text:o\.text,conversationId:convoRef\.current,image:o\.image,ratio:o\.ratio,referenceImageId:o\.referenceImageId,overlayText:o\.overlayText\}\)/);
  assert.match(a, /d\.summary|summary:'Sending your request/); assert.match(IM, /d\.summary/);
});
test('the thread is its own bottom-anchored scroller with the composer fixed below it, and a jump-to-latest button', () => {
  assert.match(CSS, /\.assistant-page \.page-thread\{[^}]*overflow-y:auto/);
  assert.ok(!/\.page-thread\{[^}]*overflow:visible/.test(CSS), 'the old overflow:visible rule is gone');
  assert.match(CSS, /\.assistant-page \.page-bar\{flex:none/); assert.ok(!/\.page-bar\{[^}]*position:sticky/.test(CSS));
  assert.match(CSS, /\.thread-inner\{[^}]*margin-top:auto/); assert.match(CSS, /main\.cc-main\{[^}]*height:100vh/); assert.match(CSS, /\.cc-centered\{[^}]*flex:1;min-height:0/);
  assert.match(A, /nearBottom\(threadRef\.current\)/); assert.match(A, /onScroll=\{onScroll\}/); assert.match(A, /showJump && <button[^>]*className="jump-latest"/); assert.match(A, /Jump to latest/);
  assert.match(A, /if\(stick\.current\)scrollBottom\(\)/);
});
test('reference picking: chip on the composer, picker panel, per-image actions, legacy upload through the library', () => {
  assert.match(A, /className="ref-chip"/); assert.match(A, /aria-label="Remove reference image"/);
  assert.match(IM, /Use as reference/); assert.match(IM, /Continue editing/);
  assert.match(IP, /\/images\?limit=24/); assert.match(IP, /before=/); assert.match(IP, /Load more/);
  assert.match(A, /api<any>\('\/images\/upload',\{method:'POST',body:\{dataUrl\}\}\)/); assert.ok(!/referenceImage:ref/.test(A), 'no base64 reference in the request');
});
test('library reads: batched thumbs (ids=), full image only on open', () => {
  const t = read('chat/thumbs.ts');
  assert.match(t, /\/images\?limit=40&ids=/); assert.match(t, /i \+= 40/); assert.match(t, /'\/images\/' \+ encodeURIComponent\(id\)/);
  assert.match(IM, /fullImage\(id\)/);
});
test('history: list, new chat, rename, delete with confirmation, open; the open conversation is remembered and sent with every request', () => {
  assert.match(HD, /\/conversations\?limit=30/); assert.match(HD, /method: 'PATCH'/); assert.match(HD, /method: 'DELETE'/); assert.match(HD, /Delete this chat\?/); assert.match(HD, /New chat/); assert.match(HD, /relTime\(/); assert.match(HD, /coverImageId/);
  assert.match(A, /api<any>\('\/conversations\/'\+encodeURIComponent\(id\)\)/); assert.match(A, /localStorage\.setItem\(CONVO_KEY,id\)/); assert.match(A, /localStorage\.getItem\(CONVO_KEY\)/);
  assert.match(A, /if\(x\.conversationId\)setConvo\(String\(x\.conversationId\)\)/); assert.match(A, /conversationId:convoRef\.current/);
  assert.match(A, /fromServerMessage/); assert.match(A, /status==='pending'&&mm\.data\?\.jobId\)pollImage/);
});
test('save to album: POST /albums/items with imageIds, ratio and conversationId; Saved state; failed images offer Retry', () => {
  assert.match(A, /api\('\/albums\/items',\{method:'POST',body:\{imageIds:ids,ratio:mm\.data\?\.ratio\|\|undefined,conversationId:convoRef\.current\|\|undefined\}\}\)/);
  assert.match(IM, /Saved ✓/); assert.match(IM, /Retry/); assert.match(IM, /d\.error/);
});
test('deep links: #cc=... read on mount, hashchange and nav; applied, then cleared with history.replaceState', () => {
  assert.match(CC, /parseHash\(location\.hash\)/); assert.match(CC, /addEventListener\('hashchange', read\)/); assert.match(CC, /addEventListener\('nav', read\)/);
  assert.match(CC, /history\.replaceState\(null, '', location\.pathname \+ location\.search\)/); assert.match(CC, /setDeepLink\(/);
  assert.match(CC, /read\(\);\n/, 'also read once on mount');
  assert.match(A, /deepLink\.cc&&deepLink\.cc!==convoRef\.current\)openConversation\(deepLink\.cc\)/); assert.match(A, /if\(deepLink\.ref\)cont\(deepLink\.ref\)/);
});
test('theming: only the existing CSS variables in the new rules, mobile rules present', () => {
  const mine = CSS.slice(CSS.indexOf('/* ---- Command Center chat:'));
  assert.ok(mine.length > 500);
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(mine), 'no hard-coded colours in the new block (rgba overlays aside)');
  for (const v of ['--bg', '--pn', '--bd', '--tx', '--mu', '--hv', '--bub', '--grad']) assert.ok(!mine.includes(v + ':'), 'does not redefine ' + v);
  assert.match(CSS, /@media\(max-width:700px\)\{[\s\S]*\.hist-drawer\{width:100vw\}/);
});