// Roadmap A.2: pure comment rules. No I/O here, so everything is unit-tested without a database or Meta.
// Sentiment and themes are KEYWORD ESTIMATES, always labelled as such (roadmap rule: label estimates). They read the comment text only.

export const RETENTION_DAYS = 90; // decision D6: comment text is kept 90 days
export const ALERT_MIN_QUESTIONS = 3, ALERT_WINDOW_H = 24; // roadmap A.2: a post under 24 h with 3+ unanswered questions
export const SENTIMENT_LABEL = 'Estimate from keywords and emoji, not a reading of tone. Short, sarcastic or mixed-language comments are often misread.';

const tokens = s => String(s || '').toLowerCase().match(/[\p{L}\p{N}']+/gu) || [];
const sameUser = (a, b) => !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();

// ---- Graph -> row ----
// Instagram comment: { id, text, username, timestamp, like_count, replies: { data: [{ id, username, timestamp }] } }.
// Returns null for the owner's own top-level comments and for anything unusable. A missing like_count is NULL, never 0.
export function mapComment(c, ownerUsername) {
  if (!c || !c.id || typeof c.text !== 'string' || !c.text.trim() || !c.timestamp) return null;
  if (sameUser(c.username, ownerUsername)) return null;
  const replied = (c.replies?.data || []).some(r => sameUser(r.username, ownerUsername));
  return {
    ig_comment_id: String(c.id), username: c.username ? String(c.username).slice(0, 60) : null, text: c.text.trim().slice(0, 2200),
    likes: Number.isFinite(c.like_count) ? c.like_count : null, posted_at: c.timestamp, owner_replied: replied,
  };
}

// ---- questions ----
const Q_START = new Set(['how', 'what', 'where', 'when', 'why', 'which', 'who', 'price', 'prices', 'cost', 'link', 'كم', 'كيف', 'وين', 'شو', 'ليش', 'متى', 'هل', 'أين', 'ما', 'ماذا', 'لماذا']);
// A question mark anywhere, or a comment that opens with a question word. "Do/is/can" alone are not used: "Do it!" is not a question.
export function looksLikeQuestion(text) {
  const s = String(text || '');
  if (/[?؟]/.test(s)) return true;
  const t = tokens(s);
  return t.length >= 2 && Q_START.has(t[0]);
}
export const questionsFromComments = comments => (comments || []).filter(c => looksLikeQuestion(c.text) && !c.owner_replied);

// ---- sentiment (keyword estimate) ----
const POS = new Set(['love', 'loved', 'great', 'amazing', 'awesome', 'beautiful', 'perfect', 'best', 'good', 'nice', 'wow', 'thanks', 'thank', 'gorgeous', 'delicious', 'fantastic', 'excellent', 'incredible', 'yum', 'congrats', 'stunning',
  'حلو', 'رائع', 'ممتاز', 'جميل', 'شكرا', 'مبدع', 'تحفة', 'يعطيك', 'العافية', 'بيجنن']);
const NEG = new Set(['bad', 'worst', 'terrible', 'awful', 'hate', 'hated', 'disappointed', 'disappointing', 'overpriced', 'expensive', 'scam', 'fake', 'rude', 'slow', 'broken', 'ugly', 'boring', 'refund', 'poor',
  'سيء', 'غالي', 'نصب', 'مزيف', 'بشع', 'سيئ', 'ممل']);
const POS_EMOJI = /[❤😍🥰😊🙌👏🔥💯✨👍😋🤩💕💖😘]/u, NEG_EMOJI = /[😡😠👎😞😒🤮💩😤😢]/u;
const NEGATORS = new Set(['not', 'no', "don't", "isn't", "wasn't", 'never', 'مش', 'ما']);

export function sentimentHeuristic(text) {
  const t = tokens(text);
  let score = 0;
  t.forEach((w, i) => {
    const negated = NEGATORS.has(t[i - 1]); // the word right before: "not good" counts against, "not bad" counts for
    if (POS.has(w)) score += negated ? -1 : 1;
    else if (NEG.has(w)) score += negated ? 1 : -1;
  });
  if (POS_EMOJI.test(text || '')) score += 1;
  if (NEG_EMOJI.test(text || '')) score -= 1;
  return score > 0 ? 'positive' : score < 0 ? 'negative' : 'neutral';
}

// ---- people and themes ----
export function topCommenters(comments, limit = 5) {
  const m = new Map();
  for (const c of comments || []) {
    if (!c.username) continue;
    const e = m.get(c.username) || { username: c.username, comments: 0, likes: 0 };
    e.comments++; e.likes += c.likes || 0; m.set(c.username, e);
  }
  return [...m.values()].sort((a, b) => b.comments - a.comments || b.likes - a.likes || a.username.localeCompare(b.username)).slice(0, limit);
}

const STOP = new Set(['the', 'and', 'for', 'you', 'your', 'this', 'that', 'with', 'are', 'was', 'have', 'has', 'had', 'will', 'can', 'its', "it's", 'but', 'not', 'just', 'too', 'from', 'what', 'how', 'when', 'where', 'why', 'who', 'they', 'them', 'there', 'here', 'out', 'all', 'our', 'their', 'one', 'get', 'got', 'would', 'could', 'should', 'please', 'pls', 'much', 'very', 'really', 'more', 'than', 'then', 'about', 'been', 'were', 'also', 'any', 'only', 'like', 'love', 'amazing', 'great', 'nice', 'wow',
  'في', 'من', 'على', 'عن', 'ان', 'أن', 'هذا', 'هذه', 'ما', 'مع', 'يا']);
// Words that recur across different comments. A keyword count, not topic modelling: the card says so.
export function themesFromComments(comments, { limit = 5, minComments = 2 } = {}) {
  const seen = new Map();
  for (const c of comments || []) for (const w of new Set(tokens(c.text))) {
    if (w.length < 3 || STOP.has(w) || /^\d+$/.test(w)) continue;
    seen.set(w, (seen.get(w) || 0) + 1);
  }
  return [...seen.entries()].filter(([, n]) => n >= minComments).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([word, comments]) => ({ word, comments }));
}

// ---- the card ----
// comments: rows {username,text,likes,posted_at,owner_replied}. Returns the numbers plus one plain sentence. Never claims more than the text shows.
export function commentInsights(comments) {
  const list = comments || [];
  const sentiment = { positive: 0, negative: 0, neutral: 0 };
  for (const c of list) sentiment[sentimentHeuristic(c.text)]++;
  const qs = list.filter(c => looksLikeQuestion(c.text));
  const unanswered = qs.filter(c => !c.owner_replied);
  const people = new Set(list.map(c => c.username).filter(Boolean)).size;
  const summary = !list.length ? 'No comments stored for this post.'
    : `${list.length} comment${list.length === 1 ? '' : 's'}${people ? ` from ${people} account${people === 1 ? '' : 's'}` : ''}. Keyword estimate: ${sentiment.positive} positive, ${sentiment.negative} negative, ${sentiment.neutral} neutral. `
      + (qs.length ? `${qs.length} look${qs.length === 1 ? 's' : ''} like a question; ${unanswered.length} ${unanswered.length === 1 ? 'is' : 'are'} not answered by you yet.` : 'None look like a question.');
  return {
    total: list.length, accounts: people, sentiment, sentimentIsEstimate: true, sentimentNote: SENTIMENT_LABEL,
    questions: { total: qs.length, unanswered: unanswered.length },
    topCommenters: topCommenters(list), themes: themesFromComments(list), themesAreKeywordCounts: true, summary,
  };
}

// Notification (kind 'questions'): a post under 24 h old with 3+ unanswered questions. One per post (dedupe key). Returns null when it does not apply.
export function questionAlert(post, comments, now = Date.now()) {
  const age = now - Date.parse(post.posted_at);
  if (!Number.isFinite(age) || age < 0 || age > ALERT_WINDOW_H * 36e5) return null;
  const n = questionsFromComments(comments).length;
  if (n < ALERT_MIN_QUESTIONS) return null;
  const label = String(post.caption || '').trim().slice(0, 40);
  return {
    kind: 'questions', key: `questions:${post.id}`,
    title: `${n} unanswered questions on a new post`,
    body: `Your ${label ? `post "${label}${String(post.caption).trim().length > 40 ? '…' : ''}"` : 'latest post'} has ${n} comments that look like questions and no reply from you yet. Answering early keeps the conversation going.`,
  };
}

// Comments older than the retention window are not stored (so a pull never re-creates what the retention job deleted).
export const withinRetention = (postedAt, now = Date.now()) => now - Date.parse(postedAt) <= RETENTION_DAYS * 864e5;
