// Roadmap A.1b: pull the user's own media + insights from the Instagram Graph API into `posts`.
// Pure mapping/scheduling functions are exported for tests; the I/O factory takes injected deps (same pattern as insights.js).
import crypto from 'node:crypto';
import { assertMetricsAllowed, IgError } from './instagram.js';
import { IgNotConnected, markReconnect } from './igconnect.js';

export const MEDIA_FIELDS = 'id,timestamp,media_type,media_product_type,caption,permalink,thumbnail_url,like_count,comments_count';
export const PAGE_SIZE = 50, CAP = 200, REPULL_DAYS = 3, USAGE_STOP = 80;

// Insight names we request, per media kind. Only metrics that have a column are requested (reach, views, saved->saves, shares, watch time).
// Each list is the most complete one; if Meta rejects it (an unsupported metric fails the whole call) we fall back to the core list, then to none.
// assertMetricsAllowed makes retired names (impressions, plays, video_views...) impossible to request.
export const INSIGHT_LADDER = {
  REEL: [assertMetricsAllowed(['reach', 'views', 'saved', 'shares', 'ig_reels_avg_watch_time']), assertMetricsAllowed(['reach', 'saved', 'shares'])],
  FEED: [assertMetricsAllowed(['reach', 'views', 'saved', 'shares']), assertMetricsAllowed(['reach', 'saved', 'shares'])],
};

// Our `type` column: VIDEO and REELS are REEL; stories are not synced (decision D5); everything else keeps Instagram's name.
export function mediaType(m) {
  if (m.media_product_type === 'STORY') return null;
  if (m.media_product_type === 'REELS' || m.media_type === 'VIDEO') return 'REEL';
  return m.media_type || null;
}

// insights API result -> { reach, saved, ... }. A metric with no value is simply absent.
export function parseInsights(resp) {
  const out = {};
  for (const x of resp?.data || []) {
    const v = x.values?.[0]?.value ?? x.total_value?.value;
    if (Number.isFinite(v)) out[x.name] = v;
  }
  return out;
}

// Pure. An unavailable metric is NULL, never 0 and never a rejection (A.1b rule). Watch time arrives in milliseconds; watch_s is whole seconds.
export function mapMedia(m, insights = {}) {
  const type = mediaType(m);
  if (!type || !m.id || !m.timestamp) return null;
  const n = v => (Number.isFinite(v) ? v : null);
  return {
    ig_media_id: String(m.id), type, posted_at: m.timestamp, caption: m.caption || '',
    permalink: m.permalink || null, thumbnail_url: m.thumbnail_url || null, media_product_type: m.media_product_type || null,
    likes: n(m.like_count), comments: n(m.comments_count),
    saves: n(insights.saved), shares: n(insights.shares), reach: n(insights.reach), views: n(insights.views),
    watch_s: Number.isFinite(insights.ig_reels_avg_watch_time) ? Math.round(insights.ig_reels_avg_watch_time / 1000) : null,
  };
}

// Per-user staggered schedule: each account syncs once a day at 02:00 local time plus a stable 0-6 h offset derived from its id,
// so a thousand users do not hit Meta at the same minute. tzOffsetMin is minutes ahead of UTC (0 until onboarding stores a time zone, O.1).
export const staggerMinutes = uid => parseInt(crypto.createHash('sha1').update(String(uid)).digest('hex').slice(0, 6), 16) % 360;
export function syncDue(acct, now = Date.now(), tzOffsetMin = 0) {
  if (acct.status !== 'connected') return false;
  const local = new Date(now + tzOffsetMin * 60000);
  const dayStartUtc = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - tzOffsetMin * 60000;
  const slot = dayStartUtc + (120 + staggerMinutes(acct.user_id)) * 60000;
  return now >= slot && (!acct.last_sync_at || new Date(acct.last_sync_at).getTime() < slot);
}

// ---- SQL. One parameter list for all three statements: see params(). ----
const SET = `likes=coalesce($3,likes),comments=coalesce($4,comments),saves=coalesce($5,saves),shares=coalesce($6,shares),reach=coalesce($7,reach),
  views=coalesce($8,views),watch_s=coalesce($9,watch_s),permalink=coalesce($10,permalink),thumbnail_url=coalesce($11,thumbnail_url),media_product_type=coalesce($12,media_product_type)`;
// 1. already linked to this Instagram media id
export const UPDATE_BY_ID_SQL = `UPDATE posts SET ${SET} WHERE user_id=$1 AND ig_media_id=$2 RETURNING id`;
// 2. a CSV/import row for the same post (same UTC date, type and caption, not yet linked): attach the id to it
export const BACKFILL_SQL = `UPDATE posts SET ig_media_id=$2,${SET} WHERE id=(
  SELECT id FROM posts WHERE user_id=$1 AND ig_media_id IS NULL AND type=$14
    AND (posted_at AT TIME ZONE 'UTC')::date=($15::timestamptz AT TIME ZONE 'UTC')::date AND md5(coalesce(caption,''))=md5($13)
  ORDER BY abs(extract(epoch from posted_at-$15::timestamptz)) LIMIT 1) RETURNING id`;
// 3. a new post. DO NOTHING covers the date+type+caption unique index (posts_dedupe) for a pathological duplicate.
export const INSERT_SQL = `INSERT INTO posts(user_id,ig_media_id,likes,comments,saves,shares,reach,views,watch_s,permalink,thumbnail_url,media_product_type,caption,type,posted_at)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT DO NOTHING RETURNING id`;
const params = (uid, r) => [uid, r.ig_media_id, r.likes, r.comments, r.saves, r.shares, r.reach, r.views, r.watch_s, r.permalink, r.thumbnail_url, r.media_product_type, r.caption, r.type, r.posted_at];

