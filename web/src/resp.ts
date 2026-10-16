// Roadmap 4.2 UI helpers: which assistant replies can be edited and what an edit must look like. Pure (no React) so test/phase42.test.js can run it in Node
// and compare the limits with the server's (src/responses.js). Only erasable TypeScript syntax.
export const MAX_TEXT = 4000;
export const PLAIN_TYPES_NOT_EDITABLE = ['image', 'analytics', 'finance'];

export type Reply = { type: string; text: string; data?: any; original?: string; edited?: boolean };

// Plain text replies only: charts, the finance split and images are not text the person would rewrite.
export const canEditResponse = (r: Reply | null | undefined): boolean =>
  !!r && !PLAIN_TYPES_NOT_EDITABLE.includes(r.type) && typeof r.text === 'string' && r.text.trim().length > 0 && !r.data?.jobId;

// What the server will accept, checked before the call. `original` is the reply as the assistant first wrote it.
export function checkEdit(original: string, draft: string): { text: string } | { error: string } {
  const text = String(draft ?? '').trim();
  if (!text) return { error: 'The text cannot be empty.' };
  if (text.length > MAX_TEXT) return { error: `Keep it under ${MAX_TEXT} characters.` };
  if (text === String(original ?? '').trim()) return { error: 'Nothing changed.' };
  return { text };
}

// A reply after a successful save: shows the edit, remembers the first original, and is marked edited.
export const applyEdit = (r: Reply, saved: string): Reply => ({ ...r, original: r.original ?? r.text, text: saved, edited: true });
