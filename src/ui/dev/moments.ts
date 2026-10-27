/**
 * Moment scenes for dev-moments.html and the tests: a dev scenario, the car's readings, and the
 * moment.show the stand-in assistant sends. Fictional data only, like fixtures.ts. Not in the
 * production bundle.
 */
import type { CarReadings, MomentShow, NavState, Place } from "../app/contract";
import { inputOf } from "../app/input";
import { type Memory, screen } from "../app/screen";
import type { MomentData } from "../moment/data";
import { COMPOSED_EXAMPLES } from "../moment/examples";
import type { Fakes } from "./fakes";
import { NOW, fixtures, guidance } from "./fixtures";
import { type Setup, scenario } from "./scenarios";

export interface MomentScene {
  id: string;
  label: string;
  /** The dev scenario it starts from. */
  scenario: string;
  /** Change the fakes after the scenario's setup (the car, the route). */
  tweak?: (f: Fakes, stress: boolean) => void;
  show: (stress: boolean) => MomentShow;
}

const composed = (id: string): string => COMPOSED_EXAMPLES.find(([s]) => s === id)?.[1] ?? "";
const place = (name: string, i: number): Place => ({ name, lat: 0.6 + i * 0.01, lng: -0.7 - i * 0.01 });

/** The car's readings, normal or worst case (old car, long drive, many codes). */
export function carReadings(stress: boolean, more: Partial<CarReadings> = {}): CarReadings {
  return stress
    ? { at: NOW, fuelPercent: 100, rangeKm: 1240, ambientC: -18, coolantC: 118, voltage: 11.2, mil: true, dtcs: ["P0420", "P0171", "P0300", "U0100", "B1342", "C0035"], ...more }
    : { at: NOW, fuelPercent: 62, rangeKm: 410, ambientC: 14, coolantC: 89, voltage: 14.1, mil: false, dtcs: [], ...more };
}

const connect = (f: Fakes, r: CarReadings) => f.car.set({ kind: "connected" }, r);

