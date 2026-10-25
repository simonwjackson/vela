/**
 * Books: EPUBs from the reader library, read aloud by Ossicle's narration.
 *
 * Narration comes in prepared windows of up to 8 sentences (`narration.prepare`); each window
 * is one audio file. Vela plays one window, prepares the next while it plays, and moves on at
 * its end. A Book's position is text-anchored (`book.position.read/write`); Vela converts it
 * to and from narration time with the timeline (`narration.timeline`).
 *
 * `positionSec` for a Book is estimated narration time: the timeline's estimated start of the
 * window's first sentence plus the time played inside the window. Seeks inside the current
 * window are exact; seeks outside it re-anchor at the sentence the timeline places there.
 *
 * Offline: prepared batches and timelines are read from the NarrationStore first, so windows
 * prepared ahead on Wi-Fi play without signal.
 */
import type { Item, NowPlaying, SourceAdapter, Transport } from "../contract";
import { createEmitter, errorMessage } from "../audio/emitter";
import { type AudioOutput, safeSeconds } from "../audio/output";
import type { KeyValueStorage } from "../audio/shelf-store";
import type { NarrationPiece } from "../sw/download-plan";
import type { NarrationStore } from "./narration-store";
import {
  type BookLocator,
  type BookPublication,
  type BookRevision,
  type ComicsClient,
  DEFAULT_VOICE,
  type NarrationBatch,
  type NarrationTimeline,
  anchorFor,
  locatorForSegment,
  segmentAtTime,
  startOrdinalFor,
  windowIndexAt,
} from "./ossicle-comics";
import { TALK_BACK_SEC, TALK_FORWARD_SEC } from "./ossicle-podcasts";
import { isRecord } from "./ossicle-rpc";
import { MAX_CONFLICT_ROUNDS, resolvePositionConflict } from "./position-conflict";

export const BOOK_POSITIONS_STORAGE_KEY = "vela.books.positions";

export interface OssicleBooksOptions {
  readonly comics: ComicsClient;
  readonly output: AudioOutput;
  readonly storage: KeyValueStorage;
  readonly deviceId: string;
  readonly narration: NarrationStore;
  /** Wait between prepare polls while synthesis catches up. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly pollAttempts?: number;
  readonly pollEveryMs?: number;
}

export interface OssicleBooksAdapter extends SourceAdapter {
  /**
   * Prepare narration ahead of the Book's current position until `budgetMs` is covered,
   * storing each batch. Returns the window audio to cache.
   */
  narrationAhead(item: Item, budgetMs: number): Promise<readonly NarrationPiece[]>;
}

interface LocalBookPosition {
  readonly locator: BookLocator;
  readonly revision?: BookRevision;
  readonly dirty: boolean;
}

function readLocal(storage: KeyValueStorage): Record<string, LocalBookPosition> {
  try {
    const value: unknown = JSON.parse(storage.getItem(BOOK_POSITIONS_STORAGE_KEY) ?? "{}");
    return isRecord(value) ? (value as Record<string, LocalBookPosition>) : {};
  } catch {
    return {};
  }
}

const sameSpot = (left: BookLocator | undefined, right: BookLocator) =>
  left !== undefined && left.resource === right.resource && left.characterOffset === right.characterOffset;

