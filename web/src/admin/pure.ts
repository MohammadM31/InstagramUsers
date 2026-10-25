// R.0 admin shell helpers. Pure (no React, no window) so test/rbacR0Ui.test.js can import them in Node. Only erasable TypeScript syntax, no imports.
export type Me = { user: { id: string; email: string; name: string | null; role: string }; permissions: string[] };
export type PageMeta = { title: string; permission?: string; order?: number };
export type AdminPage = PageMeta & { slug: string };

export const STAFF_ROLES = ['support', 'admin', 'owner'];
// Works for platform and organization permissions alike: GET /api/me lists every permission the person has. No permission asked = allowed.
export const canFrom = (me: Me | null | undefined, perm?: string | null): boolean => !perm || !!me?.permissions?.includes(perm);
export const isStaffMe = (me: Me | null | undefined): boolean => !!me && STAFF_ROLES.includes(me.user?.role);

// './pages/Overview.jsx' -> 'overview'
export const slugOf = (file: string): string => (file.split('/').pop() || '').replace(/\.[jt]sx?$/, '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
// Sidebar order: meta.order ascending (missing = 100), then title.
export function sortPages<T extends AdminPage>(pages: T[]): T[] {
  return [...pages].sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.title.localeCompare(b.title));
}
// Pages this person may open: the page is hidden when they lack its meta.permission.
export const visiblePages = <T extends AdminPage>(pages: T[], me: Me | null | undefined): T[] => sortPages(pages).filter(p => canFrom(me, p.permission));

export const isAdminPath = (pathname: string): boolean => pathname === '/admin' || pathname.startsWith('/admin/');
export const adminPath = (slug?: string): string => (slug ? '/admin/' + slug : '/admin');
// '/admin/users' -> 'users', '/admin' -> ''
export const slugFromPath = (pathname: string): string => (isAdminPath(pathname) ? pathname.slice('/admin'.length).replace(/^\/+|\/+$/g, '').split('/')[0] : '');
// The page to show: the one in the address if allowed, otherwise the first allowed page.
export const currentPage = <T extends AdminPage>(pages: T[], me: Me | null | undefined, pathname: string): T | null => {
  const ok = visiblePages(pages, me), want = slugFromPath(pathname);
  return ok.find(p => p.slug === want) || ok[0] || null;
};
