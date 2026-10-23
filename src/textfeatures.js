// Phase I.1.1: pure caption/tag feature extraction. No database, no network.
// Everything keyword-based (call to action) is an ESTIMATE, English/Arabic only.

const TAG_CHAR = '[\\p{L}\\p{M}\\p{N}_]';
const WORD_RE = new RegExp(TAG_CHAR, 'u');
const URL_RE = /(?:https?:\/\/|www\.)\S+/giu;
const MAX_TAGS = 30;

export const CTA_KEYWORDS = [
  'link in bio', 'link in my bio', 'dm me', 'dm us', 'comment below', 'tag a friend',
  'tag someone', 'follow us', 'follow me', 'share this', 'save this', 'sign up',
  'shop now', 'order now', 'book now', 'call us', 'swipe', 'subscribe', 'double tap',
  'رابط البايو', 'الرابط في البايو', 'تابعنا', 'تابعونا', 'اطلب', 'احجز', 'اتصل',
  'تواصل', 'علق', 'شارك', 'اشترك',
];

export function normalizeText(s) {
  return String(s ?? '').normalize('NFKC');
}

function stripUrls(s) {
  return s.replace(URL_RE, ' ');
}

// Returns every accepted hashtag occurrence in order (not deduped, not capped).
function scanHashtags(text) {
  const re = new RegExp(`#(${TAG_CHAR}+)`, 'gu');
  const out = [];
  let lastEnd = -1;
  let m;
  while ((m = re.exec(text)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    const prev = start > 0 ? text[start - 1] : '';
    const glued = start === lastEnd; // "#a#b"
    lastEnd = end;
    if (prev && WORD_RE.test(prev) && !glued) continue; // "abc#def"
    const tag = m[1].toLowerCase();
    if (/^[\p{N}_]+$/u.test(tag)) continue; // #1, #2024, #_
    out.push({ tag, start });
  }
  return out;
}

export function extractHashtags(caption, { max = MAX_TAGS } = {}) {
  const text = stripUrls(normalizeText(caption));
  const seen = new Set();
  const tags = [];
  for (const { tag } of scanHashtags(text)) {
    if (seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
    if (tags.length >= max) break;
  }
  return tags;
}

export function extractMentions(caption) {
  const text = stripUrls(normalizeText(caption));
  const re = new RegExp(`(?<!${TAG_CHAR}|[.@])@(${TAG_CHAR}+(?:\\.${TAG_CHAR}+)*)`, 'gu');
  const seen = new Set();
  const out = [];
  for (const m of text.matchAll(re)) {
    const h = m[1].toLowerCase();
    if (!seen.has(h)) { seen.add(h); out.push(h); }
  }
  return out;
}

export function countEmoji(caption) {
  const text = normalizeText(caption);
  const pict = (text.match(/\p{Extended_Pictographic}/gu) || []).length;
  const flags = Math.floor((text.match(/\p{Regional_Indicator}/gu) || []).length / 2);
  return pict + flags;
}

// 'none' | 'inline' | 'trailing' | 'mixed'. trailing = every tag sits in the final run of tag-only tokens.
export function tagBlockType(caption) {
  const text = stripUrls(normalizeText(caption));
  const total = scanHashtags(text).length;
  if (total === 0) return 'none';
  const tagToken = new RegExp(`^(?:#${TAG_CHAR}+)+$`, 'u');
  const filler = /^[.\-–—•·|*]+$/u;
  const lines = text.split(/\r\n|\r|\n/).map((l) => l.split(/\s+/).filter(Boolean)).filter((t) => t.length);
  let trailing = 0;
  for (let li = lines.length - 1; li >= 0; li--) {
    const tokens = lines[li];
    let run = 0;
    let allTags = true;
    for (let i = tokens.length - 1; i >= 0; i--) {
      if (tagToken.test(tokens[i])) run += scanHashtags(tokens[i]).length;
      else if (filler.test(tokens[i])) continue;
      else { allTags = false; break; }
    }
    // Only the last line may end with a partial tag run ("text #a #b"); earlier lines must be tag-only.
    if (allTags || li === lines.length - 1) trailing += run;
    if (!allTags) break;
  }
  if (trailing === total) return 'trailing';
  if (trailing === 0) return 'inline';
  return 'mixed';
}

export function captionFeatures(caption) {
  const raw = String(caption ?? '');
  const text = normalizeText(raw);
  const lower = text.toLowerCase();
  return {
    length: Array.from(raw).length,
    lineCount: raw.trim() === '' ? 0 : raw.split(/\r\n|\r|\n/).length,
    emojiCount: countEmoji(raw),
    hasQuestion: /[?؟]/u.test(text),
    hasCta: CTA_KEYWORDS.some((k) => lower.includes(k)), // estimate
    tagCount: extractHashtags(raw).length,
    tagBlock: tagBlockType(raw),
    mentionCount: extractMentions(raw).length,
  };
}
