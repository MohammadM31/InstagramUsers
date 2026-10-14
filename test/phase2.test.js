import test from 'node:test';
import assert from 'node:assert/strict';
import { postAnalysis, snapshotDelta, detectAlerts } from '../src/advisor.js';
import { makeNotifications, runNotifications } from '../src/notifications.js';
import { makeInsights } from '../src/insights.js';

const m = { hasData: true, er: 4, types: [{ type: 'REEL', er: 5 }, { type: 'IMAGE', er: 2 }] };
const post = { id: 7, type: 'REEL', reach: 1000, likes: 40, comments: 5, saves: 30, shares: 5 }; // ER 8%
const snap = (day, reach, likes) => ({ captured_at: `2026-10-${day}T03:00:00Z`, reach, likes, comments: 0, saves: 0, shares: 0 });

// ---- 2.2 ----
test('2.2 analysis compares ER with the type and page averages and names the biggest driver', () => {
  const { text, delta } = postAnalysis(post, [], m);
  assert.match(text, /engagement rate of 8%/);
  assert.match(text, /above your average REEL \(5%\)/);
  assert.match(text, /Your page averaged 4%/);
  assert.match(text, /likes \(50% of 80 interactions\)/);
  assert.equal(delta, null);
  assert.match(text, /No trend yet.*0 so far/);
});
test('2.2 analysis never claims causation', () => assert.match(postAnalysis(post, [], m).text, /does not show what caused them/));
test('2.2 below / in line wording', () => {
  assert.match(postAnalysis({ ...post, type: 'IMAGE', likes: 5, comments: 0, saves: 0, shares: 0 }, [], m).text, /below your average IMAGE/);
  assert.match(postAnalysis({ ...post, likes: 48, saves: 0, comments: 0, shares: 0 }, [], m).text, /in line with your average REEL/); // ER 4.8% vs 5%
});
test('2.2 trend needs two different days; same-day snapshots give no delta', () => {
  assert.equal(snapshotDelta([snap('01', 100, 5), { ...snap('01', 200, 9), captured_at: '2026-10-01T20:00:00Z' }]), null);
  assert.equal(snapshotDelta([snap('01', 100, 5)]), null);
  const d = snapshotDelta([snap('03', 200, 20), snap('01', 100, 5)]); // unsorted input
  assert.equal(d.days, 2); assert.equal(d.reach.from, 100); assert.equal(d.reach.to, 200); assert.equal(d.reach.pct, 100);
  assert.equal(d.er.from, 5); assert.equal(d.er.to, 10); assert.equal(d.er.points, 5);
});
test('2.2 trend text appears when there is a delta; missing reach is handled', () => {
  const { text } = postAnalysis(post, [snap('01', 100, 5), snap('04', 150, 9)], m);
  assert.match(text, /Over 2 days of snapshots, reach went from 100 to 150 \(\+50%\)/);
  assert.match(postAnalysis({ ...post, reach: 0 }, [], m).text, /No reach is recorded/);
});

// ---- 2.3 detection ----
const base = { reach30d: 1000, er: 6, best_post_er: 10, ahead: [] };
const cur0 = { reach30d: 1000, er: 6, best_post_er: 10, userAvgLc: 50, competitors: null };
const NOW = Date.parse('2026-10-14T12:00:00Z');
test('2.3 day one (current equals baseline) raises nothing, even with a competitor ahead at baseline time', () => {
  assert.deepEqual(detectAlerts(base, cur0, NOW).alerts, []);
  const r = detectAlerts({ ...base, ahead: null }, { ...cur0, competitors: [{ handle: 'big', avgLc: 500, n: 9 }] }, NOW);
  assert.deepEqual(r.alerts, []); assert.deepEqual(r.state.ahead, ['big']); // baselined, silent
});
test('2.3 reach drop over 15% alerts, exactly 15% does not', () => {
  assert.equal(detectAlerts(base, { ...cur0, reach30d: 840 }, NOW).alerts[0].kind, 'reach_drop');
  assert.equal(detectAlerts(base, { ...cur0, reach30d: 850 }, NOW).alerts.length, 0);
  assert.equal(detectAlerts({ ...base, reach30d: 0 }, { ...cur0, reach30d: 0 }, NOW).alerts.length, 0);
});
test('2.3 ER drop needs more than 2 points', () => {
  assert.equal(detectAlerts(base, { ...cur0, er: 3.9 }, NOW).alerts[0].kind, 'er_drop');
  assert.equal(detectAlerts(base, { ...cur0, er: 4 }, NOW).alerts.length, 0);
  assert.equal(detectAlerts(base, { ...cur0, er: null }, NOW).alerts.length, 0);
});
test('2.3 best-ever post alerts once: the new best is stored in state', () => {
  const r = detectAlerts(base, { ...cur0, best_post_er: 12.5 }, NOW);
  assert.equal(r.alerts[0].kind, 'best_post'); assert.equal(r.state.best_post_er, 12.5);
  assert.equal(detectAlerts({ ...base, best_post_er: 12.5 }, { ...cur0, best_post_er: 12.5 }, NOW).alerts.length, 0);
  const first = detectAlerts({ ...base, best_post_er: null }, { ...cur0, best_post_er: 9 }, NOW); // nothing to beat yet
  assert.equal(first.alerts.length, 0); assert.equal(first.state.best_post_er, 9);
});
test('2.3 competitor alert only for rivals that were NOT ahead at baseline, and needs enough posts', () => {
  const comps = [{ handle: 'old', avgLc: 90, n: 9 }, { handle: 'new', avgLc: 80, n: 5 }, { handle: 'thin', avgLc: 500, n: 2 }, { handle: 'behind', avgLc: 10, n: 9 }];
  const r = detectAlerts({ ...base, ahead: ['old'] }, { ...cur0, competitors: comps }, NOW);
  assert.deepEqual(r.alerts.map(a => a.title), ['@new now out-engages you']);
  assert.deepEqual(r.state.ahead, ['new', 'old']);
  assert.match(r.alerts[0].body, /Reach is not public/);
  // unusable competitor data (demo / none): no alerts, baseline list untouched
  const none = detectAlerts({ ...base, ahead: ['old'] }, { ...cur0, competitors: null }, NOW);
  assert.deepEqual(none.alerts, []); assert.deepEqual(none.state.ahead, ['old']);
});
test('2.3 every alert explains itself and says what to watch; keys are stable within a week', () => {
  const r = detectAlerts(base, { ...cur0, reach30d: 500, er: 1, best_post_er: 20 }, NOW);
  assert.equal(r.alerts.length, 3);
  for (const a of r.alerts) assert.ok(a.title && a.body && a.watch && a.key, a.kind);
  assert.equal(detectAlerts(base, { ...cur0, reach30d: 500 }, NOW).alerts[0].key, detectAlerts(base, { ...cur0, reach30d: 500 }, NOW + 5 * 36e5).alerts[0].key);
});

