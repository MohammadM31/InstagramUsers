// Command Center chat helpers. Pure (no React, no fetch) so test/chatUi.test.js can import them in Node. Only erasable TypeScript syntax.
// Kept free of imports on purpose: web/tsconfig has no allowImportingTsExtensions, and Node needs the .ts extension to import a sibling.

export type Role = 'user' | 'assistant';
export type Msg = { id: string; role: Role; type: string; text: string; data?: any; serverId?: string };
export type MsgPatch = { type?: string; text?: string; serverId?: string; data?: any };

export const RATIOS = ['1:1', '4:5', '9:16'];

// ---- scrolling -------------------------------------------------------------------------------------------------------
// The thread only follows new content while the reader is already (almost) at the bottom. Scrolled up = leave them alone.
export const NEAR_BOTTOM_PX = 80;
export function nearBottom(el: { scrollHeight: number; scrollTop: number; clientHeight: number } | null | undefined, px = NEAR_BOTTOM_PX): boolean {
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight <= px;
}
// forced = the person just sent something: always show it.
export const shouldStick = (el: { scrollHeight: number; scrollTop: number; clientHeight: number } | null | undefined, forced = false): boolean => forced || nearBottom(el);

// ---- stable message ids ----------------------------------------------------------------------------------------------
// React key for a message. Server id when we have one ("m12"), otherwise a client id ("c..."). Never an array index.
let counter = 0;
export function newClientId(): string {
  counter += 1;
  return 'c' + Date.now().toString(36) + counter.toString(36) + Math.random().toString(36).slice(2, 6);
}
export function messageId(serverId?: string | number | null): string {
  const s = serverId === null || serverId === undefined ? '' : String(serverId).trim();
  return s ? 'm' + s : newClientId();
}

// ---- immutable updates -----------------------------------------------------------------------------------------------
// Replace ONE message (matched by id) and keep every other message object as it was. `data` is merged, not replaced.
// Unknown id: the same list comes back, so a late poll for a message that is gone changes nothing.
export function patchMessage(list: Msg[], id: string, patch: MsgPatch): Msg[] {
  let hit = false;
  const out = list.map(m => {
    if (m.id !== id) return m;
    hit = true;
    const { data, ...rest } = patch;
    return { ...m, ...rest, data: data === undefined ? m.data : { ...(m.data || {}), ...data } };
  });
  return hit ? out : list;
}
// Append, never overwrite: an id that is already in the list is left alone.
export function appendMessage(list: Msg[], msg: Msg): Msg[] {
  return list.some(m => m.id === msg.id) ? list : [...list, msg];
}

// ---- image polling ---------------------------------------------------------------------------------------------------
// GET /api/content/image/:jobId -> patch for the ONE placeholder that owns that job (contract 4.2).
export function pollPatch(s: any, elapsed: number): { done: boolean; patch: MsgPatch } {
  const st = String(s?.status ?? '');
  if (st === 'done') {
    const ids: string[] = Array.isArray(s.imageIds) ? s.imageIds.filter((x: unknown) => typeof x === 'string' && x) : [];
    const inline: string[] | undefined = !ids.length && Array.isArray(s.images) ? s.images.filter((x: unknown) => typeof x === 'string' && x) : undefined;
    if (!ids.length && !(inline && inline.length)) return { done: true, patch: { data: { status: 'failed', error: 'The image finished but could not be found.', elapsed } } };
    return { done: true, patch: { data: { status: 'done', imageIds: ids, inline, error: undefined, elapsed } } };
  }
  if (st === 'failed') return { done: true, patch: { data: { status: 'failed', error: String(s?.error || 'Image generation failed'), elapsed } } };
  return { done: false, patch: { data: { status: 'pending', elapsed } } };
}
export function mergePolled(list: Msg[], id: string, s: any, elapsed: number): { list: Msg[]; done: boolean } {
  const r = pollPatch(s, elapsed);
  return { list: patchMessage(list, id, r.patch), done: r.done };
}
export const POLL_MAX = 90; // 30 x 2s, then 60 x 4s: about 5 minutes. The server marks a job failed after 10.
export const pollDelay = (i: number): number => (i < 30 ? 2000 : 4000);

