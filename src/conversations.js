// Command Center chat history (contract sections 3.1, 4.1, 4.4, 4.6; stream 2).
// `q` is injected (db.js's q in production, an in-memory fake in tests): q(sql, params) -> rows.
// Isolation: EVERY query filters by user_id, so another user's conversation id behaves exactly like an unknown id
// (404 on the endpoints, "start a new chat" in withConversation). Nothing here ever reveals that a foreign id exists.
import { randomUUID } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = v => typeof v === 'string' && UUID.test(v);
const CURSOR = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/; // ?before= is an ISO timestamp, nothing else reaches SQL

const DEFAULT_TITLE = 'New chat';
const TITLE_MAX = 120, AUTO_TITLE_MAX = 60;
const HISTORY_N = 12, HISTORY_TEXT = 300, READ_MAX = 300;
const PENDING_MS = 10 * 60 * 1000; // a job that never produced a library row after this long is reported as failed

const clean = s => String(s ?? '').replace(/\u0000/g, ''); // Postgres text and jsonb reject NUL
const cut = (s, n) => { let t = clean(s).slice(0, n); if (/[\ud800-\udbff]$/.test(t)) t = t.slice(0, -1); return t; }; // never leave half a surrogate pair
const iso = v => { const d = v instanceof Date ? v : new Date(v); return Number.isNaN(+d) ? String(v) : d.toISOString(); };

/* ---------- title rules ---------- */
// Auto title: the first user message, whitespace collapsed, at most 60 chars, cut at a word boundary (never mid-word, never empty).
// One single word longer than 60 chars has no boundary to cut at, so it falls back to "New chat" rather than being chopped.
export function titleFrom(text) {
  const t = clean(text).replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim();
  if (!t) return DEFAULT_TITLE;
  if (t.length <= AUTO_TITLE_MAX) return t;
  let c = t.slice(0, AUTO_TITLE_MAX);
  if (!/\s/.test(t[AUTO_TITLE_MAX])) { const i = c.lastIndexOf(' '); c = i > 0 ? c.slice(0, i) : ''; } // the cut fell inside a word: back up to the previous space
  c = c.replace(/[\s,;:\u2013\u2014-]+$/, '');
  return c || DEFAULT_TITLE;
}
// A title the user typed (POST/PATCH): trimmed, control characters removed, 1-120 chars, else null (-> 400).
export function cleanTitle(v) {
  if (typeof v !== 'string') return null;
  const t = v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  return t.length >= 1 && t.length <= TITLE_MAX ? t : null;
}

/* ---------- never store image bytes ---------- */
// Message `data` is what the UI renders; images live in generated_images and a message only keeps their ids. So before saving, every
// string that is a data: URL / contains base64, or is longer than MAX_STR, is dropped from `data` (key removed), and a body still above
// MAX_DATA after that is reduced to the small whitelisted keys. This protects the table even if another stream leaks a dataUrl into a response.
const MAX_STR = 4000, MAX_DATA = 32768;
const B64 = /data:[\w.+\/-]*;base64,/i;
const KEEP = ['imageIds', 'ratio', 'kind', 'jobId', 'parentImageId', 'instruction', 'summary', 'status', 'error'];
function scrub(v, depth) {
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string') return v.length > MAX_STR || B64.test(v) || /^\s*data:/i.test(v) ? undefined : clean(v);
  if (depth >= 6) return undefined;
  if (Array.isArray(v)) return v.slice(0, 100).map(x => scrub(x, depth + 1)).filter(x => x !== undefined);
  if (typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).slice(0, 60)) { if (k === '__proto__') continue; const s = scrub(v[k], depth + 1); if (s !== undefined) o[clean(k)] = s; }
    return o;
  }
  return undefined;
}
export function cleanData(d) {
  const o = d && typeof d === 'object' && !Array.isArray(d) ? scrub(d, 0) : {};
  if (JSON.stringify(o).length <= MAX_DATA) return o;
  const keep = {}; for (const k of KEEP) if (o[k] !== undefined) keep[k] = o[k];
  return keep;
}
// What the wrapper saves with the USER message: only small references, never the legacy base64 `referenceImage`.
const userData = b => {
  const d = {};
  if (isUuid(b.referenceImageId)) d.referenceImageId = b.referenceImageId;
  if (typeof b.ratio === 'string' && b.ratio.length <= 10) d.ratio = clean(b.ratio);
  if (b.mode === 'image') d.mode = 'image';
  return d;
};

