/**
 * Decides when Turn sounds are heard and emits each one `leadMs` before that moment,
 * so Bluetooth delay is covered. Between fixes it predicts the crossing time from speed.
 *
 * Invariant: every event is emitted at `heardAt - leadMs` (never later than the fix that
 * reveals the crossing, in which case it is heard `leadMs` after that fix).
 */
import type { Stop, TurnSound, TurnSoundEvent } from "../contract";

/** The approach sound plays about this many seconds before the Stop, at the current speed. */
export const APPROACH_SEC = 20;
export const TURN_NOW_SEC = 4;
export const ARRIVE_METERS = 30;
/** How far ahead to schedule from one fix; GPS gives about one fix per second. */
const PREDICT_HORIZON_MS = 1_200;

export function approachMeters(speedMps: number): number {
  return clamp(speedMps * APPROACH_SEC, 150, 1_200);
}

export function turnNowMeters(speedMps: number): number {
  return clamp(speedMps * TURN_NOW_SEC, 20, 150);
}

export interface TurnSoundUpdate {
  readonly nextStop: Stop;
  /** True when `nextStop` is the Destination or a waypoint arrival. */
  readonly isArrival: boolean;
  readonly metersToNext: number;
  readonly speedMps: number;
}

export interface TurnSoundOptions {
  readonly leadMs: number;
  readonly now: () => number;
  readonly emit: (event: TurnSoundEvent) => void;
}

export class TurnSoundScheduler {
  private readonly options: TurnSoundOptions;
  /** Keys of sounds already emitted or scheduled, e.g. "approach:4". */
  private readonly done = new Set<string>();
  /** Stops seen farther away than their approach distance; only those get an approach sound. */
  private readonly seenOutside = new Set<number>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(options: TurnSoundOptions) {
    this.options = options;
  }

  /** Forget everything; call on a new Route. */
  reset(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.done.clear();
    this.seenOutside.clear();
  }

  /** Emit a sound for something that already happened (off-route). */
  now(sound: TurnSound, stop?: Stop): void {
    const now = this.options.now();
    this.options.emit({ sound, heardAt: now + this.options.leadMs, ...(stop ? { stop } : {}) });
  }

  update(u: TurnSoundUpdate): void {
    const { nextStop: stop, metersToNext, speedMps } = u;
    const approachAt = approachMeters(speedMps);
    const actAt = u.isArrival ? ARRIVE_METERS : turnNowMeters(speedMps);

    if (metersToNext > approachAt) this.seenOutside.add(stop.index);
    if (this.seenOutside.has(stop.index) && metersToNext > actAt) {
      this.consider(`approach:${stop.index}`, "approach", stop, metersToNext - approachAt, speedMps);
    }
    this.consider(`act:${stop.index}`, u.isArrival ? "arrived" : "turn-now", stop, metersToNext - actAt, speedMps);
  }

  private consider(key: string, sound: TurnSound, stop: Stop, metersBefore: number, speedMps: number): void {
    if (this.done.has(key)) return;
    const { leadMs, now: clock } = this.options;
    const now = clock();
    if (metersBefore <= 0) {
      this.done.add(key);
      this.options.emit({ sound, heardAt: now + leadMs, stop });
      return;
    }
    if (speedMps < 0.5) return;
    // Whole milliseconds, so the timer fires exactly `leadMs` before `heardAt`.
    const msUntil = Math.round((metersBefore / speedMps) * 1000);
    if (msUntil > leadMs + PREDICT_HORIZON_MS) return;
    this.done.add(key);
    const heardAt = now + Math.max(msUntil, leadMs);
    const timer = setTimeout(
      () => {
        this.timers.delete(key);
        this.options.emit({ sound, heardAt, stop });
      },
      Math.max(0, msUntil - leadMs),
    );
    this.timers.set(key, timer);
  }
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
