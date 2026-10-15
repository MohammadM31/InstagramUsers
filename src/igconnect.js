// Roadmap A.1a: connect an Instagram professional account, keep its token healthy, hand per-user credentials to the rest of the app.
// Dependencies are injected (same pattern as insights.js), so the handlers are unit-tested with fakes.
import crypto from 'node:crypto';
import { buildLoginUrl, exchangeCode, exchangeLongLived, listPagesWithIg, grantedScopes, expiryFrom, IgError, IG_SCOPES } from './instagram.js';

export const STATE_TTL_SEC = 600;
export const REFRESH_WITHIN_DAYS = 15;

// Reasons shown to the user (the callback redirects to /?ig=error&reason=<code>). Plain words, one per failure the roadmap lists (O.2).
export const CONNECT_ERRORS = {
  not_configured: 'Instagram connection is not set up on this server (META_APP_ID, META_APP_SECRET and META_REDIRECT_URI are missing).',
  state_invalid: 'The connection attempt expired or was not started from this app. Please try again.',
  declined: 'You declined the permissions. Instagram data cannot be read without them.',
  no_page: 'No Facebook Page was found. Instagram professional accounts must be linked to a Facebook Page you manage.',
  wrong_type: 'None of your Pages has an Instagram professional (Business or Creator) account linked. Switch the account to professional in Instagram settings and link it to a Page.',
  missing_permissions: 'Some required permissions were not granted. Connect again and keep every box ticked.',
  token_error: 'Instagram did not accept the login. Please try again.',
};
export class ConnectError extends Error { constructor(code, extra) { super(CONNECT_ERRORS[code] || code); this.code = code; this.extra = extra; } }

// Thrown by getIgCreds when a user HAS connected but the connection is unusable. Callers must not fall back to another account's credentials.
export class IgNotConnected extends Error {
  constructor(reason) { super(reason === 'reconnect_needed' ? 'Instagram needs to be reconnected (Settings > Instagram).' : 'Instagram is not connected.'); this.reason = reason; }
}

// ---- pure helpers ----
// Pick the account to connect: the first Page with an Instagram professional account (decision D4: one account per user).
export function pickAccount(pages) {
  if (!pages?.length) throw new ConnectError('no_page');
  const hit = pages.find(p => p.instagram_business_account?.id);
  if (!hit) throw new ConnectError('wrong_type');
  const ig = hit.instagram_business_account;
  return { pageId: hit.id, igUserId: ig.id, username: ig.username || null, followers: Number.isFinite(ig.followers_count) ? ig.followers_count : null, others: pages.filter(p => p !== hit && p.instagram_business_account?.id).length };
}
export const missingScopes = granted => IG_SCOPES.filter(s => !granted.includes(s));
export const daysLeft = (expiresAt, now = Date.now()) => (expiresAt ? Math.floor((new Date(expiresAt) - now) / 864e5) : null);
export const needsRefresh = (expiresAt, now = Date.now()) => expiresAt != null && daysLeft(expiresAt, now) < REFRESH_WITHIN_DAYS;
export const appConfig = (env = process.env) => {
  const { META_APP_ID: appId, META_APP_SECRET: appSecret, META_REDIRECT_URI: redirectUri } = env;
  return appId && appSecret && redirectUri ? { appId, appSecret, redirectUri, appUrl: env.APP_URL || new URL(redirectUri).origin } : null;
};


// One place that flips an account to reconnect_needed and tells the user once per connection (dedupe key = connect time).
export async function markReconnect(q, uid, why) {
  const [a] = await q(`UPDATE ig_accounts SET status='reconnect_needed',last_error=$2 WHERE user_id=$1 AND status='connected' RETURNING extract(epoch from connected_at)::bigint AS conn`, [uid, why]);
  if (!a) return false;
  await q(`INSERT INTO notifications(user_id,kind,title,body,watch,dedupe_key) VALUES($1,'ig_reconnect','Reconnect Instagram',$2,$3,$4) ON CONFLICT (user_id,dedupe_key) DO NOTHING`,
    [uid, 'Your Instagram connection expired, so new numbers are no longer being pulled. Open Settings and connect again.', 'Last sync time on the Settings card', `ig-reconnect:${a.conn}`]);
  return true;
}

// OAuth `state` lives in Redis for ten minutes and can be used once. It is the only link between the browser redirect and the user.
export const makeRedisState = redis => ({
  put: (state, uid) => redis.set(`igstate:${state}`, uid, 'EX', STATE_TTL_SEC),
  take: async state => { const [[, uid]] = await redis.multi().get(`igstate:${state}`).del(`igstate:${state}`).exec(); return uid || null; },
});

