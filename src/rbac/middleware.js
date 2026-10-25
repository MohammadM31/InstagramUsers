// R.0: the real gates, bound to the database and to jsonwebtoken. The database and token modules are loaded on first use, so importing
// this file (for example from an admin route file) never opens a connection.
import { makeRbac } from './guards.js';
export { authProblem } from './guards.js';
export const { requireAuth, requirePermission, requireStaff } = makeRbac({
  q: async (sql, params) => (await import('../db.js')).q(sql, params),
  verify: async header => (await import('./token.js')).verifyToken(header),
});
