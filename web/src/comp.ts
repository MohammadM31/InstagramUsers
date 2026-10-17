// Roadmap A.3 UI helpers (pure; unit-tested in test/competitorsUi.test.js). Every line says "public metrics only": a competitor's reach is not available.
export type HistPoint = { day: string; followers: number | null; posts_count: number | null; avg_likes: number | null; avg_comments: number | null };
export type Momentum = { followers: number | null; followersChange7d: number | null; followersChange30d: number | null; pct7d: number | null; ownChange7d: number | null; outPacing: boolean };
export type HistData = { handle: string; days: number; points: HistPoint[]; momentum: Momentum; ownFollowersKnown: boolean; note: string; reason: string | null };

export const EMPTY_HISTORY = 'No history yet. One point is stored per day from a real Instagram scrape of a public business or creator account. Demo data is never stored. Connect Instagram in Settings, then press Scrape.';

const sign = (v: number) => (v > 0 ? '+' : v < 0 ? '-' : '') + Math.abs(Math.round(v)).toLocaleString('en-US');

// Polyline points for an inline SVG. Needs two points with a follower count; x follows the calendar day so gaps look like gaps.
export function sparkPoints(points: HistPoint[], w = 160, h = 36, pad = 2): string | null {
  const p = points.filter(x => x.followers !== null && x.day).map(x => ({ t: Date.parse(x.day + 'T00:00:00Z'), v: x.followers as number })).sort((a, b) => a.t - b.t);
  if (p.length < 2) return null;
  const t0 = p[0].t, t1 = p[p.length - 1].t, lo = Math.min(...p.map(x => x.v)), hi = Math.max(...p.map(x => x.v));
  const X = (t: number) => (t1 === t0 ? w / 2 : pad + ((t - t0) / (t1 - t0)) * (w - 2 * pad));
  const Y = (v: number) => (hi === lo ? h / 2 : h - pad - ((v - lo) / (hi - lo)) * (h - 2 * pad));
  return p.map(x => `${X(x.t).toFixed(1)},${Y(x.v).toFixed(1)}`).join(' ');
}

export function momentumLine(m: Momentum, handle: string, ownKnown: boolean): string {
  if (m.followersChange7d === null) return 'Not enough history for a 7-day change yet (it needs a stored point from 7 days ago).';
  const mine = ownKnown && m.ownChange7d !== null ? ` You: ${sign(m.ownChange7d)}.` : ' Your own 7-day follower change is not available yet.';
  return `@${handle}: ${sign(m.followersChange7d)} followers in 7 days${m.pct7d !== null ? ` (${m.pct7d > 0 ? '+' : ''}${m.pct7d}%)` : ''}.${mine}${m.outPacing ? ' They are gaining faster than you.' : ''}`;
}
export const change30 = (m: Momentum) => (m.followersChange30d === null ? 'no 30-day change yet' : `${sign(m.followersChange30d)} in 30 days`);
