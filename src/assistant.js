// One-shot assistant. Every request returns ONE result object; no conversation state is kept.
import { q } from './db.js';
import { generateImage } from './images.js'; // the ProductAI-style image service already lives here
import { advise, health, financePlan } from './advisor.js';

const ER = '(likes+comments+saves+shares)';
const L30 = "posted_at>now()-interval '30 days'";
const P30 = "posted_at BETWEEN now()-interval '60 days' AND now()-interval '30 days'";
const pct = (a, b) => (b ? +(((a - b) / b) * 100).toFixed(1) : 0);

// Reads how the page is performing. The schema has no follower or collab columns, so:
//  - growth is reach change vs the previous 30 days
//  - mentions / collabs are detected from captions ('@' and collab/partner wording)
export async function pageMetrics(uid) {
  const [c] = await q(`SELECT count(*)::int total,
    coalesce(sum(reach) FILTER(WHERE ${L30}),0)::float r1, coalesce(sum(reach) FILTER(WHERE ${P30}),0)::float r0,
    sum${ER} FILTER(WHERE ${L30})::float/NULLIF(sum(reach) FILTER(WHERE ${L30}),0) er,
    count(*) FILTER(WHERE ${L30})::int n30,
    count(*) FILTER(WHERE ${L30} AND caption ~ '@')::int mentions,
    count(*) FILTER(WHERE ${L30} AND caption ~* '(collab|partner|with @)')::int collabs
    FROM posts WHERE user_id=$1`, [uid]);
  const types = await q(`SELECT type, count(*)::int n,
    round(avg(${ER}*100.0/NULLIF(reach,0)),2)::float er FROM posts WHERE user_id=$1 GROUP BY type`, [uid]);
  const [comp] = await q('SELECT handle FROM competitors WHERE user_id=$1 AND followers IS NOT NULL ORDER BY followers DESC LIMIT 1', [uid]);
  return {
    hasData: c.total > 0,
    reach30d: Math.round(c.r1), reachChange: pct(c.r1, c.r0),
    er: +((c.er || 0) * 100).toFixed(2),
    postsPerWeek: +(c.n30 / 4.3).toFixed(1),
    mentions30d: c.mentions, collabs30d: c.collabs,
    types: types.map(t => ({ type: t.type, er: t.er || 0, share: c.total ? t.n / c.total : 0 })),
    topCompetitor: comp?.handle || null,
  };
}

const has = (s, re) => re.test(s.toLowerCase());
const imagePrompt = t =>
  t.replace(/^(please\s+)?(generate|make|create|draw|design)\s+(me\s+)?(an?\s+)?(image|picture|photo|post|visual)?\s*(of|for|with)?\s*/i, '').trim() || t;
const amount = t => Number(t.match(/\$?\s?(\d[\d,]*)/)?.[1]?.replace(/,/g, '')) || 500;

export async function assistant(req, res) {
  const text = String(req.body?.message || '').slice(0, 500);
  if (!text.trim()) return res.status(400).json({ error: 'message required' });
  const m = await pageMetrics(req.uid);
  const tips = advise(m);

  if (has(text, /\b(image|picture|photo|visual|generate|draw)\b/)) {
    try {
      const [url] = await generateImage({ prompt: imagePrompt(text), ratio: req.body.ratio || '4:5', overlayText: req.body.overlayText });
      return res.json({ type: 'image', text: 'Here you go.', data: { url } });
    } catch (e) {
      return res.json({ type: 'info', text: e.status === 503 ? 'Image generation needs REPLICATE_API_TOKEN in .env.' : 'Image generation failed. Try again.', data: {} });
    }
  }
  if (has(text, /\b(finance|capital|budget|invest|spend|money|afford)\b/))
    return res.json({ type: 'finance', text: 'Suggested split.', data: financePlan(m, amount(text)) });
  if (has(text, /\b(analytic|stats|metrics|performance|how am i|report|insight|progress|health)\b/))
    return res.json({ type: 'analytics', text: `Page health: ${health(m).label}.`, data: { metrics: m, health: health(m), top: tips.slice(0, 3) } });
  if (has(text, /\b(suggest|idea|should|grow|boost|collab|mention|next|what)\b/))
    return res.json({ type: 'tip', text: tips[0].text, data: { more: tips.slice(1, 3) } });
  res.json({ type: 'info', text: m.hasData ? `Reach ${m.reach30d.toLocaleString()} (${m.reachChange}% vs prev. 30d), ${m.er}% engagement. ${tips[0].text}` : tips[0].text, data: {} });
}

// GET /api/finance/plan?capital=1000, used by the Finance page
export async function financeRoute(req, res) {
  const capital = Math.max(0, Number(req.query.capital) || 0);
  const m = await pageMetrics(req.uid);
  res.json({ ...financePlan(m, capital), health: health(m), metrics: m });
}
