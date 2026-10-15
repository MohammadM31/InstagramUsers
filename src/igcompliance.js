// Roadmap A.1d: what Meta requires of an app that reads Instagram data: a deauthorize callback, a data-deletion callback with a status page,
// and a public privacy policy. Dependencies are injected (q, keys, env, now) so the handlers are unit-tested without Postgres.
import crypto from 'node:crypto';

const b64u = s => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
export const sha256 = v => crypto.createHash('sha256').update(String(v)).digest('hex');

// Meta sends `signed_request` = base64url(HMAC-SHA256 signature) + '.' + base64url(JSON payload). Returns the payload or null.
export function parseSignedRequest(signed, appSecret) {
  if (!appSecret || typeof signed !== 'string') return null;
  const [sig, payload, ...rest] = signed.split('.');
  if (!sig || !payload || rest.length) return null;
  const want = crypto.createHmac('sha256', appSecret).update(payload).digest(), got = b64u(sig);
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  try {
    const j = JSON.parse(b64u(payload).toString('utf8'));
    return j && String(j.algorithm || '').toUpperCase() === 'HMAC-SHA256' && j.user_id ? j : null;
  } catch { return null; }
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font:16px/1.55 system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 16px;color:#262626}h1{font-size:24px}h2{font-size:18px;margin-top:28px}code{background:#f2f2f2;padding:2px 5px;border-radius:4px}</style></head><body>${body}</body></html>`;

// The policy is a DRAFT written from what the code stores today. PRIVACY_OPERATOR and PRIVACY_CONTACT_EMAIL must be set before it is submitted to Meta.
export function privacyHtml(env = process.env) {
  const who = env.PRIVACY_OPERATOR, mail = env.PRIVACY_CONTACT_EMAIL;
  return page('Privacy policy', `<h1>Privacy policy</h1>
${who && mail ? `<p>Operator: <b>${esc(who)}</b>. Contact: <a href="mailto:${esc(mail)}">${esc(mail)}</a>.</p>` : '<p><b>DRAFT: the operator name and contact address have not been configured on this server.</b></p>'}
<h2>What we collect when you connect Instagram</h2>
<p>With your permission we read, through the official Instagram Graph API: your account name and follower count, your posts with their public numbers (likes, comments) and insights (reach, views, saves, shares, watch time), a daily follower count, daily account insights, and, for accounts with 100+ followers, audience age, country and online-time data. We store an access token for your account, encrypted. We never read direct messages, never post without your approval, and never collect passwords.</p>
<h2>How we use it</h2><p>Only to show you analytics and advice about your own account inside this app. We do not sell data and do not show it to other users.</p>
<h2>Retention</h2><p>Data stays until you disconnect Instagram and choose to delete it, delete your account, or send a deletion request from Facebook settings. Public competitor data is deleted after 30 days.</p>
<h2>Your controls</h2><p>Settings &gt; Instagram: disconnect (keeping or deleting the data), and export all your data. You can also remove this app in your Facebook or Instagram settings; that triggers our deauthorize callback and disconnects the account. A deletion request made there removes your Instagram data and gives you a confirmation code to check the result.</p>
<h2>Third parties</h2><p>Meta (Instagram) supplies the data. If you add an AI key in Settings, text you send to the assistant is sent to that provider under your key.</p>`);
}

export function makeCompliance({ q, keys, env = process.env, now = () => Date.now() }) {
  const secret = () => env.META_APP_SECRET;
  const base = () => env.APP_URL || (env.META_REDIRECT_URI ? new URL(env.META_REDIRECT_URI).origin : '');

  // POST /api/instagram/deauthorize (public, form-encoded signed_request). The user removed the app in Facebook: disconnect, keep the data.
  const deauthorize = async (req, res) => {
    const p = parseSignedRequest(req.body?.signed_request, secret());
    if (!p) return res.status(400).json({ error: 'invalid signed_request' });
    const rows = await q(`UPDATE ig_accounts SET status='disconnected',last_error=NULL,token_expires_at=NULL WHERE fb_user_id=$1 RETURNING user_id`, [String(p.user_id)]);
    for (const r of rows) await keys.del(r.user_id, 'instagram');
    res.json({ ok: true });
  };

  // POST /api/instagram/data-deletion (public). Deletes the Instagram data of the matching account and answers with the URL + code Meta expects.
  // Only a hash of the Facebook id is kept. An unknown id still gets a code (it simply reports that nothing was stored).
  const dataDeletion = async (req, res) => {
    const p = parseSignedRequest(req.body?.signed_request, secret());
    if (!p) return res.status(400).json({ error: 'invalid signed_request' });
    const fb = String(p.user_id), code = crypto.randomBytes(12).toString('hex');
    const accts = await q('SELECT user_id FROM ig_accounts WHERE fb_user_id=$1', [fb]);
    let detail = 'No Instagram data was stored for this Facebook account.';
    for (const a of accts) {
      await keys.del(a.user_id, 'instagram');
      const posts = (await q('DELETE FROM posts WHERE user_id=$1 AND ig_media_id IS NOT NULL RETURNING id', [a.user_id])).length;
      const fh = (await q('DELETE FROM follower_history WHERE user_id=$1 RETURNING id', [a.user_id])).length;
      const ad = (await q('DELETE FROM ig_account_daily WHERE user_id=$1 RETURNING day', [a.user_id])).length;
      const au = (await q('DELETE FROM ig_audience WHERE user_id=$1 RETURNING id', [a.user_id])).length;
      await q('DELETE FROM ig_accounts WHERE user_id=$1', [a.user_id]);
      detail = `Deleted the connection, the access token, ${posts} Instagram post(s), ${fh} follower-history row(s), ${ad} daily account row(s) and ${au} audience snapshot(s).`;
    }
    await q(`INSERT INTO ig_deletion_requests(code,fb_hash,status,detail,requested_at) VALUES($1,$2,'completed',$3,to_timestamp($4/1000.0))`, [code, sha256(fb), detail, now()]);
    res.json({ url: `${base()}/api/instagram/deletion-status?code=${code}`, confirmation_code: code });
  };

  // GET /api/instagram/deletion-status?code=... (public, HTML). Shows the result for one confirmation code.
  const deletionStatus = async (req, res) => {
    const code = String(req.query.code || '');
    const [r] = /^[a-f0-9]{24}$/.test(code) ? await q('SELECT status,detail,requested_at FROM ig_deletion_requests WHERE code=$1', [code]) : [];
    res.status(r ? 200 : 404).type('html').send(page('Data deletion status', r
      ? `<h1>Data deletion: ${esc(r.status)}</h1><p>${esc(r.detail)}</p><p>Requested ${esc(new Date(r.requested_at).toISOString())}. Confirmation code <code>${esc(code)}</code>.</p>`
      : '<h1>Request not found</h1><p>Check the confirmation code you were given.</p>'));
  };

  const privacy = (_req, res) => res.type('html').send(privacyHtml(env));
  return { deauthorize, dataDeletion, deletionStatus, privacy };
}
