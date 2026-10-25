/**
 * Composition root for Listening in the browser: wires the three Source adapters to their
 * Services, the Shelf store, the Media Session and offline downloads. The shell calls
 * `createVelaListening(config)` and passes `listening` (and `downloads`) to
 * src/ui/listen/mount.ts. It also registers the service worker (src/sw/register.ts).
 */
import type { VelaConfig } from "../contract";
import { createComicsClient } from "../sources/ossicle-comics";
import { createOssicleBooks } from "../sources/ossicle-books";
import { createOssiclePodcasts } from "../sources/ossicle-podcasts";
import { createOssicleRpc } from "../sources/ossicle-rpc";
import { createCacheNarrationStore } from "../sources/narration-store";
import { deviceIdFrom } from "../sources/device-id";
import { createCacheCredentialStore } from "../sources/pyxis-credentials";
import { type PyxisMusicAdapter, createPyxisMusic } from "../sources/pyxis-music";
import type { SocketFactory, SocketLike } from "../sources/pyxis-realtime";
import { createPyxisRpc } from "../sources/pyxis-rpc";
import type { ConnectionLike } from "../sw/download-plan";
import { type Downloads, createDownloads } from "../sw/downloads";
import { createCacheOfflineAudio } from "../sw/offline-cache";
import { type ListeningEngine, createListening } from "./listening";
import { type MediaSessionLike, bindMediaSession } from "./media-session";
import { type MediaElement, createAudioOutput } from "./output";
import { createShelfStore } from "./shelf-store";

export interface BrowserListeningEnv {
  readonly fetch: typeof fetch;
  readonly storage: Storage;
  readonly caches: CacheStorage;
  readonly createElement: () => MediaElement;
  readonly connect: SocketFactory;
  readonly mediaSession?: MediaSessionLike;
  readonly connection: () => (ConnectionLike & EventTarget) | undefined;
}

export interface VelaListening {
  readonly listening: ListeningEngine;
  readonly downloads: Downloads;
  /** Music's Pyxis host, for pinning albums and host status. */
  readonly music: PyxisMusicAdapter;
  dispose(): void;
}

const DOWNLOAD_EVERY_MS = 30 * 60 * 1000;

export function browserListeningEnv(): BrowserListeningEnv {
  return {
    fetch: (input, init) => fetch(input, init),
    storage: localStorage,
    caches,
    createElement: () => {
      const element = new Audio();
      element.preload = "auto";
      return element;
    },
    connect: (url) => new WebSocket(url) as unknown as SocketLike,
    ...("mediaSession" in navigator ? { mediaSession: navigator.mediaSession } : {}),
    connection: () => (navigator as Navigator & { connection?: ConnectionLike & EventTarget }).connection,
  };
}

export function createVelaListening(config: VelaConfig, env: BrowserListeningEnv = browserListeningEnv()): VelaListening {
  const { origins } = config;
  const ossicleRpc = createOssicleRpc({ origin: origins.ossicle, fetch: env.fetch });
  const comics = createComicsClient({ origin: origins.ossicle, fetch: env.fetch });
  const narration = createCacheNarrationStore(env.caches);
  const credentials = createCacheCredentialStore(env.caches);
  const ossicleDevice = deviceIdFrom(env.storage, "vela.ossicle.deviceId", "vela");
  const outputs = {
    music: createAudioOutput(env.createElement()),
    podcasts: createAudioOutput(env.createElement()),
    books: createAudioOutput(env.createElement()),
  };

  const music = createPyxisMusic({
    rpc: createPyxisRpc({ origin: origins.pyxis, fetch: env.fetch }),
    origin: origins.pyxis,
    output: outputs.music,
    credentials,
    connect: env.connect,
    storage: env.storage,
  });
  const podcasts = createOssiclePodcasts({
    rpc: ossicleRpc,
    origin: origins.ossicle,
    output: outputs.podcasts,
    storage: env.storage,
    deviceId: ossicleDevice,
  });
  const books = createOssicleBooks({
    comics,
    output: outputs.books,
    storage: env.storage,
    deviceId: ossicleDevice,
    narration,
  });

  const listening = createListening({
    sources: {
      music: { adapter: music, output: outputs.music },
      podcasts: { adapter: podcasts, output: outputs.podcasts },
      books: { adapter: books, output: outputs.books },
    },
    shelfStore: createShelfStore(env.storage),
  });

  const downloads = createDownloads({
    origins: { pyxis: origins.pyxis, ossicle: origins.ossicle },
    offline: createCacheOfflineAudio(env.caches),
    sources: {
      podcasts: () => podcasts.offlineCandidates(),
      currentBook: () => listening.shelf.books,
      narrationAhead: (book, budgetMs) => books.narrationAhead(book, budgetMs),
      pinnedTracks: () => music.offlineTracks(),
    },
    fetch: env.fetch,
    pyxisToken: async () => (await credentials.read())?.token,
    connection: env.connection,
    storage: env.storage,
  });

  const runDownloads = () => {
    downloads.run().catch((error: unknown) => console.warn("Vela downloads failed", error));
  };
  const onOnline = () => {
    runDownloads();
    void music.flush().catch(() => undefined);
    void podcasts.syncPosition().catch(() => undefined);
  };
  const unbindMediaSession = env.mediaSession === undefined ? () => undefined : bindMediaSession(listening, env.mediaSession);
  music.start().catch((error: unknown) => console.warn("Vela could not reach Pyxis", error));
  void listening.ready.then(runDownloads);
  const timer = setInterval(runDownloads, DOWNLOAD_EVERY_MS);
  const connection = env.connection();
  connection?.addEventListener("change", runDownloads);
  if (typeof window !== "undefined") window.addEventListener("online", onOnline);

  return {
    listening,
    downloads,
    music,
    dispose() {
      clearInterval(timer);
      connection?.removeEventListener("change", runDownloads);
      if (typeof window !== "undefined") window.removeEventListener("online", onOnline);
      unbindMediaSession();
      listening.dispose();
    },
  };
}