// deps: q, graph (makeGraph), state ({put,take}), keys ({get(uid,name), set(uid,name,value), del(uid,name)}), env, now
export function makeIgConnect({ q, graph, state, keys, env = process.env, now = () => Date.now() }) {
  const cfg = () => appConfig(env);

  // GET /api/instagram/connect/start (authenticated). Returns the Facebook login URL; the browser cannot send our bearer token on a redirect.
  const start = async (req, res) => {
    const c = cfg();
    if (!c) return res.status(503).json({ error: CONNECT_ERRORS.not_configured });
    const s = crypto.randomBytes(24).toString('hex');
    await state.put(s, req.uid);
    res.json({ url: buildLoginUrl({ appId: c.appId, redirectUri: c.redirectUri, state: s }) });
  };

  // GET /api/instagram/connect/callback (PUBLIC: Facebook redirects the browser here). Always ends in a redirect to the app.
  const callback = async (req, res) => {
    const c = cfg(), back = r => res.redirect(`${c?.appUrl || ''}/?ig=${r ? 'error&reason=' + encodeURIComponent(r) : 'connected'}`);
    if (!c) return back('not_configured');
    const { code, state: s, error } = req.query;
    const uid = s ? await state.take(String(s)) : null; // consumed even when the user declined, so a state cannot be replayed
    if (!uid) return back('state_invalid');
    if (error) return back(error === 'access_denied' ? 'declined' : 'token_error');
    if (!code) return back('token_error');
    try {
      const short = await exchangeCode(graph, { ...c, code: String(code) });
      const long = await exchangeLongLived(graph, { ...c, token: short.access_token });
      const token = long.access_token || short.access_token;
      const acct = pickAccount(await listPagesWithIg(graph, token));
      const granted = await grantedScopes(graph, token).catch(() => []);
      const lacking = missingScopes(granted);
      if (granted.length && lacking.length) throw new ConnectError('missing_permissions', lacking);
      const fbUser = (await graph.get('me', { fields: 'id' }, token).catch(() => null))?.id ?? null; // identifies the person in Meta's deauthorize / deletion callbacks
      await keys.set(uid, 'instagram', token);
      await q(`INSERT INTO ig_accounts(user_id,ig_user_id,page_id,username,account_type,scopes,token_expires_at,status,followers_at_connect,last_error,connected_at,fb_user_id)
        VALUES($1,$2,$3,$4,'professional',$5,$6,'connected',$7,NULL,now(),$8)
        ON CONFLICT(user_id) DO UPDATE SET ig_user_id=$2,page_id=$3,username=$4,scopes=$5,token_expires_at=$6,status='connected',followers_at_connect=$7,last_error=NULL,connected_at=now(),fb_user_id=coalesce($8,ig_accounts.fb_user_id)`,
        [uid, acct.igUserId, acct.pageId, acct.username, granted, expiryFrom(long.expires_in, now()), acct.followers, fbUser]);
      back(null);
    } catch (e) {
      if (!(e instanceof ConnectError)) console.error('ig connect', e.message);
      back(e instanceof ConnectError ? e.code : 'token_error');
    }
  };

  // GET /api/instagram/status. Never returns the token.
  const status = async (req, res) => {
    const [a] = await q('SELECT * FROM ig_accounts WHERE user_id=$1', [req.uid]);
    const envOnly = !a && !!(env.IG_ACCESS_TOKEN && env.IG_USER_ID);
    const [f] = a ? await q(`SELECT count(*)::int points, max(captured_at) last_at, (array_agg(followers ORDER BY captured_at DESC))[1] AS followers, (array_agg(source ORDER BY captured_at DESC))[1] AS source FROM follower_history WHERE user_id=$1 AND followers IS NOT NULL`, [req.uid]) : [];
    res.json({
      followers: f?.followers ?? null, followerPoints: f?.points ?? 0, lastFollowerAt: f?.last_at ?? null, followerSource: f?.source ?? null, // A.1c (additive)
      configured: !!cfg(),
      connected: a?.status === 'connected',
      status: a?.status || (envOnly ? 'dev_env' : 'not_connected'),
      source: a ? 'oauth' : envOnly ? 'env' : 'none',
      username: a?.username || null,
      followersAtConnect: a?.followers_at_connect ?? null,
      lastSyncAt: a?.last_sync_at || null,
      lastError: a?.last_error || null,
      tokenExpiresAt: a?.token_expires_at || null,
      daysLeft: a ? daysLeft(a.token_expires_at, now()) : null,
      scopes: a?.scopes || [],
    });
  };

  // DELETE /api/instagram/disconnect?data=keep|delete
  const disconnect = async (req, res) => {
    const mode = String(req.query.data || req.body?.data || 'keep');
    if (!['keep', 'delete'].includes(mode)) return res.status(400).json({ error: 'data must be keep or delete' });
    await keys.del(req.uid, 'instagram');
    await q(`UPDATE ig_accounts SET status='disconnected',last_error=NULL,token_expires_at=NULL WHERE user_id=$1`, [req.uid]);
    let purged = 0;
    let accountRows = 0;
    if (mode === 'delete') {
      purged = (await q('DELETE FROM posts WHERE user_id=$1 AND ig_media_id IS NOT NULL RETURNING id', [req.uid])).length;
      for (const t of ['follower_history', 'ig_account_daily', 'ig_audience']) accountRows += (await q(`DELETE FROM ${t} WHERE user_id=$1 RETURNING 1 AS x`, [req.uid])).length; // A.1c tables
    }
    res.json({ ok: true, data: mode, postsDeleted: purged, accountRowsDeleted: accountRows });
  };

  // Daily job (run every few hours; it only acts on tokens with under 15 days left, so repeating is harmless).
  // Failure that proves the token is dead -> reconnect_needed + notification. A network blip only records last_error and retries next run.
  async function refreshTokens() {
    const c = cfg();
    const rows = await q(`SELECT user_id,ig_user_id,token_expires_at FROM ig_accounts WHERE status='connected'`);
    const out = { checked: rows.length, refreshed: 0, reconnect: 0, errors: 0 };
    for (const a of rows) {
      if (!needsRefresh(a.token_expires_at, now())) continue;
      const markDead = async why => { out.reconnect++; await markReconnect(q, a.user_id, why); };
      if (daysLeft(a.token_expires_at, now()) < 0) { await markDead('Token expired'); continue; }
      if (!c) { out.errors++; await q('UPDATE ig_accounts SET last_error=$2 WHERE user_id=$1', [a.user_id, CONNECT_ERRORS.not_configured]); continue; }
      try {
        const token = await keys.get(a.user_id, 'instagram');
        if (!token) { await markDead('Stored token missing or unreadable'); continue; }
        const r = await exchangeLongLived(graph, { ...c, token });
        await keys.set(a.user_id, 'instagram', r.access_token || token);
        await q('UPDATE ig_accounts SET token_expires_at=$2,last_error=NULL WHERE user_id=$1', [a.user_id, expiryFrom(r.expires_in, now())]);
        out.refreshed++;
      } catch (e) {
        if (e instanceof IgError && e.tokenInvalid) await markDead(e.message);
        else { out.errors++; await q('UPDATE ig_accounts SET last_error=$2 WHERE user_id=$1', [a.user_id, 'Token refresh failed, will retry: ' + e.message]); }
      }
    }
    return out;
  }

  return { start, callback, status, disconnect, refreshTokens };
}

