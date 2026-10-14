// POST /api/schedule and PATCH /api/schedule/:id, with date validation (an invalid date used to reach Postgres and come back as a 500).
// `q` is injected (routes.js passes db.js's q; tests pass a fake).
export const parseWhen = v => { if (typeof v !== 'string' || !v.trim()) return null; const d = new Date(v); return isNaN(d) ? null : d.toISOString(); };
const BAD = { error: 'scheduledAt is not a valid date. Use ISO format, e.g. 2026-10-01T10:00:00Z' };

export function makeSchedule({ q }) {
  const create = async (req, res) => {
    const { caption, image, platforms, scheduledAt } = req.body || {};
    if (!caption || !scheduledAt) return res.status(400).json({ error: 'caption and scheduledAt required' });
    const when = parseWhen(scheduledAt);
    if (!when) return res.status(400).json(BAD);
    const [r] = await q('INSERT INTO scheduled_posts(user_id,caption,image,platforms,scheduled_at) VALUES($1,$2,$3,$4,$5) RETURNING id', [req.uid, caption, image || null, platforms || ['instagram'], when]);
    res.json(r);
  };
  // PATCH re-queues a post (status back to 'scheduled'). scheduledAt is optional: omitted means "now". If given it must be valid.
  const update = async (req, res) => {
    const s = req.body?.scheduledAt;
    let when = null;
    if (s !== undefined && s !== null && s !== '') { when = parseWhen(s); if (!when) return res.status(400).json(BAD); }
    await q(`UPDATE scheduled_posts SET status='scheduled',error=NULL,scheduled_at=COALESCE($3,now()) WHERE id=$1 AND user_id=$2`, [req.params.id, req.uid, when]);
    res.json({ ok: true });
  };
  return { create, update };
}
