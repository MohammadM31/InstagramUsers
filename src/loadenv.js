// Loads ./.env (relative to the working directory) when it exists, so plain `node src/server.js` works without --env-file.
// Variables that are already set in the real environment win over the file (same rule as --env-file).
// Must be the FIRST import of every entry point: db.js and cache.js read DATABASE_URL / REDIS_URL when they load.
// process.loadEnvFile needs Node 20.12+ / 21.7+; on older Node this does nothing and config.js reports what is missing.
import { existsSync } from 'node:fs';

if (typeof process.loadEnvFile === 'function' && existsSync('.env')) {
  try { process.loadEnvFile('.env'); } catch (e) { console.error('Could not read .env: ' + e.message); }
}