/* ---------- SQL ---------- */
const OWNS_SQL = 'SELECT id,title FROM conversations WHERE id=$1 AND user_id=$2';
const MSG_SQL = `SELECT id,role,type,text,data,created_at FROM (SELECT id,role,type,text,data,created_at FROM conversation_messages
  WHERE conversation_id=$1 AND user_id=$2 ORDER BY id DESC LIMIT $3) t ORDER BY id`; // newest N, returned oldest to newest
const LIST_SQL = `SELECT c.id,c.title,c.created_at,c.updated_at,
  to_char(c.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cur,
  (SELECT left(m.text,160) FROM conversation_messages m WHERE m.conversation_id=c.id AND m.user_id=$1 ORDER BY m.id DESC LIMIT 1) AS last_message,
  (SELECT count(*)::int FROM conversation_messages m WHERE m.conversation_id=c.id AND m.user_id=$1) AS message_count
  FROM conversations c WHERE c.user_id=$1 AND ($2::timestamptz IS NULL OR c.updated_at<$2::timestamptz)
  ORDER BY c.updated_at DESC, c.id DESC LIMIT $3`; // cur keeps microseconds so the next page cannot skip or repeat a row
const COVER_SQL = `SELECT conversation_id,id,job_id,image_id FROM (
  SELECT m.conversation_id,m.id,m.data->>'jobId' AS job_id,m.data->'imageIds'->>0 AS image_id,
  row_number() OVER (PARTITION BY m.conversation_id ORDER BY m.id DESC) AS rn
  FROM conversation_messages m WHERE m.user_id=$1 AND m.conversation_id=ANY($2::uuid[]) AND m.role='assistant'
  AND (m.data->>'jobId' IS NOT NULL OR m.data->'imageIds'->>0 IS NOT NULL)) t WHERE rn<=5 ORDER BY conversation_id,id DESC`;
// Read-only use of stream 3's table (section 3.2). The table may not exist yet: callers catch the error and degrade.
const JOB_SQL = 'SELECT job_id,id FROM generated_images WHERE user_id=$1 AND job_id=ANY($2::text[]) ORDER BY job_id,idx';

/* ---------- store ---------- */
const shape = r => ({ id: String(r.id), role: r.role, type: r.type, text: r.text, data: r.data && typeof r.data === 'object' ? r.data : {}, createdAt: iso(r.created_at) });
const hasIds = d => Array.isArray(d?.imageIds) && d.imageIds.length > 0;
const jobOf = m => (m.role === 'assistant' && m.data?.jobId != null && m.data.jobId !== '' ? String(m.data.jobId) : null);

