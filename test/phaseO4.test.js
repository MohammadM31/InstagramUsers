// Roadmap O.4: goalProgress (pure), goal re-weighting of advice, GET /api/goal and the baseline rules. Fake q only: no SQL is run here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { goalProgress, advise, needWeights, financePlan, marketingBreakdown, GOAL_AREA_FOCUS, GOAL_TIP_BONUS } from '../src/advisor.js';
import { makeGoals } from '../src/goals.js';
import { makeOnboarding } from '../src/onboarding.js';

const NOW = Date.parse('2026-10-15T12:00:00Z');
const day = n => new Date(Date.parse('2026-10-15T00:00:00Z') - n * 864e5).toISOString().slice(0, 10);
const series = pts => pts.map(([n, followers, source = 'live']) => ({ day: day(n), followers, source }));
const base = { hasData: true, reach30d: 1000, reachChange: 0, er: 2, postsPerWeek: 1, posts30d: 4, totalPosts: 20, mentions30d: 0, collabs30d: 0, types: [{ type: 'REEL', er: 6, share: 0.1 }], topCompetitor: null };
const prof = o => ({ goal_primary: 'followers', goal_target_metric: 'followers', goal_target_value: 2000, goal_baseline_value: 1000, goal_deadline: '2026-11-14', ...o });
// 30 days ago 1000, today 1300 -> +10 per day; 30 days left (deadline 14 Nov end of day UTC, now 15 Oct noon -> 31 days)
const grow = (rows) => ({ ...base, followerSeries: series(rows) });

test('O.4 no target: no progress, says what is missing; a missing profile behaves the same', () => {
  for (const p of [null, {}, { goal_target_metric: 'followers' }, { goal_target_value: 100 }]) {
    const r = goalProgress(p, base, NOW); assert.equal(r.hasGoal, false); assert.equal(r.percent, null); assert.match(r.explanation, /No numeric target/);
  }
});
test('O.4 followers: percent from baseline to target, uses follower_history and labels it', () => {
  const r = goalProgress(prof(), grow([[30, 1000], [0, 1300]]), NOW);
  assert.equal(r.current, 1300); assert.equal(r.percent, 30); assert.equal(r.dataUsed.source, 'follower_history'); assert.match(r.dataUsed.label, /Instagram follower count/);
  assert.match(r.explanation, /not a promise/);
});
test('O.4 pace: ahead, on track, behind come from the recent rate against what is still needed', () => {
  const at = (gain, tgt = 2000) => goalProgress(prof({ goal_target_value: tgt }), grow([[30, 1300 - gain], [0, 1300]]), NOW);
  // 31 days left, remaining 700 -> need about 22.6 per day
  assert.equal(at(900).pace, 'ahead');   // 30/day -> +930
  assert.equal(at(700).pace, 'on track'); // 23.3/day -> +723, ratio 1.03
  assert.equal(at(300).pace, 'behind');  // 10/day -> +310
  const r = at(300); assert.equal(r.projected, Math.round(1300 + (300 / 30) * 31)); assert.equal(r.daysLeft, 31);
});
test('O.4 achieved is ahead; a passed deadline without the target is behind; no deadline means no pace', () => {
  assert.equal(goalProgress(prof({ goal_target_value: 1200 }), grow([[30, 1000], [0, 1300]]), NOW).achieved, true);
  assert.equal(goalProgress(prof({ goal_target_value: 1200 }), grow([[30, 1000], [0, 1300]]), NOW).pace, 'ahead');
  assert.equal(goalProgress(prof({ goal_deadline: '2026-10-01' }), grow([[30, 1000], [0, 1300]]), NOW).pace, 'behind');
  const nd = goalProgress(prof({ goal_deadline: null }), grow([[30, 1000], [0, 1300]]), NOW);
  assert.equal(nd.pace, null); assert.match(nd.explanation, /No deadline/);
});
test('O.4 not enough history: no pace is invented', () => {
  const r = goalProgress(prof(), grow([[2, 1290], [0, 1300]]), NOW); // only a 2-day point: neither 7d nor 30d exists
  assert.equal(r.pace, null); assert.match(r.explanation, /not enough history/);
});
test('O.4 followers goal without follower history is NOT converted from reach; the reach trend is shown separately', () => {
  const r = goalProgress(prof(), { ...base, reachChange: 40 }, NOW);
  assert.equal(r.current, null); assert.equal(r.percent, null); assert.equal(r.dataUsed, null); assert.match(r.explanation, /reach, not followers/);
});
test('O.4 reconstructed history is labelled', () => {
  const r = goalProgress(prof(), grow([[30, 1000, 'reconstructed'], [0, 1300]]), NOW);
  assert.match(r.dataUsed.label, /reconstructed/);
});
test('O.4 reach goal uses the 30-day reach and its trend; 0% change gives no pace', () => {
  const p = prof({ goal_primary: 'reach', goal_target_metric: 'reach', goal_target_value: 5000, goal_baseline_value: 1000 });
  const r = goalProgress(p, { ...base, reach30d: 3000, reachChange: 50 }, NOW); // previous 2000, +1000 over 30 days
  assert.equal(r.current, 3000); assert.equal(r.percent, 50); assert.equal(r.dataUsed.source, 'reach'); assert.ok(['ahead', 'on track', 'behind'].includes(r.pace));
  assert.equal(goalProgress(p, { ...base, reach30d: 3000, reachChange: 0 }, NOW).pace, null);
  assert.equal(goalProgress(p, { ...base, reach30d: 3000, reachChange: -100 }, NOW).pace, null, 'reachChange -100 cannot be inverted');
});
test('O.4 engagement-rate goal: percent only, pace stated as not judged', () => {
  const r = goalProgress(prof({ goal_target_metric: 'er', goal_target_value: 4, goal_baseline_value: 2 }), { ...base, er: 3 }, NOW);
  assert.equal(r.percent, 50); assert.equal(r.pace, null); assert.match(r.explanation, /no trend data/);
});
test('O.4 a goal that must go down works (target below the start)', () => {
  const r = goalProgress(prof({ goal_target_metric: 'er', goal_target_value: 1, goal_baseline_value: 3 }), { ...base, er: 2 }, NOW);
  assert.equal(r.percent, 50); assert.equal(r.achieved, false);
  assert.equal(goalProgress(prof({ goal_target_metric: 'er', goal_target_value: 1, goal_baseline_value: 3 }), { ...base, er: 0.8 }, NOW).achieved, true);
});
test('O.4 percent is clamped to 0..100 and a zero-length span does not divide by zero', () => {
  assert.equal(goalProgress(prof(), grow([[30, 1000], [0, 900]]), NOW).percent, 0);
  assert.equal(goalProgress(prof({ goal_target_value: 1100 }), grow([[30, 1000], [0, 5000]]), NOW).percent, 100);
  const z = goalProgress(prof({ goal_target_value: 1000, goal_baseline_value: 1000 }), grow([[30, 900], [0, 1000]]), NOW);
  assert.equal(z.percent, 100);
});
test('O.4 an unset baseline asks the caller to record the current value and gives no percent', () => {
  const r = goalProgress(prof({ goal_baseline_value: null }), grow([[30, 1000], [0, 1300]]), NOW);
  assert.equal(r.needsBaseline, true); assert.equal(r.currentValue, 1300); assert.equal(r.percent, null);
  assert.equal(goalProgress(prof({ goal_baseline_value: null }), { ...base }, NOW).needsBaseline, false, 'nothing to record without data');
});

