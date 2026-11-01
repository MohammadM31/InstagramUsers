// Command Center helpers (web/src/cc.ts). Pure logic only; the React wiring is checked by rendering (see docs) and in a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
let cc = null; try { cc = await import('../web/src/cc.ts'); } catch { /* old Node without type stripping */ }
const T = cc ? test : test.skip;

T('briefing: reach up/down/unchanged/unknown wording comes straight from the numbers', () => {
  const mk = pct => cc.briefing({ name: 'Mo', dash: { reach: { value: 12345, changePct: pct }, avgER: { value: 4.2, changePct: 0.5 } }, ctx: { coverage: { posts: 9 }, health: { score: 72, label: 'Good' } } });
  assert.equal(mk(12.34).headline, 'Welcome back, Mo.');
  assert.equal(mk(12.34).lines[0], 'Reach is up 12.3% on the previous 30 days (12,345).');
  assert.match(mk(-8).lines[0], /^Reach is down 8% on the previous 30 days/);
  assert.match(mk(0).lines[0], /unchanged/);
  assert.equal(mk(null).lines[0], 'Reach is 12,345 over the last 30 days.');
  assert.equal(mk(12).lines[1], 'Engagement rate is up 0.5% on the previous 30 days (4.2%).');
  assert.equal(mk(12).lines[2], 'Account health: 72 (Good).');
});
T('briefing: focus line, tone, no name, and honest empty states', () => {
  const base = { dash: { reach: { value: 100, changePct: 5 } }, ctx: { coverage: { posts: 3 }, health: { score: 80, label: 'Good' } } };
  const g = cc.briefing({ ...base, focus: 'Reach out to two creators' });
  assert.equal(g.headline, 'Welcome back.'); assert.ok(g.lines.includes('Focus on: Reach out to two creators')); assert.equal(g.tone, 'good');
  assert.equal(cc.briefing({ dash: { reach: { value: 100, changePct: -20 } }, ctx: base.ctx }).tone, 'warn');
  assert.equal(cc.briefing({ dash: { reach: { value: 100, changePct: 5 } }, ctx: { coverage: { posts: 3 }, health: { score: 40, label: 'Weak' } } }).tone, 'warn', 'a low health score is a warning even with reach up');
  const none = cc.briefing({ name: 'Mo', dash: { reach: { value: 0, changePct: null } }, ctx: { coverage: { posts: 0 }, gaps: ['No posts yet: import or connect'] } });
  assert.match(none.lines[0], /no post data yet/); assert.match(none.lines[1], /^Focus on this first: No posts yet/); assert.equal(none.tone, 'info');
  assert.deepEqual(cc.briefing({}).lines, ['The briefing could not load yet.']);
  assert.ok(!cc.briefing({ dash: { reach: { value: 100, changePct: 1 } }, ctx: { coverage: { posts: 1 } } }).lines.some(l => /health/i.test(l)), 'no health line without health data');
});
T('fixQuestion: known kinds get a pointed question; unknown kinds quote the priority; long text is cut; never empty', () => {
  assert.match(cc.fixQuestion({ kind: 'follower_drop', text: 'x' }), /followers have dropped/);
  const u = cc.fixQuestion({ kind: 'brand_new_kind', text: '  Post   three\nreels this week ' });
  assert.match(u, /"Post three reels this week"/); assert.match(u, /What exactly should I do this week/);
  assert.ok(cc.fixQuestion({ kind: 'zzz', text: 'a'.repeat(500) }).length < 300);
  assert.equal(cc.fixQuestion({ kind: 'zzz', text: '' }), 'What should I do next?');
  assert.equal(cc.fixQuestion({ kind: 'toString', text: 'inherited key must not match' }).includes('inherited key'), true, 'object prototype keys are not treated as kinds');
});
T('pickAlerts: unread first, newest first, at most 3, input not mutated', () => {
  const a = (id, read, at) => ({ id, kind: 'x', title: 't' + id, body: '', created_at: at, read_at: read ? at : null });
  const items = [a(1, true, '2026-10-18T10:00:00Z'), a(2, false, '2026-10-18T08:00:00Z'), a(3, false, '2026-10-18T09:00:00Z'), a(4, true, '2026-10-18T11:00:00Z'), a(5, false, '2026-10-17T09:00:00Z')];
  const copy = JSON.stringify(items);
  assert.deepEqual(cc.pickAlerts(items).map(x => x.id), [3, 2, 5]);
  assert.deepEqual(cc.pickAlerts(items, 5).map(x => x.id), [3, 2, 5, 4, 1]);
  assert.equal(JSON.stringify(items), copy);
  assert.deepEqual(cc.pickAlerts(null), []);
});
T('connectionView: green only when connected', () => {
  assert.deepEqual([cc.connectionView({ status: 'connected', username: 'shop' }).on, cc.connectionView({ status: 'connected', username: 'shop' }).label], [true, '@shop']);
  for (const s of ['reconnect_needed', 'disconnected', 'dev_env', 'whatever']) assert.equal(cc.connectionView({ status: s }).on, false, s);
  assert.equal(cc.connectionView({ status: 'reconnect_needed', username: 'shop' }).label, '@shop');
  assert.equal(cc.connectionView(null).on, false); assert.equal(cc.connectionView(undefined).on, false);
  assert.match(cc.connectionView({ status: 'connected' }).label, /^@instagram$/);
});
T('scheduleBody: caption, valid future time, public URL only when it is http(s); never a data URI', () => {
  const now = Date.parse('2026-10-18T10:00:00Z'), when = '2026-10-19T09:30';
  const ok = cc.scheduleBody('  Fresh batch!  ', when, 'https://cdn.example/a.jpg', now);
  assert.deepEqual(ok.body, { caption: 'Fresh batch!', image: 'https://cdn.example/a.jpg', scheduledAt: new Date(when).toISOString() });
  assert.equal(cc.scheduleBody('x', when, undefined, now).body.image, null);
  assert.equal(cc.scheduleBody('x', when, 'data:image/png;base64,AAAA', now).body.image, null);
  assert.equal(cc.scheduleBody('x', when, 'javascript:alert(1)', now).body.image, null);
  for (const [c, w, msg] of [['', when, /caption/], ['   ', when, /caption/], ['x', '', /Pick a date/], ['x', 'not a date', /not valid/], ['x', '2020-01-01T00:00', /future/], ['a'.repeat(2201), when, /2,200/]])
    assert.match(cc.scheduleBody(c, w, null, now).error, msg);
  assert.equal(cc.scheduleBody('x', new Date(now - 30000).toISOString(), null, now).error, undefined, 'less than a minute in the past is tolerated');
});

