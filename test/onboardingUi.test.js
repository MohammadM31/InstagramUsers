// Roadmap O.1 UI helpers (web/src/onb.ts). Also checks the UI's field list against the server's, so the two cannot drift apart.
import test from 'node:test';
import assert from 'node:assert/strict';
import { STEPS as SERVER_STEPS, STEP_FIELDS, validateFields, ALL_FIELDS } from '../src/onboarding.js';

// Node 22.18+ can import .ts directly (type stripping). On older Node these tests are skipped, not failed.
let ui = null;
try { ui = await import('../web/src/onb.ts'); } catch { /* old Node */ }
const t = (name, fn) => ui ? test(name, fn) : test(name, { skip: 'needs Node 22.18+ to import web/src/onb.ts' }, () => {});
const { STEPS, FIELDS, listFromText, textFromList, toForm, toPayload, startIndex } = ui ?? {};

t('O.1 UI steps equal the server steps, in order', () => assert.deepEqual([...STEPS], SERVER_STEPS));
t('O.1 every UI field is a server field of the same step; only goal_baseline_value is intentionally not asked', () => {
  for (const s of STEPS) for (const f of FIELDS[s]) assert.ok(STEP_FIELDS[s].includes(f.k), `${s}.${f.k}`);
  const asked = new Set(STEPS.flatMap(s => FIELDS[s].map(f => f.k)));
  assert.deepEqual(ALL_FIELDS.filter(k => !asked.has(k)), ['goal_baseline_value']);
});
t('O.1 listFromText trims, drops empties and duplicates; round trip', () => {
  assert.deepEqual(listFromText(' en, ar ,,en\nfr '), ['en', 'ar', 'fr']);
  assert.equal(textFromList(['a', 'b']), 'a, b'); assert.equal(textFromList(null), '');
});
t('O.1 toForm maps null to empty strings and booleans to booleans', () => {
  const f = toForm('content', { posts_per_week: null, content_by: 'me', video_ok: null, auto_proposals: false });
  assert.deepEqual(f, { posts_per_week: '', content_by: 'me', video_ok: false, auto_proposals: false });
  assert.equal(toForm('about', { languages: ['en', 'ar'] }).languages, 'en, ar');
});
t('O.1 toPayload: the name is required, empty optional fields clear (null), numbers must be numbers', () => {
  assert.match(toPayload('about', { display_name: '  ', business_name: '', role: '', timezone: '', languages: '' }).error, /required/);
  const ok = toPayload('about', { display_name: ' Mo ', business_name: '', role: 'owner', timezone: 'Asia/Beirut', languages: 'en, ar' });
  assert.deepEqual(ok.body, { display_name: 'Mo', business_name: null, role: 'owner', timezone: 'Asia/Beirut', languages: ['en', 'ar'] });
  assert.match(toPayload('content', { posts_per_week: 'abc', content_by: '', video_ok: false, auto_proposals: false }).error, /number/);
  assert.deepEqual(toPayload('content', { posts_per_week: '4', content_by: 'team', video_ok: true, auto_proposals: false }).body,
    { posts_per_week: 4, content_by: 'team', video_ok: true, auto_proposals: false });
  assert.match(toPayload('goals', { goal_primary: 'sales', goal_secondary: 'sales', goal_target_metric: '', goal_target_value: '', goal_deadline: '' }).error, /differ/);
  assert.deepEqual(toPayload('connect', {}).body, {}); assert.deepEqual(toPayload('voice', {}).body, {});
});
t('O.1 every payload the UI can build for a filled-in form is accepted by the server validator', () => {
  const filled = {
    about: { display_name: 'Mo', business_name: 'Leet', role: 'owner', timezone: 'Asia/Beirut', languages: 'en, ar' },
    business: { business_summary: 'We roast coffee', offerings: 'beans, merch', niche: 'coffee', niche_keywords: 'coffee, roast', audience: 'home brewers', stage: 'growing' },
    goals: { goal_primary: 'sales', goal_secondary: 'followers', goal_target_metric: 'followers', goal_target_value: '5000', goal_deadline: '2027-03-01' },
    content: { posts_per_week: '4', content_by: 'me', video_ok: true, auto_proposals: true },
  };
  for (const [s, form] of Object.entries(filled)) {
    const p = toPayload(s, form); assert.ok(p.body, s);
    const v = validateFields(p.body, STEP_FIELDS[s]); assert.ok(v.value, s + ' ' + JSON.stringify(v));
  }
  // and the all-empty form (everything skipped but the name) is also valid for the optional steps
  for (const s of ['business', 'goals', 'content']) {
    const empty = Object.fromEntries(FIELDS[s].map(f => [f.k, f.kind === 'bool' ? false : '']));
    const v = validateFields(toPayload(s, empty).body, STEP_FIELDS[s]); assert.ok(v.value, s + ' empty ' + JSON.stringify(v));
  }
});
t('O.1 startIndex resumes at the server step and at the last screen when everything is saved', () => {
  assert.equal(startIndex('about'), 0); assert.equal(startIndex('goals'), 4); assert.equal(startIndex('done'), 5);
});
