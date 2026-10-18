// Roadmap A.3: pure helpers for competitor history. No database, no network. I/O lives in competitors.js.
// Only public Business Discovery numbers are used: followers, media count, and likes/comments of the last posts. Reach is never public.
export const NOT_PUBLIC_CODE = 'competitor_not_public';
export const PUBLIC_NOTE = 'Public metrics only: reach and comment text are private.';

const num = v => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const mean = (posts, k) => { const v = posts.map(p => num(p?.[k])).filter(x => x !== null); return v.length ? +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : null; };
export const utcDay = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);

// One history row from a scrape result d = { source, followers, postsCount, posts:[{likes,comments}] }.
// Anything that is not real Business Discovery data (demo data, or a result without a follower count) returns null: nothing is stored.
// A hidden like count stays out of the average (null), never 0.
export function historyRow(d) {
  if (!d || d.source !== 'business_discovery') return null;
  const followers = num(d.followers);
  if (followers === null) return null;
  const pc = num(d.postsCount), posts = Array.isArray(d.posts) ? d.posts : [];
  return { followers: Math.round(followers), posts_count: pc === null ? null : Math.round(pc), avg_likes: mean(posts, 'likes'), avg_comments: mean(posts, 'comments') };
}

export function notPublicError(handle) {
  const e = new Error(`@${handle} is not a public business or creator account (or the username does not exist), so Instagram does not share its public metrics.`);
  e.code = NOT_PUBLIC_CODE;
  return e;
}

// Maps a Business Discovery response to the scrape result used by the worker. A missing business_discovery node = not public.
export function parseDiscovery(r, handle) {
  const b = r?.business_discovery;
  if (!b) throw notPublicError(handle);
  return { source: 'business_discovery', followers: b.followers_count, postsCount: b.media_count,
    posts: (b.media?.data || []).map(m => ({ type: m.media_type, at: m.timestamp, likes: m.like_count, comments: m.comments_count, caption: m.caption || '' })) };
}

// Token, permission and rate-limit errors pass through untouched (the caller must see them). Graph code 110 ("Invalid user id") is how
// Business Discovery answers for a personal, private or unknown username. UNVERIFIED against live Meta: needs the A.0 test account.
export function classifyDiscoveryError(err, handle) {
  if (!err || err.tokenInvalid || err.permission || err.rateLimited) return err;
  if (err.name === 'IgError' && (err.code === 110 || /invalid user id|not a business|cannot find|does not exist/i.test(String(err.message)))) return notPublicError(handle);
  return err;
}

// A.3 (decision 92): a failed scrape as { code, message } for competitors.last_error. The message is written here, never copied from Graph or the
// network, so nothing internal (tokens, urls, stack text) can reach the screen. Unknown failures get a generic line and the code 'scrape_failed'.
export function scrapeErrorInfo(err) {
  if (err?.code === NOT_PUBLIC_CODE) return { code: NOT_PUBLIC_CODE, message: String(err.message).slice(0, 300) };
  if (err?.constructor?.name === 'IgNotConnected') return { code: 'instagram_reconnect', message: 'Instagram needs to be reconnected (Settings > Instagram) before competitors can be updated.' };
  if (err?.tokenInvalid) return { code: 'instagram_reconnect', message: 'Instagram rejected the saved connection. Reconnect it in Settings > Instagram.' };
  if (err?.permission) return { code: 'instagram_permission', message: 'Instagram did not allow this lookup (a permission is missing). Reconnect and accept all permissions.' };
  if (err?.rateLimited) return { code: 'instagram_rate_limited', message: 'Instagram rate limit reached. It will be tried again later.' };
  return { code: 'scrape_failed', message: 'The last update failed. It will be tried again.' };
}
