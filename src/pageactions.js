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
  const where = page?.name ? `You are on ${page.name}. ` : '';
  if (!hasWork(page)) return where + 'Nothing has been generated on Posts yet. Make a caption, hashtags or an image, then ask again.';
  const bits = [];
  if (page.imageCount) bits.push(`You have ${page.imageCount} image${page.imageCount > 1 ? 's' : ''} from “${String(page.prompt || 'the prompt').slice(0, 140)}”${page.ratio ? ` at ${page.ratio}` : ''}.`);
  else bits.push('No image has been generated on Posts yet.');
  const c = page.captions?.[0];
  if (c?.hook || c?.body) bits.push(`The latest caption starts “${String(c.hook || c.body).slice(0, 140)}”.`);
  else bits.push('No caption has been generated yet.');
  const tags = flatTags(page);
  if (tags.length) bits.push(`The tags are ${tags.slice(0, 12).join(' ')}.`);
  else bits.push('No hashtags have been generated yet.');
  return where + bits.join(' ');
}

// The model sometimes answers with a generic tip and never mentions the draft. That is not a comment on the work.
export function ignoredWork(said, page) {
  const s = String(said || '');
  if (/does not support|instagram app/i.test(s)) return true;
  if (!hasWork(page)) return false;
  const words = [];
  if (page.prompt) words.push(...String(page.prompt).toLowerCase().split(/\W+/));
  const c = page.captions?.[0];
  if (c?.hook) words.push(...String(c.hook).toLowerCase().split(/\W+/));
  for (const t of flatTags(page).slice(0, 12)) words.push(...String(t).replace(/^#+/, '').toLowerCase().split(/\W+/));
  const useful = [...new Set(words.filter(w => w.length > 3))];
  if (!useful.length) return !/\b(caption|tag|hashtag|image|photo|picture|generation)\b/i.test(s);
  const hay = s.toLowerCase();
  return !useful.some(w => hay.includes(w));
}

export function aboutCurrentWork(text) {
  return /\b(what do you think|current|these|this generation|these generations|the tags|the hashtags|my tags|my hashtags|the caption|my caption|the image|this image|my image|my generation)\b/i.test(String(text || ''));
}

// A small change to the image already on Posts. A brand-new picture ("generate a darker cafe") is not this.
export function imageAdjust(text) {
  const t = String(text || '');
  if (/\b(generate|draw|design|new image|another image)\b/i.test(t)) return null;
  if (/\b(darker|dimmer|darken)\b/i.test(t)) return 'darker';
  if (/\b(brighter|lighter|lighten)\b/i.test(t)) return 'brighter';
  if (/\bwarmer\b/i.test(t)) return 'warmer';
  if (/\bcooler\b/i.test(t)) return 'cooler';
  if (/\b(more contrast|higher contrast)\b/i.test(t)) return 'contrast';
  if (/\b(less contrast|softer)\b/i.test(t)) return 'softer';
  return null;
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
  if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
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

function cleanFolderName(s) {
  return String(s || '').replace(/^["'“]+|["'”.,!]+$/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

// "create an album named template" / "make a template folder". Null when this is not a new-folder command.
// A save ("save it to the reels album") is albumAsk, not this.
export function folderCreate(text) {
  const raw = String(text || '').trim();
  if (!/\b(create|make|new)\b/i.test(raw) || !/\b(albums?|folders?)\b/i.test(raw)) return null;
  const named = raw.match(/\b(?:named|called|titled)\s+["'“]?(.+?)["'”]?(?=\s+(?:in|on|under|inside|for|to|and)\b|[.?!,]|$)/i);
  if (named) {
    const name = cleanFolderName(named[1]);
    if (name) return { name };
  }
  if (/\btemplates?\s+(?:album|folder)s?\b/i.test(raw)) return { name: 'Templates' };
  const trailing = raw.match(/\b(?:album|folder)s?\s+["'“]?([A-Za-z0-9][\w .'-]{0,40})/i);
  if (trailing && !/^(named|called|titled|in|on|for|the|a|an|tab|tabs)$/i.test(trailing[1])) {
    const name = cleanFolderName(trailing[1].replace(/\s+\b(?:in|on|under|inside|for|to|and)\b[\s\S]*$/i, ''));
    if (name && !/^(tab|tabs|page|pages)$/i.test(name)) return { name };
  }
  return null;
}

// The album they named as the destination. "this photo" is the picture, not the Photos album.
function destinationName(raw) {
  const named = String(raw).match(/\b(?:named|called|titled)\s+["'“]?(.+?)["'”]?(?=\s+(?:in|on|under|inside|or|for|to|and)\b|[.?!,]|$)/i);
  if (named) return { explicit: true, name: cleanFolderName(named[1]) };
  const dest = String(raw).match(/\b(?:into|to|in)\s+(?:the\s+|an?\s+)?["'“]?([a-z0-9][\w'’-]*(?:\s+[\w'’-]+){0,3})["'”]?\s+(?:albums?|folders?)\b/i);
  if (dest) return { explicit: false, name: cleanFolderName(dest[1]) };
  const bare = String(raw).match(/\b(?:into|to|in)\s+(?:the\s+)?(reels?|photos?|carousels?|stor(?:y|ies)|templates?)\b/i);
  if (bare) return { explicit: false, name: cleanFolderName(bare[1]) };
  return null;
}

function albumFromName(got) {
  if (!got?.name) return null;
  if (got.explicit) return { kind: 'folder', name: got.name };
  const category = categoryNamed(got.name);
  if (category) return { kind: 'category', category };
  if (/^templates?$/i.test(got.name)) return { kind: 'folder', name: 'Templates' };
  return { kind: 'folder', name: got.name.charAt(0).toUpperCase() + got.name.slice(1) };
}

// Save into a named folder (Reference, Templates) or a built-in album category (Reels). Null when this is not a save command.
export function albumAsk(text) {
  const t = String(text || '').toLowerCase();
  if (!/\b(save|put|add|store)\b/.test(t)) return null;
  if (!/\b(album|folder|template|reel|photo|carousel|story|stories)\b/.test(t)) return null;
  return albumFromName(destinationName(text));
}

export function affirmsCreate(text) {
  return /^(yes|yeah|yep|sure|ok|okay|create it|create the folder|make it|do it|go ahead)\b/i.test(String(text || '').trim());
}

// A picture request. Image mode is an explicit one. "create a post" and "create an album" are not.
export function wantsGeneratedImage(text, mode) {
  if (mode === 'image') return true;
  const t = String(text || '');
  if (/\b(album|folder)\b/i.test(t)) return false;
  if (/\b(generate|draw|design)\b/i.test(t) && /\b(image|picture|photo|visual)\b/i.test(t)) return true;
  if (/\b(make|create)\b/i.test(t) && /\b(image|picture|photo|visual)\b/i.test(t) && !/\bpost\b/i.test(t)) return true;
  return false;
}

// Prompt sent to the image model. A vague "from this attached image" becomes an edit of that photo.
export function imageRequestPrompt(text, hasRef) {
  const raw = String(text || '').trim();
  const stripped = raw.replace(/^(please\s+)?(generate|make|create|draw|design)\s+(me\s+)?(an?\s+)?(image|picture|photo|post|visual)?\s*(of|for|with)?\s*/i, '').trim();
  if (hasRef && (!stripped || /^(referenced|based|from|using|with|this|the|attached|image|photo)\b/i.test(stripped)))
    return 'Create a polished Instagram post from the attached photo. Keep the subject recognizable.';
  return (stripped || raw).slice(0, 1000);
}
