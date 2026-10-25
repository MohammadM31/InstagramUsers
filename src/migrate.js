import './loadenv.js';
import { validateEnv } from './config.js';
validateEnv({ needDb: true });
import fs from 'node:fs';
import { db } from './db.js';

const dir = new URL('../db/', import.meta.url);
const files = ['schema.sql', ...fs.readdirSync(dir).filter(f => /^schema\..+\.sql$/.test(f)).sort()];

try {
  for (const f of files) {
    const sql = fs.readFileSync(new URL(f, dir), 'utf8');
    await db.query(sql);
    console.log('migrated', f);
  }
} catch (e) {
  console.error('Migration failed:', e.message);
} finally {
  await db.end();
}