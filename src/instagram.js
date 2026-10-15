// Roadmap A.1a: thin Instagram / Facebook Graph API wrapper. fetch is injected, so everything here is testable without the network.
// This file knows URLs, errors and metric names. It never touches the database.

// One place to bump the API version. Meta supports each version ~2 years; v25.0 is supported until 2028-02 (checked 2026-10-15).
export const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v25.0';
export const GRAPH_BASE = process.env.META_GRAPH_BASE || 'https://graph.facebook.com'; // the mock server in scripts/ overrides this
export const DIALOG_BASE = process.env.META_DIALOG_BASE || 'https://www.facebook.com';

// Permissions requested at connect time (roadmap A.0). instagram_content_publish and Public Content Access are added later (C, B.2b).
export const IG_SCOPES = ['instagram_basic', 'instagram_manage_insights', 'instagram_manage_comments', 'pages_show_list', 'pages_read_engagement'];

// Retired metric names (roadmap section 5). A unit test fails if any of them appears in a list we request.
export const BANNED_METRICS = ['impressions', 'plays', 'clips_replays_count', 'ig_reels_aggregated_all_plays_count', 'video_views'];
export function assertMetricsAllowed(list) {
  const bad = list.filter(m => BANNED_METRICS.includes(m));
  if (bad.length) throw new Error('Retired Instagram metric requested: ' + bad.join(', '));
  return list;
}

// Error from the Graph API (or the network). tokenInvalid means the user must connect again; everything else is retried later.
export class IgError extends Error {
  constructor(message, { status = 0, code = null, subcode = null, type = null } = {}) {
    super(message);
    this.name = 'IgError';
    this.status = status; this.code = code; this.subcode = subcode; this.type = type;
    // 190 = invalid/expired token; 102 = session expired; 460/463/467 = password changed / session invalidated.
    this.tokenInvalid = code === 190 || code === 102 || [460, 463, 467].includes(subcode);
    // 10 and 200-299 = a permission is missing or was revoked.
    this.permission = code === 10 || (code >= 200 && code <= 299);
    // 4, 17, 32, 613 and 80001-80099 = rate limited.
    this.rateLimited = [4, 17, 32, 613].includes(code) || (code >= 80000 && code <= 80099);
  }
}

// Meta reports how close an app/account is to its limit in these headers (values are percentages). Returns the highest one, 0 if absent.
export function usageLevel(headers) {
  const get = n => (headers && typeof headers.get === 'function' ? headers.get(n) : headers?.[n]) || null;
  let max = 0;
  for (const name of ['x-app-usage', 'x-business-use-case-usage', 'x-ad-account-usage']) {
    const raw = get(name);
    if (!raw) continue;
    let j; try { j = JSON.parse(raw); } catch { continue; }
    const walk = o => {
      if (Array.isArray(o)) o.forEach(walk);
      else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) {
        if (typeof v === 'number' && /call_count|total_time|total_cputime/.test(k)) max = Math.max(max, v);
        else walk(v);
      }
    };
    walk(j);
  }
  return max;
}

export function makeGraph({ fetch = globalThis.fetch, version = GRAPH_VERSION, base = GRAPH_BASE, onUsage } = {}) {
  async function call(method, path, params = {}, token) {
    const url = new URL(`${base}/${version}/${String(path).replace(/^\//, '')}`);
    const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''));
    if (token) clean.access_token = token;
    let res;
    try {
      if (method === 'GET') {
        for (const [k, v] of Object.entries(clean)) url.searchParams.set(k, String(v));
        res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      } else {
        res = await fetch(url, { method, body: new URLSearchParams(clean), signal: AbortSignal.timeout(20000) });
      }
    } catch (e) { throw new IgError('Could not reach Instagram: ' + e.message); }
    const usage = usageLevel(res.headers);
    if (usage && onUsage) onUsage(usage);
    const j = await res.json().catch(() => ({}));
    if (j.error || !res.ok) {
      const e = j.error || {};
      throw new IgError(e.message || `Instagram returned HTTP ${res.status}`, { status: res.status, code: e.code, subcode: e.error_subcode, type: e.type });
    }
    return Object.defineProperty(j, '_usage', { value: usage, enumerable: false });
  }
  return { get: (p, params, token) => call('GET', p, params, token), post: (p, params, token) => call('POST', p, params, token) };
}

// ---- OAuth (Facebook Login for Business, decision D1) ----
export function buildLoginUrl({ appId, redirectUri, state, scopes = IG_SCOPES, version = GRAPH_VERSION, dialogBase = DIALOG_BASE }) {
  const u = new URL(`${dialogBase}/${version}/dialog/oauth`);
  u.searchParams.set('client_id', appId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('state', state);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', scopes.join(','));
  return u.toString();
}

const days = s => (Number.isFinite(+s) && +s > 0 ? +s : 60 * 86400) / 86400;
// expires_in is in seconds. When Meta omits it for a long-lived token, assume the documented 60 days.
export const expiryFrom = (expiresIn, now = Date.now()) => new Date(now + days(expiresIn) * 864e5);

export const exchangeCode = (g, { appId, appSecret, redirectUri, code }) =>
  g.get('oauth/access_token', { client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code });
// Also used to refresh: exchanging a still-valid long-lived token returns a new one.
export const exchangeLongLived = (g, { appId, appSecret, token }) =>
  g.get('oauth/access_token', { grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret, fb_exchange_token: token });

// Pages the user manages, with the Instagram professional account linked to each (if any).
export async function listPagesWithIg(g, token) {
  const r = await g.get('me/accounts', { fields: 'id,name,instagram_business_account{id,username,followers_count,media_count}', limit: 100 }, token);
  return r.data || [];
}
export const grantedScopes = async (g, token) => {
  const r = await g.get('me/permissions', {}, token);
  return (r.data || []).filter(p => p.status === 'granted').map(p => p.permission);
};
