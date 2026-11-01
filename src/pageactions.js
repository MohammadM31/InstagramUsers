// Pure reading of "what is on the page" and of commands the assistant can carry out.
// No database. assistant.js decides, then albums.js / scheduled_posts do the write.

export function summarizePage(page) {
  if (!page || typeof page !== 'object') return '';
  const bits = [];
  if (page.name) bits.push(`The user is on the ${page.name} page.`);
  if (page.prompt) bits.push(`Image prompt: ${String(page.prompt).slice(0, 300)}`);
  if (page.ratio) bits.push(`Ratio: ${page.ratio}`);
  const c = Array.isArray(page.captions) ? page.captions[0] : null;
  if (c && (c.hook || c.body || c.cta)) bits.push(`Latest caption: ${[c.hook, c.body, c.cta].filter(Boolean).join(' ').slice(0, 500)}`);
  const tags = flatTags(page).slice(0, 30);
  if (tags.length) bits.push(`Hashtags: ${tags.join(' ')}`);
  if (page.imageCount) bits.push(`Images generated on this page: ${page.imageCount}`);
  if (page.attached) bits.push('The user attached a reference image in the assistant.');
  return bits.join('\n');
}

export function flatTags(page) {
  if (!page?.tags || typeof page.tags !== 'object') return [];
  return Object.values(page.tags).flat().filter(t => typeof t === 'string' && t.trim());
}

export function captionFromPage(page) {
  const c = Array.isArray(page?.captions) ? page.captions[0] : null;
  const cap = c ? [c.hook, c.body, c.cta].filter(Boolean).join('\n') : String(page?.prompt || '').trim();
  const tags = flatTags(page).map(t => (t.startsWith('#') ? t : '#' + t.replace(/^#+/, '')));
  return (cap + (tags.length ? '\n' + tags.join(' ') : '')).trim().slice(0, 2200);
}

export function hasWork(page) {
  return !!(page && (page.imageCount || page.prompt || (Array.isArray(page.captions) && page.captions.length) || flatTags(page).length || page.attached));
}

// A comment on the work that is actually on the page, used when no model is available.
export function localOpinion(page) {
  if (!hasWork(page)) return 'Nothing has been generated on this page yet. Make a caption, hashtags or an image, then ask again.';
  const bits = [];
  if (page.imageCount) bits.push(`You have ${page.imageCount} image${page.imageCount > 1 ? 's' : ''} from “${String(page.prompt || 'the prompt').slice(0, 140)}”${page.ratio ? ` at ${page.ratio}` : ''}.`);
  else bits.push('No image has been generated on this page yet.');
  const c = page.captions?.[0];
  if (c?.hook || c?.body) bits.push(`The latest caption starts “${String(c.hook || c.body).slice(0, 140)}”.`);
  else bits.push('No caption has been generated yet.');
  const tags = flatTags(page);
  if (tags.length) bits.push(`The tags are ${tags.slice(0, 12).join(' ')}.`);
  else bits.push('No hashtags have been generated yet.');
  return bits.join(' ');
}

export function aboutCurrentWork(text) {
  return /\b(what do you think|current|these|this generation|the tags|the hashtags|the caption|the image|this image)\b/i.test(String(text || ''));
}

export function wantsSchedule(text) {
  const t = String(text || '');
  if (/\bschedule\b/i.test(t)) return true;
  return /\b(create|make)\b[^.]{0,48}\bpost\b/i.test(t) && /\b(schedule|tags?|image|generation|background|caption)\b/i.test(t);
}

// "1pm today", "1:30 pm", "13:00" is not required. Returns an ISO time or null.
export function clockFromText(text, now = new Date()) {
  const m = String(text || '').match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (h < 1 || h > 12 || min > 59) return null;
  const ap = m[3].toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  const d = new Date(now.getTime());
  if (/\btomorrow\b/i.test(text)) d.setDate(d.getDate() + 1);
  d.setHours(h, min, 0, 0);
  return d.toISOString();
}

export function categoryNamed(text) {
  const t = String(text || '').toLowerCase();
  if (/\breels?\b/.test(t)) return 'reel';
  if (/\bphotos?\b/.test(t)) return 'photo';
  if (/\bcarousels?\b/.test(t)) return 'carousel';
  if (/\bstor(?:y|ies)\b/.test(t)) return 'story';
  return null;
}

// Save into a named folder (Templates) or a built-in album category (Reels). Null when this is not a save command.
export function albumAsk(text) {
  const t = String(text || '').toLowerCase();
  if (!/\b(save|put|add|store)\b/.test(t)) return null;
  if (!/\b(album|folder|template|reel|photo|carousel|story|stories)\b/.test(t)) return null;
  if (/\btemplates?\b/.test(t)) return { kind: 'folder', name: 'Templates' };
  const category = categoryNamed(t);
  if (category) return { kind: 'category', category };
  return { kind: 'folder', name: 'Templates' };
}

export function affirmsCreate(text) {
  return /^(yes|yeah|yep|sure|ok|okay|create it|create the folder|make it|do it|go ahead)\b/i.test(String(text || '').trim());
}