// ---------- re-weighting ----------
test('O.4 with no goal (or an unknown one) advice and weights are unchanged', () => {
  const none = advise(base), unknown = advise({ ...base, goal: 'world peace' });
  assert.deepEqual(unknown, none); assert.deepEqual(needWeights({ ...base, goal: null }), needWeights(base));
  assert.equal(marketingBreakdown(base).goal, null);
});
test('O.4 each goal changes the tip order or weights it names, and never removes a tip', () => {
  const b = { ...base, mentions30d: 0, collabs30d: 5, er: 2, postsPerWeek: 5, reachChange: 10 }; // collab tip off; community + mention + content on
  const plain = advise(b).map(t => t.kind);
  const eng = advise({ ...b, goal: 'engagement' });
  assert.equal(eng[0].kind, 'community'); assert.notEqual(plain[0], 'community');
  assert.deepEqual([...eng.map(t => t.kind)].sort(), [...plain].sort(), 'same tips, different order');
  assert.match(eng[0].why, /main goal is engagement/);
  for (const g of Object.keys(GOAL_TIP_BONUS)) assert.ok(GOAL_AREA_FOCUS[g], g + ' has an area focus too');
});
test('O.4 follower goal moves collaborations and giveaways up in the money split and the breakdown; shares still sum to about 100', () => {
  const m = { ...base, reachChange: 10, collabs30d: 5, mentions30d: 9, postsPerWeek: 5, er: 4 };
  const plain = needWeights(m), g = needWeights({ ...m, goal: 'followers' });
  assert.equal(g['Creator collaborations'], +(plain['Creator collaborations'] * 1.5).toFixed(2));
  assert.equal(g['Paid promotion on best posts'], plain['Paid promotion on best posts']);
  const fp = financePlan({ ...m, goal: 'followers' }, 1000), s = fp.money.reduce((a, x) => a + x.amount, 0); assert.ok(Math.abs(s - 1000) <= 5);
  const share = (p, n) => p.money.find(x => x.area === n).share;
  assert.ok(share(fp, 'Creator collaborations') > share(financePlan(m, 1000), 'Creator collaborations'));
  const mb = marketingBreakdown({ ...m, goal: 'followers' });
  assert.equal(mb.goal, 'followers'); assert.equal(mb.categories.find(c => c.name === 'Creator collaborations').goalBoost, true);
  assert.equal(mb.categories.find(c => c.name === 'Tools and scheduling').goalBoost, undefined);
  assert.ok(Math.abs(mb.categories.reduce((a, c) => a + c.share, 0) - 100) <= 3);
});

