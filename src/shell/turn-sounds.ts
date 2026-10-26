/**
 * The bridge between Navigation and Listening for Turn sounds: Navigation decides when,
 * Listening yields (Music ducks; Podcasts and Books pause and resume two seconds back),
 * and an earcon plays. The earcons here are placeholders until the sound design round.
 */
import type { Listening, NavEngine, TurnSound, TurnSoundEvent } from "../contract";

export interface Earcons {
  /** Play one earcon now. Resolves when it has finished. */
  play(sound: TurnSound): Promise<void>;
  readonly durationMs: Readonly<Record<TurnSound, number>>;
}

export interface Scheduler {
  now(): number;
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const browserScheduler: Scheduler = {
  now: () => Date.now(),
  setTimeout: (run, ms) => globalThis.setTimeout(run, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Wire Turn sounds. The engine emits each event `turnSoundLeadMs` before `heardAt`, so the
 * earcon starts at once to cover the Bluetooth delay; Listening yields for its duration.
 */
export function bridgeTurnSounds(nav: NavEngine, listening: Listening, earcons: Earcons, leadMs: number, scheduler: Scheduler = browserScheduler): () => void {
  const pending = new Set<unknown>();
  const fire = (event: TurnSoundEvent): void => playTurnSound(listening, earcons, event.sound);
  const off = nav.onTurnSound((event) => {
    // Start `leadMs` before the moment it should be heard, to cover the Bluetooth delay.
    const wait = Math.max(0, event.heardAt - leadMs - scheduler.now());
    if (wait === 0) return fire(event);
    const handle = scheduler.setTimeout(() => { pending.delete(handle); fire(event); }, wait);
    pending.add(handle);
  });
  return () => {
    off();
    for (const handle of pending) scheduler.clearTimeout(handle);
    pending.clear();
  };
}

/** Play one Turn sound now: Listening yields for its duration while the earcon plays. */
export function playTurnSound(listening: Listening, earcons: Earcons, sound: TurnSound): void {
  void listening.yieldForTurnSound(earcons.durationMs[sound]);
  void earcons.play(sound);
}

/** Placeholder earcons made with Web Audio tones. Replaced by designed sounds later. */
export function toneEarcons(context: () => AudioContext): Earcons {
  const notes: Record<TurnSound, readonly [number, number][]> = {
    approach: [[660, 140]],
    "turn-now": [[660, 110], [880, 160]],
    "off-route": [[440, 160], [370, 220]],
    arrived: [[523, 120], [659, 120], [784, 220]],
  };
  const durationMs = Object.fromEntries(Object.entries(notes).map(([k, seq]) => [k, seq.reduce((sum, [, ms]) => sum + ms + 40, 200)])) as Record<TurnSound, number>;
  return {
    durationMs,
    async play(sound) {
      const ctx = context();
      let at = ctx.currentTime + 0.05;
      for (const [hz, ms] of notes[sound]) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = hz;
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(0.35, at + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.001, at + ms / 1000);
        osc.connect(gain).connect(ctx.destination);
        osc.start(at);
        osc.stop(at + ms / 1000 + 0.02);
        at += (ms + 40) / 1000;
      }
      await new Promise((resolve) => setTimeout(resolve, durationMs[sound]));
    },
  };
}
