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

// The picture itself is large. Send it only when the message is about acting on it.
export function pagePayload(text: string): PageWork {
  const act = /\b(save|schedule|album|folder|template|reel|post|this|these|current|generation|tags|hashtag|caption|image|photo)\b/i.test(text);
  if (act) return { ...work };
  const { image, ...rest } = work;
  return rest;
}
