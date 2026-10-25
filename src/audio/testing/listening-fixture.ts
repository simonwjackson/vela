/**
 * The whole Listening engine wired to in-memory Pyxis and Ossicle, scripted media elements and
 * in-memory storage. Tests and previews use it; nothing touches the network.
 */
import type { Shelf } from "../../contract";
import { createMemoryNarrationStore } from "../../sources/narration-store";
import { createComicsClient } from "../../sources/ossicle-comics";
import { createOssicleBooks } from "../../sources/ossicle-books";
import { createOssiclePodcasts } from "../../sources/ossicle-podcasts";
import { createOssicleRpc } from "../../sources/ossicle-rpc";
import { createMemoryCredentialStore } from "../../sources/pyxis-credentials";
import { createPyxisMusic } from "../../sources/pyxis-music";
import { createPyxisRpc } from "../../sources/pyxis-rpc";
import { type InMemoryOssicle, createInMemoryOssicle } from "../../sources/testing/in-memory-ossicle";
import { type InMemoryPyxis, createInMemoryPyxis } from "../../sources/testing/in-memory-pyxis";
import { createListening } from "../listening";
import { createAudioOutput } from "../output";
import { type KeyValueStorage, createMemoryShelfStore } from "../shelf-store";
import { ScriptedMediaElement } from "./scripted-media-element";

export function createMemoryStorage(): KeyValueStorage & { readonly entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
    removeItem: (key) => {
      entries.delete(key);
    },
  };
}

/** Let promise chains and queued microtasks run. Works with fake timers too. */
export async function settle(rounds = 200): Promise<void> {
  for (let round = 0; round < rounds; round += 1) await Promise.resolve();
}

let counter = 0;
export const sequentialIds = () => `id-${++counter}`;

export function createListeningFixture(options: {
    readonly storage?: KeyValueStorage;
    readonly shelf?: Shelf;
    /** Runs before the engine starts, to seed the Services. */
    readonly seed?: (services: { ossicle: InMemoryOssicle; pyxis: InMemoryPyxis }) => void;
  } = {}) {
  const storage = options.storage ?? createMemoryStorage();
  const ossicle = createInMemoryOssicle();
  const pyxis = createInMemoryPyxis();
  options.seed?.({ ossicle, pyxis });
  const elements = {
    music: new ScriptedMediaElement({ durationFor: () => 200 }),
    podcasts: new ScriptedMediaElement({ durationFor: () => 1800 }),
    books: new ScriptedMediaElement({ durationFor: () => 80 }),
  };
  const outputs = {
    music: createAudioOutput(elements.music),
    podcasts: createAudioOutput(elements.podcasts),
    books: createAudioOutput(elements.books),
  };
  const credentials = createMemoryCredentialStore();
  const music = createPyxisMusic({
    rpc: createPyxisRpc({ origin: pyxis.origin, fetch: pyxis.fetch }),
    origin: pyxis.origin,
    output: outputs.music,
    credentials,
    connect: pyxis.connect,
    storage,
    newId: sequentialIds,
  });
  const podcasts = createOssiclePodcasts({
    rpc: createOssicleRpc({ origin: ossicle.origin, fetch: ossicle.fetch }),
    origin: ossicle.origin,
    output: outputs.podcasts,
    storage,
    deviceId: "vela-car",
  });
  const narration = createMemoryNarrationStore();
  const books = createOssicleBooks({
    comics: createComicsClient({ origin: ossicle.origin, fetch: ossicle.fetch }),
    output: outputs.books,
    storage,
    deviceId: "vela-car",
    narration,
    sleep: async () => undefined,
  });
  const shelfStore = createMemoryShelfStore(options.shelf);
  const listening = createListening({
    sources: {
      music: { adapter: music, output: outputs.music },
      podcasts: { adapter: podcasts, output: outputs.podcasts },
      books: { adapter: books, output: outputs.books },
    },
    shelfStore,
  });
  return { listening, ossicle, pyxis, elements, outputs, music, podcasts, books, narration, credentials, shelfStore, storage };
}
