// Pure normalisation of imported posts (roadmap 0.1). No DB, no network.
export const MAX_ROWS = 5000;
const TYPE = { reel: 'REEL', reels: 'REEL', video: 'REEL', clips: 'REEL', carousel: 'CAROUSEL_ALBUM', carousel_album: 'CAROUSEL_ALBUM', album: 'CAROUSEL_ALBUM', image: 'IMAGE', photo: 'IMAGE', picture: 'IMAGE', post: 'IMAGE',
  ig_reel: 'REEL', instagram_reel: 'REEL', story: 'IMAGE', stories: 'IMAGE', ig_story: 'IMAGE' }; // stories are filed as IMAGE (no separate story type in the schema)
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

export const METRICS = ['likes', 'comments', 'saves', 'shares', 'reach', 'impressions', 'watch_s']; // order = column order used by the import SQL

// Dates. ISO (2026-10-01, 2026-10-01T10:00:00Z) and text months ("Oct 1, 2026") go to Date as before.
// Year-first slash/dot/dash dates (2026/10/01, 2026.10.01) are parsed explicitly as UTC so the result never
// depends on the server's time zone — `new Date('2026/10/01')` would read it as local time.
// Slash/dot/dash dates with the year LAST (01/10/2026) are never guessed: if day and month could both be either,
// the row is rejected. 13/10/2026 (day-first) and 10/13/2026 (month-first) are unambiguous and accepted;
// 05/05/2026 reads the same both ways.
const NUMERIC_DATE = /^\s*(\d{1,2})([\/.-])(\d{1,2})\2(\d{2,4})(?=$|[\sT,])(.*)$/;
const YMD_DATE = /^\s*(\d{4})([\/.-])(\d{1,2})\2(\d{1,2})(?:[\sT,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?\s*$/;
const TIME = /^[\sT,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?\s*$/;
export function parseDate(v) {
  if (typeof v !== 'string') { const d = new Date(v); return isNaN(d) ? { error: 'bad or missing date' } : { date: d }; }
  const s = v.trim(), show = s.slice(0, 40);

  // Year-first (2026/10/01, 2026.10.01, 2026-10-01) with optional time — parsed as UTC explicitly.
  const ym = YMD_DATE.exec(s);
  if (ym) {
    const [, y, , mo, dy, hh, mm, ss, ap] = ym;
    let h = hh ? +hh : 0, mi = mm ? +mm : 0, sec = ss ? +ss : 0;
    if (ap) { if (h < 1 || h > 12) return { error: `bad time in "${show}"` }; h = (h % 12) + (/p/i.test(ap) ? 12 : 0); }
    if (h > 23 || mi > 59 || sec > 59) return { error: `bad time in "${show}"` };
    const d = new Date(Date.UTC(+y, +mo - 1, +dy, h, mi, sec));
    if (d.getUTCFullYear() !== +y || d.getUTCMonth() !== +mo - 1 || d.getUTCDate() !== +dy) return { error: `bad date "${show}" (no such day)` };
    return { date: d };
  }

  const m = NUMERIC_DATE.exec(s);
  if (!m) { const d = new Date(s); return isNaN(d) ? { error: 'bad or missing date' } : { date: d }; }
  const [, A, , B, Y, rest] = m, a = +A, b = +B;
  const ambiguous = { error: `ambiguous date "${show}": it could be day/month or month/day. Use ISO format (2026-10-01) or a date whose day is above 12 (13/10/2026)` };
  if (Y.length !== 4) return { error: `date "${show}" has a 2-digit or short year, which is ambiguous. Use ISO format (2026-10-01)` };
  let day, month;
  if (a > 12 && b <= 12) { day = a; month = b; }
  else if (b > 12 && a <= 12) { day = b; month = a; }
  else if (a === b && a <= 12) { day = a; month = b; }
  else if (a <= 12 && b <= 12) return ambiguous;
  else return { error: `bad date "${show}"` };
  let h = 0, mi = 0, sec = 0;
  if (rest.trim() !== '' && !/^[\sT,]*$/.test(rest)) {
    const t = TIME.exec(rest);
    if (!t) return { error: `unreadable time in "${show}". Use ISO format (2026-10-01T10:00:00Z)` };
    h = +t[1]; mi = +t[2]; sec = +(t[3] || 0);
    if (t[4]) { if (h < 1 || h > 12) return { error: `bad time in "${show}"` }; h = (h % 12) + (/p/i.test(t[4]) ? 12 : 0); }
    if (h > 23 || mi > 59 || sec > 59) return { error: `bad time in "${show}"` };
  }
  const d = new Date(Date.UTC(+Y, month - 1, day, h, mi, sec)); // slash dates are read as UTC, so the result does not depend on the server's time zone
  if (d.getUTCDate() !== day || d.getUTCMonth() !== month - 1) return { error: `bad date "${show}" (no such day)` };
  return { date: d };
}

// Returns { rows, invalid: [{index, row, reason}] }. Never throws on bad rows; caps at MAX_ROWS.
// Each row also carries `missing`: the metric columns that were NOT in the input (absent, empty or null). New posts get 0 for them;
// a refresh import (0.1b) leaves the stored value alone instead. An explicit 0 in the file is a real 0 and is not listed as missing.
// `row` is the number to show a person: CSV = line number in the file (header = line 1), JSON = array position starting at 1.
export function normalizePosts(input) {
  if (!Array.isArray(input)) throw Object.assign(new Error('expected an array of posts'), { status: 400 });
  if (input.length > MAX_ROWS) throw Object.assign(new Error(`too many rows (max ${MAX_ROWS})`), { status: 413 });
  const rows = [], invalid = [];
  input.forEach((raw, index) => {
    const r = Object.fromEntries(Object.entries(raw || {}).map(([k, v]) => [k.toLowerCase().replace(/[\s-]+/g, '_'), v]));
    const row = raw && raw.__line !== undefined ? raw.__line : index + 1, bad = reason => invalid.push({ index, row, reason });
    const pd = parseDate(pick(r, 'posted_at')), d = pd.date;
    if (pd.error) return bad(pd.error);
    if (d.getFullYear() < 2010 || d > new Date(Date.now() + 864e5)) return bad('bad or missing date');
    const t = TYPE[String(pick(r, 'type') ?? 'image').toLowerCase().replace(/[\s-]+/g, '_')];
    if (!t) return bad('unknown type (use REEL, CAROUSEL_ALBUM or IMAGE)');
    const n = Object.fromEntries(METRICS.map(k => [k, num(pick(r, k))]));
    if (Object.values(n).some(Number.isNaN)) return bad('metrics must be non-negative numbers');
    if (!n.reach) return bad('reach is required (engagement rate needs it)');
    const missing = METRICS.filter(k => pick(r, k) === undefined);
    rows.push({ posted_at: d.toISOString(), type: t, ...n, caption: String(pick(r, 'caption') ?? '').slice(0, 2200), missing });
  });
  return { rows, invalid };
}

// 0.1b: collapse rows that share the dedupe key (user is implicit; posted_at + type + caption) INSIDE one import.
// ON CONFLICT DO UPDATE refuses to touch the same row twice in a single statement, so this must run first.
// keepLast: for refresh imports the later row in the file wins; otherwise the first one wins (what DO NOTHING does).
export const dedupeKey = r => `${r.posted_at}|${r.type}|${r.caption ?? ''}`;
// Refresh imports merge duplicates instead of replacing the whole row: the later row wins for every metric it actually has,
// and a metric the later row lacks keeps the earlier row's value (missing never beats present).
function mergeRows(prev, next) {
  const nm = next.missing || [], pm = prev.missing || [], out = { ...next, missing: [] };
  for (const k of METRICS) if (nm.includes(k)) { if (pm.includes(k)) out.missing.push(k); else out[k] = prev[k]; }
  return out;
}
export function dedupeRows(rows, keepLast = false) {
  const seen = new Map();
  for (const r of rows) { const k = dedupeKey(r), p = seen.get(k); if (!p) seen.set(k, r); else if (keepLast) seen.set(k, mergeRows(p, r)); }
  return [...seen.values()];
}