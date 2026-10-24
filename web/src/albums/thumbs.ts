// Thumbnail loading for Albums. GET /api/images?ids= takes at most 40 ids (contract 4.3), so ids are fetched in chunks of 40,
// deduplicated (also while a request is in flight) and kept in memory for the session. No imports and no DOM: unit-tested in Node.

export const BATCH = 40;
export interface ThumbRow { id: string; thumb: string }

export function chunk<T>(a: T[], n: number = BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
}

// fetchBatch gets at most BATCH ids and returns the rows the server knows. `max` bounds memory (oldest thumb is dropped first).
export function makeThumbStore(fetchBatch: (ids: string[]) => Promise<ThumbRow[]>, max = 800) {
  const cache = new Map<string, string>();
  const missing = new Set<string>();   // the server answered but did not return it (not ours / gone): never ask again this session
  const failed = new Set<string>();    // the request itself failed: the next load() tries again
  const inflight = new Map<string, Promise<void>>();
  const subs = new Set<() => void>();
  let version = 0;
  const bump = () => { version++; subs.forEach(f => f()); };
  const remember = (id: string, thumb: string) => {
    cache.delete(id); cache.set(id, thumb);
    while (cache.size > max) cache.delete(cache.keys().next().value as string);
  };

  function load(ids: string[]): Promise<void> {
    const want = [...new Set((ids || []).filter(Boolean))].filter(id => !cache.has(id) && !missing.has(id));
    const waits: Promise<void>[] = [];
    const fresh: string[] = [];
    for (const id of want) { const f = inflight.get(id); if (f) waits.push(f); else fresh.push(id); }
    for (const part of chunk(fresh, BATCH)) {
      const p: Promise<void> = fetchBatch(part)
        .then(rows => {
          const got = new Set<string>();
          for (const r of rows || []) if (r && r.id && typeof r.thumb === 'string' && r.thumb) { remember(r.id, r.thumb); failed.delete(r.id); got.add(r.id); }
          for (const id of part) if (!got.has(id)) missing.add(id);
        })
        .catch(() => { for (const id of part) failed.add(id); })
        .finally(() => { for (const id of part) inflight.delete(id); bump(); });
      for (const id of part) inflight.set(id, p);
      waits.push(p);
    }
    return Promise.all(waits).then(() => undefined);
  }

  return {
    load,
    get: (id: string): string | undefined => cache.get(id),
    isMissing: (id: string) => missing.has(id),
    isFailed: (id: string) => failed.has(id),
    isLoading: (id: string) => inflight.has(id),
    subscribe(fn: () => void) { subs.add(fn); return () => { subs.delete(fn); }; },
    version: () => version,
    size: () => cache.size,
  };
}

// Full-size images are only fetched when a post is opened. A few are kept so swiping back and forth is instant.
export function makeFullCache(fetchOne: (id: string) => Promise<string>, max = 8) {
  const cache = new Map<string, string>();
  const inflight = new Map<string, Promise<string>>();
  return {
    get: (id: string): string | undefined => cache.get(id),
    load(id: string): Promise<string> {
      const hit = cache.get(id);
      if (hit !== undefined) { cache.delete(id); cache.set(id, hit); return Promise.resolve(hit); }
      const f = inflight.get(id);
      if (f) return f;
      const p: Promise<string> = fetchOne(id)
        .then(url => {
          if (typeof url !== 'string' || !url) throw new Error('The image came back empty');
          cache.set(id, url);
          while (cache.size > max) cache.delete(cache.keys().next().value as string);
          return url;
        })
        .finally(() => { inflight.delete(id); });
      inflight.set(id, p);
      return p;
    },
  };
}