// ---- Command Center page wiring (source checks: the React code has not run in a browser) ----
const CCSRC = readFileSync(new URL('../web/src/pages/CommandCenter.tsx', import.meta.url), 'utf8');
test('connection pill: sets location.hash=#settings and dispatches nav (App.tsx listens)', () => {
  const g = CCSRC.slice(CCSRC.indexOf('const goSettings'));
  assert.match(g, /location\.hash = '#settings'/); assert.match(g, /dispatchEvent\(new Event\('nav'\)\)/);
  assert.ok(g.indexOf("location.hash = '#settings'") < g.indexOf("dispatchEvent(new Event('nav'))"), 'hash is set first, so a nav listener already sees it');
  assert.match(CCSRC, /className="ccconn-pill" onClick=\{goSettings\}/);
});
test('deep link #cc=: read on mount / hashchange / nav, then cleared with history.replaceState', () => {
  assert.match(CCSRC, /parseHash\(location\.hash\)/); assert.match(CCSRC, /addEventListener\('hashchange', read\)/); assert.match(CCSRC, /addEventListener\('nav', read\)/);
  assert.match(CCSRC, /history\.replaceState\(/); assert.match(CCSRC, /<Assistant variant="page"[^>]*deepLink=\{deepLink\}/);
});
test('Command Center no longer relies on a sticky composer or a page-height thread', () => {
  const css = readFileSync(new URL('../web/src/styles.css', import.meta.url), 'utf8');
  assert.ok(!/\.assistant-page \.page-bar\{[^}]*sticky/.test(css)); assert.ok(!/min-height:calc\(100vh - 120px\)/.test(css));
});