// Pure normalisation of imported posts (roadmap 0.1). No DB, no network.
export const MAX_ROWS = 5000;
const TYPE = { reel: 'REEL', reels: 'REEL', video: 'REEL', clips: 'REEL', carousel: 'CAROUSEL_ALBUM', carousel_album: 'CAROUSEL_ALBUM', album: 'CAROUSEL_ALBUM', image: 'IMAGE', photo: 'IMAGE', picture: 'IMAGE', post: 'IMAGE' };
const ALIAS = {
  posted_at: ['posted_at', 'date', 'timestamp', 'published', 'published_at', 'created_at', 'time'],
  type: ['type', 'media_type', 'format', 'post_type'],
  likes: ['likes', 'like_count'], comments: ['comments', 'comment_count', 'comments_count'],
  saves: ['saves', 'saved', 'save_count'], shares: ['shares', 'sends', 'share_count'],
  reach: ['reach', 'accounts_reached'], impressions: ['impressions', 'views'],
  watch_s: ['watch_s', 'watch_time', 'avg_watch_seconds'], caption: ['caption', 'text', 'description'],
};
const pick = (r, k) => { for (const a of ALIAS[k]) if (r[a] !== undefined && r[a] !== null && r[a] !== '') return r[a]; };
const num = v => { if (v === undefined) return 0; const n = Number(String(v).replace(/[,\s]/g, '')); return Number.isFinite(n) && n >= 0 ? Math.round(n) : NaN; };

// Returns { rows, invalid: [{index, reason}] }. Never throws on bad rows; caps at MAX_ROWS.
export function normalizePosts(input) {
  if (!Array.isArray(input)) throw Object.assign(new Error('expected an array of posts'), { status: 400 });
  if (input.length > MAX_ROWS) throw Object.assign(new Error(`too many rows (max ${MAX_ROWS})`), { status: 413 });
  const rows = [], invalid = [];
  input.forEach((raw, index) => {
    const r = Object.fromEntries(Object.entries(raw || {}).map(([k, v]) => [k.toLowerCase().replace(/[\s-]+/g, '_'), v]));
    const d = new Date(pick(r, 'posted_at'));
    if (isNaN(d) || d.getFullYear() < 2010 || d > new Date(Date.now() + 864e5)) return invalid.push({ index, reason: 'bad or missing date' });
    const t = TYPE[String(pick(r, 'type') ?? 'image').toLowerCase().replace(/[\s-]+/g, '_')];
    if (!t) return invalid.push({ index, reason: 'unknown type (use REEL, CAROUSEL_ALBUM or IMAGE)' });
    const n = Object.fromEntries(['likes', 'comments', 'saves', 'shares', 'reach', 'impressions', 'watch_s'].map(k => [k, num(pick(r, k))]));
    if (Object.values(n).some(Number.isNaN)) return invalid.push({ index, reason: 'metrics must be non-negative numbers' });
    if (!n.reach) return invalid.push({ index, reason: 'reach is required (engagement rate needs it)' });
    rows.push({ posted_at: d.toISOString(), type: t, ...n, caption: String(pick(r, 'caption') ?? '').slice(0, 2200) });
  });
  return { rows, invalid };
}
