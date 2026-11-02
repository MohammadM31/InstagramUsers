// What the user has open right now. The assistant bar on every tab reads this, so a chat on Business
// can still see the caption, tags and image they just made on Posts. It lives outside React because
// leaving a page unmounts that page.

export type PageCaption = { hook?: string; body?: string; cta?: string };
export type PageWork = {
  name: string;
  prompt?: string;
  ratio?: string;
  overlay?: string;
  captions?: PageCaption[];
  tags?: Record<string, string[]>;
  imageCount?: number;
  image?: string;
  imageUrl?: string;
  attached?: boolean;
};

let work: PageWork = { name: 'Business' };
const imageListeners = new Set<(image: string) => void>();

export function onPageImage(fn: (image: string) => void) {
  imageListeners.add(fn);
  return () => { imageListeners.delete(fn); };
}

export function replacePageImage(image: string) {
  if (!image.startsWith('data:image/')) return;
  work = { ...work, image, imageCount: Math.max(1, work.imageCount || 0) };
  imageListeners.forEach(fn => fn(image));
}

export function setPageName(name: string) {
  work = { ...work, name: name || 'Business' };
}

export function setPageWork(partial: Partial<PageWork>) {
  const { name, ...rest } = partial;
  work = { ...work, ...rest, name: name || work.name };
}

export function getPageWork(): PageWork {
  return work;
}

// The picture itself is large. Send it only when the message saves, schedules, or answers "create that album?".
export function pagePayload(text: string): PageWork {
  const t = text.trim();
  const withImage = /\b(save|schedule|album|folder|template|reel|darker|brighter|lighter|warmer|cooler|contrast|softer|dim)\b/i.test(t)
    || /^(yes|yeah|yep|sure|ok|okay|create it|create the folder|make it|do it|go ahead)\b/i.test(t)
    || (/\b(create|make)\b/i.test(t) && /\bpost\b/i.test(t));
  if (withImage) return { ...work };
  const { image, ...rest } = work;
  return rest;
}
