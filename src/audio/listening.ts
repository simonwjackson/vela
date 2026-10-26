/**
 * The Listening engine: one Now playing across Music, Podcasts and Books, the Shelf, and
 * how listening yields to Turn sounds.
 *
 * Rules this module owns:
 * - Only one Source plays at a time. Starting an Item pauses the other Source. If a Source
 *   starts playing by itself (a Pyxis console pressed Play on the car), it takes over and the
 *   previous Source pauses.
 * - The Shelf keeps the last Item of each Source and is persisted on the device. At start, an
 *   Item a Service reports as more recent (`SourceAdapter.lastItem`) replaces the stored one;
 *   when a Service cannot answer, the stored Shelf stays.
 * - Turn sounds: Music ducks and restores after the sound. Podcasts and Books pause and then
 *   resume TALK_RESUME_BACK_SEC earlier. A driver command during the yield cancels the
 *   automatic resume: the driver's intent wins.
 * - Co-driver speech (`holdForTalk`) yields the same way, for as long as the hold lasts. Holds
 *   nest; the last release restores. A Turn sound during a hold never restores early, and a
 *   Podcast or Book paused by a Turn sound when a hold begins resumes only after the hold.
 * - While something plays, the active adapter reports its position every `syncEveryMs`, and
 *   again whenever it pauses or loses the Now playing slot.
 */
import {
  type Item,
  type ListenCommand,
  type Listening,
  type NowPlaying,
  type Shelf,
  type SourceAdapter,
  type SourceId,
  TALK_RESUME_BACK_SEC,
} from "../contract";
import { createEmitter, errorMessage } from "./emitter";
import type { AudioOutput } from "./output";
import { type ShelfStore, sameItem } from "./shelf-store";

export interface ListeningSource {
  readonly adapter: SourceAdapter;
  /** The output the adapter plays through; Listening only changes its duck factor. */
  readonly output: AudioOutput;
}

export interface ListeningOptions {
  readonly sources: Readonly<Record<SourceId, ListeningSource>>;
  readonly shelfStore: ShelfStore;
  /** How often the playing adapter reports its position. Default 15 s. */
  readonly syncEveryMs?: number;
  /** Music gain under a Turn sound, 0..1. Default 0.25. */
  readonly duckFactor?: number;
}

export interface ListeningEngine extends Listening {
  /** Resolves when the Shelf has been refreshed from the Services (or they failed to answer). */
  readonly ready: Promise<void>;
  dispose(): void;
}

/** How a Source yields to a Turn sound. */
export type TurnSoundYield = "duck" | "pause-and-rewind";

export function turnSoundYield(source: SourceId): TurnSoundYield {
  return source === "music" ? "duck" : "pause-and-rewind";
}

export const DEFAULT_SYNC_EVERY_MS = 15_000;
export const DEFAULT_DUCK_FACTOR = 0.25;

const SOURCES: readonly SourceId[] = ["music", "podcasts", "books"];

interface TalkYield {
  readonly source: SourceId;
  readonly itemId: string;
  deadline: number;
  timer: ReturnType<typeof setTimeout> | undefined;
}

