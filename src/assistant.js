// One-shot assistant. Every request returns ONE result object; no conversation state is kept.
import { q } from './db.js';
import { enqueueImage, hasReplicateKey } from './imagejobs.js';
import { advise, health, financePlan } from './advisor.js';
import { llmConfig, llmChat } from './keys.js';
import { hit } from './ratelimit.js';
import { currentVoice, voiceInstruction } from './brandvoice.js';
import { makeImageIntent, jobParams, imagePrompt, looksLikeEdit, lastTurnWasImage, isUuid } from './imageintent.js';

const ER = '(coalesce(likes,0)+coalesce(comments,0)+coalesce(saves,0)+coalesce(shares,0))';
const L30 = "posted_at>now()-interval '30 days'";
const P30 = "posted_at BETWEEN now()-interval '60 days' AND now()-interval '30 days'";
const pct = (a, b) => (b ? +(((a - b) / b) * 100).toFixed(1) : 0);

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
  const fh = await q(`SELECT to_char(captured_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS day, followers, source FROM follower_history WHERE user_id=$1 AND followers IS NOT NULL ORDER BY captured_at DESC LIMIT 61`, [uid]);
  const [bp] = await q('SELECT goal_primary FROM business_profile WHERE user_id=$1', [uid]).catch(() => []);
  return {
    goal: bp?.goal_primary ?? null,
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
const amount = t => Number(t.match(/\$?\s?(\d[\d,]*)/)?.[1]?.replace(/,/g, '')) || 500;

const recentTurns = history => (Array.isArray(history) ? history : []).slice(-6).map(h => ({
  role: h.role === 'assistant' ? 'assistant' : 'user',
  content: String(h.text || '').slice(0, 200) + (h.type === 'image' || h.data?.jobId ? ' [an image was generated here]' : '') }));

async function route(text, m, tips, uid, history) {
  const cfg = await llmConfig(uid); 
  if (cfg) try {
    const voice = voiceInstruction(await currentVoice(q, uid).catch(() => null));
    const j = await llmChat(cfg, { response_format: { type: 'json_object' }, messages: [
        { role: 'system', content: `You are the assistant inside an Instagram growth tool. You know this page's live state:\n${JSON.stringify({ metrics: m, health: health(m), priorities: tips.slice(0, 4).map(t => t.text) })}\n` +
          `Pick ONE action for the user's request. Return JSON {"intent":"image|analytics|finance|tip|info","text":"","imagePrompt":"","capital":0}. ` +
          `"text" is at most 20 words, plain and brief, no greeting. Use intent "image" only if they want a picture made or an earlier picture changed (put the visual in imagePrompt). "analytics" for performance/progress/page info, "finance" for budget or capital (put the amount in capital), "tip" for what to do next. ` +
          `When advising, prefer collaborations, mentions, reshares, giveaways and community over hashtags or posting more. Never invent numbers not in the state.` +
          (voice ? `\nBrand voice for the wording of "text" (the limits above still apply): ${voice}` : '') },
        ...recentTurns(history), { role: 'user', content: text }] }, 20000);
    const o = JSON.parse(j.choices[0].message.content);
    if (['image', 'analytics', 'finance', 'tip', 'info'].includes(o.intent)) return o;
  } catch (e) { console.warn('[assistant] LLM failed, using regex rules:', e.message); }
  
  if (has(text, /\b(image|picture|photo|visual|generate|draw)\b/) || (lastTurnWasImage(history) && looksLikeEdit(text))) return { intent: 'image', imagePrompt: imagePrompt(text) };
  if (has(text, /\b(finance|capital|budget|invest|spend|money|afford)\b/)) return { intent: 'finance', capital: amount(text) };
  if (has(text, /\b(analytic|stats|metrics|performance|how am i|report|insight|progress|health)\b/)) return { intent: 'analytics' };
  if (has(text, /\b(suggest|idea|should|grow|boost|collab|mention|next|what)\b/)) return { intent: 'tip' };
  return { intent: 'info' };
}

async function intentLlm(uid) {
  const cfg = await llmConfig(uid); if (!cfg) return null;
  return async ({ system, user, timeoutMs }) =>
    (await llmChat(cfg, { response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }, timeoutMs)).choices[0].message.content;
}
const NEEDS_KEY = 'Image generation needs a Replicate key: add one in Settings or set REPLICATE_API_TOKEN.';

export async function assistant(req, res) {
  const b = req.body || {};
  const text = String(b.message || '').slice(0, 500);
  if (!text.trim()) return res.status(400).json({ error: 'message required' });
  if (b.referenceImageId != null && !isUuid(b.referenceImageId)) return res.status(400).json({ error: 'referenceImageId must be a uuid' });
  const history = req.convo?.history; 

  let m, tips, o;
  if (b.mode === 'image') o = { intent: 'image' };
  else { m = await pageMetrics(req.uid); tips = advise(m); o = await route(text, m, tips, req.uid, history); }
  const say = (fallback) => (o.text && String(o.text).slice(0, 200)) || fallback;

  if (o.intent === 'image') {
    try {
      if (!await hasReplicateKey(req.uid)) return res.json({ type: 'info', text: NEEDS_KEY, data: {} });
      const intent = makeImageIntent({ llm: await intentLlm(req.uid) });
      const d = await intent.resolve({ message: text, mode: b.mode, ratio: b.ratio, referenceImageId: b.referenceImageId, referenceImage: b.referenceImage, history, hintPrompt: o.imagePrompt && String(o.imagePrompt).slice(0, 1000) });
      
      if (d.blocked) return res.json({ type: 'info', text: d.text, data: {} }); 

      if (d.kind === 'show') {
        return res.json({ 
          type: 'image', 
          text: d.summary, 
          data: { kind: 'restore', imageIds: [d.imageId], status: 'done' } 
        });
      }

      if (d.kind === 'chat' || d.kind === 'ask') {
        return res.json({ type: 'info', text: d.reply, data: {} });
      }

      const rl = await hit('image', req.uid, 20, 3600); 
      if (!rl.ok) return res.status(429).json({ error: rl.msg });
      
      const jobId = await enqueueImage(req.uid, jobParams(d, { conversationId: req.convo?.id, overlayText: b.overlayText }));
      
      // SAVE THE PROMPT so the LLM knows what this image is later
      const data = { 
        jobId, 
        ratio: d.ratio ?? d.parentRatio ?? null, 
        kind: d.kind, 
        summary: d.summary,
        prompt: d.prompt,
        instruction: d.instruction
      };
      
      if (d.parentImageId) data.parentImageId = d.parentImageId;
      if (d.kind === 'edit') data.instruction = d.instruction;
      return res.json({ type: 'image', text: d.kind === 'edit' ? 'Editing your image…' : 'Generating your image…', data });
    } catch (e) {
      return res.json({ type: 'info', text: e.status === 503 ? NEEDS_KEY : 'Image generation failed. Try again.', data: {} });
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

export async function financeRoute(req, res) {
  const capital = Math.max(0, Number(req.query.capital) || 0);
  const m = await pageMetrics(req.uid);
  res.json({ ...financePlan(m, capital), health: health(m), metrics: m });
}