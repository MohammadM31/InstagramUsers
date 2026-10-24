// Image brain: new image vs edit, which earlier image, faithful edit instruction, strict LLM validation, heuristic fallback.
// No Redis/Postgres/sharp/network: the LLM is a fake function and the history is plain data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeImageIntent, jobParams, framedEdit, readHistory, looksLikeEdit, editInstruction, imagePrompt, keepsNativeAspect, isUuid, DEFAULT_RATIO } from '../src/imageintent.js';

const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222', C = '33333333-3333-4333-8333-333333333333';
const now = Date.parse('2026-10-23T12:00:00Z');
const iso = ms => new Date(now - ms).toISOString();
const imgMsg = (id, ids, extra = {}) => ({ id, role: 'assistant', type: 'image', text: 'Generating your image…', data: { jobId: 'j' + id, imageIds: ids, ratio: '4:5', kind: 'generate', ...extra }, createdAt: iso(60_000) });
const userMsg = (id, text) => ({ id, role: 'user', type: 'info', text, data: {}, createdAt: iso(90_000) });
const llmOf = obj => async () => (typeof obj === 'string' ? obj : JSON.stringify(obj));
const mk = llm => makeImageIntent({ llm, now: () => now, timeoutMs: 300 });
const PHRASE = 'Edit the previous image with the green background and make the drink hot not iced';
const history2 = [userMsg('1', 'iced latte poster'), imgMsg('2', [A]), userMsg('3', 'now a croissant'), imgMsg('4', [B])];

test('isUuid accepts uuids and rejects everything else', () => {
  assert.ok(isUuid(A)); assert.ok(!isUuid('abc')); assert.ok(!isUuid(undefined)); assert.ok(!isUuid(123));
});

test('readHistory lists finished image ids oldest first and flags a fresh pending job', () => {
  const r = readHistory(history2, now); assert.deepEqual(r.images.map(i => i.id), [A, B]); assert.equal(r.latestPending, false);
  const pend = [...history2, { ...imgMsg('6', []), data: { jobId: 'x', imageIds: [], status: 'pending' }, createdAt: iso(20_000) }];
  assert.equal(readHistory(pend, now).latestPending, true);
  const dead = [...history2, { ...imgMsg('6', []), data: { jobId: 'x', imageIds: [] }, createdAt: iso(11 * 60_000) }];
  assert.equal(readHistory(dead, now).latestPending, false, 'a job older than 10 minutes is dead, not pending');
});

test('LLM: the exact user phrase becomes an edit of the previous image carrying BOTH changes', async () => {
  const llm = llmOf({ kind: 'edit', parentImageId: B, instruction: 'green background; make the drink hot instead of iced', summary: 'Editing your last image: green background, hot drink' });
  const d = await mk(llm).resolve({ message: PHRASE, mode: 'image', history: history2 });
  assert.equal(d.kind, 'edit'); assert.equal(d.parentImageId, B); assert.equal(d.referenceImageId, B);
  assert.match(d.instruction, /green background/); assert.match(d.instruction, /hot/); assert.match(d.instruction, /iced/);
  assert.equal(d.summary, 'Editing your last image: green background, hot drink');
  assert.match(d.prompt, /Apply ONLY this change/); assert.match(d.prompt, /Keep everything else identical/); assert.equal(d.source, 'llm');
});

test('LLM: picks the right EARLIER image ("the first one")', async () => {
  const d = await mk(llmOf({ kind: 'edit', parentImageId: A, instruction: 'add a logo' })).resolve({ message: 'add a logo to the first one', history: history2 });
  assert.equal(d.parentImageId, A);
});

test('LLM: sees compact history (ids, notes) and the message, and the system prompt forbids invented ids', async () => {
  let seen;
  await mk(async a => { seen = a; return JSON.stringify({ kind: 'generate', prompt: 'a cat' }); }).resolve({ message: 'a cat', history: history2 });
  const ctx = JSON.parse(seen.user); assert.deepEqual(ctx.images.map(i => i.id), [A, B]); assert.equal(ctx.message, 'a cat');
  assert.match(seen.system, /Never invent one/); assert.ok(!/data:image/.test(seen.user), 'no image bytes are ever sent to the LLM');
});

test('LLM: a parentImageId that is not in the history or the request is dropped (falls back to the newest image)', async () => {
  const d = await mk(llmOf({ kind: 'edit', parentImageId: C, instruction: 'make it blue' })).resolve({ message: 'make it blue', history: history2 });
  assert.equal(d.kind, 'edit'); assert.equal(d.parentImageId, B, 'invented id C must not survive');
});

test('LLM: malformed JSON, wrong kind and a timeout all fall back to the heuristic path', async () => {
  for (const llm of [llmOf('not json {'), llmOf({ kind: 'dance' }), () => new Promise(() => {}), async () => { throw new Error('boom'); }]) {
    const d = await mk(llm).resolve({ message: PHRASE, history: history2 });
    assert.equal(d.source, 'heuristic'); assert.equal(d.kind, 'edit'); assert.equal(d.parentImageId, B);
  }
});

