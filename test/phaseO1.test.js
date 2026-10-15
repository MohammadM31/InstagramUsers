// Roadmap O.1: business profile store + onboarding API. Fake q holds one in-memory row per user (parses the INSERT column list), so this proves
// validation, idempotence, progress and ownership logic. The real SQL is exercised separately against Postgres (docs/AI_PROGRESS.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeOnboarding, validateFields, advance, STEPS, STEP_FIELDS, ALL_FIELDS, FIELDS } from '../src/onboarding.js';

const res = () => { const r = { code: 200, body: undefined }; r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; }; r.sendStatus = c => { r.code = c; return r; }; return r; };
function fakeQ() {
  const rows = new Map(), sqls = [];
  const q = async (sql, p = []) => {
    sqls.push({ sql, p });
    if (/^\s*SELECT/i.test(sql)) { const r = rows.get(p[0]); return r ? [{ ...r }] : []; }
    let m = sql.match(/INSERT INTO business_profile\(([^)]*)\)/);
    if (m) { const cols = m[1].split(','), old = rows.get(p[0]) ?? { auto_proposals: false, skipped_steps: [], completed_at: null };
      const row = { ...old }; cols.forEach((c, i) => { row[c] = p[i]; }); row.updated_at = 'now'; rows.set(p[0], row); return []; }
    m = sql.match(/UPDATE business_profile SET completed_at/);
    if (m) { const r = rows.get(p[0]); r.completed_at = r.completed_at ?? 'T1'; r.onboarding_step = 'done'; return []; }
    throw new Error('unexpected sql ' + sql);
  };
  q.rows = rows; q.sqls = sqls; return q;
}
const A = 'user-a', B = 'user-b';
const call = async (h, uid, body, params = {}) => { const r = res(); await h({ uid, body, params }, r); return r; };

test('O.1 every profile field is owned by exactly one step or is shared via /profile only', () => {
  const owned = Object.values(STEP_FIELDS).flat();
  assert.deepEqual([...owned].sort(), [...ALL_FIELDS].sort());
  assert.equal(new Set(owned).size, owned.length);
});
test('O.1 validators: accept good values, reject bad ones with the field name, trim, de-duplicate', () => {
  const ok = validateFields({ display_name: '  Mo  ', timezone: 'Asia/Beirut', languages: ['en', 'ar', 'en'] }, STEP_FIELDS.about);
  assert.deepEqual(ok.value, { display_name: 'Mo', timezone: 'Asia/Beirut', languages: ['en', 'ar'] });
  for (const [f, v] of [['timezone', 'Mars/Base'], ['languages', ['english']], ['languages', 'en'], ['display_name', ''], ['display_name', 'x'.repeat(81)], ['display_name', 5], ['role', null]]) {
    const r = validateFields({ [f]: v }, STEP_FIELDS.about);
    if (f === 'role') assert.ok(r.value, 'role is nullable'); else assert.ok(r.error && r.details[0].startsWith(f), `${f}=${JSON.stringify(v)}`);
  }
  assert.ok(validateFields({ display_name: null }, STEP_FIELDS.about).error, 'display name cannot be cleared');
  assert.ok(validateFields({ stage: 'growing', niche_keywords: Array(16).fill('k') }, STEP_FIELDS.business).error);
  assert.ok(validateFields({ stage: 'huge' }, STEP_FIELDS.business).error);
  assert.ok(validateFields({ goal_primary: 'sales', goal_secondary: 'sales' }, STEP_FIELDS.goals).error);
  assert.ok(validateFields({ goal_target_value: -1 }, STEP_FIELDS.goals).error);
  assert.ok(validateFields({ goal_target_value: '5000' }, STEP_FIELDS.goals).error, 'numbers must be numbers');
  assert.ok(validateFields({ goal_deadline: '2026-02-30' }, STEP_FIELDS.goals).error, 'impossible date');
  assert.ok(validateFields({ goal_deadline: '2099-01-01' }, STEP_FIELDS.goals).error, 'too far away');
  assert.ok(validateFields({ goal_deadline: '2027-03-01' }, STEP_FIELDS.goals).value);
  assert.ok(validateFields({ posts_per_week: 2.5 }, STEP_FIELDS.content).error);
  assert.ok(validateFields({ video_ok: 'yes' }, STEP_FIELDS.content).error);
  assert.ok(validateFields({ niche: 'x' }, STEP_FIELDS.about).error, 'field from another step is rejected, never silently dropped');
  assert.ok(validateFields([], STEP_FIELDS.about).error);
});
test('O.1 advance never moves backwards and ends at done', () => {
  assert.equal(advance('about', 'about'), 'connect');
  assert.equal(advance('goals', 'about'), 'goals');
  assert.equal(advance('goals', 'goals'), 'content');
  assert.equal(advance('content', 'content'), 'done');
  assert.equal(advance('done', 'about'), 'done');
});