// deps: q, graph, getIgCreds, afterSync (e.g. runSnapshots), now
export function makeIgSync({ q, graph, getIgCreds, afterSync = async () => {}, hit, enqueue, getJob, now = () => Date.now() }) {
  async function insightsFor(token, m) {
    const ladder = INSIGHT_LADDER[mediaType(m) === 'REEL' ? 'REEL' : 'FEED'];
    for (const metrics of ladder) {
      try { return { data: parseInsights(await graph.get(`${m.id}/insights`, { metric: metrics.join(',') }, token)) }; }
      catch (e) {
        if (!(e instanceof IgError) || e.tokenInvalid || e.rateLimited) throw e; // stop the whole run on these
        // anything else (unsupported metric, media too old, too few viewers): try the shorter list, then give up quietly
      }
    }
    return { data: {}, failed: true };
  }

  async function upsert(uid, row) {
    const p = params(uid, row);
    if ((await q(UPDATE_BY_ID_SQL, p.slice(0, 12))).length) return 'updated';
    if ((await q(BACKFILL_SQL, p)).length) return 'linked';
    return (await q(INSERT_SQL, p)).length ? 'inserted' : 'skipped';
  }

  // One sync for one user. Never throws for per-post problems; throws IgNotConnected / IgError for account-level ones (after recording them).
  async function syncUser(uid) {
    const creds = await getIgCreds(uid);
    if (!creds) throw new IgNotConnected('not_connected');
    const [{ n: known }] = await q('SELECT count(*)::int n FROM posts WHERE user_id=$1 AND ig_media_id IS NOT NULL', [uid]);
    const firstRun = known === 0, cutoff = now() - REPULL_DAYS * 864e5;
    const res = { fetched: 0, inserted: 0, updated: 0, linked: 0, skipped: 0, noInsights: 0, stoppedEarly: null };
    try {
      let after;
      scan: while (res.fetched < CAP) {
        const page = await graph.get(`${creds.igUserId}/media`, { fields: MEDIA_FIELDS, limit: PAGE_SIZE, after }, creds.token);
        let oldestInPage = Infinity;
        for (const m of page.data || []) {
          if (res.fetched >= CAP) break;
          oldestInPage = Math.min(oldestInPage, Date.parse(m.timestamp) || Infinity);
          // Later runs only need the last few days (insights can lag up to 48 h); the first run backfills up to the cap.
          if (!firstRun && Date.parse(m.timestamp) < cutoff) continue;
          if (!mediaType(m)) continue; // stories: not synced, and no point asking for their insights
          const ins = await insightsFor(creds.token, m);
          const row = mapMedia(m, ins.data);
          if (!row) continue;
          res.fetched++; if (ins.failed) res.noInsights++;
          res[await upsert(uid, row)]++;
        }
        if (page._usage >= USAGE_STOP) { res.stoppedEarly = `Instagram usage at ${page._usage}%, continuing at the next scheduled run`; break; }
        after = page.paging?.cursors?.after;
        if (!page.paging?.next || !after) break;
        if (!firstRun && oldestInPage < cutoff) break scan;
      }
    } catch (e) {
      if (creds.source === 'oauth' && e instanceof IgError) {
        if (e.tokenInvalid) await markReconnect(q, uid, e.message);
        else await q('UPDATE ig_accounts SET last_error=$2 WHERE user_id=$1', [uid, e.message]);
      }
      throw e;
    }
    const warn = res.stoppedEarly || (res.fetched && res.noInsights === res.fetched ? 'Instagram returned no insights for any post (check permissions or account age)' : null);
    if (creds.source === 'oauth') await q('UPDATE ig_accounts SET last_sync_at=now(),last_error=$2 WHERE user_id=$1', [uid, warn]);
    await afterSync(); // snapshots: idempotent per post per UTC day
    return res;
  }

  // Scheduler tick: sync every connected account whose staggered slot has passed and which has not synced since.
  async function runDue() {
    const accts = await q(`SELECT user_id,status,last_sync_at FROM ig_accounts WHERE status='connected'`);
    const out = { due: 0, ok: 0, failed: 0 };
    for (const a of accts.filter(a => syncDue(a, now()))) {
      out.due++;
      try { await syncUser(a.user_id); out.ok++; } catch (e) { out.failed++; console.error('ig sync', a.user_id, e.message); }
    }
    return out;
  }

  // POST /api/instagram/sync: per-user cooldown (1 per 5 min), then a queued job. 202 {jobId}.
  const requestSync = async (req, res) => {
    const [a] = await q('SELECT status FROM ig_accounts WHERE user_id=$1', [req.uid]);
    if (!a) return res.status(409).json({ error: 'Instagram is not connected.' });
    if (a.status !== 'connected') return res.status(409).json({ error: new IgNotConnected(a.status).message });
    const h = await hit('igsync', req.uid, 1, 300);
    if (!h.ok) { res.set('Retry-After', String(h.ttl)); return res.status(429).json({ error: `Sync was just run. Try again in ${Math.ceil(h.ttl / 60)} min.` }); }
    res.status(202).json({ jobId: await enqueue(req.uid) });
  };
  const jobStatus = async (req, res) => {
    const j = await getJob(req.params.jobId);
    if (!j || j.data.userId !== req.uid) return res.sendStatus(404);
    const st = await j.getState();
    res.json(st === 'completed' ? { status: 'done', ...j.returnvalue } : st === 'failed' ? { status: 'failed', error: j.failedReason } : { status: 'pending' });
  };

  return { syncUser, runDue, requestSync, jobStatus };
}
