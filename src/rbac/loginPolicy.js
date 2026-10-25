// R.0: who may log in. Pure. Called AFTER the password was checked, so a suspended account never learns anything from a wrong password.
export function loginBlock(user) {
  if (user && user.status && user.status !== 'active') return { status: 403, error: 'This account is suspended. Contact support.' };
  return null;
}
