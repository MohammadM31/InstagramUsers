// Roadmap O.1 UI: pure helpers for the onboarding wizard (no React here, so test/onboardingUi.test.js can run them in Node).
// Only erasable TypeScript syntax is used (no enums), so Node can import this file directly.
export const STEPS = ['about', 'connect', 'business', 'voice', 'goals', 'content'] as const;
export type StepKey = typeof STEPS[number];
export type Kind = 'text' | 'area' | 'select' | 'list' | 'num' | 'date' | 'bool';
export type Field = { k: string; label: string; kind: Kind; options?: [string, string][]; hint?: string; required?: boolean };

const GOALS: [string, string][] = [['followers', 'Grow followers'], ['reach', 'Reach more people'], ['engagement', 'More engagement'], ['sales', 'Get sales'], ['leads', 'Get leads or enquiries'], ['brand', 'Build the brand']];

export const TITLES: Record<StepKey, string> = { about: 'About you', connect: 'Connect Instagram', business: 'Your business', voice: 'Brand voice', goals: 'Your goal', content: 'How you post' };

// Same field names as the API (src/onboarding.js STEP_FIELDS). goal_baseline_value is not asked: the goal step (O.4) records it.
export const FIELDS: Record<StepKey, Field[]> = {
  about: [
    { k: 'display_name', label: 'Your name', kind: 'text', required: true },
    { k: 'business_name', label: 'Business or account name', kind: 'text' },
    { k: 'role', label: 'Your role', kind: 'text', hint: 'For example owner, marketer, creator' },
    { k: 'timezone', label: 'Time zone', kind: 'text', hint: 'For example Asia/Beirut. Daily syncs and best-time advice use it.' },
    { k: 'languages', label: 'Languages you post in', kind: 'list', hint: 'Language codes, comma separated: en, ar, fr' },
  ],
  connect: [],
  business: [
    { k: 'business_summary', label: 'What does the business do?', kind: 'area', hint: 'A few sentences. Used to make advice and captions fit you.' },
    { k: 'offerings', label: 'Products or services', kind: 'list', hint: 'Comma separated' },
    { k: 'niche', label: 'Niche', kind: 'text' },
    { k: 'niche_keywords', label: 'Niche keywords', kind: 'list', hint: 'Comma separated, up to 15' },
    { k: 'audience', label: 'Who is your audience?', kind: 'text' },
    { k: 'stage', label: 'Stage', kind: 'select', options: [['idea', 'Just an idea'], ['starting', 'Just starting'], ['growing', 'Growing'], ['established', 'Established']] },
  ],
  voice: [],
  goals: [
    { k: 'goal_primary', label: 'Main goal', kind: 'select', options: GOALS },
    { k: 'goal_secondary', label: 'Second goal (optional)', kind: 'select', options: GOALS },
    { k: 'goal_target_metric', label: 'Measure it by', kind: 'select', options: [['followers', 'Followers'], ['reach', 'Reach'], ['er', 'Engagement rate (%)']] },
    { k: 'goal_target_value', label: 'Target number', kind: 'num' },
    { k: 'goal_deadline', label: 'By when', kind: 'date' },
  ],
  content: [
    { k: 'posts_per_week', label: 'Posts per week', kind: 'num', hint: 'Whole number, 0 to 35' },
    { k: 'content_by', label: 'Who makes the content?', kind: 'select', options: [['me', 'Me'], ['team', 'My team'], ['agency', 'An agency']] },
    { k: 'video_ok', label: 'I can make videos and Reels', kind: 'bool' },
    { k: 'auto_proposals', label: 'Let the app suggest posts for me to approve (nothing is ever posted without your approval)', kind: 'bool' },
  ],
};

export type Form = Record<string, string | boolean>;

export const listFromText = (s: string): string[] => {
  const out: string[] = [];
  for (const p of String(s ?? '').split(/[,\n]/)) { const t = p.trim(); if (t && !out.includes(t)) out.push(t); }
  return out;
};
export const textFromList = (a: unknown): string => Array.isArray(a) ? a.join(', ') : '';

// Server profile -> form strings (null becomes an empty field)
export function toForm(step: StepKey, profile: Record<string, any>): Form {
  const f: Form = {};
  for (const fd of FIELDS[step]) {
    const v = profile?.[fd.k];
    f[fd.k] = fd.kind === 'bool' ? !!v : fd.kind === 'list' ? textFromList(v) : v === null || v === undefined ? '' : String(v);
  }
  return f;
}

// Form -> API body for PATCH /onboarding/:step. Empty optional fields send null (clears them). Returns a readable error instead of calling the server with junk.
export function toPayload(step: StepKey, form: Form): { body: Record<string, any> } | { error: string } {
  const body: Record<string, any> = {};
  for (const fd of FIELDS[step]) {
    const raw = form[fd.k];
    if (fd.kind === 'bool') { body[fd.k] = !!raw; continue; }
    const s = String(raw ?? '').trim();
    if (fd.required && !s) return { error: `${fd.label} is required.` };
    if (!s) { body[fd.k] = null; continue; }
    if (fd.kind === 'list') { body[fd.k] = listFromText(s); continue; }
    if (fd.kind === 'num') {
      const n = Number(s);
      if (!Number.isFinite(n)) return { error: `${fd.label} must be a number.` };
      body[fd.k] = n; continue;
    }
    body[fd.k] = s;
  }
  // auto_proposals cannot be cleared on the server (it is a yes/no), so it is always sent as a boolean (handled above)
  if (body.goal_primary && body.goal_primary === body.goal_secondary) return { error: 'The second goal must differ from the main goal.' };
  return { body };
}

// Where to open the wizard: the server's step, or the last screen when everything is already saved or skipped.
export const startIndex = (step: string): number => { const i = STEPS.indexOf(step as StepKey); return i < 0 ? STEPS.length - 1 : i; };
export const detectedZone = (): string => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } };
