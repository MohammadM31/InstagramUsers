// Command Center helpers. Pure (no React, no fetch) so test/commandCenter.test.js can run them in Node. Only erasable TypeScript syntax.

export type Tip = { priority?: number; kind: string; text: string; why?: string; watch?: string };
export type AlertItem = { id: number; kind: string; title: string; body: string; created_at: string; read_at: string | null };

const round1 = (n: number) => +Math.abs(n).toFixed(1);
const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

// "Reach is up 12% on the previous 30 days" / "down" / "unchanged". null change = nothing to compare with.
export function changeWords(label: string, value: number | string, pct: number | null | undefined, suffix = ''): string {
  const v = typeof value === 'number' ? value.toLocaleString('en-US') : String(value);
  if (!isNum(pct)) return `${label} is ${v}${suffix} over the last 30 days.`;
  if (pct === 0) return `${label} is unchanged on the previous 30 days (${v}${suffix}).`;
  return `${label} is ${pct > 0 ? 'up' : 'down'} ${round1(pct)}% on the previous 30 days (${v}${suffix}).`;
}

// The Morning Briefing. Uses /api/dashboard (reach, avgER), /api/ai/context (health, gaps) and, for the focus line, the top priority.
// Says plainly when there is no data. Never invents a number: every figure comes from the inputs.
export function briefing(i: { name?: string | null; dash?: any; ctx?: any; focus?: string | null }): { headline: string; lines: string[]; tone: 'good' | 'warn' | 'info' } {
  const name = String(i.name ?? '').trim(), headline = name ? `Welcome back, ${name}.` : 'Welcome back.';
  const d = i.dash, c = i.ctx, lines: string[] = [];
  const hasPosts = isNum(c?.coverage?.posts) ? c.coverage.posts > 0 : isNum(d?.reach?.value) && d.reach.value > 0;
  if (!d && !c) return { headline, lines: ['The briefing could not load yet.'], tone: 'info' };
  if (!hasPosts) {
    lines.push('There is no post data yet, so there is nothing to report on. Connect Instagram or import your posts to get a briefing.');
    const gap = Array.isArray(c?.gaps) ? c.gaps.find((g: unknown) => typeof g === 'string' && g.trim()) : null;
    if (gap) lines.push(`Focus on this first: ${gap}`);
    return { headline, lines, tone: 'info' };
  }
  if (d?.reach && isNum(d.reach.value)) lines.push(changeWords('Reach', d.reach.value, d.reach.changePct));
  if (d?.avgER && isNum(d.avgER.value)) lines.push(changeWords('Engagement rate', d.avgER.value, d.avgER.changePct, '%'));
  const h = c?.health;
  if (h && isNum(h.score)) lines.push(`Account health: ${h.score}${h.label ? ` (${h.label})` : ''}.`);
  const focus = String(i.focus ?? '').trim();
  if (focus) lines.push(`Focus on: ${focus}`);
  const down = (isNum(d?.reach?.changePct) && d.reach.changePct < 0) || (isNum(h?.score) && h.score < 50);
  const up = isNum(d?.reach?.changePct) && d.reach.changePct > 0 && !down;
  return { headline, lines, tone: down ? 'warn' : up ? 'good' : 'info' };
}

// "Fix this" fills the chat with a question. Known kinds get a pointed question; anything else gets the priority's own words.
const ASK: Record<string, string> = {
  follower_drop: 'My followers have dropped recently. What are the most likely reasons and what should I do first?',
  hashtags: 'How should I improve my hashtags? Tell me what to change this week.',
  consistency: 'How do I post more consistently? Give me a simple weekly rhythm.',
  content: 'Which of my formats works best, and how do I make more of it?',
  collab: 'How do I set up a creator collaboration this week? Give me the first three steps.',
  mention: 'How do I get more mentions and tags from other accounts? Give me concrete steps.',
  community: 'How do I reply to my community faster and get more conversations going?',
  giveaway: 'How should I run a giveaway that actually grows my account?',
  swap: 'How do I set up a shoutout swap with a similar account?',
  start: 'I am just starting. What should I do first to get useful numbers?',
};
export function fixQuestion(t: Tip): string {
  const text = String(t?.text ?? '').trim().replace(/\s+/g, ' ');
  if (t && Object.prototype.hasOwnProperty.call(ASK, t.kind)) return ASK[t.kind];
  return text ? `One of my priorities is: "${text.slice(0, 160)}${text.length > 160 ? '…' : ''}" What exactly should I do this week to fix it?` : 'What should I do next?';
}

// Alerts banner: unread first, then newest, at most n.
export function pickAlerts(items: AlertItem[] | null | undefined, n = 3): AlertItem[] {
  return [...(items || [])].sort((a, b) => (a.read_at ? 1 : 0) - (b.read_at ? 1 : 0) || Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id).slice(0, n);
}

// Left-column widget. Green only when Instagram is really connected.
export function connectionView(s: { status?: string; username?: string | null } | null | undefined): { on: boolean; label: string; title: string } {
  if (!s) return { on: false, label: 'Instagram status unknown', title: 'Could not read the Instagram connection' };
  if (s.status === 'connected') return { on: true, label: '@' + (s.username || 'instagram'), title: 'Instagram is connected' };
  if (s.status === 'reconnect_needed') return { on: false, label: s.username ? '@' + s.username : 'Reconnect Instagram', title: 'The connection expired. Open Settings to connect again.' };
  if (s.status === 'dev_env') return { on: false, label: 'Instagram (dev env)', title: 'Only a server-side development token is set, not your own account' };
  return { on: false, label: 'Not connected', title: 'Open Settings to connect Instagram' };
}

// "Schedule this post": the body for POST /api/schedule, or a plain error. when = the value of a datetime-local input (local time).
export const IMAGE_NOT_ATTACHED = 'The image is not attached to the queue item yet (public image storage is not set up), so only the caption is queued.';
export function scheduleBody(caption: string, when: string, publicUrl: string | null | undefined, now: number): { body: { caption: string; image: string | null; scheduledAt: string } } | { error: string } {
  const c = String(caption ?? '').trim();
  if (!c) return { error: 'Write a caption first.' };
  if (c.length > 2200) return { error: 'Keep the caption under 2,200 characters.' };
  if (!String(when ?? '').trim()) return { error: 'Pick a date and time.' };
  const t = new Date(when).getTime();
  if (!Number.isFinite(t)) return { error: 'That date and time is not valid.' };
  if (t < now - 60000) return { error: 'Pick a time in the future.' };
  const url = typeof publicUrl === 'string' && /^https?:\/\//i.test(publicUrl) ? publicUrl : null;
  return { body: { caption: c, image: url, scheduledAt: new Date(t).toISOString() } };
}
