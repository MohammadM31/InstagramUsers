// R.0: the admin API (/api/admin). Every request passes requireAuth + requireStaff + a per-user rate limit; every route file under src/admin/routes/
// is loaded automatically and must export a default Router and `export const mount = '/name'`. Each route must also use requirePermission(...):
// the router refuses to build (the server will not start) if one does not.
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { unguardedRoutes } from './guards.js';

export const ROUTES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'routes');

// [{file, mount, router}] for every route file, sorted by file name.
export async function loadAdminRoutes(dir = ROUTES_DIR) {
  const out = [];
  for (const file of readdirSync(dir).filter(f => f.endsWith('.js')).sort()) {
    const m = await import(pathToFileURL(path.join(dir, file)).href);
    if (!m.default || typeof m.mount !== 'string' || !/^\/[a-z0-9-]+$/i.test(m.mount)) throw new Error(`admin route file ${file} must export a default router and const mount = '/name'`);
    out.push({ file, mount: m.mount, router: m.default });
  }
  const seen = new Set();
  for (const r of out) { if (seen.has(r.mount)) throw new Error(`admin mount ${r.mount} is used twice (${r.file})`); seen.add(r.mount); }
  return out;
}
// "METHOD /mount/path" for every route without a requirePermission gate, across all route files.
export const unguardedIn = routes => routes.flatMap(r => unguardedRoutes(r.router, r.mount));

// deps: Router (express), requireAuth, requireStaff, limiter. Nothing is imported from express here so the tests need no packages.
export async function makeAdminRouter({ Router, requireAuth, requireStaff, limiter, dir = ROUTES_DIR }) {
  const routes = await loadAdminRoutes(dir), bad = unguardedIn(routes);
  if (bad.length) throw new Error('admin routes without requirePermission: ' + bad.join(', '));
  const r = Router();
  r.use(requireAuth, requireStaff, limiter);
  for (const x of routes) r.use(x.mount, x.router);
  r.use((_req, res) => res.status(404).json({ error: 'not found' }));
  return r;
}

// The real thing, used by server.js.
export async function adminRouter() {
  const [{ Router }, { default: rateLimit }, rbac, rl] = await Promise.all([import('express'), import('express-rate-limit'), import('../rbac/middleware.js'), import('../ratelimit.js')]);
  const limiter = rateLimit({
    windowMs: 60000, limit: 300, standardHeaders: true, legacyHeaders: false,
    keyGenerator: req => String(req.user?.id ?? 'anon'), // after requireAuth, so this is the signed-in staff member, not an IP
    handler: (_req, res) => { rl.recordSecurityEvent('rate_limit'); res.status(429).json({ error: 'Too many admin requests. Slow down.' }); },
  });
  return makeAdminRouter({ Router, requireAuth: rbac.requireAuth, requireStaff: rbac.requireStaff, limiter });
}