export function makeConversations({ q, now = Date.now, log = console }) {
  // job_id -> [image ids in idx order] for this user; null when generated_images cannot be read (missing table or any query error).
  async function jobImages(uid, jobs) {
    const out = new Map();
    try {
      for (const r of await q(JOB_SQL, [uid, jobs])) {
        const k = String(r.job_id);
        if (!out.has(k)) out.set(k, []);
        out.get(k).push(String(r.id));
      }
      return out;
    } catch (e) { if (e?.code !== '42P01') log.warn?.('[conversations] generated_images lookup failed:', e?.message); return null; }
  }

  // Pending image messages (assistant, data.jobId, no data.imageIds) are resolved on READ, nothing is written back:
  //   library row(s) found for the job -> data.imageIds + status 'done'
  //   none and the message is older than 10 minutes -> status 'failed' + error;  otherwise status 'pending'.
  // When the lookup is impossible (table missing) the same age rule applies instead of throwing.
  async function resolvePending(uid, messages) {
    const jobs = [...new Set(messages.filter(m => !hasIds(m.data)).map(jobOf).filter(Boolean))];
    if (!jobs.length) return messages;
    const found = (await jobImages(uid, jobs)) || new Map();
    const t = now();
    return messages.map(m => {
      const job = jobOf(m);
      if (job === null || hasIds(m.data)) return m;
      const ids = found.get(job);
      if (ids?.length) return { ...m, data: { ...m.data, imageIds: ids, status: 'done' } };
      const old = t - Date.parse(m.createdAt) > PENDING_MS; // an unparsable date is never "old"
      return { ...m, data: old ? { ...m.data, imageIds: [], status: 'failed', error: 'Generation did not finish' } : { ...m.data, imageIds: [], status: 'pending' } };
    });
  }

  // coverImageId per conversation = first image of the most recent image message that has one (stored ids, else resolved through job_id).
  async function covers(uid, ids) {
    const out = new Map();
    if (!ids.length) return out;
    try {
      const rows = await q(COVER_SQL, [uid, ids]);
      const jobs = [...new Set(rows.filter(r => !r.image_id && r.job_id).map(r => String(r.job_id)))];
      const found = jobs.length ? (await jobImages(uid, jobs)) || new Map() : new Map();
      for (const r of rows) { // rows are newest message first within each conversation
        if (out.has(r.conversation_id)) continue;
        const img = r.image_id || found.get(String(r.job_id))?.[0];
        if (img) out.set(r.conversation_id, String(img));
      }
    } catch (e) { log.warn?.('[conversations] cover lookup failed:', e?.message); }
    return out;
  }

  const owns = async (uid, id) => isUuid(id) && (await q(OWNS_SQL, [id, uid])).length > 0;

  return {
    owns, resolvePending,

    async create(uid, title = DEFAULT_TITLE) {
      const [r] = await q('INSERT INTO conversations(user_id,title) VALUES($1,$2) RETURNING id,title', [uid, title]);
      return { id: r.id, title: r.title };
    },

    async list(uid, { limit = 30, before = null } = {}) {
      const n = Math.min(Math.max(Math.floor(Number(limit)) || 30, 1), 100);
      const rows = await q(LIST_SQL, [uid, before, n + 1]); // one extra row tells us whether another page exists
      const page = rows.slice(0, n), cov = await covers(uid, page.map(r => r.id));
      const out = { conversations: page.map(r => ({
        id: r.id, title: r.title, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
        lastMessage: r.last_message ?? '', messageCount: Number(r.message_count) || 0, ...(cov.has(r.id) ? { coverImageId: cov.get(r.id) } : {}) })) };
      if (rows.length > n) out.next = page[n - 1].cur ?? iso(page[n - 1].updated_at); // `next` only when more exist
      return out;
    },

    async get(uid, id) {
      if (!isUuid(id)) return null;
      const [c] = await q(OWNS_SQL, [id, uid]);
      if (!c) return null;
      const messages = await resolvePending(uid, (await q(MSG_SQL, [id, uid, READ_MAX])).map(shape));
      return { id: c.id, title: c.title, messages };
    },

    async rename(uid, id, title) { // renaming does not bump updated_at: it must not reorder the list
      if (!isUuid(id)) return null;
      const [r] = await q('UPDATE conversations SET title=$3 WHERE id=$1 AND user_id=$2 RETURNING id,title', [id, uid, title]);
      return r ? { id: r.id, title: r.title } : null;
    },

    async remove(uid, id) {
      if (!isUuid(id)) return false;
      return (await q('DELETE FROM conversations WHERE id=$1 AND user_id=$2 RETURNING id', [id, uid])).length > 0; // messages cascade
    },

    // One statement, so the user and assistant messages are saved together or not at all. The conversation row is bumped (or, with
    // create:true, created with this id) in the same statement and only when it belongs to uid; otherwise nothing is inserted and we return null.
    // A conversation still titled 'New chat' with no messages takes its title from the first user message.
    async appendMessages(uid, id, msgs, { create = false, title } = {}) {
      if (!isUuid(id) || !msgs?.length) return null;
      const params = [id, uid, title ?? titleFrom(msgs.find(m => m.role === 'user')?.text)];
      const vals = msgs.map((m, i) => {
        const b = params.length + 1;
        params.push(m.role, cut(m.type || 'info', 32) || 'info', clean(m.text), JSON.stringify(cleanData(m.data)));
        return `(${i},$${b}::text,$${b + 1}::text,$${b + 2}::text,$${b + 3}::jsonb)`;
      });
      const head = create
        ? 'INSERT INTO conversations(id,user_id,title) VALUES($1::uuid,$2::uuid,$3::text) ON CONFLICT (id) DO UPDATE SET updated_at=now() WHERE conversations.user_id=$2::uuid RETURNING id'
        : `UPDATE conversations SET updated_at=now(), title=CASE WHEN title='${DEFAULT_TITLE}' AND NOT EXISTS (SELECT 1 FROM conversation_messages x WHERE x.conversation_id=conversations.id AND x.user_id=$2::uuid) THEN $3::text ELSE title END
           WHERE id=$1::uuid AND user_id=$2::uuid RETURNING id`;
      const rows = await q(`WITH c AS (${head}) INSERT INTO conversation_messages(conversation_id,user_id,role,type,text,data)
        SELECT c.id,$2::uuid,v.r,v.t,v.x,v.d FROM c CROSS JOIN (VALUES ${vals.join(',')}) AS v(o,r,t,x,d) ORDER BY v.o RETURNING id,role`, params);
      if (!rows.length) return null;
      const a = rows.filter(r => r.role === 'assistant').at(-1) ?? rows.at(-1), u = rows.find(r => r.role === 'user');
      return { messageId: String(a.id), ...(u ? { userMessageId: String(u.id) } : {}) };
    },

    // Last n messages (default 12), oldest to newest, in the shape stream 4 reads from req.convo.history:
    // text cut to 300 chars, data reduced to {imageIds, ratio, kind, jobId}; pending jobs are resolved so finished imageIds show up.
    async history(uid, id, n = HISTORY_N) {
      if (!isUuid(id)) return [];
      const msgs = await resolvePending(uid, (await q(MSG_SQL, [id, uid, n])).map(shape));
      return msgs.map(m => {
        const d = {};
        if (m.data.jobId != null) d.jobId = String(m.data.jobId);
        if (m.type === 'image' || m.data.jobId != null || Array.isArray(m.data.imageIds)) {
          d.imageIds = (Array.isArray(m.data.imageIds) ? m.data.imageIds : []).filter(x => typeof x === 'string'); 
        }
        if (typeof m.data.ratio === 'string') d.ratio = m.data.ratio;
        if (typeof m.data.kind === 'string') d.kind = m.data.kind;
        
        // Pass the prompt/instruction as the caption so the LLM understands the image
        if (typeof m.data.prompt === 'string') d.caption = m.data.prompt; 
        if (typeof m.data.instruction === 'string') d.caption = m.data.instruction; 
        
        return { id: m.id, role: m.role, type: m.type, text: cut(m.text, HISTORY_TEXT), data: d, createdAt: m.createdAt };
      });
    },
  };
}

