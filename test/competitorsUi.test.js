// Roadmap A.3 UI helpers (web/src/comp.ts). Skipped on Node < 22.18 (no .ts import).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeCompetitors } from '../src/competitors.js';

let ui = null;
try { ui = await import('../web/src/comp.ts'); } catch { /* old Node */ }
const t = (name, fn) => ui ? test(name, fn) : test(name, { skip: 'needs Node 22.18+ to import web/src/comp.ts' }, () => {});
const { sparkPoints, momentumLine, change30, EMPTY_HISTORY } = ui ?? {};
const P = (day, followers) => ({ day, followers, posts_count: null, avg_likes: null, avg_comments: null });

t('A.3 UI: a sparkline needs two real points; null follower counts are ignored', () => {
  assert.equal(sparkPoints([]), null); assert.equal(sparkPoints([P('2026-10-01', 5)]), null);
  assert.equal(sparkPoints([P('2026-10-01', 5), P('2026-10-02', null)]), null);
});
t('A.3 UI: sparkline x follows the calendar day (gaps look like gaps) and y rises with followers', () => {
  const pts = sparkPoints([P('2026-10-01', 100), P('2026-10-02', 100), P('2026-10-09', 200)], 100, 40, 0).split(' ').map(s => s.split(',').map(Number));
  assert.equal(pts[0][0], 0); assert.equal(pts[2][0], 100); assert.equal(pts[1][0], 12.5);          // day 1 of 8
  assert.equal(pts[2][1], 0); assert.equal(pts[0][1], 40);                                          // highest value at the top (y = 0)
});
t('A.3 UI: a flat series draws a middle line, input order does not matter', () => {
  assert.equal(sparkPoints([P('2026-10-02', 7), P('2026-10-01', 7)], 100, 40, 0), '0.0,20.0 100.0,20.0');
});
t('A.3 UI: momentum text covers no-history, gain, loss, outpacing and unknown own change', () => {
  const m = (o = {}) => ({ followers: 1000, followersChange7d: 120, followersChange30d: null, pct7d: 1.2, ownChange7d: 40, outPacing: true, ...o });
  assert.match(momentumLine(m({ followersChange7d: null }), 'r', true), /Not enough history for a 7-day change/);
  assert.equal(momentumLine(m(), 'r', true), '@r: +120 followers in 7 days (+1.2%). You: +40. They are gaining faster than you.');
  assert.match(momentumLine(m({ followersChange7d: -30, pct7d: -0.5, outPacing: false }), 'r', true), /-30 followers in 7 days \(-0\.5%\)\. You: \+40\.$/);
  assert.match(momentumLine(m({ ownChange7d: null, outPacing: false }), 'r', false), /Your own 7-day follower change is not available yet\.$/);
  assert.equal(change30(m()), 'no 30-day change yet'); assert.equal(change30(m({ followersChange30d: 2500 })), '+2,500 in 30 days');
});
t('A.3 UI: the response keys the card reads exist in the server answer, and the card shows the server\'s public-metrics note', async () => {
  const rows = Array.from({ length: 9 }, (_, i) => ({ day: `2026-10-${String(9 + i).padStart(2, '0')}`, followers: 1000 + i * 10, posts_count: 5, avg_likes: '10.0', avg_comments: '1.0', source: 'live' }));
  const q = async sql => (/FROM competitors WHERE/.test(sql) ? [{ id: 1, handle: 'r' }] : /FROM competitor_history/.test(sql) ? rows : /FROM follower_history/.test(sql) ? rows : []);
  const r = {}; r.json = b => { r.body = b; return r; }; r.status = () => r; r.sendStatus = () => r;
  await makeCompetitors({ q, now: () => Date.parse('2026-10-17T12:00:00Z') }).history({ uid: 'u', params: { id: '1' }, query: {} }, r);
  for (const k of ['handle', 'days', 'points', 'momentum', 'ownFollowersKnown', 'note', 'reason']) assert.ok(k in r.body, k);
  for (const k of ['followers', 'followersChange7d', 'followersChange30d', 'pct7d', 'ownChange7d', 'outPacing']) assert.ok(k in r.body.momentum, k);
  for (const k of ['day', 'followers', 'posts_count', 'avg_likes', 'avg_comments']) assert.ok(k in r.body.points[0], k);
  const card = fs.readFileSync(new URL('../web/src/pages/CompetitorHistory.tsx', import.meta.url), 'utf8');
  assert.match(card, /\{d\.note\}/); assert.match(card, /EMPTY_HISTORY/);
  assert.match(EMPTY_HISTORY, /Demo data is never stored/);
});
