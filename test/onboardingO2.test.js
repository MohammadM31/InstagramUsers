// Roadmap O.2 (onboarding connect step): the pure helpers in web/src/ig.ts, checked against the SERVER's own lists so UI and API cannot drift apart.
// Node 22.18+ imports the .ts file directly; older Node reports these tests as skipped, not failed (same rule as onboardingUi.test.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONNECT_ERRORS } from '../src/igconnect.js';
import { IG_SCOPES } from '../src/instagram.js';

let ig = null;
try { ig = await import('../web/src/ig.ts'); } catch { /* old Node */ }
const t = (name, fn) => ig ? test(name, fn) : test(name, { skip: 'needs Node 22.18+ to import web/src/ig.ts' }, () => {});
const { IG_REQUIREMENTS, IG_PERMISSIONS, IG_FIX, IG_REASONS, describeIgError, parseIgRedirect, syncMessage } = ig ?? {};

t('O.2 every error code the server can send has plain text, a fix, and a retry flag in the UI', () => {
  for (const code of Object.keys(CONNECT_ERRORS)) {
    const d = describeIgError(code);
    assert.ok(d.text.length > 20, code); assert.ok(d.fix.length > 20, code); assert.equal(typeof d.retry, 'boolean', code);
    assert.ok(IG_REASONS[code] && IG_FIX[code], `${code} has both a reason and a fix`);
  }
});
t('O.2 only a server-side setting problem is not retryable; everything else offers Try again', () => {
  assert.equal(describeIgError('not_configured').retry, false);
  for (const code of Object.keys(CONNECT_ERRORS).filter(c => c !== 'not_configured')) assert.equal(describeIgError(code).retry, true, code);
});
t('O.2 the four failures the roadmap names (wrong type, no Page, declined, token error) each tell the person what to do', () => {
  assert.match(describeIgError('wrong_type').fix, /Business or Creator/);
  assert.match(describeIgError('no_page').fix, /Facebook Page/);
  assert.match(describeIgError('declined').fix, /allow every permission/i);
  assert.match(describeIgError('token_error').fix, /Try again/);
});
t('O.2 an unknown code gets a safe generic message with Try again, never a blank', () => {
  for (const c of ['', 'whatever', undefined]) { const d = describeIgError(c); assert.ok(d.text && d.fix); assert.equal(d.retry, true); }
});
t('O.2 the redirect carries the code through to the step (so the right fix is shown)', () => {
  for (const code of Object.keys(CONNECT_ERRORS)) {
    const r = parseIgRedirect(`?ig=error&reason=${code}`);
    assert.equal(r.ok, false); assert.equal(r.code, code); assert.equal(r.text, describeIgError(code).text);
  }
  assert.deepEqual(parseIgRedirect('?ig=connected').ok, true);
  assert.equal(parseIgRedirect(''), null);
  assert.equal(parseIgRedirect('?ig=error&reason=zzz').code, 'zzz');
});
t('O.2 the permission list shown to the person equals the scopes the server really requests', () => {
  assert.deepEqual(IG_PERMISSIONS.map(p => p.scope).sort(), [...IG_SCOPES].sort());
  assert.ok(IG_PERMISSIONS.every(p => p.why.length > 10));
  assert.match(IG_PERMISSIONS.find(p => p.scope === 'instagram_manage_comments').why, /not stored today/, 'honest: comments are not stored (A.2 not built)');
});
t('O.2 requirements name a professional account, a linked Page, and Page admin rights, before the redirect', () => {
  const all = IG_REQUIREMENTS.map(r => r.title + ' ' + r.detail).join(' ');
  assert.match(all, /Business or Creator/); assert.match(all, /Facebook Page/); assert.match(all, /manage that Page/i);
  assert.ok(IG_REQUIREMENTS.length >= 3);
});
t('O.2 syncMessage: done, empty result, partial stop, failure, still running', () => {
  assert.equal(syncMessage({ status: 'done', fetched: 3, inserted: 3, updated: 0, linked: 0, account: { followers: 1240 } }), 'Synced: 3 posts checked (3 new, 0 updated), 1,240 followers.');
  assert.match(syncMessage({ status: 'done', fetched: 2, inserted: 0, updated: 1, linked: 1, stoppedEarly: 'Instagram usage at 85%, continuing at the next scheduled run' }), /2 updated.*usage at 85%/);
  assert.match(syncMessage({ status: 'done', fetched: 0, inserted: 0, account: { followers: 50 } }), /returned no posts yet.*Followers: 50/, 'an empty result is not reported as success');
  assert.equal(syncMessage({ status: 'failed', error: 'Instagram needs to be reconnected' }), '⚠ Instagram needs to be reconnected');
  assert.match(syncMessage({ status: 'failed' }), /^⚠/);
  assert.match(syncMessage({ status: 'pending' }), /Still syncing/);
  assert.equal(syncMessage(null), '');
});