// Credentials for one user. Order: connected account (OAuth) > legacy manual key + global IG_USER_ID > env pair (dev fallback).
// A user who connected and then lost the connection gets an error, never somebody else's env credentials.
// Production uses the env pair only when IG_ALLOW_ENV_FALLBACK=1 (roadmap: "env fallback for dev only").
export function makeIgCreds({ q, keys, env = process.env }) {
  return async function getIgCreds(uid) {
    const [a] = await q('SELECT ig_user_id,status,username FROM ig_accounts WHERE user_id=$1', [uid]);
    if (a) {
      if (a.status !== 'connected') throw new IgNotConnected(a.status);
      const token = await keys.get(uid, 'instagram');
      if (!token) throw new IgNotConnected('reconnect_needed');
      return { token, igUserId: a.ig_user_id, username: a.username, source: 'oauth' };
    }
    const envOk = env.NODE_ENV !== 'production' || env.IG_ALLOW_ENV_FALLBACK === '1';
    const manual = await keys.get(uid, 'instagram');
    if (manual && env.IG_USER_ID && envOk) return { token: manual, igUserId: env.IG_USER_ID, source: 'manual' };
    if (envOk && env.IG_ACCESS_TOKEN && env.IG_USER_ID) return { token: env.IG_ACCESS_TOKEN, igUserId: env.IG_USER_ID, source: 'env' };
    return null; // not connected: callers use demo mode or fail loud, depending on the feature
  };
}
