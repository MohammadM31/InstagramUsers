// Roadmap O.3 UI: pure helpers for the brand-voice step (no React, so test/voiceUi.test.js can run them in Node and compare them with the server's own lists).
// Only erasable TypeScript syntax (no enums), so Node can import this file directly.
export const TONE_TAGS = ['friendly', 'professional', 'playful', 'bold', 'warm', 'witty', 'inspiring', 'luxurious', 'educational', 'calm', 'direct', 'empathetic'] as const;
export const MAX_TONE_TAGS = 5;
export const CHOICES: Record<'formality' | 'length_pref' | 'emoji_use' | 'hashtag_style', { label: string; options: [string, string][] }> = {
  formality: { label: 'Formality', options: [['casual', 'Casual'], ['balanced', 'Friendly but professional'], ['formal', 'Formal']] },
  length_pref: { label: 'Caption length', options: [['short', 'Short'], ['medium', 'Medium'], ['long', 'Long, story-style']] },
  emoji_use: { label: 'Emojis', options: [['none', 'None'], ['low', 'A few'], ['med', 'Some'], ['high', 'Lots']] },
  hashtag_style: { label: 'Hashtags', options: [['niche', 'Niche and mid-size'], ['mixed', 'A mix'], ['popular', 'Popular'], ['branded', 'Branded plus niche']] },
};
export const SAMPLE_KINDS: [string, string][] = [['liked', 'A caption I like'], ['disliked', 'A caption I do not like'], ['reference_link', 'A link to an account or post I admire']];
export const LLM_REASON_TEXT: Record<string, string> = {
  no_consent: 'Written from a template using your choices (AI was not used).',
  no_user_key: 'Written from a template: AI needs your own OpenAI key. Add one in Settings, then press Redo.',
  budget: 'Written from a template: you have used this hour’s AI summaries. Try Redo later.',
  llm_failed: 'Written from a template: the AI request failed. Press Redo to try again.',
  llm_invalid: 'Written from a template: the AI gave an unusable answer. Press Redo to try again.',
};

export type VoiceForm = { tone_tags: string[]; formality: string; length_pref: string; emoji_use: string; hashtag_style: string; do: string; dont: string; phrases: string };
export const emptyForm = (): VoiceForm => ({ tone_tags: [], formality: '', length_pref: '', emoji_use: '', hashtag_style: '', do: '', dont: '', phrases: '' });

// One item per line (items may contain commas, so lines are the only separator).
export const linesFromText = (s: string): string[] => { const out: string[] = []; for (const p of String(s ?? '').split('\n')) { const t = p.trim(); if (t && !out.includes(t)) out.push(t); } return out; };
export const textFromLines = (a: unknown): string => Array.isArray(a) ? a.join('\n') : '';

export function voiceToForm(v: Record<string, any> | null | undefined): VoiceForm {
  const f = emptyForm();
  if (!v) return f;
  f.tone_tags = Array.isArray(v.tone_tags) ? [...v.tone_tags] : [];
  for (const k of ['formality', 'length_pref', 'emoji_use', 'hashtag_style'] as const) f[k] = v[k] ?? '';
  for (const k of ['do', 'dont', 'phrases'] as const) f[k] = textFromLines(v[k]);
  return f;
}

// Toggle a tone tag; the fifth is the last one allowed (the server refuses more).
export const toggleTag = (tags: string[], t: string): string[] => tags.includes(t) ? tags.filter(x => x !== t) : tags.length >= MAX_TONE_TAGS ? tags : [...tags, t];

// Form -> body for POST /onboarding/voice/generate and PUT /voice. Empty choices send null (clear). `consent` is sent only for generate and only when the box is ticked.
export function toVoicePayload(form: VoiceForm, opts: { consent?: boolean } = {}): { body: Record<string, any> } | { error: string } {
  const body: Record<string, any> = { tone_tags: form.tone_tags };
  for (const k of ['formality', 'length_pref', 'emoji_use', 'hashtag_style'] as const) body[k] = form[k] || null;
  const lists = { do: linesFromText(form.do), dont: linesFromText(form.dont), phrases: linesFromText(form.phrases) };
  if (lists.do.length > 8 || lists.dont.length > 8 || lists.phrases.length > 8) return { error: 'Use at most 8 lines in each list.' };
  if ([...lists.do, ...lists.dont].some(s => s.length > 120)) return { error: 'Each Do or Avoid line must be 120 characters or fewer.' };
  if (lists.phrases.some(s => s.length > 80)) return { error: 'Each phrase must be 80 characters or fewer.' };
  Object.assign(body, lists);
  if (opts.consent !== undefined) body.consent = opts.consent === true;
  return { body };
}

export const hasSignal = (form: VoiceForm, sampleCount: number): boolean =>
  sampleCount > 0 || form.tone_tags.length > 0 || !!(form.formality || form.length_pref || form.emoji_use || form.hashtag_style) || linesFromText(form.do).length + linesFromText(form.dont).length + linesFromText(form.phrases).length > 0;

// Plain words for the one-line status under a generated voice.
export const sourceNote = (source: string, reason?: string): string =>
  source === 'llm' ? 'Written by AI with your own OpenAI key.' : source === 'edited' ? 'Saved from your edits.' : (reason && LLM_REASON_TEXT[reason]) || LLM_REASON_TEXT.no_consent;

// Client-side check of a sample before it is sent (the server checks again).
export function sampleError(kind: string, text: string, url: string): string {
  const t = text.trim(), u = url.trim();
  if (kind === 'reference_link') { try { const x = new URL(u); if (x.protocol !== 'http:' && x.protocol !== 'https:') throw 0; } catch { return 'Enter a full link starting with https://'; } return t.length > 300 ? 'The note can be 300 characters at most.' : ''; }
  if (!t) return 'Paste the caption first.';
  return t.length > 2000 ? 'A caption can be 2000 characters at most.' : '';
}