export const MOMENT_SCENES: readonly MomentScene[] = [
  {
    id: "fuel",
    label: "Range short, after the turn",
    scenario: "near",
    // The short route is 54 km; the stress route is longer still.
    tweak: (f, stress) => connect(f, carReadings(stress, { fuelPercent: stress ? 2 : 7, rangeKm: stress ? 3.4 : 30 })),
    show: () => ({
      type: "moment.show",
      id: "m-fuel",
      program: composed("range-short"),
      say: "Fuel is low: about 30 kilometres left, and Northgate is 54 away. Shall I find fuel on the way?",
      when: "after-turn",
      until: { event: "stop.added" },
      chip: "Fuel low",
      cause: { event: "e-range" },
    }),
  },
  {
    id: "arrived",
    label: "Arrived, a summary with Details",
    scenario: "arrived",
    tweak: (f, stress) => connect(f, carReadings(stress)),
    show: () => ({
      type: "moment.show",
      id: "m-arrived",
      program: composed("arrived"),
      say: "You're in Northgate. A calm drive, just under an hour.",
      when: "now",
      until: { seconds: 600 },
      cause: { event: "e-arrived" },
    }),
  },
  {
    id: "stops",
    label: "Stops ahead on a long leg",
    scenario: "far",
    tweak: (f, stress) => {
      const x = fixtures(stress);
      const names = stress ? x.plan.via.map((v) => v.place) : [place("Harbour Fuel", 1), place("Fernley Market", 2), place("Coast Road Services", 3)];
      const ticks = stress ? [0.08, 0.17, 0.22, 0.4, 0.54, 0.67, 0.9] : [0.1, 0.35, 0.7];
      const first = names[0] as Place;
      const r = { ...x.long.route, via: names.map((p, i) => ({ place: p, at: ticks[i] ?? 0.5 })), nextVia: { place: first, min: 40, arriveAt: NOW + 40 * 60_000 } };
      f.nav.state = { kind: "guiding", guidance: guidance(r, { nextVia: { place: first, metersTo: (ticks[0] ?? 0.1) * r.km * 1000, secTo: 2400, arriveAt: NOW + 40 * 60_000 } }) } as NavState;
    },
    show: (stress) => ({
      type: "moment.show",
      id: "m-stops",
      program: composed("long-leg"),
      say: stress ? "Seven stops on the way. The first is a while off." : "Three stops on the way. Harbour Fuel comes first, in about 40 minutes.",
      when: "now",
      until: { event: "stop.reached" },
      cause: { event: "e-setting-off" },
    }),
  },
  {
    id: "weather",
    label: "Weather ahead on a long leg",
    scenario: "far",
    tweak: (f, stress) =>
      f.weather.set(
        stress
          ? [
              { fromKm: 0, toKm: 4, kind: "fog", label: "Freezing fog patches near Kessler Junction", current: true },
              { fromKm: 4, toKm: 9, kind: "clear", label: "Clear", current: false },
              { fromKm: 9, toKm: 41, kind: "rain", label: "Heavy rain and spray, slow traffic", current: false },
              { fromKm: 41, toKm: 47, kind: "storm", label: "Thunderstorms with hail", current: false },
              { fromKm: 47, toKm: 60, kind: "snow", label: "Wet snow on the Coast Road", current: false },
            ]
          : [
              { fromKm: 0, toKm: 12, kind: "clear", label: "Clear", current: true },
              { fromKm: 12, toKm: 31, kind: "rain", label: "Heavy rain", current: false },
              { fromKm: 31, toKm: 60, kind: "clear", label: "Clear", current: false },
            ],
      ),
    show: () => ({
      type: "moment.show",
      id: "m-weather",
      program: `root = Screen([lead, ahead, trip])
lead = Lead(Row([Value("weather.rain.in"), Label("to the rain")]))
ahead = Stack([Sequence("weather.stretches"), Fact("Lasts", "weather.rain.length")])
trip = TripRow()`,
      say: "Rain on the road ahead, for a stretch. It clears again before the next turn.",
      when: "now",
      until: { seconds: 300 },
      cause: { event: "e-weather-ahead" },
      silent: true,
    }),
  },
  {
    id: "engine",
    label: "Check engine, asked through Talk",
    scenario: "far",
    tweak: (f, stress) => connect(f, carReadings(stress, { mil: true, dtcs: stress ? (carReadings(true).dtcs ?? []) : ["P0420", "P0171"] })),
    show: () => ({
      type: "moment.show",
      id: "m-engine",
      program: `root = Screen([lead, codes, readings, trip])
lead = Lead(Row([Glyph("engine"), Label("Check engine")]))
codes = Name("car.codes", "tertiary")
readings = Facts([Fact("Coolant", "car.coolant"), Fact("Battery", "car.voltage")])
trip = TripRow()`,
      say: "The check-engine light is on. The codes point at the catalytic converter and a lean mixture; it is safe to keep driving, but book a garage.",
      when: "now",
      until: { seconds: 120 },
      cause: { talk: true },
    }),
  },
  {
    id: "refused",
    label: "A Moment the gate refuses",
    scenario: "near",
    show: () => ({
      type: "moment.show",
      id: "m-refused",
      program: `root = Screen([a, b, note, trip])
a = Lead(Value("trip.left"))
b = Lead(Value("trip.distance"))
note = Text("Northgate is a long way off, so settle in and enjoy the music while you drive there")
trip = TripRow()`,
      say: "Settle in and enjoy the music.",
      when: "now",
      until: { seconds: 60 },
      cause: { event: "e-long-leg" },
    }),
  },
];

export const momentScene = (id: string): MomentScene | undefined => MOMENT_SCENES.find((s) => s.id === id);

/** Set up the fakes for a scene; returns the scenario's setup (the mount's initial state). */
export function setUp(sc: MomentScene, f: Fakes, stress: boolean): Setup {
  const base = scenario(sc.scenario);
  if (!base) throw new Error(`No dev scenario ${sc.scenario}`);
  const setup = base.setup(f, fixtures(stress), stress) ?? {};
  sc.tweak?.(f, stress);
  return setup;
}

/** Move the car past the next turn: the following one is 2.4 km on. */
export function passTurn(f: Fakes): void {
  const st = f.nav.state;
  if (st.kind !== "guiding" && st.kind !== "rerouting") return;
  const g = st.guidance;
  const next = { ...g.nextStop, index: g.nextStop.index + 1, maneuver: "left" as const, street: "Harbour Ring Road", instruction: "Harbour Ring Road", routeMeters: g.nextStop.routeMeters + 2_400 };
  const { thenStop: _then, ...rest } = g;
  void _then;
  f.nav.set({ ...st, guidance: { ...rest, nextStop: next, metersToNext: 2_400, secToNext: 160, metersLeft: Math.max(0, g.metersLeft - g.metersToNext), secLeft: Math.max(60, g.secLeft - 30) } });
}

/** The Moment data the mount would hand the renderer, for tests and the gate. */
export function dataOf(f: Fakes, setup: Setup = {}, memory: Partial<Memory> = {}): MomentData {
  const input = inputOf(f, {
    now: NOW,
    online: setup.online ?? true,
    ui: { typing: false, library: {}, ...setup.initial },
    memory: { ...setup.memory, ...memory },
    frame: { h: 553, keyboard: 0 },
    version: "1a2b3c4",
  });
  return { input, screen: screen(input), weather: f.weather, car: { state: f.car.state, readings: f.car.readings } };
}
