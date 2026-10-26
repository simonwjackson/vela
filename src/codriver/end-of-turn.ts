/**
 * End of a hands-free turn (after "Hey Vela"), decided on the phone from microphone levels.
 *
 * Counted in audio time, frame by frame, so it does not depend on timers:
 * - the turn ends ("said") after END_OF_TURN_SILENCE_MS of silence that follows speech;
 * - it ends with nothing said after NO_SPEECH_MS without any speech;
 * - it ends ("said") after MAX_TURN_MS whatever happens.
 *
 * Speech is a frame clearly above the noise floor. The floor is a low percentile of the last
 * FLOOR_WINDOW frames, seeded with the frames the wake word heard before the wake, so steady
 * road noise is the floor and the pauses between words keep it there. The numbers are
 * estimates until a field test (docs/backlog.md).
 */

export const END_OF_TURN_SILENCE_MS = 1_200;
export const NO_SPEECH_MS = 5_000;
export const MAX_TURN_MS = 30_000;
/** Frames (100 ms each) the noise floor looks back over. */
export const FLOOR_WINDOW = 50;
/** Speech is at least this many times the floor's RMS (10 dB). */
const SPEECH_OVER_FLOOR = 3.16;
/** And at least this RMS (about -50 dBFS), so near-silence never counts as speech. */
const MIN_SPEECH_RMS = 0.003;
const FLOOR_PERCENTILE = 0.1;

export type TurnVerdict = "continue" | "said" | "nothing-said";

export interface EndOfTurn {
  push(rms: number, frameMs: number): TurnVerdict;
}

function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] as number;
}

/** `before`: RMS of the frames heard before the turn, oldest first. */
export function createEndOfTurn(before: readonly number[] = []): EndOfTurn {
  const window = before.slice(-FLOOR_WINDOW);
  let heardSpeech = false;
  let silentMs = 0;
  let totalMs = 0;
  let done: TurnVerdict | undefined;

  return {
    push(rms, frameMs) {
      if (done) return done;
      totalMs += frameMs;
      const floor = window.length > 0 ? percentile(window, FLOOR_PERCENTILE) : Number.POSITIVE_INFINITY;
      const speech = rms >= MIN_SPEECH_RMS && rms > floor * SPEECH_OVER_FLOOR;
      window.push(rms);
      if (window.length > FLOOR_WINDOW) window.shift();
      if (speech) {
        heardSpeech = true;
        silentMs = 0;
      } else {
        silentMs += frameMs;
      }
      if (totalMs >= MAX_TURN_MS) done = "said";
      else if (heardSpeech && silentMs >= END_OF_TURN_SILENCE_MS) done = "said";
      else if (!heardSpeech && totalMs >= NO_SPEECH_MS) done = "nothing-said";
      return done ?? "continue";
    },
  };
}

/** The recent frame levels, for seeding an EndOfTurn. */
export class LevelHistory {
  private readonly levels: number[] = [];
  push(rms: number): void {
    this.levels.push(rms);
    if (this.levels.length > FLOOR_WINDOW) this.levels.shift();
  }
  snapshot(): readonly number[] {
    return [...this.levels];
  }
}
