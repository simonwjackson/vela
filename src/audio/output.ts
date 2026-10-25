/**
 * The audio output each Source adapter plays through: one media element plus a gain stage.
 *
 * Two parties change loudness for different reasons. The Source adapter sets the volume
 * (for Music, the Pyxis session volume). Listening ducks Music under a Turn sound. Keeping
 * them as two factors means a restore after a duck can never undo a volume change that
 * arrived during the duck.
 */

export type MediaEventType = "timeupdate" | "ended" | "error" | "loadedmetadata" | "play" | "pause" | "seeked";

/** The part of HTMLAudioElement that Vela uses. Tests use a scripted implementation. */
export interface MediaElement {
  src: string;
  currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  readonly error: { readonly message: string } | null;
  volume: number;
  play(): Promise<void>;
  pause(): void;
  removeAttribute(name: "src"): void;
  addEventListener(type: MediaEventType, listener: () => void): void;
  removeEventListener(type: MediaEventType, listener: () => void): void;
}

export interface AudioOutput {
  readonly element: MediaElement;
  /** Adapter-owned volume, 0..1. */
  setVolume(volume: number): void;
  /** Listening-owned duck factor, 0..1. 1 means not ducked. */
  setDuck(factor: number): void;
  readonly ducked: boolean;
}

const clamp01 = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1);

export function createAudioOutput(element: MediaElement): AudioOutput {
  let volume = 1;
  let duck = 1;
  const apply = () => {
    element.volume = volume * duck;
  };
  apply();
  return {
    element,
    setVolume(next) {
      volume = clamp01(next);
      apply();
    },
    setDuck(factor) {
      duck = clamp01(factor);
      apply();
    },
    get ducked() {
      return duck < 1;
    },
  };
}

/** Finite, non-negative seconds from a media element, or 0. */
export function safeSeconds(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** A known duration in seconds, or undefined while the element has none. */
export function knownDuration(element: MediaElement): number | undefined {
  return Number.isFinite(element.duration) && element.duration > 0 ? element.duration : undefined;
}
