// Roadmap 0.1 / 0.1b: the import job, with its dependencies injected so it can be unit-tested without Postgres or Redis.
// worker.js wires the real pool, `q` and the Graph API reader (see makeProcessImport at the bottom of worker.js).
import { normalizePosts, dedupeRows, METRICS } from './importer.js';

const COLS = ['type', 'posted_at', ...METRICS, 'caption'];
const UNNEST = '$2::text[],$3::timestamptz[],$4::int[],$5::int[],$6::int[],$7::int[],$8::int[],$9::int[],$10::int[],$11::text[]'; // same order as COLS

// New posts. Metrics the file did not contain are stored as 0 (so engagement sums never hit NULL). Existing posts are skipped.
export const INSERT_SQL = `INSERT INTO posts(user_id,type,posted_at,likes,comments,saves,shares,reach,impressions,watch_s,caption)
  SELECT $1,* FROM unnest(${UNNEST}) ON CONFLICT DO NOTHING`;

// 0.1b refresh of EXISTING posts. A metric that is NULL in the incoming row (the file had no such column, or the cell was empty)
// resolves to the stored value, so "missing" means "don't change". Only metrics can change; identity (date, type, caption) is the match key.
// Rows whose resulting numbers equal the stored ones are not touched, and are not counted as updated.
export const REFRESH_SQL = `UPDATE posts p SET ${METRICS.map(k => `${k}=coalesce(v.${k},p.${k})`).join(',')}
  FROM unnest(${UNNEST}) AS v(${COLS.join(',')})
  WHERE p.user_id=$1 AND p.type=v.type AND p.posted_at=v.posted_at AND md5(coalesce(p.caption,''))=md5(coalesce(v.caption,''))
  AND (${METRICS.map(k => 'p.' + k).join(',')}) IS DISTINCT FROM (${METRICS.map(k => `coalesce(v.${k},p.${k})`).join(',')})
  RETURNING p.id`;

// Arrays for unnest. nullable=true (refresh): a metric the row lacks becomes NULL. nullable=false (insert): the 0 default is used.
const arrays = (chunk, nullable) => COLS.map(k => chunk.map(r => nullable && METRICS.includes(k) && (r.missing || []).includes(k) ? null : r[k]));

// deps: { db: pg pool (needs connect()), q: query helper for the log insert, own: async (uid) => raw posts, for source 'instagram' }
export const makeProcessImport = ({ db, q, own }) => async function processImport({ userId, rows, source, update = false }) {
  const input = source === 'instagram' ? await own(userId) : rows;
  const { rows: valid, invalid } = normalizePosts(input), ok = dedupeRows(valid, update);
  let imported = 0, updated = 0;
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    for (let i = 0; i < ok.length; i += 500) {
      const chunk = ok.slice(i, i + 500);
      imported += (await c.query(INSERT_SQL, [userId, ...arrays(chunk, false)])).rowCount;
      if (update) updated += (await c.query(REFRESH_SQL, [userId, ...arrays(chunk, true)])).rowCount;
    }
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
  finally { c.release(); }
  // `duplicates` still means "rows that already existed" (old contract); `updated` is the subset whose numbers actually changed.
  const res = { imported, updated, duplicates: valid.length - imported, invalid: invalid.length, invalidSample: invalid.slice(0, 5), source, mode: update ? 'update' : 'skip' };
  await q('INSERT INTO import_log(user_id,source,imported,duplicates,invalid) VALUES($1,$2,$3,$4,$5)', [userId, source, imported, res.duplicates, res.invalid]);
  return res;
};
