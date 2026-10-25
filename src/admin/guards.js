// R.0: finds admin routes that are not behind a requirePermission(...) gate. Pure (walks an Express router's stack), so it runs at boot, in
// scripts/check-admin-guards.js and in the tests. A route is guarded when a requirePermission-tagged function (it carries .permission) is on the route itself
// or was added with router.use(...) earlier in the same router (or in a parent router before this one was mounted).
export function unguardedRoutes(router, prefix = '', inherited = false) {
  const bad = [];
  let guarded = inherited;
  for (const layer of router?.stack || []) {
    if (layer.route) {
      const handlers = (layer.route.stack || []).map(l => l.handle);
      if (!guarded && !handlers.some(h => typeof h === 'function' && h.permission)) {
        const methods = Object.keys(layer.route.methods || {}).filter(m => layer.route.methods[m]).map(m => m.toUpperCase()).join(',') || 'ANY';
        bad.push(`${methods} ${prefix}${layer.route.path}`);
      }
    } else if (layer.handle?.stack) bad.push(...unguardedRoutes(layer.handle, prefix, guarded)); // a nested router
    else if (typeof layer.handle === 'function' && layer.handle.permission) guarded = true;
  }
  return bad;
}
