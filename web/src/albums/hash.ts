// Hash deep links (contract section 4.7). Pure functions, no imports, no DOM access at load time (Node can import this file in tests).
//   #albums                      -> Albums page
//   #settings                    -> Settings
//   #cc=<conversationId>[&ref=<imageId>] , or #cc  -> Command Center (stream 1 reads and clears the #cc= part itself)

export type RoutedPage = 'Dashboard' | 'Albums' | 'Settings';

// The route named by a location.hash value, or null when the hash is empty or not one of ours (then the current page stays).
export function pageFromHash(hash: string): RoutedPage | null {
  const first = String(hash || '').replace(/^#/, '').split('&')[0].split('=')[0].toLowerCase();
  if (first === 'albums') return 'Albums';
  if (first === 'settings') return 'Settings';
  if (first === 'cc') return 'Dashboard';
  return null;
}

export const isEmptyHash = (hash: string): boolean => hash === '' || hash === '#';

// {id, ref} from "#cc=<id>&ref=<id>". Missing parts are null.
export function parseCc(hash: string): { id: string | null; ref: string | null } {
  const raw = String(hash || '').replace(/^#/, '');
  if (!/^cc(=|&|$)/i.test(raw)) return { id: null, ref: null };
  const p = new URLSearchParams(raw);
  return { id: p.get('cc') || null, ref: p.get('ref') || null };
}

// The hash "Continue editing" sets: "#cc=<conversationId>&ref=<coverImageId>" (no ref when there is no image).
export function ccHash(conversationId: string, imageId?: string | null): string {
  return '#cc=' + encodeURIComponent(conversationId) + (imageId ? '&ref=' + encodeURIComponent(imageId) : '');
}

// The hash that belongs to a page name used by App.tsx ("Albums", "Settings", ...). Pages without a deep link have none.
export function hashForPage(page: string): string {
  return page === 'Albums' ? '#albums' : page === 'Settings' ? '#settings' : '';
}

// What the address bar should become when the user clicks a navigation item. null = leave it alone.
// A pending "#cc=..." is never cleared here: the Command Center (stream 1) consumes and clears it itself.
export function hashAfterNav(page: string, current: string): string | null {
  if (page === 'Dashboard' && pageFromHash(current) === 'Dashboard' && current !== '' && current !== '#') return null;
  const want = hashForPage(page);
  return want === current || (want === '' && isEmptyHash(current)) ? null : want;
}