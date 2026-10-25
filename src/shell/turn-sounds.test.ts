import type { Listening, NavEngine, TurnSound, TurnSoundEvent } from "../contract";
import { type Earcons, type Scheduler, bridgeTurnSounds } from "./turn-sounds";

function fakes() {
  let emit: (event: TurnSoundEvent) => void = () => {};
  const nav = { onTurnSound: (listener: (event: TurnSoundEvent) => void) => { emit = listener; return () => { emit = () => {}; }; } } as unknown as NavEngine;
  const yields: number[] = [];
  const listening = { yieldForTurnSound: async (ms: number) => { yields.push(ms); } } as unknown as Listening;
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
  return { nav, listening, earcons, scheduler, yields, played, emit: (e: TurnSoundEvent) => emit(e), advance, timers };
}

test("an event that arrives on time plays at once and listening yields for the earcon's length", () => {
  const f = fakes();
  bridgeTurnSounds(f.nav, f.listening, f.earcons, 250, f.scheduler);
  f.emit({ sound: "turn-now", heardAt: 250 });
  expect(f.played).toEqual(["turn-now"]);
  expect(f.yields).toEqual([500]);
});

test("an event that arrives very early waits, and dispose cancels it", () => {
  const f = fakes();
  const off = bridgeTurnSounds(f.nav, f.listening, f.earcons, 250, f.scheduler);
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
