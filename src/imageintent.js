// Image intent: decides, WITH conversation context, what a message in image mode actually wants:
//   generate -> a NEW image            edit -> change an earlier image (or the uploaded reference)
//   show     -> display an EARLIER image again (no job)
//   chat     -> a question/comment, answer with text (no job)
//   ask      -> ambiguous, ask ONE short clarifying question (no job)
//
// Pure and dependency-injected (no db, no sharp, no network) so it is unit-tested without Redis/Postgres.
// makeImageIntent({ llm }) -> { resolve(args) }.  llm is null or async ({ system, user, timeoutMs }) => string (JSON text).
// resolve() NEVER throws on LLM trouble: invalid JSON, a timeout or an invented id all fall back to the heuristic path.
//
// Only kinds "generate" and "edit" should enqueue an image job (see isJobKind / jobParams).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = s => typeof s === 'string' && UUID.test(s);
export const RATIO_KEYS = ['1:1', '4:5', '9:16'];
export const DEFAULT_RATIO = '4:5'; // what the assistant has always used for NEW images
export const KINDS = ['generate', 'edit', 'show', 'chat', 'ask'];
export const SCOPES = ['local', 'global', 'text'];
export const isJobKind = d => d?.kind === 'generate' || d?.kind === 'edit';
const PENDING_MS = 30 * 1000; // 30 seconds
const TURNS_SENT = 10; // how many recent messages the LLM sees
const clip = (s, n) => String(s ?? '').trim().slice(0, n);

/* ---------- edit prompt for FLUX Kontext ---------- */
// WHY this shape: Kontext responds best to a direct imperative ("Change the background to green."), followed by a SHORT, positively
// phrased preservation clause. It has no negative prompt. The clause depends on the kind of edit, because "keep the same lighting"
// contradicts "make it night", so global edits only pin subject/composition.
const KEEP = {
  local: 'Keep everything else exactly the same: same subject, pose, composition, framing, camera angle, lighting and style.',
  global: 'Keep the same subject, composition and framing.',
  text: 'Keep the same font style, size, color, placement and the rest of the image unchanged.',
};
// "change the background to green" / "Change the background to green." -> "Change the background to green."  (handles several sentences)
const sentence = s => {
  const t = String(s || '').trim().replace(/[.\s]+$/, '');
  return t ? t[0].toUpperCase() + t.slice(1) + '.' : '';
};
export const framedEdit = (instruction, scope = 'local') => `${sentence(instruction)} ${KEEP[scope] || KEEP.local}`.trim();

// An edit with no explicit ratio keeps the reference image's own aspect (no crop, no default). Used by generateImage.
export const keepsNativeAspect = ({ edit, ratio }) => !!edit && !ratio;

// The leftover of the old assistant regex: "generate an image of a cat" -> "a cat".
export const imagePrompt = t =>
  String(t).replace(/^(please\s+)?(generate|make|create|draw|design)\s+(me\s+)?(an?\s+)?((brand\s+new|new|another|different|fresh)\s+)?(image|picture|photo|post|visual)?\s*(of|for|with)?\s*/i, '').trim() || String(t);

// A free caption for a finished image, built from data you already have. Save it as data.caption on the image message so
// later requests ("the one with the iced drink") can be resolved by CONTENT. No extra LLM or vision call needed.
export const makeCaption = ({ kind, prompt, instruction, parentCaption } = {}) =>
  clip(kind === 'edit' ? `${parentCaption ? parentCaption + ' | ' : ''}edited: ${instruction || ''}` : prompt, 160);

/* ---------- reading the compact history (req.convo.history) ---------- */
// -> { images: [{id, ratio, kind, note, caption}] oldest first, latestPending, lastTurnImage, turns }
// turns = the last few messages in order, so the LLM can see what was said around each image.
export function readHistory(history, now = Date.now()) {
  const list = Array.isArray(history) ? history : [];
  const images = []; let latest = null; // latest = the newest image-related message: {pending}
  for (const m of list) {
    const d = m?.data || {};
    const ids = (Array.isArray(d.imageIds) ? d.imageIds : []).filter(isUuid);
    if (!(m?.type === 'image' || d.jobId || ids.length)) continue;
    if (ids.length) {
      for (const id of ids) images.push({ id, ratio: d.ratio, kind: d.kind, note: clip(m.text, 80), caption: clip(d.caption || d.prompt || m.text, 160) });
      latest = { pending: false };
    } else { const age = now - Date.parse(m.createdAt); latest = { pending: Number.isFinite(age) && age <= PENDING_MS }; }
  }
  const turns = list.slice(-TURNS_SENT).map(m => {
    const d = m?.data || {};
    const imageId = (Array.isArray(d.imageIds) ? d.imageIds : []).find(isUuid);
    return { role: m?.role || (m?.type === 'image' ? 'assistant' : 'user'), text: clip(m?.text, 200), ...(imageId ? { imageId } : {}) };
  });
  const lastMsg = list.at(-1);
  const ld = lastMsg?.data || {};
  return { images, latestPending: !!latest?.pending, turns,
    lastTurnImage: !!lastMsg && (lastMsg.type === 'image' || !!ld.jobId || (Array.isArray(ld.imageIds) && ld.imageIds.length > 0)) };
}
export const lastTurnWasImage = history => readHistory(history).lastTurnImage;