/* ---------- withConversation (section 4.1 / 4.4) ---------- */
const withTimeout = (p, ms) => new Promise((ok, no) => {
  const t = setTimeout(() => no(new Error('persistence timed out')), ms); // short-lived and cleared as soon as the save settles
  p.then(v => { clearTimeout(t); ok(v); }, e => { clearTimeout(t); no(e); });
});

// Wraps an Express handler (POST /api/assistant). Before it runs: resolve or start the conversation and set req.convo = {id, history}.
// While it runs: res.json is intercepted. On a 2xx object body the user message and the assistant message are saved, updated_at is bumped
// and conversationId + messageId (string) are added to the body. Non-2xx stores nothing. Any persistence failure is logged and the
// original body is sent unchanged: history must never break the assistant (a slow database delays the reply by at most timeoutMs).
// A NEW conversation only gets its uuid here; its row is created together with the first messages, so a failed request leaves no empty chat behind.
export function withConversation(store, handler, { log = console, timeoutMs = 4000 } = {}) {
  return async (req, res, next) => {
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    let id = null, history = [], created = false;
    try {
      if (isUuid(b.conversationId) && await store.owns(req.uid, b.conversationId)) { id = b.conversationId; history = await store.history(req.uid, id, HISTORY_N); }
    } catch (e) { log.error('[conversations] open failed:', e?.message); id = null; history = []; }
    if (!id) { id = randomUUID(); created = true; history = []; } // absent, unknown or someone else's id: start a new chat, say nothing about why
    req.convo = { id, history };

    const orig = res.json.bind(res);
    res.json = body => {
      res.json = orig; // intercept once only
      const code = res.statusCode || 200;
      if (code < 200 || code >= 300 || !body || typeof body !== 'object' || Array.isArray(body) || (body.type == null && body.text == null)) return orig(body);
      const save = [
        { role: 'user', type: 'info', text: cut(b.message, 2000), data: userData(b) },
        { role: 'assistant', type: body.type ?? 'info', text: cut(body.text, 4000), data: body.data },
      ];
      withTimeout(store.appendMessages(req.uid, id, save, { create: created }), timeoutMs)
        .then(r => { if (!r) throw new Error('conversation not found'); return { ...body, conversationId: id, messageId: r.messageId }; })
        .catch(e => { log.error('[conversations] not saved:', e?.message); return body; })
        .then(out => { if (!res.headersSent) orig(out); });
      return res;
    };
    return handler(req, res, next);
  };
}

