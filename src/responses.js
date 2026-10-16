// Roadmap 4.2: editable assistant responses. The person edits a reply, the original and the edit are both kept, and the UI marks edited text.
// One row per (user, original text): saving the same original again updates the edit. Dependencies are injected (same pattern as insights.js).
export const KINDS = ['assistant', 'proposal_caption']; // proposal_caption is for C.3 (proposal captions are editable the same way)
export const MAX_TEXT = 4000, MAX_ROWS = 500, DEFAULT_LIST = 50, MAX_LIST = 200;

export function validateSave(b) {
  const kind = b?.kind ?? 'assistant';
  if (!KINDS.includes(kind)) return { error: `kind must be one of ${KINDS.join(', ')}` };
  for (const f of ['original', 'edited']) if (typeof b?.[f] !== 'string') return { error: `${f} must be text` };
  const original = b.original.trim(), edited = b.edited.trim();
  if (!original) return { error: 'original is empty' };
  if (!edited) return { error: 'the edited text cannot be empty' };
  if (original.length > MAX_TEXT || edited.length > MAX_TEXT) return { error: `text can be at most ${MAX_TEXT} characters` };
  if (original === edited) return { error: 'nothing changed' };
  return { value: { kind, original, edited } };
}

const COLS = 'id,kind,original,edited,created_at,updated_at';

export function makeResponses({ q }) {
  // POST /api/responses/save  { kind?, original, edited }
  const save = async (req, res) => {
    const v = validateSave(req.body);
    if (v.error) return res.status(400).json(v);
    const { kind, original, edited } = v.value;
    const [c] = await q('SELECT count(*)::int n, coalesce(bool_or(md5(original)=md5($2)),false) has FROM saved_responses WHERE user_id=$1', [req.uid, original]);
    if (!c.has && c.n >= MAX_ROWS) return res.status(409).json({ error: `You have ${MAX_ROWS} saved responses. Delete some to save more.` });
    const [row] = await q(`INSERT INTO saved_responses(user_id,kind,original,edited) VALUES($1,$2,$3,$4)
      ON CONFLICT(user_id,md5(original)) DO UPDATE SET edited=EXCLUDED.edited,kind=EXCLUDED.kind,updated_at=now() RETURNING ${COLS}`, [req.uid, kind, original, edited]);
    res.json({ response: row });
  };
  // GET /api/responses?limit=  newest edit first
  const list = async (req, res) => {
    const raw = req.query?.limit, n = raw === undefined ? DEFAULT_LIST : Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > MAX_LIST) return res.status(400).json({ error: `limit must be a whole number from 1 to ${MAX_LIST}` });
    const rows = await q(`SELECT ${COLS} FROM saved_responses WHERE user_id=$1 ORDER BY updated_at DESC,id DESC LIMIT $2`, [req.uid, n]);
    res.json({ responses: rows });
  };
  // DELETE /api/responses/:id  (own rows only)
  const remove = async (req, res) => {
    if (!/^\d{1,9}$/.test(String(req.params.id))) return res.status(400).json({ error: 'bad id' });
    const r = await q('DELETE FROM saved_responses WHERE id=$1 AND user_id=$2 RETURNING id', [req.params.id, req.uid]);
    if (!r.length) return res.sendStatus(404);
    res.json({ ok: true });
  };
  return { save, list, remove };
}
