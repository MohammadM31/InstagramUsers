// Albums: types and pure helpers (contract section 4.5). No imports and no DOM, so test/albumsUi.test.js can load this file directly in Node.

export type Category = 'reel' | 'photo' | 'carousel' | 'story' | 'other';
export type Status = 'draft' | 'ready';

export interface Item {
  id: string; title: string; category: Category; categorySource: 'auto' | 'user'; status: Status; caption: string;
  imageIds: string[]; ratio: string | null; folderId: string | null; conversationId: string | null; createdAt: string; updatedAt: string;
}
export interface AlbumSummary { category: Category; count: number; coverImageIds: string[] }
export interface FolderSummary { id: string; name: string; count: number; coverImageIds: string[] }
export interface Overview { albums: AlbumSummary[]; folders: FolderSummary[]; total: number }

// The fixed display order (the server also returns all five in this order; we do not trust that and normalise below).
export const CATEGORIES: { key: Category; label: string; single: string }[] = [
  { key: 'reel', label: 'Reels', single: 'Reel' },
  { key: 'photo', label: 'Photos', single: 'Photo' },
  { key: 'carousel', label: 'Carousels', single: 'Carousel' },
  { key: 'story', label: 'Stories', single: 'Story' },
  { key: 'other', label: 'Other', single: 'Other' },
];
export const categoryLabel = (k: string): string => CATEGORIES.find(c => c.key === k)?.label ?? 'Other';

// Always five tiles, always in the fixed order, even if the server omits one or returns extras.
export function orderedAlbums(list: { category: string; count?: number; coverImageIds?: string[] }[] | null | undefined): AlbumSummary[] {
  return CATEGORIES.map(c => {
    const a = (list || []).find(x => x.category === c.key);
    return { category: c.key, count: Number(a?.count) || 0, coverImageIds: (a?.coverImageIds || []).slice(0, 4) };
  });
}

export interface ItemsQuery { category?: string; folderId?: string; status?: string; q?: string; before?: string; limit?: number }
// GET /api/albums/items?category=&folderId=&status=&q=&limit=50&before=  (empty filters are left out)
export function itemsQuery(p: ItemsQuery): string {
  const parts: string[] = [];
  for (const k of ['category', 'folderId', 'status', 'q', 'before'] as const) {
    const v = p[k];
    if (v !== undefined && v !== null && String(v) !== '') parts.push(k + '=' + encodeURIComponent(String(v)));
  }
  parts.push('limit=' + (p.limit && p.limit > 0 ? Math.min(Math.floor(p.limit), 100) : 50));
  return '?' + parts.join('&');
}

// "4:5" -> "4 / 5" for CSS aspect-ratio. Unknown or missing ratios render square.
export function ratioCss(r?: string | null): string {
  const m = /^(\d{1,3}):(\d{1,3})$/.exec(r || '');
  return m && +m[1] > 0 && +m[2] > 0 ? m[1] + ' / ' + m[2] : '1 / 1';
}
// The little outline rectangle shown next to the ratio label: the longer side is `box` px.
export function ratioShape(r?: string | null, box = 14): { w: number; h: number } {
  const m = /^(\d{1,3}):(\d{1,3})$/.exec(r || '');
  const a = m ? +m[1] : 1, b = m ? +m[2] : 1;
  if (!(a > 0) || !(b > 0)) return { w: box, h: box };
  return a >= b ? { w: box, h: Math.max(4, Math.round(box * b / a)) } : { w: Math.max(4, Math.round(box * a / b)), h: box };
}

// "Folder name already exists" comes back as HTTP 409 with a server message; show our own wording for it.
export const duplicateFolder = (msg: string): boolean => /exist|duplicate|conflict|already/i.test(msg || '');