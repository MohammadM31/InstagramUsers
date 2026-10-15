// Roadmap Phase 1 handlers. Dependencies are injected (see routes.js) so the handlers can be unit-tested without Postgres.
// Pure logic lives in advisor.js; this file only reads data and shapes responses.
import { advise, health, marketingBreakdown, contextGaps, postAnalysis as analyse } from './advisor.js';

export function makeInsights({ q, pageMetrics }) {
  // 1.1 GET /api/priorities: the ranked tips, each with why + watch (see advisor.advise)
  const priorities = async (req, res) => {
    const m = await pageMetrics(req.uid);
    res.json({ updatedAt: new Date().toISOString(), priorities: advise(m) });
  };

  // 1.2 GET /api/ai/context: what the AI is looking at, how fresh it is, and what is missing
  const aiContext = async (req, res) => {
    const uid = req.uid;
    const m = await pageMetrics(uid);
    const [p] = await q(`SELECT count(*)::int n, min(posted_at) first_at, max(posted_at) last_at,
      count(*) FILTER (WHERE caption LIKE 'Demo caption %')::int demo FROM posts WHERE user_id=$1`, [uid]);
    const [imp] = await q('SELECT count(*)::int n, max(at) last_at FROM import_log WHERE user_id=$1', [uid]);
    const [comp] = await q('SELECT count(*)::int n, count(last_scraped)::int scraped, max(last_scraped) last_at FROM competitors WHERE user_id=$1', [uid]);
    const [cp] = await q('SELECT count(*)::int n FROM competitor_posts cp JOIN competitors c ON c.id=cp.competitor_id WHERE c.user_id=$1', [uid]);
    const [snap] = await q(`SELECT count(*)::int n, max(s.captured_at) last_at, count(DISTINCT (s.captured_at AT TIME ZONE 'UTC')::date)::int days
      FROM post_snapshots s JOIN posts po ON po.id=s.post_id WHERE po.user_id=$1`, [uid]);
    const [au] = await q('SELECT source FROM scrape_audit WHERE user_id=$1 ORDER BY at DESC LIMIT 1', [uid]);

    const spanDays = p.first_at ? Math.max(1, Math.round((new Date(p.last_at) - new Date(p.first_at)) / 864e5) + 1) : 0;
    const sources = [
      { name: 'Posts', rows: p.n, lastUpdated: p.last_at },
      { name: 'Imports', rows: imp.n, lastUpdated: imp.last_at },
      { name: 'Competitors', rows: comp.n, lastUpdated: comp.last_at },
      { name: 'Competitor posts', rows: cp.n, lastUpdated: comp.last_at },
      { name: 'Daily snapshots', rows: snap.n, lastUpdated: snap.last_at },
    ];
    const gaps = contextGaps(m, {
      posts: p.n, spanDays, competitors: comp.n, scrapedCompetitors: comp.scraped,
      demoPosts: p.demo, imports: imp.n, snapshotDays: snap.days, competitorSource: au?.source || null,
    });
    res.json({ metrics: m, health: health(m), sources, coverage: { posts: p.n, competitors: comp.n, days: spanDays }, gaps });
  };

  // 1.4 GET /api/marketing/breakdown
  const marketing = async (req, res) => res.json(marketingBreakdown(await pageMetrics(req.uid)));

  // 2.2 GET /api/posts/:id/analysis -> { text, delta, rank, snapshots }. Ownership is enforced in the first query (404 for someone else's post).
  const postAnalysis = async (req, res) => {
    if (!/^\d{1,9}$/.test(String(req.params.id))) return res.status(400).json({ error: 'bad post id' });
    const [post] = await q(`SELECT *, round((coalesce(likes,0)+coalesce(comments,0)+coalesce(saves,0)+coalesce(shares,0))*100.0/NULLIF(reach,0),2) er FROM posts WHERE id=$1 AND user_id=$2`, [req.params.id, req.uid]);
    if (!post) return res.sendStatus(404);
    const snaps = await q('SELECT captured_at,likes,comments,saves,shares,reach FROM post_snapshots WHERE post_id=$1 ORDER BY captured_at', [post.id]);
    const m = await pageMetrics(req.uid);
    let rank = null;
    if (post.er !== null) {
      const [r] = await q(`SELECT count(*)::int total, count(*) FILTER (WHERE er>$2::numeric)::int higher,
        count(*) FILTER (WHERE type=$3)::int type_total, count(*) FILTER (WHERE type=$3 AND er>$2::numeric)::int type_higher
        FROM (SELECT type, round((coalesce(likes,0)+coalesce(comments,0)+coalesce(saves,0)+coalesce(shares,0))*100.0/NULLIF(reach,0),2) er FROM posts WHERE user_id=$1 AND reach>0) x`, [req.uid, post.er, post.type]);
      rank = { position: r.higher + 1, of: r.total, type: post.type, typePosition: r.type_higher + 1, typeOf: r.type_total, by: 'engagement rate' };
    }
    const { text, delta } = analyse(post, snaps, m);
    res.json({ text, delta, rank, snapshots: { count: snaps.length, lastAt: snaps.length ? snaps[snaps.length - 1].captured_at : null } });
  };

  return { priorities, aiContext, marketing, postAnalysis };
}