test('LLM output wrapped in a markdown fence is still read', async () => {
  const d = await mk(llmOf('```json\n{"kind":"edit","parentImageId":"' + A + '","instruction":"x"}\n```')).resolve({ message: 'x', history: history2 });
  assert.equal(d.parentImageId, A);
});

test('no LLM -> heuristic: the exact phrase is an edit of the latest image with the instruction passed through', async () => {
  const d = await mk(null).resolve({ message: PHRASE, mode: 'image', history: history2 });
  assert.equal(d.kind, 'edit'); assert.equal(d.parentImageId, B); assert.equal(d.source, 'heuristic');
  assert.match(d.instruction, /green background/); assert.match(d.instruction, /make the drink hot not iced/);
  assert.ok(!/^edit the previous image/i.test(d.instruction), 'the leading command words are stripped, the changes are kept verbatim');
});

test('no LLM: ordinal words pick the earlier image; "new image" stays a generation', async () => {
  assert.equal((await mk(null).resolve({ message: 'change the first image to black and white', history: history2 })).parentImageId, A);
  const g = await mk(null).resolve({ message: 'make a brand new image of a sunset', history: history2 });
  assert.equal(g.kind, 'generate'); assert.equal(g.prompt, 'a sunset'); assert.equal(g.ratio, DEFAULT_RATIO);
});

test('no LLM and no image anywhere: an edit-sounding request becomes a normal generation, never an error', async () => {
  const d = await mk(null).resolve({ message: 'make the background green', history: [] });
  assert.equal(d.kind, 'generate'); assert.ok(d.prompt.length > 0);
});

test('pending previous image: say so instead of silently generating something unrelated', async () => {
  const pend = [userMsg('1', 'poster'), { ...imgMsg('2', []), data: { jobId: 'x', imageIds: [] }, createdAt: iso(15_000) }];
  const d = await mk(null).resolve({ message: 'make it hot instead of iced', history: pend });
  assert.equal(d.blocked, true); assert.match(d.text, /still generating/);
  const viaLlm = await mk(llmOf({ kind: 'edit', parentImageId: '', instruction: 'hot' })).resolve({ message: 'make it hot', history: pend });
  assert.equal(viaLlm.blocked, true);
});

test('mode:"image" with a plain new request generates (the LLM still decides), default ratio 4:5', async () => {
  const d = await mk(llmOf({ kind: 'generate', prompt: 'flat white on marble, soft window light', summary: 'Creating a new image: flat white' })).resolve({ message: 'a flat white', mode: 'image', history: [] });
  assert.equal(d.kind, 'generate'); assert.equal(d.prompt, 'flat white on marble, soft window light'); assert.equal(d.ratio, '4:5'); assert.equal(d.parentImageId, undefined);
});

test('an explicit referenceImageId beats whatever the LLM inferred', async () => {
  const d = await mk(llmOf({ kind: 'edit', parentImageId: A, instruction: 'x' })).resolve({ message: 'x', referenceImageId: B, history: history2 });
  assert.equal(d.referenceImageId, B); assert.equal(d.parentImageId, B);
});

test('an explicit referenceImageId works with no history and no LLM', async () => {
  const d = await mk(null).resolve({ message: 'make the background green', referenceImageId: A, history: undefined });
  assert.equal(d.kind, 'edit'); assert.equal(d.parentImageId, A);
});

test('legacy uploaded data URL still works as the image to edit, and as a reference for a new image', async () => {
  const ref = 'data:image/png;base64,AAAA';
  const e = await mk(null).resolve({ message: 'make the background green', referenceImage: ref, history: undefined });
  assert.equal(e.kind, 'edit'); assert.equal(e.referenceImage, ref); assert.equal(e.referenceImageId, undefined); assert.equal(e.parentImageId, undefined);
  const g = await mk(llmOf({ kind: 'generate', prompt: 'a poster with this product' })).resolve({ message: 'poster', referenceImage: ref, history: [] });
  assert.equal(g.kind, 'generate'); assert.equal(g.referenceImage, ref);
  const bad = await mk(null).resolve({ message: 'a cat', referenceImage: 'javascript:alert(1)', history: [] });
  assert.equal(bad.referenceImage, undefined, 'only data:image references are accepted');
});

test('req.convo undefined (no persistence wired) works', async () => {
  const d = await mk(null).resolve({ message: 'a cat on a sofa', history: undefined });
  assert.equal(d.kind, 'generate'); assert.equal(d.prompt, 'a cat on a sofa');
});

test('an EDIT never gets a default ratio; a valid explicit ratio is kept; a NEW image defaults to 4:5', async () => {
  const noRatio = await mk(null).resolve({ message: PHRASE, history: history2 });
  assert.equal(noRatio.ratio, undefined); assert.ok(!('ratio' in jobParams(noRatio)));
  assert.equal((await mk(null).resolve({ message: PHRASE, ratio: '9:16', history: history2 })).ratio, '9:16');
  assert.equal((await mk(null).resolve({ message: PHRASE, ratio: '7:3', history: history2 })).ratio, undefined, 'an unknown ratio is ignored, not defaulted');
  assert.equal((await mk(null).resolve({ message: 'a cat', ratio: '1:1', history: [] })).ratio, '1:1');
  assert.equal(keepsNativeAspect({ edit: true, ratio: undefined }), true); assert.equal(keepsNativeAspect({ edit: true, ratio: '1:1' }), false); assert.equal(keepsNativeAspect({ edit: false }), false);
});

