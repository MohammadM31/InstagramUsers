// One-shot assistant. Every request returns ONE result object; no conversation state is kept.
import { q } from './db.js';
import { enqueueImage, hasReplicateKey } from './imagejobs.js'; // 0.8: image work runs on the same queue as Content AI
import { advise, health, financePlan } from './advisor.js';
import { llmConfig, llmChat } from './keys.js';
import { hit } from './ratelimit.js';
import { currentVoice, voiceInstruction } from './brandvoice.js'; // O.3: the saved brand voice shapes the wording of the reply
import { makeAlbums, coverOf } from './albums.js';
import { summarizePage, captionFromPage, flatTags, hasWork, localOpinion, ignoredWork, aboutCurrentWork, wantsSchedule, clockFromText, albumAsk, folderCreate, categoryNamed, affirmsCreate, wantsGeneratedImage, imageRequestPrompt } from './pageactions.js';

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
  // O.4: the main goal re-weights advice (advisor.GOAL_*). Null when the person has no profile or no goal; any failure means "no goal".
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
const imagePrompt = t =>
  t.replace(/^(please\s+)?(generate|make|create|draw|design)\s+(me\s+)?(an?\s+)?(image|picture|photo|post|visual)?\s*(of|for|with)?\s*/i, '').trim() || t;
const amount = t => Number(t.match(/\$?\s?(\d[\d,]*)/)?.[1]?.replace(/,/g, '')) || 500;

// Intent router. With LLM_API_KEY set (Gemini, DeepSeek or OpenAI via an OpenAI-compatible endpoint) the model sees the
// page's live metrics and picks ONE action plus a short reply. Without a key, or on any failure, regex rules decide.
async function route(text, m, tips, uid, pageSummary = '') {
  const cfg = await llmConfig(uid); // 0.4: user's stored key first, env fallback
  if (cfg) try {
    const voice = voiceInstruction(await currentVoice(q, uid).catch(() => null)); // '' when none
    const j = await llmChat(cfg, { response_format: { type: 'json_object' }, messages: [
        { role: 'system', content: `You are the assistant inside an Instagram growth tool. You know this page's live state:\n${JSON.stringify({ metrics: m, health: health(m), priorities: tips.slice(0, 4).map(t => t.text) })}\n` +
          (pageSummary ? `What the user currently has open:\n${pageSummary}\nWhen they refer to this, current, these, the generation, the tags, or the image, talk about that work and no other.\n` : '') +
          `Pick ONE action for the user's request. Return JSON {"intent":"image|analytics|finance|tip|info","text":"","imagePrompt":"","capital":0}. ` +
          `"text" is at most 20 words, plain and brief, no greeting. Use intent "image" only if they want a picture made (put the visual in imagePrompt). "analytics" for performance/progress/page info, "finance" for budget or capital (put the amount in capital), "tip" for what to do next. ` +
          `Albums, saving a draft, and scheduling are actions this app performs. Never say this tool cannot create an album or that the user must use the Instagram app to do it. ` +
          `When advising, prefer collaborations, mentions, reshares, giveaways and community over hashtags or posting more. Never invent numbers not in the state.` +
          (voice ? `\nBrand voice for the wording of "text" (the limits above still apply): ${voice}` : '') },
        { role: 'user', content: text }] }, 20000);
    const o = JSON.parse(j.choices[0].message.content);
    if (['image', 'analytics', 'finance', 'tip', 'info'].includes(o.intent)) return o;
  } catch (e) { console.warn('[assistant] LLM failed, using regex rules:', e.message); }
  if (has(text, /\b(image|picture|photo|visual|generate|draw)\b/)) return { intent: 'image', imagePrompt: imagePrompt(text) };
  if (has(text, /\b(finance|capital|budget|invest|spend|money|afford)\b/)) return { intent: 'finance', capital: amount(text) };
  if (has(text, /\b(analytic|stats|metrics|performance|how am i|report|insight|progress|health)\b/)) return { intent: 'analytics' };
  if (has(text, /\b(suggest|idea|should|grow|boost|collab|mention|next|what)\b/)) return { intent: 'tip' };
  return { intent: 'info' };
}

const draftFrom = page => ({
  title: String(page?.prompt || page?.captions?.[0]?.hook || 'Saved from the assistant').slice(0, 140),
  caption: captionFromPage(page),
  ratio: page?.ratio || null,
  cover: coverOf(page?.image) || coverOf(page?.imageUrl),
});