// ---- 2.3 job and handlers with a fake DB ----
const res = () => { const r = { code: 200 }; r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; }; r.sendStatus = c => { r.code = c; return r; }; return r; };
test('2.3 job inserts alerts with their dedupe key and writes the new state only when it changed', async () => {
  const calls = [];
  const q = async (sql, p) => {
    calls.push([sql, p]);
    if (sql.includes('FROM metrics_baseline b')) return [{ user_id: 'u1', b_reach: 1000, b_er: '6.00', b_best: '10.00', b_ahead: [], reach30d: 400, er: '6.00', best_post_er: '10.00', user_avg_lc: null }];
    if (sql.includes('FROM competitors c')) return [];
    if (sql.includes('scrape_audit')) return [];
    if (sql.startsWith('INSERT INTO notifications')) return [{ id: 1 }];
    return [];
  };
  const r = await runNotifications(q, NOW);
  assert.deepEqual(r, { users: 1, created: 1 });
  const ins = calls.find(c => c[0].startsWith('INSERT INTO notifications'));
  assert.equal(ins[1][0], 'u1'); assert.equal(ins[1][1], 'reach_drop'); assert.match(ins[1][5], /^reach_drop:w\d+$/);
  assert.ok(!calls.some(c => c[0].startsWith('UPDATE metrics_baseline')), 'unchanged state is not rewritten');
});
test('2.3 job skips competitor alerts for users whose competitor data is demo', async () => {
  const q = async sql => {
    if (sql.includes('FROM metrics_baseline b')) return [{ user_id: 'u1', b_reach: 1000, b_er: '6', b_best: '10', b_ahead: [], reach30d: 1000, er: '6', best_post_er: '10', user_avg_lc: '5' }];
    if (sql.includes('FROM competitors c')) return [{ user_id: 'u1', handle: 'rival', avg_lc: 999, n: 9 }];
    if (sql.includes('scrape_audit')) return [{ user_id: 'u1', source: 'demo' }];
    return [];
  };
  assert.deepEqual(await runNotifications(q, NOW), { users: 1, created: 0 });
});
test('2.3 handlers are scoped to req.uid and validate ids', async () => {
  const seen = [];
  const q = async (sql, p) => { seen.push(p); if (sql.includes('count(*)')) return [{ unread: 2 }]; if (sql.startsWith('SELECT')) return [{ id: 1 }]; return p[0] === 99 ? [] : [{ id: p[0] }]; };
  const h = makeNotifications({ q });
  let r = res(); await h.list({ uid: 'U' }, r);
  assert.equal(r.body.unread, 2); assert.ok(seen.every(p => p[0] === 'U'));
  r = res(); await h.mark({ uid: 'U', params: { id: 'abc' }, body: {} }, r); assert.equal(r.code, 400);
  r = res(); await h.mark({ uid: 'U', params: { id: '99' }, body: {} }, r); assert.equal(r.code, 404);
  r = res(); await h.remove({ uid: 'U', params: { id: '99' } }, r); assert.equal(r.code, 404);
  r = res(); await h.mark({ uid: 'U', params: { id: '5' }, body: { read: false } }, r); assert.deepEqual(r.body, { ok: true, read: false });
  assert.deepEqual(seen.at(-1), [5, 'U', false]);
});
test('2.2 handler: 404 for a post that is not the caller\'s, 400 for a bad id, rank + text otherwise', async () => {
  const q = async (sql, p) => {
    if (sql.includes('FROM posts WHERE id=$1')) return p[1] === 'owner' ? [{ ...post, er: '8.00' }] : [];
    if (sql.includes('FROM post_snapshots')) return [];
    if (sql.includes('count(*)::int total')) return [{ total: 10, higher: 2, type_total: 4, type_higher: 0 }];
    return [];
  };
  const h = makeInsights({ q, pageMetrics: async () => m });
  let r = res(); await h.postAnalysis({ uid: 'other', params: { id: '7' } }, r); assert.equal(r.code, 404);
  r = res(); await h.postAnalysis({ uid: 'owner', params: { id: 'x' } }, r); assert.equal(r.code, 400);
  r = res(); await h.postAnalysis({ uid: 'owner', params: { id: '7' } }, r);
  assert.equal(r.body.rank.position, 3); assert.equal(r.body.rank.of, 10); assert.equal(r.body.rank.typePosition, 1);
  assert.match(r.body.text, /engagement rate of 8%/); assert.deepEqual(r.body.snapshots, { count: 0, lastAt: null });
});
