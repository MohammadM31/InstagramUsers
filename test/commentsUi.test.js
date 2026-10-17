// Roadmap A.2 UI helpers (web/src/cmt.ts) and a check that the card's lists cannot drift from the server's reasons. Skipped on Node < 22.18 (no .ts import).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeComments } from '../src/comments.js';

let ui = null;
try { ui = await import('../web/src/cmt.ts'); } catch { /* old Node */ }
const t = (name, fn) => ui ? test(name, fn) : test(name, { skip: 'needs Node 22.18+ to import web/src/cmt.ts' }, () => {});
const { EMPTY_TEXT, emptyMessage, sentimentParts, openQuestions, clip, freshness } = ui ?? {};

t('A.2 UI: every reason the server can return has a message, and an unknown one falls back to the "none stored" text', async () => {
  // collect the reasons by driving the real handler through its four empty states
  const reasons = new Set();
  const res = () => { const r = {}; r.status = () => r; r.json = b => { r.body = b; return r; }; r.sendStatus = () => r; return r; };
  for (const [post, acct] of [[{ id: 1, ig_media_id: null }, { status: 'connected' }], [{ id: 1, ig_media_id: 'M' }, null], [{ id: 1, ig_media_id: 'M' }, { status: 'reconnect_needed' }], [{ id: 1, ig_media_id: 'M' }, { status: 'connected' }]]) {
    const q = async sql => (/FROM posts WHERE id/.test(sql) ? [post] : /FROM post_comments/.test(sql) ? [] : /FROM ig_accounts/.test(sql) ? (acct ? [acct] : []) : []);
    const r = res(); await makeComments({ q }).list({ uid: 'u', params: { id: '1' } }, r); reasons.add(r.body.reason);
  }
  assert.deepEqual([...reasons].sort(), Object.keys(EMPTY_TEXT).sort());
  assert.equal(emptyMessage('whatever'), EMPTY_TEXT.none_stored); assert.equal(emptyMessage(null), EMPTY_TEXT.none_stored);
});
t('A.2 UI: sentiment parts keep the server\'s numbers in a fixed order', () => {
  assert.deepEqual(sentimentParts({ positive: 3, negative: 1, neutral: 2 }), [{ label: 'positive', n: 3 }, { label: 'negative', n: 1 }, { label: 'neutral', n: 2 }]);
});
t('A.2 UI: only unanswered questions are listed, capped at 5, order kept', () => {
  const c = (text, question, owner_replied) => ({ username: 'u', text, likes: 0, posted_at: 'x', owner_replied, question });
  const list = [c('a', true, false), c('b', true, true), c('c', false, false), ...Array.from({ length: 8 }, (_, i) => c('q' + i, true, false))];
  assert.deepEqual(openQuestions(list).map(x => x.text), ['a', 'q0', 'q1', 'q2', 'q3']);
  assert.equal(openQuestions(list, 2).length, 2); assert.deepEqual(openQuestions([]), []);
});
t('A.2 UI: clip shortens long text with an ellipsis and leaves short text alone', () => {
  assert.equal(clip('short'), 'short'); assert.equal(clip('x'.repeat(200), 10), 'xxxxxxxxx…'); assert.equal(clip('x'.repeat(10), 10), 'xxxxxxxxxx');
});
t('A.2 UI: freshness wording', () => {
  const now = Date.parse('2026-10-14T20:00:00Z');
  assert.equal(freshness(null, now), 'not pulled yet');
  assert.equal(freshness('2026-10-14T19:30:00Z', now), 'updated less than an hour ago');
  assert.equal(freshness('2026-10-14T15:00:00Z', now), 'updated 5 h ago');
  assert.equal(freshness('2026-10-10T20:00:00Z', now), 'updated 4 days ago');
});
test('A.2 UI source: the card says the sentiment is an estimate, shows the retention period, and is mounted in the post analysis panel', () => {
  const card = fs.readFileSync(new URL('../web/src/pages/CommentsCard.tsx', import.meta.url), 'utf8');
  const pa = fs.readFileSync(new URL('../web/src/pages/PostAnalysis.tsx', import.meta.url), 'utf8');
  assert.match(card, /estimate: keywords and emoji only/); assert.match(card, /kept \{d\.retentionDays\} days/);
  assert.match(pa, /<CommentsCard id=\{id\}\/>/); assert.match(pa, /import CommentsCard/);
});
