// Roadmap O.3 (brand voice step): the pure helpers in web/src/voice.ts, checked against the SERVER's own lists and validator so UI and API cannot drift apart.
// Node 22.18+ imports the .ts file directly; older Node reports these tests as skipped, not failed (same rule as onboardingUi.test.js and onboardingO2.test.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/brandvoice.js';

let ui = null;
try { ui = await import('../web/src/voice.ts'); } catch { /* old Node */ }
const t = (name, fn) => ui ? test(name, fn) : test(name, { skip: 'needs Node 22.18+ to import web/src/voice.ts' }, () => {});
const U = ui ?? {};

t('O.3 UI: the tone tags and every choice list are exactly what the server accepts', () => {
  assert.deepEqual([...U.TONE_TAGS], S.TONE_TAGS); assert.equal(U.MAX_TONE_TAGS, S.MAX_TONE_TAGS);
  assert.deepEqual(U.CHOICES.formality.options.map(o => o[0]), S.FORMALITY); assert.deepEqual(U.CHOICES.length_pref.options.map(o => o[0]), S.LENGTHS);
  assert.deepEqual(U.CHOICES.emoji_use.options.map(o => o[0]), S.EMOJI); assert.deepEqual(U.CHOICES.hashtag_style.options.map(o => o[0]), S.HASHTAG_STYLES);
  assert.deepEqual(U.SAMPLE_KINDS.map(o => o[0]), S.SAMPLE_KINDS);
  for (const [, label] of Object.values(U.CHOICES).flatMap(c => c.options)) assert.ok(label.length > 1);
});
t('O.3 UI: every reason the server can give for not using AI has plain text for the person', () => {
  for (const r of S.LLM_REASONS) assert.ok(U.LLM_REASON_TEXT[r]?.length > 20, r);
  assert.match(U.sourceNote('llm'), /OpenAI key/); assert.match(U.sourceNote('template', 'budget'), /hour/); assert.match(U.sourceNote('template', 'weird'), /template/); assert.match(U.sourceNote('edited'), /edits/);
});
t('O.3 UI: a filled form builds a payload the server validator accepts, and consent is sent only when asked for', () => {
  const f = { ...U.emptyForm(), tone_tags: ['warm', 'witty'], formality: 'casual', length_pref: 'short', emoji_use: 'low', hashtag_style: 'niche', do: 'ask, then listen\nuse first person\n\nuse first person', dont: 'hype', phrases: 'See you there' };
  const p = U.toVoicePayload(f, { consent: true });
  assert.deepEqual(p.body.do, ['ask, then listen', 'use first person'], 'lines, trimmed, de-duplicated; commas stay inside an item'); assert.equal(p.body.consent, true);
  const { consent, ...chips } = p.body; assert.ok(S.validateVoice(chips).value, JSON.stringify(S.validateVoice(chips)));
  assert.equal('consent' in U.toVoicePayload(f).body, false); assert.equal(U.toVoicePayload(f, { consent: false }).body.consent, false);
});
t('O.3 UI: an empty form sends clearing nulls/empty lists that the server also accepts', () => {
  const { body } = U.toVoicePayload(U.emptyForm()); assert.deepEqual(body, { tone_tags: [], formality: null, length_pref: null, emoji_use: null, hashtag_style: null, do: [], dont: [], phrases: [] });
  assert.ok(S.validateVoice(body).value);
});
t('O.3 UI: list limits are caught before the request, with the same limits as the server', () => {
  assert.ok(U.toVoicePayload({ ...U.emptyForm(), do: Array(9).fill(0).map((_, i) => 'x' + i).join('\n') }).error);
  assert.ok(U.toVoicePayload({ ...U.emptyForm(), dont: 'y'.repeat(121) }).error); assert.ok(U.toVoicePayload({ ...U.emptyForm(), phrases: 'z'.repeat(81) }).error);
  assert.ok(!U.toVoicePayload({ ...U.emptyForm(), dont: 'y'.repeat(120), phrases: 'z'.repeat(80) }).error);
  for (const body of [{ dont: ['y'.repeat(121)] }, { phrases: ['z'.repeat(81)] }, { do: Array(9).fill(0).map((_, i) => 'x' + i) }]) assert.ok(S.validateVoice(body).error);
});
t('O.3 UI: toggling tags stops at five, and a saved voice round-trips through the form', () => {
  let tags = []; for (const x of U.TONE_TAGS) tags = U.toggleTag(tags, x); assert.equal(tags.length, 5);
  assert.deepEqual(U.toggleTag(['warm', 'calm'], 'warm'), ['calm']);
  const v = { tone_tags: ['warm'], formality: 'casual', length_pref: null, emoji_use: 'none', hashtag_style: null, do: ['a, b', 'c'], dont: [], phrases: ['p'] };
  const f = U.voiceToForm(v); assert.equal(f.do, 'a, b\nc'); assert.equal(f.length_pref, '');
  const { body } = U.toVoicePayload(f); assert.deepEqual(body.do, v.do); assert.equal(body.length_pref, null); assert.deepEqual(U.voiceToForm(null), U.emptyForm());
});
t('O.3 UI: Generate needs something to go on (a choice, a line, or an example); examples alone count', () => {
  const e = U.emptyForm(); assert.equal(U.hasSignal(e, 0), false); assert.equal(U.hasSignal(e, 1), true); assert.equal(U.hasSignal({ ...e, emoji_use: 'low' }, 0), true);
  assert.equal(U.hasSignal({ ...e, do: '  \n ' }, 0), false); assert.equal(U.hasSignal({ ...e, phrases: 'hi' }, 0), true); assert.equal(U.hasSignal({ ...e, tone_tags: ['calm'] }, 0), true);
});
t('O.3 UI: sample checks mirror the server (links must be http(s); captions 1-2000 characters)', () => {
  assert.equal(U.sampleError('liked', 'hello', ''), ''); assert.ok(U.sampleError('liked', '  ', '')); assert.ok(U.sampleError('disliked', 'x'.repeat(2001), ''));
  assert.equal(U.sampleError('reference_link', '', 'https://example.com/a'), ''); assert.ok(U.sampleError('reference_link', '', 'example.com')); assert.ok(U.sampleError('reference_link', '', 'javascript:alert(1)'));
  assert.ok(U.sampleError('reference_link', 'x'.repeat(301), 'https://a.co'));
});
