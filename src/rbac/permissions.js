// R.0: platform roles and permissions. Pure (no database, no Express), so every rule is unit-tested in test/rbacR0.test.js.
// The permission list is the contract: never rename or redefine it here.
export const ROLES = ['user', 'support', 'admin', 'owner']; // lowest to highest
export const rank = role => ROLES.indexOf(role); // -1 for anything that is not a role

export const PERMISSIONS = [
  'users:read', 'users:suspend', 'users:logout', 'users:unlock', 'users:role', 'users:export', 'users:delete', 'users:impersonate',
  'orgs:read', 'orgs:suspend', 'orgs:manage', 'orgs:export', 'orgs:delete',
  'usage:read', 'quotas:manage', 'plans:manage', 'killswitch:toggle',
  'jobs:read', 'jobs:manage', 'content:read', 'content:moderate', 'ig:read', 'ig:manage',
  'system:read', 'flags:manage', 'announcement:manage', 'audit:read',
];

const SUPPORT = ['users:read', 'orgs:read', 'usage:read', 'jobs:read', 'content:read', 'ig:read', 'system:read'];
const ADMIN = [...SUPPORT, 'audit:read', 'users:suspend', 'users:logout', 'users:unlock', 'orgs:suspend', 'orgs:manage', 'quotas:manage', 'plans:manage',
  'killswitch:toggle', 'jobs:manage', 'content:moderate', 'ig:manage', 'flags:manage', 'announcement:manage'];
export const ROLE_PERMISSIONS = Object.freeze({ user: Object.freeze([]), support: Object.freeze(SUPPORT), admin: Object.freeze(ADMIN), owner: Object.freeze([...PERMISSIONS]) });

export const isPermission = p => PERMISSIONS.includes(p);
export const isStaffRole = role => rank(role) >= rank('support');
export const permissionsFor = role => [...(ROLE_PERMISSIONS[role] || [])];
export const can = (role, perm) => !!ROLE_PERMISSIONS[role] && ROLE_PERMISSIONS[role].includes(perm);

// May this actor act on this target (suspend, sign out, unlock...)? Strictly higher rank only; an owner may act on an admin (and no one acts on an equal).
export function canActOn(actorRole, targetRole) {
  const a = rank(actorRole), t = rank(targetRole);
  if (a < 0 || t < 0) return false;
  if (actorRole === 'owner' && targetRole === 'admin') return true;
  return a > t;
}

// Changing someone's platform role. actor and target are {id, role}; ownerCount is how many owners exist right now (the caller counts them).
// Returns {ok:true} or {ok:false, reason}. Owner only, never on yourself, and the last owner can never be demoted.
export function roleChangeGuard({ actor, target, newRole, ownerCount }) {
  const no = reason => ({ ok: false, reason });
  if (!actor || !target) return no('actor and target are required');
  if (!ROLES.includes(newRole)) return no('unknown role');
  if (!ROLES.includes(actor.role) || !ROLES.includes(target.role)) return no('unknown role');
  if (actor.role !== 'owner') return no('only an owner can change platform roles');
  if (actor.id !== undefined && String(actor.id) === String(target.id)) return no('you cannot change your own role');
  if (target.role === newRole) return no('that person already has this role');
  if (target.role === 'owner' && newRole !== 'owner' && !(Number(ownerCount) > 1)) return no('the last owner cannot be demoted');
  return { ok: true };
}
