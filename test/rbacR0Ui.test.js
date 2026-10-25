// R.0 frontend shell: pure helpers (web/src/admin/pure.ts, imported straight from the .ts file; skipped on a Node without type stripping)
// plus source checks of App.tsx, AdminShell.tsx, useCan.ts and the page files. The React code has not run in a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const web = p => readFileSync(new URL('../web/src/' + p, import.meta.url), 'utf8');
let h = null; try { h = await import('../web/src/admin/pure.ts'); } catch { /* old Node without type stripping */ }
const T = h ? test : test.skip;
const me = (role, permissions) => ({ user: { id: 'u1', email: 'a@x.com', name: null, role }, permissions });

T('canFrom / useCan logic: platform and organization permissions come from the same list; nothing asked = allowed; signed out = nothing', () => {
  const m = me('admin', ['users:read', 'org.members.read']);
  assert.equal(h.canFrom(m, 'users:read'), true); assert.equal(h.canFrom(m, 'org.members.read'), true, 'an org permission works the same way'); assert.equal(h.canFrom(m, 'users:delete'), false);
  assert.equal(h.canFrom(m, undefined), true); assert.equal(h.canFrom(m, ''), true); assert.equal(h.canFrom(null, 'users:read'), false); assert.equal(h.canFrom(undefined, 'x'), false); assert.equal(h.canFrom({ user: {}, permissions: undefined }, 'x'), false);
});
T('isStaffMe: support, admin and owner only', () => {
  for (const [role, want] of [['user', false], ['support', true], ['admin', true], ['owner', true], ['org_admin', false], ['', false]]) assert.equal(h.isStaffMe(me(role, [])), want, role);
  assert.equal(h.isStaffMe(null), false); assert.equal(h.isStaffMe(undefined), false);
});
T('page discovery: slug from the file name, sorted by meta.order then title, hidden without the permission', () => {
  assert.equal(h.slugOf('./pages/Overview.jsx'), 'overview'); assert.equal(h.slugOf('./pages/AuditLog.jsx'), 'audit-log'); assert.equal(h.slugOf('./pages/users.tsx'), 'users');
  const pages = [{ slug: 'audit', title: 'Audit', permission: 'audit:read', order: 30 }, { slug: 'users', title: 'Users', permission: 'users:read', order: 10 }, { slug: 'overview', title: 'Overview', permission: 'system:read', order: 0 }, { slug: 'zeta', title: 'Zeta' }, { slug: 'alpha', title: 'Alpha' }];
  assert.deepEqual(h.sortPages(pages).map(p => p.slug), ['overview', 'users', 'audit', 'alpha', 'zeta'], 'no order = last, then by title'); assert.equal(pages[0].slug, 'audit', 'input not mutated');
  assert.deepEqual(h.visiblePages(pages, me('support', ['users:read', 'system:read'])).map(p => p.slug), ['overview', 'users', 'alpha', 'zeta'], 'audit hidden from support');
  assert.deepEqual(h.visiblePages(pages, me('user', [])).map(p => p.slug), ['alpha', 'zeta'], 'only pages that ask for no permission'); assert.deepEqual(h.visiblePages(pages, null).map(p => p.slug), ['alpha', 'zeta']);
});
T('admin paths: /admin and /admin/<page> only; unknown or forbidden pages fall back to the first allowed one', () => {
  for (const [p, want] of [['/admin', true], ['/admin/', true], ['/admin/users', true], ['/administrator', false], ['/', false], ['/adminx/users', false], ['/api/admin', false]]) assert.equal(h.isAdminPath(p), want, p);
  assert.equal(h.adminPath(), '/admin'); assert.equal(h.adminPath('users'), '/admin/users'); assert.equal(h.slugFromPath('/admin/users'), 'users'); assert.equal(h.slugFromPath('/admin/users/42'), 'users'); assert.equal(h.slugFromPath('/admin/'), ''); assert.equal(h.slugFromPath('/x'), '');
  const pages = [{ slug: 'overview', title: 'O', permission: 'system:read', order: 0 }, { slug: 'audit', title: 'A', permission: 'audit:read', order: 30 }], sup = me('support', ['system:read']), adm = me('admin', ['system:read', 'audit:read']);
  assert.equal(h.currentPage(pages, adm, '/admin/audit').slug, 'audit'); assert.equal(h.currentPage(pages, sup, '/admin/audit').slug, 'overview', 'support cannot open audit: falls back'); assert.equal(h.currentPage(pages, adm, '/admin').slug, 'overview'); assert.equal(h.currentPage(pages, adm, '/admin/nope').slug, 'overview');
  assert.equal(h.currentPage(pages, me('user', []), '/admin'), null); assert.equal(h.currentPage([], adm, '/admin'), null);
});

