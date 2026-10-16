// Roadmap D.1: voice input helpers (web/src/speech.ts). The microphone itself needs a browser (manual check in docs/AI_PROGRESS.md); everything that can be
// decided without one is tested here. Skipped, not failed, on Node < 22.18.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let ui = null; try { ui = await import('../web/src/speech.ts'); } catch { /* old Node */ }
const t = (name, fn) => ui ? test(name, fn) : test(name, { skip: 'needs Node 22.18+ to import web/src/speech.ts' }, () => {});
const R = (text, isFinal) => Object.assign([{ transcript: text }], { isFinal });

t('D.1 the mic is only offered when the browser has a recognizer (standard or webkit), never in Firefox-like browsers', () => {
  const { getRecognition } = ui, C = function () {};
  assert.equal(getRecognition({ SpeechRecognition: C }), C); assert.equal(getRecognition({ webkitSpeechRecognition: C }), C);
  assert.equal(getRecognition({}), null); assert.equal(getRecognition(undefined), null);
});
t('D.1 language defaults to the first language chosen in setup, falls back to English, and every default is in the picker', () => {
  const { defaultLang, LANGS } = ui;
  assert.equal(defaultLang(['ar', 'en']), 'ar'); assert.equal(defaultLang(['fr']), 'fr-FR'); assert.equal(defaultLang(['EN-gb']), 'en-US');
  for (const v of [[], null, undefined, ['xx'], 'ar', [5]]) assert.equal(defaultLang(v), 'en-US', JSON.stringify(v));
  for (const l of ['ar', 'fr', 'es', 'de', 'en']) assert.ok(LANGS.some(([k]) => k === defaultLang([l])), l);
});
t('D.1 permission denied and a missing microphone are fatal and say what to do; transient errors are not fatal; our own abort is silent', () => {
  const { describeSpeechError: d } = ui;
  for (const c of ['not-allowed', 'service-not-allowed']) { assert.equal(d(c).fatal, true); assert.match(d(c).message, /site settings/); }
  assert.equal(d('audio-capture').fatal, true);
  for (const c of ['no-speech', 'network', 'language-not-supported', 'whatever']) { assert.equal(d(c).fatal, false, c); assert.ok(d(c).message.length > 0, c); }
  assert.deepEqual(d('aborted'), { message: '', fatal: false });
});
t('D.1 splitResults separates settled words from interim words and skips empty results', () => {
  const { splitResults } = ui;
  assert.deepEqual(splitResults([R('show me', true), R(' how my ', true), R('reels are', false), R('  ', false)]), { finals: 'show me how my', interim: 'reels are' });
  assert.deepEqual(splitResults([]), { finals: '', interim: '' }); assert.deepEqual(splitResults(null), { finals: '', interim: '' });
});
t('D.1 mergeTranscript keeps what was already typed, joins with single spaces and never starts with a space', () => {
  const { mergeTranscript: m } = ui;
  assert.equal(m('How am I doing  ', 'and what', 'next'), 'How am I doing and what next');
  assert.equal(m('', 'hello', ''), 'hello'); assert.equal(m('typed', '', ''), 'typed'); assert.equal(m('', '', ''), '');
  // listening again re-starts from the new base, so earlier speech is not duplicated
  assert.equal(m('hello', 'world', ''), 'hello world');
});
t('D.1 the privacy notice names the browser speech service and says nothing is stored by the app', () => {
  assert.match(ui.NOTICE, /browser's own speech service/); assert.match(ui.NOTICE, /does not record or store/);
});
test('D.1 the Assistant wires the mic as specified: hidden without support, disabled when blocked, notice before first use, no Ctrl+Shift+M, nothing sent to the server', () => {
  const src = readFileSync(new URL('../web/src/Assistant.tsx', import.meta.url), 'utf8');
  assert.match(src, /\{Rec&&<button[^>]*className=\{'mic'/, 'mic only drawn when Rec exists');
  assert.match(src, /disabled=\{!!vOff\}/); assert.match(src, /localStorage\.getItem\(NOTICE_KEY\)/); assert.match(src, /defaultLang\(p\.languages\)/);
  assert.match(src, /x\.interimResults=true/); assert.match(src, /x\.continuous=cont/);
  assert.ok(!/ctrlKey|shiftKey|keydown/i.test(src.split('// D.1')[1] ?? ''), 'no keyboard shortcut was added');
  assert.ok(!/api(<[^>]*>)?\(\s*['`][^'`]*(transcribe|speech|audio)/i.test(src), 'no server transcription');
  assert.ok(!/fetch\(/.test(src.split('// D.1')[1] ?? ''), 'no network call in the voice code');
});