const pictureNote = draft => draft.cover
  ? ' The generated image is included.'
  : ' No image was on Posts, so this has the caption and tags only.';

// Commands that change the app: schedule the current Posts work, or save it into an album.
// Returns a response body, or null to let the normal reply run.
async function pageCommand(req, text, page) {
  const albums = makeAlbums({ q });
  const last = [...(req.convo?.history || [])].reverse().find(m => m.role === 'assistant');
  const pending = last?.data?.pendingFolder;
  if (pending && affirmsCreate(text)) {
    const folder = await albums.createFolder(req.uid, pending).catch(async e => e.status === 409 ? albums.findFolder(req.uid, pending) : Promise.reject(e));
    const draft = draftFrom(page);
    const row = await albums.saveDraft(req.uid, { ...draft, category: page?.ratio === '9:16' ? 'reel' : 'photo', folderId: folder.id });
    return { type: 'info', text: `Created “${folder.name}” and saved the current work there.${pictureNote(draft)}`, data: { folderId: folder.id, itemId: row.id } };
  }
  if (pending && categoryNamed(text)) {
    const category = categoryNamed(text);
    const draft = draftFrom(page);
    const row = await albums.saveDraft(req.uid, { ...draft, category, folderId: null });
    const label = category === 'reel' ? 'Reels' : category;
    return { type: 'info', text: `Saved the current work into the ${label} album.${pictureNote(draft)}`, data: { itemId: row.id } };
  }
  const made = folderCreate(text);
  if (made && !albumAsk(text)) {
    const existing = await albums.findFolder(req.uid, made.name);
    if (existing) return { type: 'info', text: `You already have an album named “${existing.name}”. Open Albums to see it.`, data: { folderId: existing.id } };
    const folder = await albums.createFolder(req.uid, made.name);
    return { type: 'info', text: `Created the album “${folder.name}”. Open Albums to see it.`, data: { folderId: folder.id } };
  }
  const ask = albumAsk(text);
  if (ask) {
    if (!hasWork(page)) return { type: 'info', text: 'There is nothing to save yet. Generate a caption, tags or an image on Posts, then ask again.', data: {} };
    if (ask.kind === 'folder') {
      const existing = await albums.findFolder(req.uid, ask.name);
      if (!existing) {
        const names = (await albums.listFolders(req.uid)).map(f => f.name);
        const have = names.length ? ` You already have: ${names.join(', ')}.` : '';
        return { type: 'info', text: `There is no album named ${ask.name}. Should I create it, or save this into another album (Reels, Photos, Carousels, Stories)?${have}`, data: { pendingFolder: ask.name } };
      }
      const draft = draftFrom(page);
      const row = await albums.saveDraft(req.uid, { ...draft, category: page?.ratio === '9:16' ? 'reel' : 'photo', folderId: existing.id });
      return { type: 'info', text: `Saved the current work into ${existing.name}.${pictureNote(draft)}`, data: { folderId: existing.id, itemId: row.id } };
    }
    const draft = draftFrom(page);
    const row = await albums.saveDraft(req.uid, { ...draft, category: ask.category, folderId: null });
    const label = ask.category === 'reel' ? 'Reels' : ask.category;
    return { type: 'info', text: `Saved the current work into the ${label} album.${pictureNote(draft)}`, data: { itemId: row.id } };
  }
  if (wantsSchedule(text)) {
    const now = new Date();
    const when = clockFromText(text, now);
    if (!when) return { type: 'info', text: 'Tell me a time, for example “schedule it for 1pm today”.', data: {} };
    const caption = captionFromPage(page);
    if (!caption) return { type: 'info', text: 'Generate a caption, tags or an image on Posts first, then ask me to schedule it.', data: {} };
    const image = typeof page?.imageUrl === 'string' && /^https?:\/\//.test(page.imageUrl) ? page.imageUrl : null;
    const [row] = await q('INSERT INTO scheduled_posts(user_id,caption,image,platforms,scheduled_at) VALUES($1,$2,$3,$4,$5) RETURNING id', [req.uid, caption, image, ['instagram'], when]);
    const at = new Date(when);
    const whenLabel = at.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' });
    const rolled = /\btoday\b/i.test(text) && at.getDate() !== now.getDate();
    const tags = flatTags(page).slice(0, 8);
    const tagNote = tags.length ? ` Tags included: ${tags.join(' ')}.` : '';
    const lead = rolled ? `That time today has already passed, so I scheduled it for ${whenLabel}.` : `Scheduled that post for ${whenLabel}.`;
    const note = image ? ' The generated image is attached.' : (page?.image ? ' The picture is not a public link yet, so Instagram cannot publish it until storage is set up. The caption and tags are on the schedule.' : '');
    return { type: 'info', text: `${lead} It is in Scheduling.${tagNote}${note}`, data: { scheduledId: row.id, scheduledAt: when } };
  }
  return null;
}

