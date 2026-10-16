// Roadmap O.6 UI helpers (web/src/onb.ts): which sections are editable, when Save is allowed, and the read-only summary.
// Also proves every payload the Settings card builds is accepted by PUT /api/profile's validator. Skipped (not failed) on Node < 22.18.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFields, ALL_FIELDS, makeOnboarding } from '../src/onboarding.js';

let ui = null;
try { ui = await import('../web/src/onb.ts'); } catch { /* old Node */ }
const t = (name, fn) => ui ? test(name, fn) : test(name, { skip: 'needs Node 22.18+ to import web/src/onb.ts' }, () => {});
const { PROFILE_SECTIONS, FIELDS, toForm, toPayload, isDirty, summaryLines } = ui ?? {};

const profile = { display_name: 'Mo', business_name: 'Cedar Cafe', role: null, timezone: 'Asia/Beirut', languages: ['en', 'ar'], niche: 'coffee', niche_keywords: ['latte'], stage: 'growing',
  goal_primary: 'followers', goal_secondary: null, goal_target_metric: 'followers', goal_target_value: 2000, goal_deadline: '2026-12-31', posts_per_week: 4, content_by: 'me', video_ok: true, auto_proposals: false };

t('O.6 the editable sections are the four field sections; connect and voice have their own screens', () => {
  assert.deepEqual([...PROFILE_SECTIONS], ['about', 'business', 'goals', 'content']);
  for (const s of PROFILE_SECTIONS) assert.ok(FIELDS[s].length, s + ' has fields');
});
t('O.6 every section built from a saved profile is accepted by the PUT /profile validator', () => {
  for (const s of PROFILE_SECTIONS) {
    const p = toPayload(s, toForm(s, profile)); assert.ok(p.body, s + ' ' + JSON.stringify(p));
    const v = validateFields(p.body, ALL_FIELDS); assert.ok(!v.error, s + ' ' + JSON.stringify(v));
  }
});
t('O.6 isDirty: false for the untouched form, true after a change, false again when the change is undone', () => {
  const f = toForm('about', profile); assert.equal(isDirty('about', f, profile), false);
  assert.equal(isDirty('about', { ...f, display_name: 'Mo K' }, profile), true);
  assert.equal(isDirty('about', { ...f, display_name: 'Mo' }, profile), false);
  assert.equal(isDirty('content', { ...toForm('content', profile), video_ok: false }, profile), true, 'checkboxes count');
  assert.equal(isDirty('about', { ...f, languages: 'en, ar' }, profile), false, 'same list written the same way');
});
t('O.6 an empty required name is refused before the server is called; clearing an optional field sends null', () => {
  assert.ok(toPayload('about', { ...toForm('about', profile), display_name: '  ' }).error);
  assert.equal(toPayload('about', { ...toForm('about', profile), business_name: '' }).body.business_name, null);
});
t('O.6 summaryLines shows saved values with readable option names and skips empty fields', () => {
  const l = Object.fromEntries(summaryLines('business', profile).map(x => [x.label, x.value]));
  assert.equal(l['Stage'], 'Growing'); assert.equal(l['Niche'], 'coffee'); assert.equal(l['Niche keywords'], 'latte');
  assert.ok(!('Who is your audience?' in l), 'empty audience left out');
  assert.equal(summaryLines('about', {}).length, 0);
  assert.equal(Object.fromEntries(summaryLines('content', profile).map(x => [x.label, x.value]))['I can make videos and Reels'], 'Yes');
  assert.ok(!JSON.stringify(summaryLines('goals', { goal_target_value: null })).includes('null'));
});

// Server side of O.6 (already built in O.1): PUT /api/profile is a partial update that keeps onboarding progress and needs an existing profile.
const res = () => { const r = { code: 200, body: undefined }; r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; }; return r; };
test('O.6 PUT /profile: 409 before onboarding started, 400 on junk, and it does not move onboarding_step', async () => {
  const rows = new Map(), sqls = [];
  const q = async (sql, p = []) => { sqls.push(sql);
    if (/^\s*SELECT/i.test(sql)) return rows.has(p[0]) ? [{ ...rows.get(p[0]) }] : [];
    const m = sql.match(/INSERT INTO business_profile\(([^)]*)\)/); if (m) { const row = { ...rows.get(p[0]) }; m[1].split(',').forEach((c, i) => { row[c] = p[i]; }); rows.set(p[0], row); return []; }
    throw new Error('unexpected ' + sql); };
  const h = makeOnboarding({ q }), put = async (uid, body) => { const r = res(); await h.putProfile({ uid, body }, r); return r; };
  assert.equal((await put('new', { display_name: 'X' })).code, 409);
  rows.set('u', { display_name: 'Mo', onboarding_step: 'goals', skipped_steps: ['voice'], auto_proposals: false });
  assert.equal((await put('u', { display_name: 'Mo K', stage: 'huge' })).code, 400);
  assert.equal((await put('u', {})).code, 400);
  const ok = await put('u', { display_name: 'Mo K' }); assert.equal(ok.code, 200); assert.equal(ok.body.display_name, 'Mo K');
  assert.equal(rows.get('u').onboarding_step, 'goals'); assert.deepEqual(rows.get('u').skipped_steps, ['voice']);
});
