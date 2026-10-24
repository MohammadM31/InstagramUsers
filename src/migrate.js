import './loadenv.js';
import { validateEnv } from './config.js';
validateEnv({ needDb: true });
import fs from 'node:fs';
import { db } from './db.js';

const run = async (file) => {
  const sql = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  await db.query(sql);
};

try {
  await run('db/schema.sql');
  await run('db/schema.conversations.sql');
  await run('db/schema.imagelib.sql');
  await run('db/schema.albums.sql');
  console.log('migrated all schemas');
} catch (e) {
  console.error('Migration failed:', e.message);
} finally {
  await db.end();
}