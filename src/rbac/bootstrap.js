// R.0: owner bootstrap. The ONLY way to get the first owner: set OWNER_EMAIL to an account that has already signed up, then restart the server.
// Idempotent. No request path grants admin or owner; the role-change endpoint (a later phase) is the only other writer of users.role.
export function makeBootstrap({ q, env = process.env, log = console }) {
  return async function bootstrapOwner() {
    const email = String(env.OWNER_EMAIL ?? '').trim().toLowerCase();
    if (!email) { log.warn('OWNER_EMAIL is not set: nobody can become the platform owner, so /admin stays closed. Sign up, then set OWNER_EMAIL to that email and restart.'); return { status: 'unset' }; }
    try {
      const [u] = await q('SELECT id,role FROM users WHERE lower(email)=$1', [email]);
      if (!u) { log.warn(`OWNER_EMAIL is set (${email}) but nobody has signed up with that email yet. Sign up first, then restart the server.`); return { status: 'no-user' }; }
      if (u.role === 'owner') return { status: 'already', userId: u.id };
      await q("UPDATE users SET role='owner' WHERE id=$1 AND role<>'owner'", [u.id]);
      log.log(`OWNER_EMAIL: ${email} is now the platform owner (was ${u.role}).`);
      return { status: 'promoted', userId: u.id, from: u.role };
    } catch (e) { log.error('owner bootstrap failed:', e.message); return { status: 'error' }; }
  };
}
export const bootstrapOwner = () => makeBootstrap({ q: async (sql, p) => (await import('../db.js')).q(sql, p) })();
