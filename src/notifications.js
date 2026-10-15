// Roadmap 2.3: notifications. The hourly job compares each user's current numbers with their stored baseline (metrics_baseline)
// and writes dismissible notifications. Detection is pure (advisor.detectAlerts); this file only does the I/O.
// `q` is injected (db.js's q in production, a fake in tests).
import { detectAlerts } from './advisor.js';

const W30 = "posted_at>now()-interval '30 days'";
const USERS_SQL = `SELECT b.user_id, b.reach30d AS b_reach, b.er AS b_er, b.best_post_er AS b_best, b.ahead AS b_ahead,
    coalesce(sum(p.reach) FILTER (WHERE p.${W30}),0)::int AS reach30d,
    round((sum(coalesce(p.likes,0)+coalesce(p.comments,0)+coalesce(p.saves,0)+coalesce(p.shares,0)) FILTER (WHERE p.${W30}))*100.0 / NULLIF(sum(p.reach) FILTER (WHERE p.${W30}),0),2) AS er,
    round(max((coalesce(p.likes,0)+coalesce(p.comments,0)+coalesce(p.saves,0)+coalesce(p.shares,0))*100.0/NULLIF(p.reach,0)),2) AS best_post_er,
    avg(p.likes+p.comments) FILTER (WHERE p.${W30}) AS user_avg_lc
  FROM metrics_baseline b LEFT JOIN posts p ON p.user_id=b.user_id
  GROUP BY b.user_id`;
const COMPETITORS_SQL = `SELECT c.user_id, c.handle, avg(cp.likes+cp.comments)::float AS avg_lc, count(*)::int AS n
  FROM competitors c JOIN competitor_posts cp ON cp.competitor_id=c.id WHERE cp.${W30} GROUP BY c.user_id, c.handle`;
// Demo competitor data is synthetic, so it must never tell a user that a rival overtook them.
const SOURCES_SQL = 'SELECT DISTINCT ON (user_id) user_id, source FROM scrape_audit ORDER BY user_id, at DESC';
const INSERT_SQL = `INSERT INTO notifications(user_id,kind,title,body,watch,dedupe_key) VALUES($1,$2,$3,$4,$5,$6)
  ON CONFLICT (user_id,dedupe_key) DO NOTHING RETURNING id`;
const STATE_SQL = 'UPDATE metrics_baseline SET best_post_er=$2, ahead=$3 WHERE user_id=$1';

export async function runNotifications(q, now = Date.now()) {
  const [users, comps, srcs] = await Promise.all([q(USERS_SQL), q(COMPETITORS_SQL), q(SOURCES_SQL)]);
  const demo = new Set(srcs.filter(s => s.source === 'demo').map(s => s.user_id));
  let created = 0;
  for (const u of users) {
    const mine = comps.filter(c => c.user_id === u.user_id).map(c => ({ handle: c.handle, avgLc: Number(c.avg_lc), n: c.n }));
    const base = { reach30d: u.b_reach, er: u.b_er, best_post_er: u.b_best, ahead: u.b_ahead };
    const cur = { reach30d: u.reach30d, er: u.er, best_post_er: u.best_post_er,
      userAvgLc: u.user_avg_lc === null ? null : Number(u.user_avg_lc),
      competitors: demo.has(u.user_id) || !mine.length ? null : mine };
    const { alerts, state } = detectAlerts(base, cur, now);
    for (const a of alerts) created += (await q(INSERT_SQL, [u.user_id, a.kind, a.title, a.body, a.watch, a.key])).length;
    const best = state.best_post_er === null ? null : Number(state.best_post_er);
    const sameAhead = JSON.stringify(state.ahead ?? null) === JSON.stringify(u.b_ahead ?? null);
    if (best !== (u.b_best === null ? null : Number(u.b_best)) || !sameAhead) await q(STATE_SQL, [u.user_id, best, state.ahead]);
  }
  return { users: users.length, created };
}

export function startNotifications(q, everyMs = 36e5) {
  const run = () => runNotifications(q).then(r => { if (r.created) console.log('notifications', r); }).catch(e => console.error('notifications', e.message));
  setTimeout(run, 15000); // after the 5s snapshot run, so a brand-new baseline already exists
  return setInterval(run, everyMs);
}

// GET /api/notifications, PATCH /api/notifications/:id, PATCH /api/notifications/read-all, DELETE /api/notifications/:id. Always scoped to req.uid.
export function makeNotifications({ q }) {
  const idOf = p => (/^\d{1,9}$/.test(String(p)) ? Number(p) : null);
  const list = async (req, res) => {
    const items = await q('SELECT id,kind,title,body,watch,created_at,read_at FROM notifications WHERE user_id=$1 ORDER BY created_at DESC, id DESC LIMIT 20', [req.uid]);
    const [c] = await q('SELECT count(*)::int AS unread FROM notifications WHERE user_id=$1 AND read_at IS NULL', [req.uid]);
    res.json({ unread: c.unread, items });
  };
  const mark = async (req, res) => {
    const id = idOf(req.params.id);
    if (id === null) return res.status(400).json({ error: 'bad notification id' });
    const read = req.body?.read !== false; // PATCH {read:false} marks it unread again
    const r = await q(`UPDATE notifications SET read_at = CASE WHEN $3 THEN coalesce(read_at, now()) ELSE NULL END WHERE id=$1 AND user_id=$2 RETURNING id`, [id, req.uid, read]);
    if (!r.length) return res.sendStatus(404);
    res.json({ ok: true, read });
  };
  const markAll = async (req, res) => {
    const r = await q('UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL RETURNING id', [req.uid]);
    res.json({ ok: true, updated: r.length });
  };
  const remove = async (req, res) => {
    const id = idOf(req.params.id);
    if (id === null) return res.status(400).json({ error: 'bad notification id' });
    const r = await q('DELETE FROM notifications WHERE id=$1 AND user_id=$2 RETURNING id', [id, req.uid]);
    if (!r.length) return res.sendStatus(404);
    res.json({ ok: true });
  };
  return { list, mark, markAll, remove };
}
