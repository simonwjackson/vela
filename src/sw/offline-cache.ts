/**
 * Offline audio in Cache Storage. Each copy is the full body, keyed by the exact URL the
 * player requests: `{pyxis}/stream/:trackId`, `{ossicle}{audioPath}` and narration windows
 * under `{ossicle}/comics/…`.
 */

export const OFFLINE_AUDIO_CACHE = "vela-audio-v1";

export interface OfflineAudio {
  keys(): Promise<readonly string[]>;
  match(url: string): Promise<Response | undefined>;
  put(url: string, response: Response): Promise<void>;
  delete(url: string): Promise<void>;
}

export function createCacheOfflineAudio(storage: CacheStorage, cacheName = OFFLINE_AUDIO_CACHE): OfflineAudio {
  const open = () => storage.open(cacheName);
  return {
    async keys() {
      return (await (await open()).keys()).map((request) => request.url);
    },
    async match(url) {
      return (await (await open()).match(url)) ?? undefined;
    },
    async put(url, response) {
      await (await open()).put(url, response);
    },
    async delete(url) {
      await (await open()).delete(url);
    },
  };
}

/** Offline audio kept in memory, for previews and tests. Bodies are stored as bytes. */
export function createMemoryOfflineAudio(): OfflineAudio {
  const entries = new Map<string, { body: ArrayBuffer; type: string }>();
  return {
    keys: async () => [...entries.keys()],
    async match(url) {
      const entry = entries.get(url);
      return entry === undefined ? undefined : new Response(entry.body.slice(0), { headers: { "content-type": entry.type } });
    },
    async put(url, response) {
      entries.set(url, {
        body: await response.arrayBuffer(),
        type: response.headers.get("content-type") ?? "application/octet-stream",
      });
    },
    async delete(url) {
      entries.delete(url);
    },
  };
}
