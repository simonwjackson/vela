import type { Item, NavEngine, TurnSound, TurnSoundEvent } from "../contract";
import { createListeningFixture, settle } from "../audio/testing/listening-fixture";
import { type Earcons, type Scheduler, bridgeTurnSounds, toneEarcons } from "./turn-sounds";

function fakes() {
  let emit: (event: TurnSoundEvent) => void = () => {};
  const nav = { onTurnSound: (listener: (event: TurnSoundEvent) => void) => { emit = listener; return () => { emit = () => {}; }; } } as unknown as NavEngine;
  const played: TurnSound[] = [];
  const earcons: Earcons = { durationMs: { approach: 300, "turn-now": 500, "off-route": 600, arrived: 700 }, play: async (s) => { played.push(s); } };
  let clock = 0;
  const timers: { at: number; run: () => void }[] = [];
  const scheduler: Scheduler = {
    now: () => clock,
    setTimeout: (run, ms) => { const t = { at: clock + ms, run }; timers.push(t); return t; },
    clearTimeout: (t) => { timers.splice(timers.indexOf(t as never), 1); },
  };
  const advance = (ms: number) => { clock += ms; for (const t of [...timers]) if (t.at <= clock) { timers.splice(timers.indexOf(t), 1); t.run(); } };
  return { nav, earcons, scheduler, played, emit: (e: TurnSoundEvent) => emit(e), advance, timers };
}

test("an event that arrives on time plays at once", () => {
  const f = fakes();
  bridgeTurnSounds(f.nav, f.earcons, 250, f.scheduler);
  f.emit({ sound: "turn-now", heardAt: 250 });
  expect(f.played).toEqual(["turn-now"]);
});

test("an event that arrives very early waits, and dispose cancels it", () => {
  const f = fakes();
  const off = bridgeTurnSounds(f.nav, f.earcons, 250, f.scheduler);
  f.emit({ sound: "approach", heardAt: 5_000 });
  expect(f.played).toEqual([]);
  f.advance(4_749);
  expect(f.played).toEqual([]);
  f.advance(1);
  expect(f.played).toEqual(["approach"]);
  f.emit({ sound: "arrived", heardAt: 20_000 });
  off();
  f.advance(30_000);
  expect(f.played).toEqual(["approach"]);
});


test("earcons peak about 9 dB above the old gain, below full scale", async () => {
  vi.useFakeTimers();
  try {
    const peaks: number[] = [];
    const gain = { gain: { setValueAtTime() {}, linearRampToValueAtTime(value: number) { peaks.push(value); }, exponentialRampToValueAtTime() {} }, connect() {} };
    const context = { currentTime: 0, destination: {}, createGain: () => gain, createOscillator: () => ({ frequency: { value: 0 }, connect: () => gain, start() {}, stop() {} }) } as unknown as AudioContext;
    const earcons = toneEarcons(() => context);
    for (const sound of ["approach", "turn-now", "off-route", "arrived"] as const) {
      const done = earcons.play(sound); await vi.runAllTimersAsync(); await done;
    }
    expect(peaks).toHaveLength(8);
    for (const peak of peaks) { expect(peak).toBeLessThan(1); expect(20 * Math.log10(peak / 0.35)).toBeCloseTo(9, 0); }
  } finally { vi.useRealTimers(); }
});


test.each(["music", "podcasts", "books"] as const)("a Sounds-only Turn sound leaves %s playing at full device volume", async (source) => {
  const fixture = createListeningFixture(); const { listening, elements } = fixture;
  const item: Item | undefined = source === "music" ? (await listening.search("music", "Gull"))[0] : source === "podcasts" ?
    { source, id: "e-4", title: "Gears of Glass", by: "The Quiet Engine" } : { source, id: "b-lantern", title: "The Lantern Keeper", by: "A. Invented" };
  if (!item) throw new Error("missing test item");
  await listening.send({ type: "playItem", item }); await settle();
  elements[source].advance(20); const volume = elements[source].volume;
  const f = fakes(); const stop = bridgeTurnSounds(f.nav, f.earcons, 250, f.scheduler);
  f.emit({ sound: "turn-now", heardAt: 250 }); await settle();
  expect(f.played).toEqual(["turn-now"]); expect(elements[source].paused).toBe(false); expect(elements[source].volume).toBe(volume);
  elements[source].advance(1); expect(listening.nowPlaying?.positionSec).toBe(21);
  stop(); listening.dispose();
});
