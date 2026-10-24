// Image library reads for the chat (contract 4.3): batched thumbnails and full images, cached for the page's lifetime.
import {api} from '../api';

const thumbs = new Map<string, string>(); // id -> data URL; '' = looked up and not available (not ours / gone)
const fulls = new Map<string, string>();
let queue = new Set<string>();
let waiters: Array<() => void> = [];
let timer: any = null;

export const cachedThumb = (id: string): string | undefined => thumbs.get(id) || undefined;
export const rememberThumb = (id: string, thumb: string | undefined | null) => { if (id && thumb) thumbs.set(id, thumb); };
export const thumbMissing = (id: string): boolean => thumbs.get(id) === '';

async function flush() {
  timer = null;
  const ids = [...queue]; queue = new Set();
  const ws = waiters; waiters = [];
  for (let i = 0; i < ids.length; i += 40) {
    const chunk = ids.slice(i, i + 40);
    try {
      const r = await api<any>('/images?limit=40&ids=' + chunk.map(encodeURIComponent).join(','));
      const got = new Set<string>();
      for (const im of r.images || []) if (im?.id && im.thumb) { thumbs.set(im.id, im.thumb); got.add(im.id); }
      for (const id of chunk) if (!got.has(id)) thumbs.set(id, '');
    } catch { /* network error: leave uncached so the next render can try again */ }
  }
  ws.forEach(w => w());
}

// Ids asked for in the same tick go out as ONE request (max 40 per request), so opening a long conversation is not one call per image.
export function loadThumbs(ids: string[]): Promise<void> {
  const need = [...new Set(ids)].filter(id => id && !thumbs.has(id));
  if (!need.length) return Promise.resolve();
  need.forEach(id => queue.add(id));
  return new Promise<void>(res => { waiters.push(res); if (!timer) timer = setTimeout(flush, 15); });
}

// Full image, fetched only when the person opens it.
export async function fullImage(id: string): Promise<string> {
  const hit = fulls.get(id);
  if (hit) return hit;
  const r = await api<any>('/images/' + encodeURIComponent(id));
  if (!r?.dataUrl) throw new Error('Image not available');
  if (fulls.size > 12) fulls.delete(fulls.keys().next().value as string);
  fulls.set(id, r.dataUrl);
  return r.dataUrl;
}