/* ---------- heuristic path (no LLM, or the LLM failed) ---------- */
const EDIT_VERB = /\b(edit|change|modify|adjust|tweak|fix|replace|remove|swap|recolou?r|update|redo|make (it|the|this|that|him|her|them|everything)|turn (it|the|this|that)|keep (it|the)|instead of|rather than)\b/i;
const REF_PHRASE = /\b(previous|last|latest|earlier|above|same|that|this|first|second|third|original)\s+(image|picture|photo|pic|one|post|version|result|visual)\b/i;
const TWEAK = /\b(background|colou?r|brighter|darker|lighter|bigger|smaller|sharper|blur|filter|crop|zoom|shadow|lighting|font|logo|hot|cold|iced|warmer|cooler)\b/i;
const NEW_REQ = /\b(new|another|different|brand new|fresh|unrelated)\s+(image|picture|photo|one|post|version|design|visual|take)\b|\bfrom scratch\b/i;
// "give me back the first image", "show the last one", "go back to the previous version" = retrieval, not generation
const SHOW = /\b(give me back|bring back|go back to|show( me)?|send( me)?|display|where is|see)\b[^.?!]*\b(image|picture|photo|pic|one|version|post|result)\b/i;
const GEN_VERB = /\b(generate|create|make|draw|design|render|produce)\b[^.?!]*\b(image|picture|photo|post|visual|illustration|poster|banner|logo)\b/i;
const WANTS_LAST = /\b(last|latest|previous|newest|most recent)\b/i;
const VERB_START = /^(change|make|replace|remove|add|turn|swap|set|put|use|give|edit|fix|adjust|brighten|darken|crop|blur|recolou?r|increase|decrease|delete|move|resize)\b/i;

export const looksLikeShow = text => SHOW.test(String(text || '')) && !EDIT_VERB.test(String(text || '').replace(SHOW, ''));
export const looksLikeEdit = text => {
  const t = String(text || '');
  if (NEW_REQ.test(t) && !EDIT_VERB.test(t)) return false;
  return EDIT_VERB.test(t) || REF_PHRASE.test(t) || (TWEAK.test(t) && t.trim().split(/\s+/).length <= 12);
};
// "Edit the previous image with the green background and make the drink hot not iced" -> "Apply this change: the green background and make the drink hot not iced"
// The heuristic can only strip the lead-in, so make sure what is left still reads as an instruction.
const LEAD = /^(please\s+)?(edit|change|modify|update|redo|fix|adjust|tweak)\s+(the\s+)?(previous|last|latest|same|that|this|first|second|third|above|earlier)\s+(image|picture|photo|pic|one|post|version)\s*(with|to|by|so that|:|,|-)?\s*/i;
export const editInstruction = text => {
  const stripped = String(text).replace(LEAD, '').trim() || String(text).trim();
  return clip(VERB_START.test(stripped) ? stripped : `Apply this change: ${stripped}`, 600);
};
const ORDINALS = [[/\b(first|1st|original|earliest)\b/i, 0], [/\b(second|2nd)\b/i, 1], [/\b(third|3rd)\b/i, 2]];
const ordinalIndex = (text, n) => { for (const [re, i] of ORDINALS) if (re.test(text) && i < n) return i; return null; };

