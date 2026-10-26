/** Listening: Sources, Now playing and the Shelf. Words follow CONTEXT.md. */

export type SourceId = "music" | "podcasts" | "books";

/** One listenable thing, in a shape every view can draw without knowing its Service. */
export interface Item {
  readonly source: SourceId;
  /** Stable within its Source, e.g. a Pyxis track id, an Ossicle episode id, a book id. */
  readonly id: string;
  readonly title: string;
  /** Artist, show or author. */
  readonly by: string;
  /** Album, show or book title, when it differs from `by`. */
  readonly from?: string;
  /** Absolute URL; may be undefined, in which case views use the Source tint. */
  readonly artUrl?: string;
  readonly durationSec?: number;
}

export type Transport = "playing" | "paused" | "loading" | "stopped" | "error";

export interface NowPlaying {
  readonly item: Item;
  readonly transport: Transport;
  readonly positionSec: number;
  /** Plain-English reason when transport is "error". */
  readonly error?: string;
}

/** The last item heard from each Source. Tapping an entry resumes it. */
export type Shelf = Readonly<Record<SourceId, Item | undefined>>;

export type ListenCommand =
  | { readonly type: "play" }
  | { readonly type: "pause" }
  | { readonly type: "toggle" }
  /** Music: previous/next track. Podcasts and Books: back 15 s / forward 30 s. */
  | { readonly type: "back" }
  | { readonly type: "forward" }
  | { readonly type: "seek"; readonly positionSec: number }
  | { readonly type: "resume"; readonly source: SourceId }
  | { readonly type: "playItem"; readonly item: Item };

/** A Source adapter talks to exactly one Service for one Source. */
export interface SourceAdapter {
  readonly source: SourceId;
  /** Load an item ready to play, at its last known position. */
  load(item: Item): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  seek(positionSec: number): void;
  back(): void;
  forward(): void;
  /** Report the current position to the Service (revisioned for Ossicle, session status for Pyxis). */
  syncPosition(): Promise<void>;
  /** The most recently played item, for the Shelf. */
  lastItem(): Promise<Item | undefined>;
  search(query: string): Promise<readonly Item[]>;
  subscribe(listener: (state: NowPlaying | undefined) => void): () => void;
  dispose(): void;
}

/**
 * The single listening controller. Only one Source plays at a time.
 * Turn sounds: Music ducks under them; Podcasts and Books pause, then resume 2 seconds back.
 */
export interface Listening {
  readonly nowPlaying: NowPlaying | undefined;
  readonly shelf: Shelf;
  send(command: ListenCommand): Promise<void>;
  search(source: SourceId, query: string): Promise<readonly Item[]>;
  /** Called by the nav side around every Turn sound. Returns when listening has yielded. */
  yieldForTurnSound(durationMs: number): Promise<void>;
  /**
   * Called while the Co-driver speaks. Music ducks; Podcasts and Books pause. The returned
   * function releases the hold: Music restores, Podcasts and Books resume TALK_RESUME_BACK_SEC back.
   */
  holdForTalk(): () => void;
  subscribe(listener: (state: { nowPlaying: NowPlaying | undefined; shelf: Shelf }) => void): () => void;
}

export const TALK_RESUME_BACK_SEC = 2;
