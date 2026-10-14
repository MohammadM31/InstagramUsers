import './loadenv.js'; // load ./.env first (no --env-file needed)
// Boot-time environment validation (roadmap 0.2). Call validateEnv() at the top of every entry point.
// Pure: takes an env object, returns a list of problems, so it is unit-testable.
export const DEV_SECRET = 'dev-secret-change-me';

export function envProblems(env = process.env, { needDb = true } = {}) {
  const p = [];
  const prod = env.NODE_ENV === 'production';
  const js = env.JWT_SECRET;
  if (!js) p.push('JWT_SECRET is missing (set a random string of 32+ chars, e.g. `openssl rand -hex 32`)');
  else if (js.length < 32) p.push(`JWT_SECRET is too short (${js.length} chars, need 32+)`);
  else if (js === DEV_SECRET || /replace[_-]?me/i.test(js) || (prod && /change-me/i.test(js))) p.push('JWT_SECRET is a placeholder value; set a real random secret');
  const ek = env.ENCRYPTION_KEY;
  if (!ek) p.push('ENCRYPTION_KEY is missing (need exactly 64 hex chars, e.g. `openssl rand -hex 32`)');
  else if (!/^[0-9a-fA-F]{64}$/.test(ek)) p.push('ENCRYPTION_KEY is malformed (need exactly 64 hex characters)');
  else if (/^0{64}$/.test(ek)) p.push('ENCRYPTION_KEY is all zeros; generate a real key');
  if (needDb && !env.DATABASE_URL) p.push('DATABASE_URL is missing');
  return p;
}

export function validateEnv(opts) {
  const p = envProblems(process.env, opts);
  if (p.length) {
    console.error('\nGrowthEngine cannot start. Fix these environment variables:\n' + p.map(x => '  - ' + x).join('\n') + '\n');
    process.exit(1);
  }
}
