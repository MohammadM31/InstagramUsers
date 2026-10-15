// Roadmap 2.1: daily post snapshots + per-user baseline. Idempotent, so it is safe to run every hour.
// `q` is injected (db.js's q in production, a fake in tests).

// One snapshot per post per UTC day (post_snapshots_day unique index); a second run on the same day inserts nothing.
const SNAPSHOT_SQL = `INSERT INTO post_snapshots(post_id,likes,comments,saves,shares,reach)
  SELECT id,likes,comments,saves,shares,reach FROM posts
  ON CONFLICT DO NOTHING
  RETURNING id`;

// First run per user only (ON CONFLICT DO NOTHING). ER is stored as a percentage, like the rest of the app.
const BASELINE_SQL = `INSERT INTO metrics_baseline(user_id,reach30d,er,best_post_er,posts30d)
  SELECT user_id,
    coalesce(sum(reach) FILTER (WHERE posted_at>now()-interval '30 days'),0)::int,
    round((sum(coalesce(likes,0)+coalesce(comments,0)+coalesce(saves,0)+coalesce(shares,0)) FILTER (WHERE posted_at>now()-interval '30 days'))*100.0
      / NULLIF(sum(reach) FILTER (WHERE posted_at>now()-interval '30 days'),0),2),
    round(max((coalesce(likes,0)+coalesce(comments,0)+coalesce(saves,0)+coalesce(shares,0))*100.0/NULLIF(reach,0)),2),
    (count(*) FILTER (WHERE posted_at>now()-interval '30 days'))::int
  FROM posts GROUP BY user_id
  ON CONFLICT (user_id) DO NOTHING
  RETURNING user_id`;

export async function runSnapshots(q) {
  // Baseline first: it records the numbers as they were before today's snapshot, and before any alerting exists (2.3).
  const baselines = await q(BASELINE_SQL);
  const snaps = await q(SNAPSHOT_SQL);
  return { baselines: baselines.length, snapshots: snaps.length };
}

export function startSnapshots(q, everyMs = 36e5) {
  const run = () => runSnapshots(q).then(r => { if (r.snapshots || r.baselines) console.log('snapshots', r); }).catch(e => console.error('snapshots', e.message));
  setTimeout(run, 5000); // shortly after boot, then hourly. A day's snapshot exists after the first run of that day.
  return setInterval(run, everyMs);
}
