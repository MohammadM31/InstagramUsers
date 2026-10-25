// R.0: GET /api/me. Who am I and what may I do. The frontend's useCan(permission) reads this; R.0b adds the organization permissions to the list.
import { permissionsFor } from './permissions.js';

export function makeMe({ q }) {
  return async function me(req, res) {
    let name = null;
    try { [{ display_name: name = null } = {}] = await q('SELECT display_name FROM business_profile WHERE user_id=$1', [req.user.id]); }
    catch (e) { if (e?.code !== '42P01') throw e; } // no profile table yet: no name, not an error
    const { id, email, role } = req.user;
    res.json({ user: { id, email, name: name || null, role }, permissions: permissionsFor(role) });
  };
}
