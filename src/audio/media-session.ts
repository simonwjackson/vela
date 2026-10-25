/**
 * Media Session binding: lock screen, steering-wheel and car stereo buttons.
 *
 * The stereo's previous/next buttons map to `back`/`forward`, so their meaning follows the
 * Source: Music goes to the previous/next track; Podcasts and Books go back 15 s / forward 30 s.
 * The adapters own that meaning (see SourceAdapter.back/forward in the contract).
 */
import type { Listening, NowPlaying } from "../contract";

export interface MediaMetadataFields {
  readonly title: string;
  readonly artist: string;
  readonly album: string;
  readonly artwork: readonly { readonly src: string; readonly sizes?: string }[];
}

/** The part of `navigator.mediaSession` Vela uses. */
export interface MediaSessionLike {
  metadata: MediaMetadata | null;
  playbackState: MediaSessionPlaybackState;
  setActionHandler(action: MediaSessionAction, handler: MediaSessionActionHandler | null): void;
  setPositionState?(state?: MediaPositionState): void;
}

export interface MediaSessionOptions {
  /** Builds the platform metadata object. Default: `new MediaMetadata(fields)`. */
  readonly createMetadata?: (fields: MediaMetadataFields) => MediaMetadata;
}

export function metadataFieldsFor(nowPlaying: NowPlaying): MediaMetadataFields {
  const { item } = nowPlaying;
  return {
    title: item.title,
    artist: item.by,
    album: item.from ?? "",
    artwork: item.artUrl === undefined ? [] : [{ src: item.artUrl, sizes: "512x512" }],
  };
}

/** Chrome throws on positions past the duration or on non-finite numbers. */
export function positionStateFor(nowPlaying: NowPlaying): MediaPositionState | undefined {
  const duration = nowPlaying.item.durationSec;
  if (duration === undefined || !Number.isFinite(duration) || duration <= 0) return undefined;
  const position = Number.isFinite(nowPlaying.positionSec) ? nowPlaying.positionSec : 0;
  return { duration, playbackRate: 1, position: Math.min(Math.max(0, position), duration) };
}

const ACTIONS: readonly MediaSessionAction[] = [
  "play",
  "pause",
  "seekto",
  "previoustrack",
  "nexttrack",
  "seekbackward",
  "seekforward",
];

export function bindMediaSession(
  listening: Listening,
  session: MediaSessionLike,
  options: MediaSessionOptions = {},
): () => void {
  const createMetadata =
    options.createMetadata ?? ((fields: MediaMetadataFields) => new MediaMetadata({ ...fields, artwork: [...fields.artwork] }));
  const run = (promise: Promise<void>) => {
    promise.catch((error: unknown) => console.warn("Vela media button failed", error));
  };

  const handlers: Record<string, MediaSessionActionHandler> = {
    play: () => run(listening.send({ type: "play" })),
    pause: () => run(listening.send({ type: "pause" })),
    seekto: (details) => {
      if (details.seekTime !== undefined) run(listening.send({ type: "seek", positionSec: details.seekTime }));
    },
    previoustrack: () => run(listening.send({ type: "back" })),
    nexttrack: () => run(listening.send({ type: "forward" })),
    seekbackward: () => run(listening.send({ type: "back" })),
    seekforward: () => run(listening.send({ type: "forward" })),
  };
  for (const action of ACTIONS) {
    const handler = handlers[action];
    if (handler === undefined) continue;
    try {
      session.setActionHandler(action, handler);
    } catch {
      // Older browsers reject actions they do not know.
    }
  }

  let shownKey: string | undefined;
  const render = (nowPlaying: NowPlaying | undefined) => {
    if (nowPlaying === undefined) {
      session.metadata = null;
      session.playbackState = "none";
      shownKey = undefined;
      return;
    }
    const key = `${nowPlaying.item.source}:${nowPlaying.item.id}:${nowPlaying.item.title}`;
    if (key !== shownKey) {
      session.metadata = createMetadata(metadataFieldsFor(nowPlaying));
      shownKey = key;
    }
    session.playbackState =
      nowPlaying.transport === "playing" ? "playing" : nowPlaying.transport === "paused" ? "paused" : "none";
    const position = positionStateFor(nowPlaying);
    if (position !== undefined) {
      try {
        session.setPositionState?.(position);
      } catch {
        // Position state is decoration; a refusal must not break playback.
      }
    }
  };

  render(listening.nowPlaying);
  const unsubscribe = listening.subscribe(({ nowPlaying }) => render(nowPlaying));
  return () => {
    unsubscribe();
    for (const action of ACTIONS) {
      try {
        session.setActionHandler(action, null);
      } catch {
        // ignore
      }
    }
  };
}