const APP = web('App.tsx'), SHELL = web('admin/AdminShell.tsx'), CAN = web('admin/useCan.ts'), OV = web('admin/pages/Overview.jsx');
test('App.tsx: the admin shell is lazy-loaded (its own chunk), only staff see the Admin entry, /admin is opened and left through the history API', () => {
  assert.match(APP, /const AdminShell = lazy\(\(\)=>import\('\.\/admin\/AdminShell'\)\)/); assert.ok(!/import AdminShell/.test(APP) && !/from '\.\/admin\/AdminShell'/.test(APP), 'no static import of the shell');
  assert.ok(!/from '\.\/admin\/pages|import\.meta\.glob/.test(APP), 'App never pulls admin pages');
  assert.match(APP, /\{isStaffMe\(me\)&&<button className="navb sm" onClick=\{\(\)=>\{history\.pushState\(null,'','\/admin'\);setAdminMode\(true\)\}\}>.*Admin<\/button>\}/);
  assert.match(APP, /const \{me\} = useMe\(t\)/); assert.match(APP, /isAdminPath\(location\.pathname\)/); assert.match(APP, /addEventListener\('popstate',f\)/);
  assert.match(APP, /if\(adminMode\)return <Suspense fallback=.*><AdminShell onExit=/s);
  assert.ok(APP.indexOf('if(!t) return <Login') < APP.indexOf('if(adminMode)return') && APP.indexOf("ob==='needed'") < APP.indexOf('if(adminMode)return'), 'a signed-out or not-yet-onboarded person never reaches /admin');
  assert.ok(APP.indexOf('useMe(t)') < APP.indexOf('if(!t) return <Login') && APP.indexOf('const [adminMode') < APP.indexOf('if(!t) return <Login'), 'hooks stay before the early returns');
  assert.match(APP, /\{cc \? <CommandCenter\/> : <P go=\{go\}\/>\}/, 'the stream-6 hash router and the Command Center mounting are unchanged');
});
test('AdminShell: pages auto-discovered from ./pages/*.jsx, sorted and permission-filtered, non-staff are sent back, existing theme classes and icons only', () => {
  assert.match(SHELL, /import\.meta\.glob\('\.\/pages\/\*\.jsx',\{eager:true\}\)/); assert.match(SHELL, /visiblePages\(PAGES,me\)/); assert.match(SHELL, /currentPage\(PAGES,me,path\)/);
  assert.match(SHELL, /useEffect\(\(\)=>\{if\(!loading&&!isStaffMe\(me\)\)onExit\(\)\},\[loading,me\]\)/); assert.match(SHELL, /if\(loading\|\|!isStaffMe\(me\)\)return/);
  assert.match(SHELL, /history\.pushState\(null,'',adminPath\(slug\)\)/); assert.match(SHELL, /addEventListener\('popstate'/);
  for (const c of ['shell nav-open', 'className="side"', 'className="nav"', 'className="navb"', 'className="ctr"', 'className="tb"', 'className="page"']) assert.ok(SHELL.includes(c), c);
  assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgb\(/.test(SHELL), 'no hard-coded colours: the app\'s theme variables via its classes'); assert.match(SHELL, /name="chevLeft"/);
  assert.match(web('icons.tsx'), /\n  chevLeft: '/, 'the icon the shell uses exists');
});
test('useCan reads GET /api/me once per sign-in and works for any permission name', () => {
  assert.match(CAN, /api<Me>\('\/me'\)/); assert.match(CAN, /cache\.t!==t/); assert.match(CAN, /export function useCan\(perm:string\):boolean\{const \{me\}=useMe\(\);return canFrom\(me,perm\)\}/); assert.match(CAN, /p\.catch\(\(\)=>\{if\(cache&&cache\.p===p\)cache=null\}\)/);
});
test('page files follow the contract: default component + meta {title, permission, order}; the placeholder needs only system:read', () => {
  const dir = new URL('../web/src/admin/pages/', import.meta.url), files = readdirSync(dir).filter(f => /\.jsx$/.test(f)); assert.ok(files.includes('Overview.jsx'));
  for (const f of files) { const s = readFileSync(new URL(f, dir), 'utf8'); assert.match(s, /export const meta = \{ title: '[^']+', permission: '[a-z.:_]+', order: \d+ \}/, f); assert.match(s, /export default function/, f); }
  assert.match(OV, /permission: 'system:read'/); assert.match(OV, /api\('\/admin\/ping'\)/);
});