test('enqueue params: exactly the contract 4.1 shape for an edit', async () => {
  const d = await mk(llmOf({ kind: 'edit', parentImageId: B, instruction: 'green background, hot drink' })).resolve({ message: PHRASE, history: history2 });
  const p = jobParams(d, { conversationId: 'cv1', overlayText: 'Open now' });
  assert.deepEqual(Object.keys(p).sort(), ['edit', 'instruction', 'meta', 'n', 'overlayText', 'prompt', 'referenceImageId'].sort());
  assert.equal(p.n, 1); assert.equal(p.edit, true); assert.equal(p.referenceImageId, B); assert.equal(p.instruction, 'green background, hot drink');
  assert.deepEqual(p.meta, { kind: 'edit', prompt: p.prompt, conversationId: 'cv1', parentImageId: B, instruction: 'green background, hot drink' });
  assert.equal(p.overlayText, 'Open now');
});

test('enqueue params: a new image carries no edit keys and no undefined values', async () => {
  const p = jobParams(await mk(null).resolve({ message: 'a cat', history: [] }));
  assert.deepEqual(Object.keys(p).sort(), ['meta', 'n', 'prompt', 'ratio']); assert.deepEqual(p.meta, { kind: 'generate', prompt: 'a cat' });
  for (const v of Object.values(p)) assert.notEqual(v, undefined);
});

test('looksLikeEdit / editInstruction / imagePrompt', () => {
  for (const t of ['make the drink hot instead of iced', 'change the previous image', 'same image but darker', 'background green']) assert.ok(looksLikeEdit(t), t);
  for (const t of ['generate an image of a beach', 'a new image of a dog', 'what should I post next']) assert.ok(!looksLikeEdit(t), t);
  assert.equal(editInstruction('Edit the previous image with the green background'), 'the green background');
  assert.equal(editInstruction('make it brighter'), 'make it brighter');
  assert.equal(imagePrompt('Please generate me an image of a beach'), 'a beach');
  assert.match(framedEdit('x'), /Apply ONLY this change: x\./);
});

test('instructions are clipped, ids are never echoed from the LLM unvalidated, and nothing logs image bytes', () => {
  const src = readFileSync(new URL('../src/imageintent.js', import.meta.url), 'utf8');
  assert.match(src, /clip\(o\.instruction, 600\)/); assert.match(src, /isUuid\(o\.parentImageId\)/);
  const logged = src.split('\n').filter(l => /console\./.test(l)).map(l => l.replace(/\/\/.*$/, '')).join('\n').replace(/e\.message/g, '');
  assert.ok(!/(message|referenceImage|data:|text|prompt)/.test(logged.replace(/\[imageintent\] LLM failed, using heuristics:/, '')), 'the logger prints only e.message');
});

test('images.js: edits skip refinePrompt, need a reference, use instruction-following models, keep native aspect', () => {
  const s = readFileSync(new URL('../src/images.js', import.meta.url), 'utf8');
  assert.match(s, /export async function refinePrompt\(prompt, hasRef, uid, \{ edit = false \} = \{\}\) \{\n  if \(edit\) return prompt;/);
  assert.match(s, /const final = edit \? \(prompt \|\| framedEdit\(instruction\)\) : await refinePrompt\(prompt, !!ref, uid\);/);
  assert.match(s, /if \(edit && !ref\) throw/); assert.match(s, /EDIT_MODELS = \['flux-kontext-pro', 'nano-banana', 'flux-kontext-max'\]/);
  assert.ok(!/EDIT_MODELS[^\n]*flux-dev/.test(s), 'flux-dev img2img re-imagines the picture and is never an edit fallback');
  assert.match(s, /if \(!edit && ratio === undefined\) ratio = '1:1'/); assert.match(s, /if \(native\) \{ const m = await sharp\(buf\)\.metadata\(\); W = m\.width; H = m\.height; \}/);
  assert.match(s, /export async function generateImage\(\{ prompt, ratio, /);
});

test('assistant.js: mode:image skips the router, passes history, uses jobParams, keeps analytics/finance/tip untouched', () => {
  const s = readFileSync(new URL('../src/assistant.js', import.meta.url), 'utf8');
  assert.match(s, /if \(b\.mode === 'image'\) o = \{ intent: 'image' \}/); assert.match(s, /history = req\.convo\?\.history/);
  assert.match(s, /enqueueImage\(req\.uid, jobParams\(d,/); assert.match(s, /recentTurns\(history\)/);
  assert.match(s, /financePlan\(m, cap\)/); assert.match(s, /type: 'analytics'/); assert.match(s, /type: 'tip'/);
  assert.match(s, /hit\('image', req\.uid, 20, 3600\)/);
  assert.ok(s.indexOf("d.blocked") < s.indexOf("hit('image'"), 'a blocked edit costs no rate-limit budget');
});