async function startImage(req, res, prompt, referenceImage) {
  try {
    if (!await hasReplicateKey(req.uid)) return res.json({ type: 'info', text: 'Image generation needs a Replicate key: add one in Settings or set REPLICATE_API_TOKEN.', data: {} });
    const rl = await hit('image', req.uid, 20, 3600);
    if (!rl.ok) return res.status(429).json({ error: rl.msg });
    const b = req.body || {};
    const jobId = await enqueueImage(req.uid, { prompt: String(prompt || '').slice(0, 1000), ratio: b.ratio || '4:5', overlayText: b.overlayText ? String(b.overlayText).slice(0, 120) : undefined, referenceImage: referenceImage || undefined, n: 1 });
    return res.json({ type: 'image', text: 'Generating your image…', data: { jobId } });
  } catch (e) {
    const missing = e.status === 503;
    return res.json({ type: 'info', text: missing ? 'Image generation needs a Replicate key: add one in Settings or set REPLICATE_API_TOKEN.' : (e.expose ? e.message : 'Image generation failed. Try again.'), data: {} });
  }
}

export async function assistant(req, res) {
  const text = String(req.body?.message || '').slice(0, 500);
  if (!text.trim()) return res.status(400).json({ error: 'message required' });
  const page = req.body?.page && typeof req.body.page === 'object' ? req.body.page : null;
  const rawRef = typeof req.body?.referenceImage === 'string' ? req.body.referenceImage : '';
  const ref = /^(data:image\/|https?:\/\/)/.test(rawRef) ? rawRef : '';
  if (page || aboutCurrentWork(text) || wantsSchedule(text) || albumAsk(text) || folderCreate(text)) {
    try {
      const done = await pageCommand(req, text, page);
      if (done) return res.json(done);
    } catch (e) {
      if (e.code === '42P01') return res.json({ type: 'info', text: 'Albums are not ready yet. Restart the server so the database can update, then ask again.', data: {} });
      console.error('page command', e.message);
      return res.json({ type: 'info', text: 'I could not do that just now. ' + (e.message || 'Try again.'), data: {} });
    }
  }
  if (wantsGeneratedImage(text, req.body?.mode)) {
    if (/\b(attached|reference|this image)\b/i.test(text) && !ref)
      return res.json({ type: 'info', text: 'Attach the image first, then ask me to generate from it.', data: {} });
    return startImage(req, res, imageRequestPrompt(text, !!ref), ref);
  }
  if (aboutCurrentWork(text)) {
    const local = localOpinion(page);
    const cfg = await llmConfig(req.uid).catch(() => null);
    if (cfg) try {
      const j = await llmChat(cfg, { messages: [
        { role: 'system', content: 'Comment on the user\'s current Instagram draft in at most 40 words. Use only the work described. Do not invent numbers.\n' + (summarizePage(page) || 'Nothing is on the page.') },
        { role: 'user', content: text }] }, 20000);
      const said = String(j.choices?.[0]?.message?.content || '').replace(/^["']|["']$/g, '').slice(0, 400);
      if (said && !ignoredWork(said, page)) return res.json({ type: 'info', text: said, data: {} });
    } catch { /* the local comment still answers */ }
    return res.json({ type: 'info', text: local, data: {} });
  }
  const m = await pageMetrics(req.uid);
  const tips = advise(m);
  const o = await route(text, m, tips, req.uid, summarizePage(page));
  const say = (fallback) => (o.text && String(o.text).slice(0, 200)) || fallback;

  if (o.intent === 'image') return startImage(req, res, String(o.imagePrompt || imagePrompt(text)), ref);
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