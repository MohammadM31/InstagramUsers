// One-shot assistant. Every request returns ONE result object; no conversation state is kept.
import { q } from './db.js';
import { enqueueImage, hasReplicateKey } from './imagejobs.js'; // 0.8: image work runs on the same queue as Content AI
import { advise, health, financePlan } from './advisor.js';
import { llmConfig } from './keys.js';
import { hit } from './ratelimit.js';

const ER = '(coalesce(likes,0)+coalesce(comments,0)+coalesce(saves,0)+coalesce(shares,0))';
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
  // A.1c: Instagram follower history (empty until the first connected sync). Additive: older consumers ignore it.
  const fh = await q(`SELECT to_char(captured_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS day, followers, source FROM follower_history WHERE user_id=$1 AND followers IS NOT NULL ORDER BY captured_at DESC LIMIT 61`, [uid]);
  return {
    followerSeries: fh.reverse(),
    hasData: c.total > 0,
    reach30d: Math.round(c.r1), reachChange: pct(c.r1, c.r0),
    er: +((c.er || 0) * 100).toFixed(2),
    postsPerWeek: +(c.n30 / 4.3).toFixed(1),
    posts30d: c.n30, totalPosts: c.total,
    mentions30d: c.mentions, collabs30d: c.collabs,
    types: types.map(t => ({ type: t.type, er: t.er || 0, share: c.total ? t.n / c.total : 0 })),
    topCompetitor: comp?.handle || null,
  };
}

const has = (s, re) => re.test(s.toLowerCase());
const imagePrompt = t =>
  t.replace(/^(please\s+)?(generate|make|create|draw|design)\s+(me\s+)?(an?\s+)?(image|picture|photo|post|visual)?\s*(of|for|with)?\s*/i, '').trim() || t;
const amount = t => Number(t.match(/\$?\s?(\d[\d,]*)/)?.[1]?.replace(/,/g, '')) || 500;

// Intent router. With LLM_API_KEY set (Gemini, DeepSeek or OpenAI via an OpenAI-compatible endpoint) the model sees the
// page's live metrics and picks ONE action plus a short reply. Without a key, or on any failure, regex rules decide.
async function route(text, m, tips, uid) {
  const cfg = await llmConfig(uid); // 0.4: user's stored key first, env fallback
  if (cfg) try {
    const r = await fetch(cfg.base + '/chat/completions', {
      method: 'POST', headers: { Authorization: 'Bearer ' + cfg.key, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10000),
      body: JSON.stringify({ model: cfg.model, response_format: { type: 'json_object' }, messages: [
        { role: 'system', content: `You are the assistant inside an Instagram growth tool. You know this page's live state:\n${JSON.stringify({ metrics: m, health: health(m), priorities: tips.slice(0, 4).map(t => t.text) })}\n` +
          `Pick ONE action for the user's request. Return JSON {"intent":"image|analytics|finance|tip|info","text":"","imagePrompt":"","capital":0}. ` +
          `"text" is at most 20 words, plain and brief, no greeting. Use intent "image" only if they want a picture made (put the visual in imagePrompt). "analytics" for performance/progress/page info, "finance" for budget or capital (put the amount in capital), "tip" for what to do next. ` +
          `When advising, prefer collaborations, mentions, reshares, giveaways and community over hashtags or posting more. Never invent numbers not in the state.` },
        { role: 'user', content: text }] }) });
    const j = await r.json(), o = JSON.parse(j.choices[0].message.content);
    if (['image', 'analytics', 'finance', 'tip', 'info'].includes(o.intent)) return o;
  } catch { /* fall through to rules */ }
  if (has(text, /\b(image|picture|photo|visual|generate|draw)\b/)) return { intent: 'image', imagePrompt: imagePrompt(text) };
  if (has(text, /\b(finance|capital|budget|invest|spend|money|afford)\b/)) return { intent: 'finance', capital: amount(text) };
  if (has(text, /\b(analytic|stats|metrics|performance|how am i|report|insight|progress|health)\b/)) return { intent: 'analytics' };
  if (has(text, /\b(suggest|idea|should|grow|boost|collab|mention|next|what)\b/)) return { intent: 'tip' };
  return { intent: 'info' };
}

export async function assistant(req, res) {
  const text = String(req.body?.message || '').slice(0, 500);
  if (!text.trim()) return res.status(400).json({ error: 'message required' });
  const m = await pageMetrics(req.uid);
  const tips = advise(m);
  const o = await route(text, m, tips, req.uid);
  const say = (fallback) => (o.text && String(o.text).slice(0, 200)) || fallback;

  if (o.intent === 'image') {
    // 0.8: queue the job and return its id. The card polls GET /api/content/image/:jobId (same endpoint as Content AI).
    try {
      if (!await hasReplicateKey(req.uid)) return res.json({ type: 'info', text: 'Image generation needs a Replicate key: add one in Settings or set REPLICATE_API_TOKEN.', data: {} });
      const rl = await hit('image', req.uid, 20, 3600); // assistant images spend from the same budget as Content AI
      if (!rl.ok) return res.status(429).json({ error: rl.msg });
      const b = req.body || {};
      const jobId = await enqueueImage(req.uid, { prompt: String(o.imagePrompt || imagePrompt(text)).slice(0, 1000), ratio: b.ratio || '4:5', overlayText: b.overlayText ? String(b.overlayText).slice(0, 120) : undefined, referenceImage: b.referenceImage, n: 1 });
      return res.json({ type: 'image', text: 'Generating your image…', data: { jobId } });
    } catch (e) {
      return res.json({ type: 'info', text: e.status === 503 ? 'Image generation needs a Replicate key: add one in Settings or set REPLICATE_API_TOKEN.' : 'Image generation failed. Try again.', data: {} });
    }
  }
  if (o.intent === 'finance') {
    const cap = Math.max(0, Number(o.capital) || amount(text));
    return res.json({ type: 'finance', text: say('Suggested split.'), data: financePlan(m, cap) });
  }
  if (o.intent === 'analytics')
    return res.json({ type: 'analytics', text: say(`Page health: ${health(m).label}.`), data: { metrics: m, health: health(m), top: tips.slice(0, 3) } });
  if (o.intent === 'tip')
    return res.json({ type: 'tip', text: say(tips[0].text), data: { more: tips.slice(1, 3) } });
  res.json({ type: 'info', text: say(m.hasData ? `Reach ${m.reach30d.toLocaleString()} (${m.reachChange}% vs prev. 30d), ${m.er}% engagement. ${tips[0].text}` : tips[0].text), data: {} });
}

// GET /api/finance/plan?capital=1000, used by the Finance page
export async function financeRoute(req, res) {
  const capital = Math.max(0, Number(req.query.capital) || 0);
  const m = await pageMetrics(req.uid);
  res.json({ ...financePlan(m, capital), health: health(m), metrics: m });
}
