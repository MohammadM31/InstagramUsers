// Roadmap A.3: competitor history. I/O only; the rules are pure and live in competitorintel.js and advisor.js (competitorMomentum, momentumAlert).
// Every dependency is injected: q (db), getIgCreds (per-user Instagram credentials), enqueue (scrape queue), now.
import { followerGrowth, competitorMomentum, momentumAlert } from './advisor.js';
import { historyRow, PUBLIC_NOTE, utcDay, scrapeErrorInfo } from './competitorintel.js';

const UPSERT = `INSERT INTO competitor_history(competitor_id,followers,posts_count,avg_likes,avg_comments) VALUES($1,$2,$3,$4,$5)
  ON CONFLICT (competitor_id,((captured_at AT TIME ZONE 'UTC')::date)) DO UPDATE SET captured_at=now(),followers=EXCLUDED.followers,
    posts_count=coalesce(EXCLUDED.posts_count,competitor_history.posts_count),avg_likes=coalesce(EXCLUDED.avg_likes,competitor_history.avg_likes),
    avg_comments=coalesce(EXCLUDED.avg_comments,competitor_history.avg_comments) RETURNING id`;
const DUE_SQL = `SELECT c.id,c.user_id,c.handle FROM competitors c
  WHERE NOT EXISTS (SELECT 1 FROM competitor_history h WHERE h.competitor_id=c.id AND (h.captured_at AT TIME ZONE 'UTC')::date=(now() AT TIME ZONE 'UTC')::date)
  ORDER BY c.id LIMIT $1`;
const HISTORY_SQL = `SELECT (captured_at AT TIME ZONE 'UTC')::date::text AS day,followers,posts_count,avg_likes,avg_comments FROM competitor_history
  WHERE competitor_id=$1 AND captured_at>now()-make_interval(days=>$2) ORDER BY captured_at`;
const OWN_SQL = `SELECT (captured_at AT TIME ZONE 'UTC')::date::text AS day,followers,source FROM follower_history
  WHERE user_id=$1 AND followers IS NOT NULL AND captured_at>now()-interval '40 days' ORDER BY captured_at`;
const ALL_HISTORY_SQL = `SELECT c.user_id,c.handle,(h.captured_at AT TIME ZONE 'UTC')::date::text AS day,h.followers FROM competitors c
  JOIN competitor_history h ON h.competitor_id=c.id WHERE h.followers IS NOT NULL AND h.captured_at>now()-interval '40 days' ORDER BY c.user_id,c.handle,h.captured_at`;
const ALL_OWN_SQL = `SELECT user_id,(captured_at AT TIME ZONE 'UTC')::date::text AS day,followers,source FROM follower_history
  WHERE followers IS NOT NULL AND captured_at>now()-interval '40 days' ORDER BY user_id,captured_at`;
const NOTIFY_SQL = `INSERT INTO notifications(user_id,kind,title,body,watch,dedupe_key) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (user_id,dedupe_key) DO NOTHING RETURNING id`;

