// R.0: authentication and permission gates as a factory (same pattern as insights.js), so the rules run against a fake q in test/rbacR0.test.js.
// No imports from the database or Express here. R.0b extends requireAuth with the organization (req.org).
import { can, isPermission, isStaffRole } from './permissions.js';

const USER_COLS = 'id,email,role,status,token_version'; // explicit columns: the password hash is never loaded into req.user

// Why an account or token is refused (null = fine). The caller answers 401 for every reason and never says which.
export function authProblem(user, tv) {
  if (!user) return 'unknown user';
  if (user.status !== 'active') return 'suspended';
  if ((Number.isInteger(user.token_version) ? user.token_version : 0) !== tv) return 'signed out';
  return null;
}

// verify(authorizationHeader) -> {sub, tv} or throws (sync or async).
export function makeRbac({ q, verify }) {
  // Every request reloads the user row, so a suspension, a role change or "sign out everywhere" takes effect on the very next call.
  const requireAuth = async (req, res, next) => {
    let t;
    try { t = await verify(req.headers?.authorization); } catch { return res.status(401).json({ error: 'unauthorized' }); }
    try {
      const [u] = await q(`SELECT ${USER_COLS} FROM users WHERE id=$1`, [t.sub]);
      if (authProblem(u, t.tv)) return res.status(401).json({ error: 'unauthorized' });
      req.user = { id: u.id, email: u.email, role: u.role, status: u.status, token_version: u.token_version };
      req.uid = u.id; // every existing route reads req.uid
      next();
    } catch (e) { next(e); }
  };
  // requirePermission('users:read'). The returned function is tagged with .permission so scripts/check-admin-guards.js can find it.
  // An unknown permission name throws when the route file loads (a typo must not silently open or close a route).
  const requirePermission = perm => {
    if (!isPermission(perm)) throw new Error('requirePermission: unknown permission ' + perm);
    const mw = (req, res, next) => {
      if (!req.user) return res.status(401).json({ error: 'unauthorized' });
      if (!can(req.user.role, perm)) return res.status(403).json({ error: 'forbidden' });
      next();
    };
    mw.permission = perm;
    return mw;
  };
  const requireStaff = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'unauthorized' });
    if (!isStaffRole(req.user.role)) return res.status(403).json({ error: 'forbidden' });
    next();
  };
  return { requireAuth, requirePermission, requireStaff };
}