/* ---------- routes (section 4.4 / 4.6) ---------- */
function makeHandlers(store) {
  const bad = (res, error) => res.status(400).json({ error });
  return {
    list: async (req, res) => {
      const before = req.query.before;
      if (before !== undefined && !(typeof before === 'string' && CURSOR.test(before) && !Number.isNaN(Date.parse(before)))) return bad(res, 'bad before');
      res.json(await store.list(req.uid, { limit: req.query.limit, before: before ?? null }));
    },
    create: async (req, res) => {
      let title = DEFAULT_TITLE;
      if (req.body?.title !== undefined && req.body?.title !== null) { title = cleanTitle(req.body.title); if (!title) return bad(res, 'title must be 1-120 characters'); }
      res.status(201).json(await store.create(req.uid, title));
    },
    read: async (req, res) => { const c = await store.get(req.uid, req.params.id); if (!c) return res.sendStatus(404); res.json(c); },
    rename: async (req, res) => {
      const title = cleanTitle(req.body?.title);
      if (!title) return bad(res, 'title must be 1-120 characters');
      const r = await store.rename(req.uid, req.params.id, title); if (!r) return res.sendStatus(404); res.json(r);
    },
    remove: async (req, res) => { if (!await store.remove(req.uid, req.params.id)) return res.sendStatus(404); res.sendStatus(204); },
  };
}

// Called once from routes.js. Returns the store so the same instance can wrap the assistant: withConversation(store, assistant).
// No rate limiter on purpose: limit() fails closed (503) when Redis is down and history must keep working without Redis. `limit` is accepted for a uniform registrar signature.
export function registerConversationRoutes({ get, post, patch, del, q, limit }) { // eslint-disable-line no-unused-vars
  const store = makeConversations({ q }), h = makeHandlers(store);
  get('/conversations', h.list);
  post('/conversations', h.create);
  get('/conversations/:id', h.read);
  patch('/conversations/:id', h.rename);
  del('/conversations/:id', h.remove);
  return store;
}