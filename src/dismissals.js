// Roadmap A.1d: Today's Priorities "Dismiss" survives a reload. The key is the tip kind; the tip comes back after `until`.
export const DEFAULT_DAYS = 14, MAX_DAYS = 365;
export const validKey = k => /^[a-z0-9_-]{1,40}$/i.test(String(k));

export function makeDismissals({ q }) {
  // POST /api/priorities/:key/dismiss  body { days? }
  const dismiss = async (req, res) => {
    if (!validKey(req.params.key)) return res.status(400).json({ error: 'bad tip key' });
    const raw = req.body?.days, days = raw === undefined ? DEFAULT_DAYS : Number(raw);
    if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) return res.status(400).json({ error: `days must be a whole number from 1 to ${MAX_DAYS}` });
    const [r] = await q(`INSERT INTO priority_dismissals(user_id,tip_key,until) VALUES($1,$2,now()+make_interval(days=>$3)) ON CONFLICT(user_id,tip_key) DO UPDATE SET until=EXCLUDED.until RETURNING tip_key,until`, [req.uid, req.params.key, days]);
    res.json({ key: r.tip_key, until: r.until, days });
  };
  // DELETE /api/priorities/:key  (Undo)
  const undo = async (req, res) => {
    if (!validKey(req.params.key)) return res.status(400).json({ error: 'bad tip key' });
    await q('DELETE FROM priority_dismissals WHERE user_id=$1 AND tip_key=$2', [req.uid, req.params.key]);
    res.json({ ok: true });
  };
  const active = uid => q('SELECT tip_key AS key, until FROM priority_dismissals WHERE user_id=$1 AND until>now() ORDER BY until', [uid]);
  return { dismiss, undo, active };
}