// ---- request body for POST /api/assistant (contract 4.1) -------------------------------------------------------------
export type SendOpts = { text: string; conversationId?: string | null; image?: boolean; ratio?: string; referenceImageId?: string | null; overlayText?: string | null };
export function buildAssistantBody(o: SendOpts): Record<string, any> {
  const b: Record<string, any> = { message: o.text };
  if (o.conversationId) b.conversationId = o.conversationId;
  if (o.image) {
    b.mode = 'image';
    b.ratio = RATIOS.includes(String(o.ratio)) ? o.ratio : '1:1';
    const ov = String(o.overlayText ?? '').trim();
    if (ov) b.overlayText = ov.slice(0, 200);
  }
  if (o.referenceImageId) b.referenceImageId = o.referenceImageId;
  return b;
}

// What a retry of a failed image message re-sends: the user line before it, plus the ratio and reference it used.
export function retryParams(list: Msg[], id: string): { text: string; ratio?: string; referenceImageId?: string; overlayText?: string } | null {
  const i = list.findIndex(m => m.id === id);
  if (i < 0) return null;
  const d = list[i].data || {};
  let text = '';
  for (let k = i - 1; k >= 0; k--) if (list[k].role === 'user') { text = list[k].text; break; }
  if (!text.trim()) text = String(d.instruction || '');
  if (!text.trim()) return null;
  return { text, ratio: d.ratio, referenceImageId: d.referenceImageId || d.parentImageId, overlayText: d.overlayText };
}

export const imageIdsOf = (m: Msg | null | undefined): string[] => (Array.isArray(m?.data?.imageIds) ? m!.data.imageIds.filter((x: unknown) => typeof x === 'string' && x) : []);

// ---- conversations ---------------------------------------------------------------------------------------------------
// A message from GET /api/conversations/:id -> the shape the thread renders. Image messages always carry imageIds + status.
export function fromServerMessage(sm: any): Msg {
  const role: Role = sm?.role === 'user' ? 'user' : 'assistant';
  const data = sm && typeof sm.data === 'object' && sm.data ? sm.data : {};
  const type = role === 'user' ? 'info' : String(sm?.type || 'info');
  const ids = Array.isArray(data.imageIds) ? data.imageIds : [];
  const d = type === 'image' ? { ...data, imageIds: ids, status: data.status || (ids.length ? 'done' : 'pending') } : data;
  return { id: messageId(sm?.id), serverId: sm?.id !== undefined && sm?.id !== null ? String(sm.id) : undefined, role, type, text: String(sm?.text ?? ''), data: d };
}

// Short Instagram-style age: now, 5m, 3h, 2d, 3w, then a date.
export function relTime(iso: string | null | undefined, now = Date.now()): string {
  const t = Date.parse(String(iso ?? ''));
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return 'now';
  const m = Math.round(s / 60); if (m < 60) return m + 'm';
  const h = Math.round(m / 60); if (h < 24) return h + 'h';
  const d = Math.round(h / 24); if (d < 7) return d + 'd';
  if (d < 35) return Math.round(d / 7) + 'w';
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ---- deep links (contract 4.7) ---------------------------------------------------------------------------------------
// "#cc=<conversationId>&ref=<imageId>" -> {cc, ref}. Anything else ("#settings", "#albums", junk) -> null, so the hash is left for App.tsx.
const ID = /^[A-Za-z0-9_-]{6,64}$/;
export function parseHash(hash: string | null | undefined): { cc?: string; ref?: string } | null {
  const h = String(hash ?? '').replace(/^#/, '');
  if (!h) return null;
  const out: { cc?: string; ref?: string } = {};
  for (const part of h.split('&')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const k = part.slice(0, i);
    let v = part.slice(i + 1);
    try { v = decodeURIComponent(v); } catch { return null; }
    if ((k === 'cc' || k === 'ref') && ID.test(v)) out[k as 'cc' | 'ref'] = v;
  }
  return out.cc || out.ref ? out : null;
}