const n = v => (v === null || v === undefined ? null : Number(v));
const group = (rows, keyOf) => { const m = new Map(); for (const r of rows) { const k = keyOf(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return m; };

export function makeCompetitors({ q, getIgCreds = async () => null, enqueue = async () => null, now = () => Date.now() }) {
  // Called by the scrape job after the competitor row is updated. Demo data and results without followers store nothing.
  async function record(competitorId, d) {
    const row = historyRow(d);
    if (!row) return { stored: false, reason: d?.source === 'demo' ? 'demo' : 'no_followers' };
    await q(UPSERT, [competitorId, row.followers, row.posts_count, row.avg_likes, row.avg_comments]);
    return { stored: true };
  }

  // Called by the scrape worker when an attempt fails. Stores a safe message (scrapeErrorInfo) for the UI; the next success clears it (worker UPDATE).
  // Never throws: a failed bookkeeping write must not hide the original scrape error.
  async function recordError(competitorId, err) {
    const { code, message } = scrapeErrorInfo(err);
    try { await q('UPDATE competitors SET last_error=$2,last_error_code=$3,last_error_at=now() WHERE id=$1', [competitorId, message, code]); return { stored: true, code }; }
    catch { return { stored: false, code }; }
  }

  // GET /api/competitors/:id/history?days=30  (days 1-365). Scoped to the signed-in user.
  const history = async (req, res) => {
    if (!/^\d{1,9}$/.test(String(req.params.id))) return res.status(400).json({ error: 'bad competitor id' });
    const raw = req.query?.days;
    if (raw !== undefined && !/^\d{1,3}$/.test(String(raw))) return res.status(400).json({ error: 'days must be a whole number from 1 to 365' });
    const days = Math.min(365, Math.max(1, raw === undefined ? 30 : Number(raw)));
    const [c] = await q('SELECT id,handle FROM competitors WHERE id=$1 AND user_id=$2', [Number(req.params.id), req.uid]);
    if (!c) return res.sendStatus(404);
    const rows = await q(HISTORY_SQL, [c.id, Math.max(days, 35)]); // momentum needs 30 days of look-back even for a short chart
    const own = await q(OWN_SQL, [req.uid]);
    const cutoff = utcDay(now() - days * 864e5);
    const all = rows.map(r => ({ day: r.day, followers: n(r.followers) }));
    const ownGrowth = followerGrowth({ followerSeries: own.map(r => ({ day: r.day, followers: n(r.followers), source: r.source })) });
    const points = rows.filter(r => r.day >= cutoff).map(r => ({ day: r.day, followers: n(r.followers), posts_count: n(r.posts_count), avg_likes: n(r.avg_likes), avg_comments: n(r.avg_comments) }));
    res.json({ handle: c.handle, days, points, momentum: competitorMomentum({ handle: c.handle, history: all }, ownGrowth.hasData ? ownGrowth : null),
      ownFollowersKnown: ownGrowth.hasData && ownGrowth.value7d !== null, source: 'business_discovery', note: PUBLIC_NOTE,
      reason: points.length ? null : 'no_history' });
  };

  // Daily job: queue one scrape per competitor that has no history row yet today (UTC). Users without a working Instagram connection are
  // skipped, so the demo fallback never runs from the schedule (and never feeds history or alerts). The jobId makes the queue ignore a second add on the same day.
  async function scrapeDue({ max = 100 } = {}) {
    const due = await q(DUE_SQL, [max]);
    const creds = new Map(), out = { due: due.length, queued: 0, skipped: { not_connected: 0, reconnect_needed: 0 }, errors: 0 };
    for (const c of due) {
      if (!creds.has(c.user_id)) creds.set(c.user_id, await getIgCreds(c.user_id).then(v => (v ? 'ok' : 'none'), () => 'reconnect'));
      const st = creds.get(c.user_id);
      if (st === 'none') { out.skipped.not_connected++; continue; }
      if (st === 'reconnect') { out.skipped.reconnect_needed++; continue; }
      try { await enqueue({ userId: c.user_id, competitorId: c.id, handle: c.handle }, `dc-${c.id}-${utcDay(now())}`); out.queued++; } catch { out.errors++; }
    }
    return out;
  }

  // Hourly: compare each competitor's 7-day follower change with the user's own and write the "outpacing you" notification (once per rival per week).
  async function runMomentum() {
    const [hist, own] = await Promise.all([q(ALL_HISTORY_SQL), q(ALL_OWN_SQL)]);
    const ownBy = group(own, r => r.user_id), res = { competitors: 0, created: 0 };
    for (const [uid, rows] of group(hist, r => r.user_id)) {
      const g = followerGrowth({ followerSeries: (ownBy.get(uid) || []).map(r => ({ day: r.day, followers: n(r.followers), source: r.source })) });
      for (const [handle, hs] of group(rows, r => r.handle)) {
        res.competitors++;
        const a = momentumAlert(competitorMomentum({ handle, history: hs.map(r => ({ day: r.day, followers: n(r.followers) })) }, g.hasData ? g : null), now());
        if (a) res.created += (await q(NOTIFY_SQL, [uid, a.kind, a.title, a.body, a.watch, a.key])).length;
      }
    }
    return res;
  }

  return { record, history, scrapeDue, runMomentum, recordError };
}