export function createOssicleBooks(options: OssicleBooksOptions): OssicleBooksAdapter {
  const { comics, output, storage, deviceId, narration } = options;
  const element = output.element;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const pollAttempts = options.pollAttempts ?? 40;
  const pollEveryMs = options.pollEveryMs ?? 1500;
  const changes = createEmitter<NowPlaying | undefined>();
  const local = readLocal(storage);
  const books = new Map<string, BookPublication>();

  let book: BookPublication | undefined;
  let item: Item | undefined;
  let timeline: NarrationTimeline | undefined;
  let batch: NarrationBatch | undefined;
  let batchStartMs = 0;
  let next: Promise<NarrationBatch | undefined> | undefined;
  let transport: Transport = "stopped";
  let failure: string | undefined;
  let pendingSeek: number | undefined;
  let run = 0;
  let syncing: Promise<void> | undefined;

  const saveLocal = () => {
    try {
      storage.setItem(BOOK_POSITIONS_STORAGE_KEY, JSON.stringify(local));
    } catch (error) {
      console.warn("Vela could not save book positions", error);
    }
  };

  const windowSec = () => pendingSeek ?? safeSeconds(element.currentTime);
  const positionSec = () => (batchStartMs + windowSec() * 1000) / 1000;

  const state = (): NowPlaying | undefined =>
    item === undefined
      ? undefined
      : {
          item,
          transport,
          positionSec: positionSec(),
          ...(transport === "error" && failure !== undefined ? { error: failure } : {}),
        };
  const publish = () => changes.emit(state());

  const fail = (message: string) => {
    transport = "error";
    failure = message;
    publish();
  };

  const itemFor = (publication: BookPublication, durationMs?: number): Item => ({
    source: "books",
    id: publication.id,
    title: publication.title,
    by: publication.authors.length > 0 ? publication.authors.join(", ") : "Unknown author",
    ...(publication.cover === undefined ? {} : { artUrl: comics.url(publication.cover) }),
    ...(durationMs === undefined || durationMs <= 0 ? {} : { durationSec: Math.round(durationMs / 1000) }),
  });

  async function refreshBooks(): Promise<void> {
    for (const publication of await comics.booksList()) books.set(publication.id, publication);
  }

  async function findBook(id: string): Promise<BookPublication> {
    let found = books.get(id);
    if (found === undefined) {
      await refreshBooks();
      found = books.get(id);
    }
    if (found === undefined) throw new Error("This book is not in the library");
    return found;
  }

  async function timelineFor(publication: BookPublication): Promise<NarrationTimeline> {
    try {
      const fresh = await comics.timeline(publication.id, publication.generation);
      await narration.putTimeline(publication.id, publication.generation, fresh).catch(() => undefined);
      return fresh;
    } catch (error) {
      const stored = await narration.timeline(publication.id, publication.generation).catch(() => undefined);
      if (stored !== undefined) return stored;
      throw error;
    }
  }

  async function prepareFrom(publication: BookPublication, line: NarrationTimeline, ordinal: number): Promise<NarrationBatch> {
    const stored = await narration.batch(publication.id, publication.generation, ordinal).catch(() => undefined);
    if (stored?.window !== undefined) return stored;
    const segment = line.segments.find((entry) => entry.ordinal === ordinal);
    if (segment === undefined) throw new Error("This book has no narratable text here");
    for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
      const prepared = await comics.prepare(publication.id, publication.generation, anchorFor(segment), DEFAULT_VOICE);
      if (prepared.window !== undefined) return prepared;
      // Synthesis is live: the window appears once the narration worker catches up.
      await sleep(pollEveryMs);
    }
    throw new Error("Narration is taking too long to prepare");
  }

  const ordinalAfter = (line: NarrationTimeline, prepared: NarrationBatch): number | undefined => {
    const last = prepared.segments[prepared.segments.length - 1];
    if (last === undefined) return undefined;
    return line.segments.find((segment) => segment.ordinal > last.ordinal)?.ordinal;
  };

  function prepareNext(): Promise<NarrationBatch | undefined> {
    const publication = book;
    const line = timeline;
    const current = batch;
    if (publication === undefined || line === undefined || current === undefined) return Promise.resolve(undefined);
    const ordinal = ordinalAfter(line, current);
    if (ordinal === undefined) return Promise.resolve(undefined);
    return prepareFrom(publication, line, ordinal).catch(() => undefined);
  }

  async function startBatch(prepared: NarrationBatch, offsetSec: number, autoplay: boolean): Promise<void> {
    const window = prepared.window;
    const first = prepared.segments[0];
    if (window === undefined || first === undefined || timeline === undefined) throw new Error("Narration window is missing");
    batch = prepared;
    batchStartMs = timeline.segments.find((segment) => segment.ordinal === first.ordinal)?.estimatedStartMs ?? 0;
    next = undefined;
    pendingSeek = Math.max(0, offsetSec);
    transport = autoplay ? "loading" : "paused";
    element.src = comics.url(window.audioUrl);
    publish();
    if (autoplay) await element.play();
  }

  async function jumpTo(ordinal: number, offsetSec: number, autoplay: boolean): Promise<void> {
    const publication = book;
    const line = timeline;
    if (publication === undefined || line === undefined) return;
    const mine = ++run;
    element.pause();
    transport = "loading";
    publish();
    try {
      const prepared = await prepareFrom(publication, line, ordinal);
      if (mine !== run) return;
      await startBatch(prepared, offsetSec, autoplay);
    } catch (error) {
      if (mine === run) fail(`This book could not continue: ${errorMessage(error)}`);
    }
  }

  const currentLocator = (): BookLocator | undefined => {
    if (book === undefined || timeline === undefined || batch?.window === undefined) return undefined;
    const index = windowIndexAt(batch.window.startsMs, windowSec() * 1000);
    const segment = batch.segments[index];
    return segment === undefined ? undefined : locatorForSegment(timeline, book.generation, segment);
  };

  const recordLocal = () => {
    const locator = currentLocator();
    if (book === undefined || locator === undefined) return;
    const known = local[book.id];
    if (sameSpot(known?.locator, locator)) return;
    local[book.id] = { locator, dirty: true, ...(known?.revision === undefined ? {} : { revision: known.revision }) };
    saveLocal();
  };

  const handlers = {
    loadedmetadata: () => {
      if (pendingSeek !== undefined) {
        const seek = pendingSeek;
        pendingSeek = undefined;
        element.currentTime = seek;
      }
      publish();
    },
    timeupdate: () => {
      recordLocal();
      publish();
    },
    play: () => {
      transport = "playing";
      if (next === undefined) next = prepareNext();
      publish();
    },
    pause: () => {
      if (transport === "playing") transport = "paused";
      recordLocal();
      publish();
    },
    ended: () => {
      recordLocal();
      const mine = run;
      void (async () => {
        void syncPosition().catch(() => undefined);
        const following = await (next ?? prepareNext());
        if (mine !== run) return;
        if (following === undefined) {
          transport = "stopped";
          publish();
          return;
        }
        await startBatch(following, 0, true).catch((error: unknown) => fail(`This book could not continue: ${errorMessage(error)}`));
      })();
    },
    error: () => {
      if (item === undefined || element.src === "") return;
      fail(`Narration could not play: ${element.error?.message ?? "the audio did not load"}`);
    },
  } as const;
  for (const [type, handler] of Object.entries(handlers)) element.addEventListener(type as keyof typeof handlers, handler);

  async function load(target: Item): Promise<void> {
    const mine = ++run;
    element.pause();
    item = target;
    transport = "loading";
    failure = undefined;
    batch = undefined;
    batchStartMs = 0;
    pendingSeek = 0;
    publish();
    const publication = await findBook(target.id);
    const [remote, line] = await Promise.all([
      comics.positionRead(publication.id, publication.generation).catch(() => undefined),
      timelineFor(publication),
    ]);
    if (mine !== run) return;
    book = publication;
    timeline = line;
    item = itemFor(publication, line.estimatedDurationMs);
    const stored = local[publication.id];
    let locator: BookLocator | undefined = stored?.locator;
    if (remote !== undefined && stored?.dirty !== true) {
      locator = remote.locator;
      local[publication.id] = { locator: remote.locator, revision: remote.revision, dirty: false };
      saveLocal();
    }
    const prepared = await prepareFrom(publication, line, startOrdinalFor(line, locator));
    if (mine !== run) return;
    await startBatch(prepared, 0, false);
    if (stored?.dirty === true) void syncPosition().catch(() => undefined);
  }

  function seek(targetSec: number): void {
    if (timeline === undefined || batch?.window === undefined) return;
    const total = timeline.estimatedDurationMs;
    const targetMs = Math.min(Math.max(0, targetSec * 1000), total > 0 ? total : Number.POSITIVE_INFINITY);
    const inside = targetMs - batchStartMs;
    if (inside >= 0 && inside < batch.window.durationMs) {
      if (pendingSeek !== undefined) pendingSeek = inside / 1000;
      else element.currentTime = inside / 1000;
      recordLocal();
      publish();
      return;
    }
    const segment = segmentAtTime(timeline, targetMs);
    if (segment === undefined) return;
    void jumpTo(segment.ordinal, 0, transport === "playing");
  }

  async function writePosition(): Promise<void> {
    recordLocal();
    if (book === undefined) return;
    const publication = book;
    const stored = local[publication.id];
    if (stored === undefined || !stored.dirty) return;
    let revision = stored.revision;
    let force = false;
    for (let round = 0; round < MAX_CONFLICT_ROUNDS; round += 1) {
      const result = await comics.positionWrite(publication.id, stored.locator, deviceId, revision, force);
      if (result.status === "accepted") {
        const latest = local[publication.id];
        local[publication.id] = {
          locator: latest?.locator ?? stored.locator,
          revision: result.position.revision,
          dirty: latest !== undefined && !sameSpot(stored.locator, latest.locator),
        };
        saveLocal();
        return;
      }
      if (result.status === "conflict") {
        const theirs = result.theirs;
        const mine = local[publication.id]?.locator ?? stored.locator;
        if (resolvePositionConflict(theirs.locator.wholeBookProgression, mine.wholeBookProgression).kind === "keepMine") {
          revision = theirs.revision;
          force = true;
          continue;
        }
        local[publication.id] = { locator: theirs.locator, revision: theirs.revision, dirty: false };
        saveLocal();
        if (book?.id === publication.id && timeline !== undefined) {
          await jumpTo(startOrdinalFor(timeline, theirs.locator), 0, transport === "playing");
        }
        return;
      }
      throw new Error(`The books server did not store the position (${result.detail})`);
    }
  }

  function syncPosition(): Promise<void> {
    if (syncing !== undefined) return syncing;
    syncing = writePosition().finally(() => {
      syncing = undefined;
    });
    return syncing;
  }

  return {
    source: "books",
    load,
    async play() {
      if (item === undefined || batch === undefined) return;
      try {
        await element.play();
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        fail(`Narration could not play: ${errorMessage(error)}`);
        throw error;
      }
    },
    pause: () => element.pause(),
    seek,
    back: () => seek(positionSec() - TALK_BACK_SEC),
    forward: () => seek(positionSec() + TALK_FORWARD_SEC),
    syncPosition,
    // The reader has no "recently heard" list; the Shelf keeps the device's own entry.
    lastItem: async () => undefined,
    async search(query) {
      await refreshBooks();
      const needle = query.trim().toLowerCase();
      return [...books.values()]
        .filter(
          (publication) =>
            needle === "" ||
            publication.title.toLowerCase().includes(needle) ||
            publication.authors.some((author) => author.toLowerCase().includes(needle)),
        )
        .slice(0, 50)
        .map((publication) => itemFor(publication));
    },
    subscribe: (listener) => changes.subscribe(listener),
    async narrationAhead(target, budgetMs) {
      const publication = await findBook(target.id);
      const line = await timelineFor(publication);
      let ordinal: number | undefined;
      if (book?.id === publication.id && batch?.segments[0] !== undefined) {
        ordinal = batch.segments[0].ordinal;
      } else {
        const remote = await comics.positionRead(publication.id, publication.generation).catch(() => undefined);
        ordinal = startOrdinalFor(line, local[publication.id]?.locator ?? remote?.locator);
      }
      const pieces: NarrationPiece[] = [];
      const kept = new Set<number>();
      let covered = 0;
      while (ordinal !== undefined && covered < budgetMs) {
        const prepared = await prepareFrom(publication, line, ordinal);
        await narration.putBatch(publication.id, publication.generation, ordinal, prepared);
        kept.add(ordinal);
        if (prepared.window !== undefined) {
          pieces.push({ url: comics.url(prepared.window.audioUrl), durationMs: prepared.window.durationMs });
          covered += prepared.window.durationMs;
        }
        ordinal = ordinalAfter(line, prepared);
      }
      await narration.retainOnly(publication.id, publication.generation, kept);
      return pieces;
    },
    dispose() {
      run += 1;
      for (const [type, handler] of Object.entries(handlers)) element.removeEventListener(type as keyof typeof handlers, handler);
      element.pause();
      changes.clear();
    },
  };
}