/* ---------- the LLM path ---------- */
// WHY the prompt is strict: the model must pick the right ACTION first (many messages are not image requests at all), and for edits
// it must COPY every change the user asked for as short imperative sentences, never summarise or restyle.
export const INTENT_SYSTEM = `You are the router of an Instagram post tool. Decide what the user's latest message wants.
Input JSON: {"message","imageModeOn","turns":[{"role","text","imageId"}],"images":[{"n","id","caption","ratio"}],"newestImageStillGenerating","hasUploadedReference"}.
"turns" are the most recent chat messages in order (imageId marks a turn that produced an image). "images" are all images of this chat, oldest first, with a caption of what each contains.
Return ONLY JSON: {"kind":"generate|edit|show|chat|ask","parentImageId":"","instruction":"","scope":"local|global|text","prompt":"","reply":"","summary":""}
- kind "show": the user wants an EARLIER image displayed again, with no change ("give me back the first image", "show the last one", "go back to the version before the green background"). parentImageId = the id they mean ("last"/"previous" = the newest listed, "first" = the oldest; use the captions and turns to find it by content). No new image is made.
- kind "edit": the user wants an earlier image (or the uploaded reference) CHANGED. parentImageId = the id they mean, or "" when they mean the uploaded reference or just the newest.
  instruction = one or more short imperative sentences, e.g. "Change the background to green. Make the drink hot instead of iced." Start each sentence with a verb (Change, Replace, Remove, Add, Make). Name the object explicitly, never "it/this/that". Copy EVERY change the user asked for, add none, drop none. Never describe the whole scene. For text edits use quotes: Replace the text "SALE" with "OPEN NOW".
  scope: "local" = a specific object or area changes (default); "global" = the whole image changes (style, time of day, season, color grade); "text" = words inside the image change.
- kind "generate": the user clearly wants a NEW picture. prompt = ONE concrete image prompt (subject, lighting, composition, style, no text inside the image).
- kind "chat": a question or comment that needs no image work (what did we make, which image is better, thanks). Put the answer in "reply", using the captions and turns.
- kind "ask": ambiguous (several images could match, or it is unclear whether they want a change or a new image). Put ONE short question in "reply".
- summary = one short sentence of what will happen, e.g. "Editing your last image: green background, hot drink".
- Choose generate or edit only when the user clearly wants a new or changed picture. If unsure, choose ask. Never turn a request to retrieve an image into a generate.
- Use ONLY ids that appear in "images". Never invent one. If newestImageStillGenerating is true do not pick the newest image yourself: leave parentImageId "".`;

// The timer is cleared as soon as the race settles, so a fast LLM never leaves a pending timer behind (and a hung one still rejects).
const withTimeout = (p, ms) => { let t; return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error('intent timeout')), ms); })]).finally(() => clearTimeout(t)); };
const parseJson = s => { const t = String(s ?? '').trim().replace(/^```(?:json)?\s*|\s*```$/g, ''); return JSON.parse(t); };

