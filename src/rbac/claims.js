// R.0: what goes into a session token and how it is read back. Pure (no jsonwebtoken), so the tv (token_version) rules are unit-tested.
const tvOf = n => (Number.isInteger(n) && n >= 0 ? n : 0);
export const makeClaims = user => ({ sub: user.id, tv: tvOf(user.token_version) });
// A token issued before R.0 has no tv: it counts as 0, which is what every existing user row holds, so nobody is signed out by the upgrade.
export function readClaims(payload) {
  if (!payload || typeof payload.sub !== 'string' || !payload.sub) throw new Error('bad token');
  return { sub: payload.sub, tv: tvOf(payload.tv) };
}
