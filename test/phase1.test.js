import test from 'node:test';
import assert from 'node:assert/strict';
import { advise, financePlan, needWeights, marketingBreakdown, contextGaps } from '../src/advisor.js';
import { dedupeRows } from '../src/importer.js';
import { makeInsights } from '../src/insights.js';
import { runSnapshots } from '../src/snapshots.js';

const base = { hasData: true, reach30d: 1000, reachChange: 0, er: 2, postsPerWeek: 1, posts30d: 4, totalPosts: 20, mentions30d: 0, collabs30d: 0,
  types: [{ type: 'REEL', er: 6, share: 0.1 }, { type: 'IMAGE', er: 2, share: 0.9 }], topCompetitor: 'rival' };

test('1.1 every tip explains itself (why) and names a metric to watch', () => {
  for (const t of advise(base)) { assert.ok(t.text && t.why && t.watch, t.kind); assert.equal(typeof t.priority, 'number'); }
  assert.ok(advise({ hasData: false })[0].why);
});
test('1.1 estimates are labelled in the tips that depend on caption heuristics', () => {
  const t = advise(base);
  assert.match(t.find(x => x.kind === 'collab').why, /estimated/);
  assert.match(t.find(x => x.kind === 'mention').why, /estimated/);
});
test('reel share is read from the DB casing (REEL), so a reel-heavy feed lowers the production need', () => {
  const heavy = { ...base, types: [{ type: 'REEL', er: 6, share: 0.6 }] }, light = { ...base, types: [{ type: 'REEL', er: 6, share: 0.1 }] };
  const k = 'Content production (reels, editing)';
  assert.equal(needWeights(light)[k] - needWeights(heavy)[k], 2);
});
test('1.4 financePlan still splits capital after the weights were extracted', () => {
  const p = financePlan(base, 1000);
  assert.ok(Math.abs(p.money.reduce((a, x) => a + x.amount, 0) - 1000) <= 5);
  assert.deepEqual(p.money.map(x => x.area).sort(), Object.keys(needWeights(base)).sort());
});
test('1.4 breakdown: shares ~100, required fields, low confidence says correlation not causation, labelled as an estimate', () => {
  const b = marketingBreakdown(base);
  assert.equal(b.estimate, true);
  assert.ok(Math.abs(b.categories.reduce((a, c) => a + c.share, 0) - 100) <= 3);
  for (const c of b.categories) {
    for (const k of ['name', 'weight', 'share', 'evidence', 'confidence', 'suggestedMetric']) assert.ok(c[k] !== undefined, c.name + ' ' + k);
    assert.ok(['low', 'medium', 'high'].includes(c.confidence));
    if (c.confidence === 'low') assert.match(c.caveat, /correlation, not causation/i);
  }
  assert.ok(b.categories.every((c, i, a) => !i || a[i - 1].weight >= c.weight));
});
test('1.4 confidence rises to medium only with enough recent posts', () => {
  const med = marketingBreakdown({ ...base, posts30d: 12, er: 4 }).categories;
  assert.equal(med.find(c => c.name.startsWith('Paid')).confidence, 'medium');
  assert.equal(marketingBreakdown({ ...base, posts30d: 3 }).categories.find(c => c.name.startsWith('Content')).confidence, 'low');
  assert.equal(marketingBreakdown({ hasData: false }).categories.length, 0);
});
test('1.2 gaps: demo data, thin history, no competitors, no snapshots, always the estimate note', () => {
  const g = contextGaps(base, { posts: 50, spanDays: 59, competitors: 0, scrapedCompetitors: 0, demoPosts: 50, imports: 0, snapshotDays: 0, competitorSource: null });
  const all = g.join('\n');
  for (const re of [/demo data/, /59 day/, /No competitors/, /No daily snapshots/, /estimated from caption/]) assert.match(all, re);
  const ok = contextGaps(base, { posts: 80, spanDays: 120, competitors: 2, scrapedCompetitors: 2, demoPosts: 0, imports: 1, snapshotDays: 5, competitorSource: 'business_discovery' });
  assert.equal(ok.length, 1); // only the standing estimate note
  assert.match(contextGaps(base, { posts: 80, spanDays: 120, competitors: 2, scrapedCompetitors: 2, demoPosts: 0, imports: 1, snapshotDays: 2, competitorSource: 'demo' }).join(), /synthetic demo data/);
  assert.match(contextGaps(base, { posts: 0 })[0], /No posts yet/);
});
test('0.1b dedupeRows: first wins by default, last wins for refresh imports', () => {
  const r = (likes, caption = 'a') => ({ posted_at: '2026-10-01T10:00:00.000Z', type: 'REEL', likes, caption });
  assert.equal(dedupeRows([r(1), r(2), r(3, 'b')]).length, 2);
  assert.equal(dedupeRows([r(1), r(2)])[0].likes, 1);
  assert.equal(dedupeRows([r(1), r(2)], true)[0].likes, 2);
});

// Handlers with fake dependencies. This checks wiring and response shapes only; the SQL itself needs a real Postgres.
const fakeRes = () => ({ body: null, json(b) { this.body = b; return this; } });
const fakeQ = async sql => {
  if (/FROM posts WHERE user_id/.test(sql) && /demo/.test(sql)) return [{ n: 50, first_at: '2026-08-01', last_at: '2026-10-10', demo: 50 }];
  if (/FROM import_log/.test(sql)) return [{ n: 0, last_at: null }];
  if (/FROM competitors WHERE/.test(sql)) return [{ n: 3, scraped: 0, last_at: null }];
  if (/FROM competitor_posts/.test(sql)) return [{ n: 0 }];
  if (/FROM post_snapshots/.test(sql)) return [{ n: 0, last_at: null, days: 0 }];
  if (/FROM scrape_audit/.test(sql)) return [];
  if (/FROM priority_dismissals/.test(sql)) return []; // A.1d
  throw new Error('unexpected SQL: ' + sql.slice(0, 60));
};
test('1.1/1.2/1.4 handlers return the documented shapes', async () => {
  const h = makeInsights({ q: fakeQ, pageMetrics: async () => base });
  let r = fakeRes(); await h.priorities({ uid: 'u' }, r);
  assert.ok(Array.isArray(r.body.priorities) && r.body.priorities[0].why);
  r = fakeRes(); await h.aiContext({ uid: 'u' }, r);
  assert.deepEqual(Object.keys(r.body).sort(), ['coverage', 'gaps', 'health', 'metrics', 'sources']);
  assert.deepEqual(r.body.coverage, { posts: 50, competitors: 3, days: 71 });
  assert.deepEqual(r.body.sources.map(s => s.name), ['Posts', 'Imports', 'Competitors', 'Competitor posts', 'Daily snapshots']);
  assert.ok(r.body.sources.every(s => 'rows' in s && 'lastUpdated' in s));
  assert.match(r.body.gaps.join(), /demo data/);
  r = fakeRes(); await h.marketing({ uid: 'u' }, r);
  assert.equal(r.body.estimate, true); assert.equal(r.body.categories.length, 5);
});
test('2.1 runSnapshots runs the baseline before the snapshot insert and reports counts', async () => {
  const calls = [];
  const out = await runSnapshots(async sql => { calls.push(/metrics_baseline/.test(sql) ? 'baseline' : 'snapshot'); return calls.length === 1 ? [{ user_id: 'u' }] : [{ id: 1 }, { id: 2 }]; });
  assert.deepEqual(calls, ['baseline', 'snapshot']);
  assert.deepEqual(out, { baselines: 1, snapshots: 2 });
});