export function makeImageIntent({ llm = null, timeoutMs = 12000, now = Date.now } = {}) {
  async function askLlm(ctx) {
    if (!llm) return null;
    try {
      const raw = await withTimeout(llm({ system: INTENT_SYSTEM, user: JSON.stringify(ctx), timeoutMs: Math.max(1000, timeoutMs - 1000) }), timeoutMs);
      const o = parseJson(raw);
      if (!KINDS.includes(o?.kind)) return null;
      if ((o.kind === 'chat' || o.kind === 'ask') && !clip(o.reply, 600)) return null; // a text answer with no text is useless: use heuristics
      return { kind: o.kind, parent: isUuid(o.parentImageId) ? o.parentImageId : null, instruction: clip(o.instruction, 600),
        scope: SCOPES.includes(o.scope) ? o.scope : 'local', prompt: clip(o.prompt, 1000), reply: clip(o.reply, 600), summary: clip(o.summary, 140) };
    } catch (e) { console.warn('[imageintent] LLM failed, using heuristics:', e.message); return null; } // message only: never log the request (it may carry image data)
  }

  // -> { blocked:true, text }
  //  | { kind:'show', imageId, summary, source }
  //  | { kind:'chat'|'ask', reply, source }          (reply '' on chat = hand the message to your normal assistant)
  //  | { kind:'edit'|'generate', ..., prompt, ratio?, summary, source }
  async function resolve({ message, mode, ratio, referenceImageId, referenceImage, history, hintPrompt } = {}) {
    const text = clip(message, 500);
    const { images, latestPending, turns } = readHistory(history, now());
    const refId = isUuid(referenceImageId) ? referenceImageId : null; // the user's explicit pick always wins over anything inferred
    const legacy = !refId && typeof referenceImage === 'string' && /^data:image\//.test(referenceImage) ? referenceImage : null;
    const valid = new Set(images.map(i => i.id)); if (refId) valid.add(refId);
    const ordinal = ordinalIndex(text, images.length);
    const wantsNew = mode === 'image' || GEN_VERB.test(text); // only these may ever fall back to a generate

    const ctx = { message: text, imageModeOn: mode === 'image', turns,
      images: images.map((im, i) => ({ n: i + 1, id: im.id, caption: im.caption, ratio: im.ratio })),
      newestImageStillGenerating: latestPending, hasUploadedReference: !!(refId || legacy) };
    let d = await askLlm(ctx), source = 'llm';
    if (!d) { // heuristic path: conservative, it must never turn a non-image message into a generation
      source = 'heuristic';
      const canEdit = images.length > 0 || !!refId || !!legacy || latestPending;
      if (looksLikeShow(text) && images.length) {
        d = { kind: 'show', parent: ordinal != null ? images[ordinal].id : WANTS_LAST.test(text) ? images.at(-1).id : null };
      } else if (looksLikeEdit(text) && canEdit) {
        d = { kind: 'edit', parent: ordinal != null ? images[ordinal].id : null, instruction: editInstruction(text), scope: 'local', prompt: '', summary: '' };
      } else if (wantsNew) {
        d = { kind: 'generate', parent: null, instruction: '', scope: 'local', prompt: '', summary: '' };
      } else {
        return { kind: 'chat', reply: '', source }; // not an image request: let the normal assistant answer
      }
    }

    if (d.kind === 'chat' || d.kind === 'ask') return { kind: d.kind, reply: d.reply, source };

    if (d.kind === 'show') {
      const id = d.parent && valid.has(d.parent) ? d.parent : ordinal != null ? images[ordinal].id : null;
      if (!id) {
        return { kind: 'ask', source, reply: images.length
          ? `Which image do you mean? You have ${images.length} so far; the first one was "${images[0].caption || images[0].note || 'untitled'}".`
          : 'There are no earlier images in this chat yet.' };
      }
      return { kind: 'show', imageId: id, summary: d.summary || 'Here is that image again.', source };
    }

    if (d.kind === 'edit') {
      let parent = null;
      if (refId) parent = refId;
      else if (d.parent && valid.has(d.parent)) parent = d.parent; // an id the LLM made up is dropped here
      else if (legacy) parent = null; // the uploaded picture IS the image to edit
      else if (ordinal != null) parent = images[ordinal].id;
      else if (latestPending) return { blocked: true, text: 'Your previous image is still generating. Ask again in a few seconds and I will edit it.' };
      else if (images.length) parent = images.at(-1).id;
      else d = { ...d, kind: 'generate', prompt: d.prompt || hintPrompt || imagePrompt(text), instruction: '' }; // nothing to edit: do not fail, make a new one
      if (d.kind === 'edit') {
        const instruction = d.instruction || editInstruction(text);
        const parentInfo = images.find(i => i.id === parent);
        const r = RATIO_KEYS.includes(ratio) ? ratio : undefined; // an EDIT never gets a default ratio: no crop unless the user asked
        return { kind: 'edit', parentImageId: parent || undefined, referenceImageId: parent || undefined, referenceImage: parent ? undefined : legacy || undefined,
          instruction, scope: d.scope || 'local', prompt: framedEdit(instruction, d.scope), ratio: r, parentRatio: parentInfo?.ratio, parentCaption: parentInfo?.caption,
          summary: d.summary || `Editing your ${parent ? 'image' : 'uploaded image'}: ${clip(instruction, 90)}`, source };
      }
    }

    // generate. The raw message is only ever used as a prompt when the user clearly asked for an image (image mode or a generate verb).
    const prompt = d.prompt || hintPrompt || (wantsNew ? imagePrompt(text) : '');
    if (!prompt) return { kind: 'ask', reply: 'What would you like the image to show?', source };
    return { kind: 'generate', referenceImageId: refId || undefined, referenceImage: legacy || undefined, prompt: clip(prompt, 1000),
      ratio: RATIO_KEYS.includes(ratio) ? ratio : DEFAULT_RATIO, summary: d.summary || `Creating a new image: ${clip(prompt, 90)}`, source };
  }
  return { resolve };
}

// The exact job params of contract 4.1. Extra keys are passed through the queue untouched; undefined keys are left out.
// Returns null for kinds that must NOT enqueue a job (show / chat / ask).
export function jobParams(d, { conversationId, overlayText } = {}) {
  if (!isJobKind(d)) return null;
  const p = { prompt: d.prompt, n: 1 };
  if (d.ratio) p.ratio = d.ratio;
  if (overlayText) p.overlayText = clip(overlayText, 120);
  if (d.kind === 'edit') { p.edit = true; p.instruction = d.instruction; }
  if (d.referenceImageId) p.referenceImageId = d.referenceImageId;
  if (d.referenceImage) p.referenceImage = d.referenceImage;
  p.meta = { kind: d.kind, prompt: d.prompt };
  if (conversationId) p.meta.conversationId = conversationId;
  if (d.parentImageId) p.meta.parentImageId = d.parentImageId;
  if (d.kind === 'edit') { p.meta.instruction = d.instruction; p.meta.scope = d.scope || 'local'; }
  // free caption, stored with the finished image so later requests can find it by content
  p.meta.caption = makeCaption({ kind: d.kind, prompt: d.kind === 'edit' ? d.instruction : d.prompt, instruction: d.instruction, parentCaption: d.parentCaption });
  return p;
}