test('O.1 GET for a user with no row: empty profile, step about, not complete', async () => {
  const h = makeOnboarding({ q: fakeQ() });
  const r = await call(h.get, A);
  assert.equal(r.body.completed, false); assert.equal(r.body.step, 'about'); assert.equal(r.body.profile.display_name, null);
  assert.equal(r.body.profile.auto_proposals, false); assert.deepEqual(r.body.steps, STEPS); assert.equal(Object.keys(r.body.profile).length, ALL_FIELDS.length);
});
test('O.1 saving a step twice leaves one row with the same content (idempotent) and advances progress once', async () => {
  const q = fakeQ(), h = makeOnboarding({ q });
  const body = { display_name: 'Mo', business_name: 'Leet', timezone: 'Asia/Beirut' };
  const r1 = await call(h.patchStep, A, body, { step: 'about' }), r2 = await call(h.patchStep, A, body, { step: 'about' });
  assert.equal(r1.code, 200); assert.deepEqual(r1.body, r2.body); assert.equal(q.rows.size, 1);
  assert.equal(r2.body.step, 'connect'); assert.equal(r2.body.profile.business_name, 'Leet');
});
test('O.1 resume after reload: a later GET returns the saved answers and the next step', async () => {
  const h = makeOnboarding({ q: fakeQ() });
  await call(h.patchStep, A, { display_name: 'Mo' }, { step: 'about' });
  await call(h.patchStep, A, { skipped: true }, { step: 'connect' });
  await call(h.patchStep, A, { niche: 'coffee', stage: 'growing' }, { step: 'business' });
  const r = await call(h.get, A);
  assert.equal(r.body.step, 'voice'); assert.deepEqual(r.body.skippedSteps, ['connect']); assert.equal(r.body.profile.niche, 'coffee');
});
test('O.1 editing an earlier step keeps progress; saving a skipped step un-skips it; unknown step 404; bad input 400 and nothing saved', async () => {
  const q = fakeQ(), h = makeOnboarding({ q });
  await call(h.patchStep, A, { display_name: 'Mo' }, { step: 'about' });
  await call(h.patchStep, A, { skipped: true }, { step: 'voice' });
  assert.equal((await call(h.get, A)).body.step, 'goals', 'about saved, voice skipped: next is goals (connect/business still open via the back button)');
  await call(h.patchStep, A, { display_name: 'Moe' }, { step: 'about' });
  assert.equal((await call(h.get, A)).body.step, 'goals', 'progress did not go back');
  await call(h.patchStep, A, {}, { step: 'voice' });
  assert.deepEqual((await call(h.get, A)).body.skippedSteps, []);
  assert.equal((await call(h.patchStep, A, {}, { step: 'nope' })).code, 404);
  const before = q.sqls.length;
  const bad = await call(h.patchStep, A, { stage: 'huge' }, { step: 'business' });
  assert.equal(bad.code, 400); assert.equal(q.sqls.length, before, 'no query at all on bad input');
  assert.equal((await call(h.patchStep, A, { skipped: true }, { step: 'about' })).code, 400, 'first step cannot be skipped');
  assert.equal((await call(h.patchStep, A, { skipped: true, niche: 'x' }, { step: 'business' })).code, 400);
});
test('O.1 complete needs a display name, is idempotent, and skipping everything else is allowed', async () => {
  const h = makeOnboarding({ q: fakeQ() });
  assert.equal((await call(h.complete, A, {})).code, 400);
  await call(h.patchStep, A, { display_name: 'Mo' }, { step: 'about' });
  for (const s of ['connect', 'business', 'voice', 'goals', 'content']) await call(h.patchStep, A, { skipped: true }, { step: s });
  const r = await call(h.complete, A, {}), r2 = await call(h.complete, A, {});
  assert.equal(r.code, 200); assert.equal(r.body.completed, true); assert.equal(r.body.step, 'done'); assert.equal(r2.body.completedAt, r.body.completedAt);
});
test('O.1 another user cannot read or change this profile (every query is scoped by the caller id)', async () => {
  const q = fakeQ(), h = makeOnboarding({ q });
  await call(h.patchStep, A, { display_name: 'Alice', business_summary: 'secret plan' }, { step: 'about' });
  await call(h.patchStep, A, { business_summary: 'secret plan' }, { step: 'business' });
  const rb = await call(h.get, B); assert.equal(rb.body.profile.display_name, null); assert.equal(rb.body.profile.business_summary, null);
  assert.equal((await call(h.getProfile, B)).body.business_summary, null);
  assert.equal((await call(h.putProfile, B, { niche: 'x' })).code, 409, 'B has no profile yet and cannot touch A');
  assert.equal(q.rows.get(A).niche ?? null, null);
  for (const { sql, p } of q.sqls) assert.ok(p[0] === A || p[0] === B, 'first param is always a user id: ' + sql.slice(0, 40));
  assert.ok(q.sqls.filter(x => /SELECT/.test(x.sql)).every(x => /WHERE user_id=\$1/.test(x.sql)));
});
test('O.1 PUT /profile: partial edit across steps, validated, does not change onboarding progress', async () => {
  const h = makeOnboarding({ q: fakeQ() });
  await call(h.patchStep, A, { display_name: 'Mo' }, { step: 'about' });
  const before = (await call(h.get, A)).body;
  const r = await call(h.putProfile, A, { niche: 'coffee', posts_per_week: 4, goal_primary: 'sales' });
  assert.equal(r.code, 200); assert.equal(r.body.niche, 'coffee'); assert.equal(r.body.display_name, 'Mo');
  const after = (await call(h.get, A)).body; assert.equal(after.step, before.step); assert.deepEqual(after.skippedSteps, before.skippedSteps);
  assert.equal((await call(h.putProfile, A, { posts_per_week: 99 })).code, 400);
  assert.equal((await call(h.putProfile, A, {})).code, 400);
  assert.equal((await call(h.putProfile, A, { display_name: null })).code, 400);
});
test('O.1 mutation guard: FIELDS covers every column the SQL selects', () => {
  assert.deepEqual(Object.keys(FIELDS), ALL_FIELDS); assert.ok(ALL_FIELDS.includes('goal_baseline_value') && ALL_FIELDS.includes('auto_proposals'));
});
