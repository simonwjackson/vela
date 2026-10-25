/**
 * Prepared narration kept on the device, so a Book keeps reading in a dead zone (ADR 0002).
 * Timelines and prepared batches are JSON in Cache Storage under synthetic keys; the window
 * audio itself is cached by the download runner under its real URL.
 */
import type { NarrationBatch, NarrationTimeline } from "./ossicle-comics";

export interface NarrationStore {
  timeline(bookId: string, generation: string): Promise<NarrationTimeline | undefined>;
  putTimeline(bookId: string, generation: string, timeline: NarrationTimeline): Promise<void>;
  /** A prepared batch whose first sentence is `ordinal`. */
  batch(bookId: string, generation: string, ordinal: number): Promise<NarrationBatch | undefined>;
  putBatch(bookId: string, generation: string, ordinal: number, batch: NarrationBatch): Promise<void>;
  /** A stored batch with a window that narrates sentence `ordinal`, wherever that batch starts. */
  batchContaining(bookId: string, generation: string, ordinal: number): Promise<NarrationBatch | undefined>;
  /** Delete every stored batch except these ordinals of this book. */
  retainOnly(bookId: string, generation: string, ordinals: ReadonlySet<number>): Promise<void>;
}

export const NARRATION_CACHE = "vela-narration-v1";
const KEY_ORIGIN = "https://vela-narration.invalid";

const bookPrefix = (bookId: string, generation: string) =>
  `${KEY_ORIGIN}/${encodeURIComponent(bookId)}/${encodeURIComponent(generation)}`;
const timelineKey = (bookId: string, generation: string) => `${bookPrefix(bookId, generation)}/timeline`;
const batchKey = (bookId: string, generation: string, ordinal: number) =>
  `${bookPrefix(bookId, generation)}/batch/${ordinal}`;

/** The first-sentence ordinals of stored batch keys for one book, highest first. */
function batchStarts(keys: readonly string[], bookId: string, generation: string): number[] {
  const prefix = `${bookPrefix(bookId, generation)}/batch/`;
  return keys
    .filter((key) => key.startsWith(prefix))
    .map((key) => Number(key.slice(prefix.length)))
    .filter((ordinal) => Number.isSafeInteger(ordinal))
    .sort((a, b) => b - a);
}

export const narrates = (batch: NarrationBatch | undefined, ordinal: number): batch is NarrationBatch =>
  batch?.window !== undefined && batch.segments.some((segment) => segment.ordinal === ordinal);

export function createCacheNarrationStore(storage: CacheStorage, cacheName = NARRATION_CACHE): NarrationStore {
  const open = () => storage.open(cacheName);
  const readJson = async <T>(key: string): Promise<T | undefined> => {
    const response = await (await open()).match(key);
    if (response === undefined) return undefined;
    try {
      return (await response.json()) as T;
    } catch {
      return undefined;
    }
  };
  const writeJson = async (key: string, value: unknown) => {
    await (await open()).put(key, new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } }));
  };
  return {
    timeline: (bookId, generation) => readJson<NarrationTimeline>(timelineKey(bookId, generation)),
    putTimeline: (bookId, generation, timeline) => writeJson(timelineKey(bookId, generation), timeline),
    batch: (bookId, generation, ordinal) => readJson<NarrationBatch>(batchKey(bookId, generation, ordinal)),
    putBatch: (bookId, generation, ordinal, batch) => writeJson(batchKey(bookId, generation, ordinal), batch),
    async batchContaining(bookId, generation, ordinal) {
      const keys = (await (await open()).keys()).map((request) => request.url);
      for (const start of batchStarts(keys, bookId, generation)) {
        if (start > ordinal) continue;
        const candidate = await readJson<NarrationBatch>(batchKey(bookId, generation, start));
        return narrates(candidate, ordinal) ? candidate : undefined;
      }
      return undefined;
    },
    async retainOnly(bookId, generation, ordinals) {
      const cache = await open();
      const keep = new Set([...ordinals].map((ordinal) => batchKey(bookId, generation, ordinal)));
      const keepTimeline = timelineKey(bookId, generation);
      for (const request of await cache.keys()) {
        if (request.url === keepTimeline || keep.has(request.url)) continue;
        await cache.delete(request);
      }
    },
  };
}

export function createMemoryNarrationStore(): NarrationStore & { readonly batches: ReadonlyMap<string, NarrationBatch> } {
  const timelines = new Map<string, NarrationTimeline>();
  const batches = new Map<string, NarrationBatch>();
  return {
    batches,
    timeline: async (bookId, generation) => timelines.get(timelineKey(bookId, generation)),
    async putTimeline(bookId, generation, timeline) {
      timelines.set(timelineKey(bookId, generation), timeline);
    },
    batch: async (bookId, generation, ordinal) => batches.get(batchKey(bookId, generation, ordinal)),
    async putBatch(bookId, generation, ordinal, batch) {
      batches.set(batchKey(bookId, generation, ordinal), batch);
    },
    async batchContaining(bookId, generation, ordinal) {
      for (const start of batchStarts([...batches.keys()], bookId, generation)) {
        if (start > ordinal) continue;
        const candidate = batches.get(batchKey(bookId, generation, start));
        return narrates(candidate, ordinal) ? candidate : undefined;
      }
      return undefined;
    },
    async retainOnly(bookId, generation, ordinals) {
      const keep = new Set([...ordinals].map((ordinal) => batchKey(bookId, generation, ordinal)));
      for (const key of [...batches.keys()]) if (!keep.has(key)) batches.delete(key);
      for (const key of [...timelines.keys()]) if (key !== timelineKey(bookId, generation)) timelines.delete(key);
    },
  };
}
