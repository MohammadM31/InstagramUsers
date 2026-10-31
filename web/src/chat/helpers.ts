// "#cc=<conversationId>&ref=<imageId>" for the Command Center. Other hashes (#settings, #albums, empty) are null
// so the page that owns them can keep the hash.
export function parseHash(hash: string): { conversationId: string; ref: string | null } | null {
  const raw = String(hash || '').replace(/^#/, '');
  if (!/^cc=/i.test(raw)) return null;
  const conversationId = new URLSearchParams(raw).get('cc');
  if (!conversationId) return null;
  return { conversationId, ref: new URLSearchParams(raw).get('ref') };
}
