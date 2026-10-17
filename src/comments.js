// Roadmap A.2: pull the user's own post comments from the Instagram Graph API, keep them 90 days, raise the "unanswered questions" notification,
// and serve GET /api/posts/:id/comments. Pure rules live in commentintel.js; this file is I/O with injected deps (same pattern as igsync.js).
// Needs the instagram_manage_comments permission (already in IG_SCOPES). Nothing here WRITES to Instagram: reply drafts are not built (see AI_DECISIONS).
import { IgError } from './instagram.js';
import { IgNotConnected, markReconnect } from './igconnect.js';
import { USAGE_STOP } from './igsync.js';
import { mapComment, withinRetention, commentInsights, looksLikeQuestion, questionAlert, RETENTION_DAYS } from './commentintel.js';

export const COMMENT_FIELDS = 'id,text,username,timestamp,like_count,replies{id,username,timestamp}';
export const POSTS_PER_RUN = 30, PAGE_SIZE = 50, MAX_PAGES = 4, RECENT_DAYS = 7, REFRESH_H = 20, LIST_MAX = 50;

export const POSTS_SQL = `SELECT p.id, p.ig_media_id, p.posted_at, (SELECT max(c.fetched_at) FROM post_comments c WHERE c.post_id=p.id) AS last_fetch
  FROM posts p WHERE p.user_id=$1 AND p.ig_media_id IS NOT NULL ORDER BY p.posted_at DESC LIMIT ${POSTS_PER_RUN}`;
// One row per (user, comment). A re-pull updates likes and text and never un-sets owner_replied (a deleted reply does not make a question unanswered again).
export const UPSERT_SQL = `INSERT INTO post_comments(user_id,post_id,ig_comment_id,username,text,likes,posted_at,owner_replied,fetched_at)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,now())
  ON CONFLICT(user_id,ig_comment_id) DO UPDATE SET likes=coalesce(EXCLUDED.likes,post_comments.likes),text=EXCLUDED.text,
    owner_replied=post_comments.owner_replied OR EXCLUDED.owner_replied,fetched_at=now()`;
export const RETENTION_SQL = `DELETE FROM post_comments WHERE posted_at < now() - interval '${RETENTION_DAYS} days'`;
export const ALERT_ROWS_SQL = `SELECT p.id, p.user_id, p.caption, p.posted_at, c.text, c.username, c.owner_replied
  FROM posts p JOIN post_comments c ON c.post_id=p.id WHERE p.posted_at > now() - interval '24 hours' AND NOT c.owner_replied`;
export const NOTIFY_SQL = `INSERT INTO notifications(user_id,kind,title,body,watch,dedupe_key) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (user_id,dedupe_key) DO NOTHING RETURNING id`;

// A post is due when it is recent (comments arrive fast) or when its comments have not been fetched for REFRESH_H hours.
// A post that has never had a stored comment counts as never fetched, so it is asked about each run: the price of not adding a column to track "fetched, found none".
export function postsDue(posts, now = Date.now()) {
  return posts.filter(p => now - Date.parse(p.posted_at) <= RECENT_DAYS * 864e5 || !p.last_fetch || now - Date.parse(p.last_fetch) > REFRESH_H * 36e5);
}