export function createListening(options: ListeningOptions): ListeningEngine {
  const { sources, shelfStore } = options;
  const duckFactor = options.duckFactor ?? DEFAULT_DUCK_FACTOR;
  const changes = createEmitter<{ nowPlaying: NowPlaying | undefined; shelf: Shelf }>();

  let shelf: Shelf = shelfStore.read();
  let active: SourceId | undefined;
  let nowPlaying: NowPlaying | undefined;
  let activation = 0;
  let disposed = false;
  const latest: Partial<Record<SourceId, NowPlaying | undefined>> = {};

  let duckDeadline = 0;
  let duckTimer: ReturnType<typeof setTimeout> | undefined;
  let talkYield: TalkYield | undefined;
  /** Co-driver speech holds; while any is open, Music stays ducked. */
  let holds = 0;
  /** A Podcast or Book paused for the Co-driver, resumed when the last hold ends. */
  let talkHold: { readonly source: SourceId; readonly itemId: string } | undefined;

  const publish = () => changes.emit({ nowPlaying, shelf });

  const putOnShelf = (item: Item) => {
    if (sameItem(shelf[item.source], item) && shelf[item.source]?.title === item.title) return;
    shelf = { ...shelf, [item.source]: item };
    shelfStore.write(shelf);
  };

  const sync = (source: SourceId) => {
    sources[source].adapter.syncPosition().catch((error: unknown) => {
      console.warn(`Vela could not report the ${source} position`, error);
    });
  };

  const restoreDuck = () => {
    if (duckTimer !== undefined) clearTimeout(duckTimer);
    duckTimer = undefined;
    duckDeadline = 0;
    sources.music.output.setDuck(holds > 0 ? duckFactor : 1);
  };

  const cancelTalkYield = () => {
    if (talkYield?.timer !== undefined) clearTimeout(talkYield.timer);
    talkYield = undefined;
    talkHold = undefined;
  };

  /** Seek back TALK_RESUME_BACK_SEC and play, if the same item still holds the slot. */
  const resumeBack = (source: SourceId, itemId: string, why: string) => {
    if (active !== source || nowPlaying?.item.id !== itemId) return;
    const adapter = sources[source].adapter;
    const position = latest[source]?.positionSec ?? nowPlaying.positionSec;
    adapter.seek(Math.max(0, position - TALK_RESUME_BACK_SEC));
    adapter.play().catch((error: unknown) => {
      console.warn(`Vela could not resume after ${why}`, error);
    });
  };

  const leave = (source: SourceId) => {
    const adapter = sources[source].adapter;
    adapter.pause();
    sync(source);
    if (source === "music") restoreDuck();
  };

  const onAdapterState = (source: SourceId, state: NowPlaying | undefined) => {
    latest[source] = state;
    if (source !== active && state?.transport === "playing") {
      // A Source started by itself (for example a Pyxis console). It takes the slot.
      const previous = active;
      active = source;
      activation += 1;
      cancelTalkYield();
      if (previous !== undefined) leave(previous);
    }
    if (source !== active) return;
    nowPlaying = state;
    if (state !== undefined) putOnShelf(state.item);
    publish();
  };

  const unsubscribers = SOURCES.map((source) =>
    sources[source].adapter.subscribe((state) => onAdapterState(source, state)),
  );

  const syncTimer = setInterval(() => {
    if (active !== undefined && nowPlaying?.transport === "playing") sync(active);
  }, options.syncEveryMs ?? DEFAULT_SYNC_EVERY_MS);

  async function activate(item: Item): Promise<void> {
    const mine = ++activation;
    cancelTalkYield();
    if (active !== undefined && active !== item.source) leave(active);
    active = item.source;
    nowPlaying = { item, transport: "loading", positionSec: 0 };
    putOnShelf(item);
    publish();
    const adapter = sources[item.source].adapter;
    try {
      await adapter.load(item);
      if (mine !== activation || disposed) return;
      await adapter.play();
    } catch (error) {
      if (mine !== activation || disposed) return;
      nowPlaying = {
        item,
        transport: "error",
        positionSec: latest[item.source]?.positionSec ?? 0,
        error: errorMessage(error),
      };
      publish();
    }
  }

  async function send(command: ListenCommand): Promise<void> {
    if (disposed) return;
    // A driver command ends any automatic resume after a Turn sound.
    cancelTalkYield();
    const adapter = active === undefined ? undefined : sources[active].adapter;
    switch (command.type) {
      case "playItem":
        return activate(command.item);
      case "resume": {
        const item = shelf[command.source];
        if (item === undefined) return;
        if (active === command.source && sameItem(nowPlaying?.item, item) && nowPlaying?.transport !== "error") {
          return adapter?.play();
        }
        return activate(item);
      }
      case "play":
        return adapter?.play();
      case "pause":
        if (adapter === undefined || active === undefined) return;
        adapter.pause();
        sync(active);
        return;
      case "toggle":
        if (nowPlaying?.transport === "playing" || nowPlaying?.transport === "loading") {
          return send({ type: "pause" });
        }
        return adapter?.play();
      case "back":
        adapter?.back();
        return;
      case "forward":
        adapter?.forward();
        return;
      case "seek":
        adapter?.seek(Math.max(0, command.positionSec));
        return;
    }
  }

  async function yieldForTurnSound(durationMs: number): Promise<void> {
    if (disposed || active === undefined) return;
    const source = active;
    const holdMs = Math.max(0, durationMs);
    const now = Date.now();

    if (turnSoundYield(source) === "duck") {
      if (nowPlaying?.transport !== "playing" && !sources.music.output.ducked) return;
      sources.music.output.setDuck(duckFactor);
      duckDeadline = Math.max(duckDeadline, now + holdMs);
      if (duckTimer !== undefined) clearTimeout(duckTimer);
      duckTimer = setTimeout(restoreDuck, duckDeadline - now);
      return;
    }

    if (talkYield === undefined) {
      if (nowPlaying?.transport !== "playing" || nowPlaying === undefined) return;
      talkYield = { source, itemId: nowPlaying.item.id, deadline: now + holdMs, timer: undefined };
      sources[source].adapter.pause();
    } else {
      talkYield.deadline = Math.max(talkYield.deadline, now + holdMs);
      if (talkYield.timer !== undefined) clearTimeout(talkYield.timer);
    }
    const pending = talkYield;
    pending.timer = setTimeout(() => {
      if (talkYield !== pending) return;
      talkYield = undefined;
      resumeBack(pending.source, pending.itemId, "a Turn sound");
    }, pending.deadline - now);
  }

  function beginHold(): void {
    sources.music.output.setDuck(duckFactor);
    if (active === undefined || turnSoundYield(active) === "duck") return;
    if (talkYield !== undefined) {
      // Paused by a Turn sound: the hold takes over, so it does not resume mid-answer.
      if (talkYield.timer !== undefined) clearTimeout(talkYield.timer);
      talkHold = { source: talkYield.source, itemId: talkYield.itemId };
      talkYield = undefined;
      return;
    }
    if (nowPlaying?.transport !== "playing") return;
    talkHold = { source: active, itemId: nowPlaying.item.id };
    sources[active].adapter.pause();
  }

  function endHold(): void {
    if (duckTimer === undefined) sources.music.output.setDuck(1);
    const held = talkHold;
    talkHold = undefined;
    if (held !== undefined) resumeBack(held.source, held.itemId, "the Co-driver spoke");
  }

  function holdForTalk(): () => void {
    if (disposed) return () => undefined;
    holds += 1;
    if (holds === 1) beginHold();
    let released = false;
    return () => {
      if (released || disposed) return;
      released = true;
      holds -= 1;
      if (holds === 0) endHold();
    };
  }

  const ready = (async () => {
    const answers = await Promise.all(
      SOURCES.map(async (source) => {
        try {
          return await sources[source].adapter.lastItem();
        } catch {
          return undefined;
        }
      }),
    );
    if (disposed) return;
    let changed = false;
    for (const item of answers) {
      if (item === undefined) continue;
      // Do not replace what the driver is listening to right now.
      if (item.source === active) continue;
      if (sameItem(shelf[item.source], item)) continue;
      shelf = { ...shelf, [item.source]: item };
      changed = true;
    }
    if (changed) {
      shelfStore.write(shelf);
      publish();
    }
  })();

  return {
    get nowPlaying() {
      return nowPlaying;
    },
    get shelf() {
      return shelf;
    },
    ready,
    send,
    search: (source, query) => sources[source].adapter.search(query),
    yieldForTurnSound,
    holdForTalk,
    subscribe(listener) {
      return changes.subscribe(listener);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearInterval(syncTimer);
      holds = 0;
      restoreDuck();
      cancelTalkYield();
      for (const unsubscribe of unsubscribers) unsubscribe();
      for (const source of SOURCES) sources[source].adapter.dispose();
      changes.clear();
    },
  };
}
