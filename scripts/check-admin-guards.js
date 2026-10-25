// Fails (exit 1) if any route under the admin router has no requirePermission(...) gate. Run: npm run check:admin  (works on Windows; no database needed)
import { loadAdminRoutes, unguardedIn } from '../src/admin/index.js';
try {
  const routes = await loadAdminRoutes(), bad = unguardedIn(routes);
  if (bad.length) { console.error('Admin routes WITHOUT a requirePermission(...) gate:\n  ' + bad.join('\n  ')); process.exit(1); }
  console.log(`admin guards ok: ${routes.length} route file(s), every route has a requirePermission gate`);
  process.exit(0);
} catch (e) { console.error('check-admin-guards failed:', e.message); process.exit(1); }