// deps: q, graph, getIgCreds, now
export function makeComments({ q, graph, getIgCreds, now = () => Date.now() }) {
  async function ownerOf(uid) { const [a] = await q('SELECT username FROM ig_accounts WHERE user_id=$1', [uid]); return a?.username || null; }

  // One user. Per-post problems are skipped and counted; token, permission and rate-limit problems stop the run (the first one is recorded for the person).
  async function pullUser(uid) {
    const creds = await getIgCreds(uid);
    if (!creds) throw new IgNotConnected('not_connected');
    const owner = await ownerOf(uid);
    const posts = postsDue(await q(POSTS_SQL, [uid]), now());
    const res = { posts: posts.length, comments: 0, skippedPosts: 0, stoppedEarly: null };
    scan: for (const p of posts) {
      let after;
      for (let page = 0; page < MAX_PAGES; page++) {
        let r;
        try { r = await graph.get(`${p.ig_media_id}/comments`, { fields: COMMENT_FIELDS, limit: PAGE_SIZE, after }, creds.token); }
        catch (e) {
          if (!(e instanceof IgError)) throw e;
          if (e.tokenInvalid) { if (creds.source === 'oauth') await markReconnect(q, uid, e.message); throw e; }
          if (e.permission) { res.stoppedEarly = 'Instagram did not allow reading comments (the comments permission is missing or was revoked). Connect Instagram again and accept every permission.'; break scan; }
          if (e.rateLimited) { res.stoppedEarly = 'Instagram asked us to slow down; comments will be pulled at the next run.'; break scan; }
          res.skippedPosts++; continue scan; // e.g. comments are turned off for this post
        }
        for (const c of r.data || []) {
          const row = mapComment(c, owner);
          if (!row || !withinRetention(row.posted_at, now())) continue;
          await q(UPSERT_SQL, [uid, p.id, row.ig_comment_id, row.username, row.text, row.likes, row.posted_at, row.owner_replied]);
          res.comments++;
        }
        if (r._usage >= USAGE_STOP) { res.stoppedEarly = `Instagram usage at ${r._usage}%, continuing at the next run`; break scan; }
        after = r.paging?.cursors?.after;
        if (!r.paging?.next || !after) break;
      }
    }
    return res;
  }

  // 90-day retention (D6) by the comment's own date.
  const retention = async () => (await q(RETENTION_SQL + ' RETURNING id')).length;

  // Notification kind 'questions': one per post (dedupe key questions:<post id>), however often this runs.
  async function runAlerts() {
    const rows = await q(ALERT_ROWS_SQL);
    const byPost = new Map();
    for (const r of rows) { const e = byPost.get(r.id) || { post: { id: r.id, user_id: r.user_id, caption: r.caption, posted_at: r.posted_at }, comments: [] }; e.comments.push({ text: r.text, owner_replied: r.owner_replied }); byPost.set(r.id, e); }
    let created = 0;
    for (const { post, comments } of byPost.values()) {
      const a = questionAlert(post, comments, now());
      if (a) created += (await q(NOTIFY_SQL, [post.user_id, a.kind, a.title, a.body, null, a.key])).length;
    }
    return created;
  }

  // Scheduler tick: every connected account, then retention, then alerts. A failing account never stops the others.
  async function runAll() {
    const accts = await q(`SELECT user_id FROM ig_accounts WHERE status='connected'`);
    const out = { users: accts.length, ok: 0, failed: 0, comments: 0, deleted: 0, alerts: 0 };
    for (const a of accts) {
      try { out.comments += (await pullUser(a.user_id)).comments; out.ok++; } catch (e) { out.failed++; console.error('comments', a.user_id, e.message); }
    }
    out.deleted = await retention();
    out.alerts = await runAlerts();
    return out;
  }

  // GET /api/posts/:id/comments  -> { postId, connected, lastFetchedAt, retentionDays, insights, comments: [newest 50] }. Scoped to req.uid; another user's post is a 404.
  const list = async (req, res) => {
    if (!/^\d{1,9}$/.test(String(req.params.id))) return res.status(400).json({ error: 'bad post id' });
    const [post] = await q('SELECT id, ig_media_id FROM posts WHERE id=$1 AND user_id=$2', [req.params.id, req.uid]);
    if (!post) return res.sendStatus(404);
    const rows = await q('SELECT username,text,likes,posted_at,owner_replied,fetched_at FROM post_comments WHERE post_id=$1 AND user_id=$2 ORDER BY posted_at DESC, id DESC', [post.id, req.uid]);
    const [acct] = await q('SELECT status FROM ig_accounts WHERE user_id=$1', [req.uid]);
    const connected = acct?.status === 'connected';
    const last = rows.reduce((m, r) => (!m || r.fetched_at > m ? r.fetched_at : m), null);
    const reason = rows.length ? null : !post.ig_media_id ? 'not_from_instagram' : !acct ? 'not_connected' : !connected ? 'reconnect_needed' : 'none_stored';
    res.json({
      postId: post.id, connected, lastFetchedAt: last, retentionDays: RETENTION_DAYS, reason,
      insights: commentInsights(rows),
      comments: rows.slice(0, LIST_MAX).map(r => ({ username: r.username, text: r.text, likes: r.likes, posted_at: r.posted_at, owner_replied: r.owner_replied, question: looksLikeQuestion(r.text) })),
    });
  };

  return { pullUser, runAll, runAlerts, retention, list };
}

// Worker: every 3 hours (first run 90 s after boot, after the 45 s sync tick). Recent posts are asked every time; older ones about once a day (postsDue).
export function startComments(comments, everyMs = 108e5) {
  const run = () => comments.runAll().then(r => { if (r.comments || r.deleted || r.alerts || r.failed) console.log('comments', r); }).catch(e => console.error('comments', e.message));
  setTimeout(run, 90000);
  return setInterval(run, everyMs);
}