// ---------- GET /api/goal ----------
const res = () => { const r = { code: 200, body: undefined }; r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; }; return r; };
function goalQ(row) {
  const calls = []; let profile = row && { ...row };
  const q = async (sql, p = []) => {
    calls.push({ sql, p });
    if (/^\s*SELECT/i.test(sql)) return profile ? [{ ...profile }] : [];
    if (/UPDATE business_profile SET goal_baseline_value=\$2 WHERE user_id=\$1 AND goal_baseline_value IS NULL/.test(sql)) { if (profile.goal_baseline_value == null) profile.goal_baseline_value = p[1]; return []; }
    throw new Error('unexpected sql ' + sql);
  };
  q.calls = calls; q.profile = () => profile; return q;
}
test('O.4 GET /goal records the baseline once, only into an empty column, and answers with the percent', async () => {
  const q = goalQ(prof({ goal_baseline_value: null })), h = makeGoals({ q, pageMetrics: async () => grow([[30, 1000], [0, 1300]]), now: () => NOW });
  const r = res(); await h.get({ uid: 'u1' }, r);
  assert.equal(r.body.baseline, 1300); assert.equal(r.body.percent, 0); assert.equal(r.body.needsBaseline, undefined); assert.equal(r.body.currentValue, undefined);
  assert.equal(q.calls.filter(c => /^UPDATE/.test(c.sql)).length, 1);
  await h.get({ uid: 'u1' }, res()); assert.equal(q.calls.filter(c => /^UPDATE/.test(c.sql)).length, 1, 'second read writes nothing');
});
test('O.4 GET /goal with no follower history does not write a baseline; with no profile it says so', async () => {
  const q = goalQ(prof({ goal_baseline_value: null })), h = makeGoals({ q, pageMetrics: async () => ({ ...base }), now: () => NOW });
  const r = res(); await h.get({ uid: 'u1' }, r); assert.equal(r.body.hasGoal, true); assert.equal(r.body.percent, null);
  assert.equal(q.calls.filter(c => /^UPDATE/.test(c.sql)).length, 0);
  const r2 = res(); await makeGoals({ q: goalQ(null), pageMetrics: async () => base }).get({ uid: 'x' }, r2);
  assert.equal(r2.body.hasGoal, false); assert.match(r2.body.explanation, /No goal yet/);
});
test('O.4 GET /goal only reads the caller\'s own profile', async () => {
  const q = goalQ(prof()), h = makeGoals({ q, pageMetrics: async () => grow([[30, 1000], [0, 1300]]), now: () => NOW });
  await h.get({ uid: 'u-me' }, res());
  assert.ok(q.calls.every(c => c.p[0] === 'u-me'));
});

// ---------- onboarding keeps the baseline tied to one goal ----------
function obQ(row) {
  const rows = new Map([['u', { auto_proposals: false, skipped_steps: [], completed_at: null, ...row }]]);
  const q = async (sql, p = []) => {
    if (/^\s*SELECT/i.test(sql)) return [{ ...rows.get(p[0]) }];
    const m = sql.match(/INSERT INTO business_profile\(([^)]*)\)/);
    if (m) { const row = { ...rows.get(p[0]) }; m[1].split(',').forEach((c, i) => { row[c] = p[i]; }); rows.set(p[0], row); return []; }
    throw new Error('unexpected sql ' + sql);
  };
  q.row = () => rows.get('u'); return q;
}
const patch = async (q, body) => { const r = res(); await makeOnboarding({ q }).patchStep({ uid: 'u', params: { step: 'goals' }, body }, r); assert.equal(r.code, 200, JSON.stringify(r.body)); };
test('O.4 changing the measure or the target clears the baseline; saving the same goal or only the deadline keeps it', async () => {
  const q = obQ({ onboarding_step: 'goals', display_name: 'Mo', goal_target_metric: 'followers', goal_target_value: 2000, goal_baseline_value: 1000 });
  await patch(q, { goal_target_metric: 'followers', goal_target_value: 2000 }); assert.equal(q.row().goal_baseline_value, 1000, 'same goal, same start');
  await patch(q, { goal_deadline: '2026-12-31' }); assert.equal(q.row().goal_baseline_value, 1000, 'deadline only');
  await patch(q, { goal_target_value: 3000 }); assert.equal(q.row().goal_baseline_value, null, 'new target, new start');
  q.row().goal_baseline_value = 50; await patch(q, { goal_target_metric: 'reach' }); assert.equal(q.row().goal_baseline_value, null, 'new measure');
  q.row().goal_baseline_value = 77; await patch(q, { goal_target_value: 3000, goal_baseline_value: 5 }); assert.equal(q.row().goal_baseline_value, 5, 'an explicit baseline wins');
});
