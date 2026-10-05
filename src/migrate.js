import fs from 'node:fs';import {db} from './db.js';
await db.query(fs.readFileSync(new URL('../db/schema.sql',import.meta.url),'utf8'));console.log('migrated');await db.end();
