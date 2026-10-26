/**
 * Live data for the spike: the dev fakes, set up by a scene, ticking once a second (the car moves
 * 15 m, playback moves 1 s, the clock runs). Bound parts read it through `textOf`, `placeOf` and
 * `mediaOf`; nothing in a program carries these values. Dev-only.
 */
import type { Guidance, Item, Place } from "../app/contract";
import { inputOf } from "../app/input";
import { type Memory, type Screen, type ScreenInput, type SheetState, type UiState, screen } from "../app/screen";
import { arrival, clockTime, cleanTitle, distance, distanceParts, duration, km, minutesOf, placeName, shortRoad } from "../core/format";
import type { GlyphName } from "../core/icons";
import { type Fakes, fakes } from "../dev/fakes";
import { NOW, fixtures } from "../dev/fixtures";
import { type Setup, scenario } from "../dev/scenarios";
import type { MediaKey, PlaceKey, ValueKey } from "./vocabulary";

/** Metres the car covers in one tick (54 km/h). */
export const TICK_M = 15;
export const TICK_MS = 1_000;

export interface Suggested {
  place: Place;
  /** How far ahead on the route, now. */
  meters: number;
  detourMin?: number;
  icon: GlyphName;
}

/** Data the contract does not carry yet: the spike's stand-ins (named in the README). */
export interface Extras {
  /** Distance to empty. */
  range?: number;
  weather?: { now: string; next?: string };
  suggest?: Suggested[];
  /** The co-driver's recommendation. */
  next?: Item;
  /** The drive that ended. */
  summary?: { meters: number; min: number; stops: number };
}

export interface SceneSetup {
  setup: Setup;
  extras: Extras;
}

export interface Scene {
  id: string;
  label: string;
  /** What is going on, in words: the model's context. */
  situation: string;
  build(f: Fakes, stress: boolean): SceneSetup;
}

/** A dev scenario as a scene: the same fakes `dev.html?state=<id>` mounts. */
export function fromScenario(id: string): (f: Fakes, stress: boolean) => SceneSetup {
  return (f, stress) => {
    const sc = scenario(id);
    if (!sc) throw new Error(`No dev scenario ${id}`);
    return { setup: sc.setup(f, fixtures(stress), stress) ?? {}, extras: {} };
  };
}

export interface LiveOptions {
  stress?: boolean;
  daylight?: boolean;
  /** No ticking: what the captures use, so a render matches dev.html at t = 0. */
  still?: boolean;
}

export interface Live {
  readonly scene: Scene;
  readonly f: Fakes;
  readonly extras: Extras;
  /** Seconds since the scene started. */
  readonly t: number;
  /** The app's own mapping of the fakes, with the sheet a program asks for. */
  screen(sheet?: SheetState["kind"]): Screen;
  input(): ScreenInput;
  subscribe(fn: () => void): () => void;
  /** Advance one tick by hand (tests, and the ticker). */
  tick(): void;
  dispose(): void;
}

export function createLive(scene: Scene, opts: LiveOptions = {}): Live {
  const f = fakes();
  const built = scene.build(f, opts.stress ?? false);
  const { setup, extras } = built;
  f.nav.readouts = { ...f.nav.readouts, daylight: opts.daylight ?? false };
  const ui: UiState = { typing: false, library: {}, ...setup.initial };
  const memory: Memory = { ...setup.memory };
  const fns = new Set<() => void>();
  let t = 0;
  const start = { guidance: guidanceOf(f), range: extras.range, suggest: extras.suggest?.map((s) => s.meters) };

  const input = (): ScreenInput =>
    inputOf(f, { now: NOW + t * 1000, online: setup.online ?? true, ui, memory, frame: { h: 553, keyboard: 0 }, version: "1a2b3c4", nav: f.nav.state, readouts: f.nav.readouts });

  function tick(): void {
    t++;
    const g0 = start.guidance;
    const st = f.nav.state;
    if (g0 && (st.kind === "guiding" || st.kind === "rerouting")) {
      // The next Stop comes closer; a few metres before it, the drive loops back (the fixture has one Stop).
      const span = Math.max(1, g0.metersToNext - 40);
      const moved = (t * TICK_M) % span;
      const g: Guidance = {
        ...st.guidance,
        metersToNext: g0.metersToNext - moved,
        secToNext: Math.max(1, g0.secToNext - t),
        secLeft: Math.max(60, g0.secLeft - t),
        metersLeft: Math.max(0, g0.metersLeft - t * TICK_M),
        progress: Math.min(1, g0.progress + (t * TICK_M) / Math.max(1, g0.route.totalMeters)),
      };
      f.nav.state = { ...st, guidance: g };
    }
    const np = f.listening.nowPlaying;
    if (np && np.transport === "playing") {
      const end = np.item.durationSec ?? Number.POSITIVE_INFINITY;
      f.listening.nowPlaying = { ...np, positionSec: Math.min(end, np.positionSec + 1) };
    }
    f.nav.readouts = { ...f.nav.readouts, clock: clockTime(NOW + t * 1000) };
    if (start.range !== undefined) extras.range = Math.max(0, start.range - t * TICK_M);
    extras.suggest?.forEach((s, i) => {
      s.meters = Math.max(0, (start.suggest?.[i] ?? s.meters) - t * TICK_M);
    });
    for (const fn of [...fns]) fn();
  }

  const timer = opts.still ? undefined : setInterval(tick, TICK_MS);
  // A tap on a key changes the fakes; redraw at once.
  const unsub = f.listening.subscribe(() => {
    for (const fn of [...fns]) fn();
  });

  return {
    scene,
    f,
    extras,
    get t() {
      return t;
    },
    screen: (sheet) => {
      const sh: SheetState | undefined = sheet === "route" ? { kind: "route", edit: false, confirmEnd: false } : ui.sheet;
      return screen({ ...input(), ui: { ...ui, sheet: sh } });
    },
    input,
    subscribe: (fn) => {
      fns.add(fn);
      return () => fns.delete(fn);
    },
    tick,
    dispose: () => {
      if (timer) clearInterval(timer);
      unsub();
      fns.clear();
    },
  };
}

function guidanceOf(f: Fakes): Guidance | undefined {
  const st = f.nav.state;
  return st.kind === "guiding" || st.kind === "rerouting" ? st.guidance : undefined;
}

// ---- Bound values ------------------------------------------------------------------------------

/** A value with a large figure: `num` + `unit`, or minutes (drawn as "1 h 35 min"). */
export type Figure = { num: string; unit: string } | { min: number };

const split = (text: string): { num: string; unit: string } => {
  const m = /^([\d.,]+)\s*(.*)$/.exec(text);
  return m ? { num: m[1] ?? text, unit: m[2] ?? "" } : { num: text, unit: "" };
};

export function figureOf(key: ValueKey, live: Live): Figure | undefined {
  const g = guidanceOf(live.f);
  const np = live.f.listening.nowPlaying;
  const sum = live.extras.summary;
  switch (key) {
    case "trip.left":
      return g ? { min: minutesOf(g.secLeft) } : undefined;
    case "trip.distance":
      return g ? split(km(g.metersLeft)) : undefined;
    case "car.range":
      return live.extras.range === undefined ? undefined : split(km(live.extras.range));
    case "playback.left": {
      const d = np?.item.durationSec;
      return np && d ? { min: Math.max(1, Math.round((d - np.positionSec) / 60)) } : undefined;
    }
    case "trip.driven":
      return sum ? split(km(sum.meters)) : undefined;
    case "trip.time":
      return sum ? { min: sum.min } : undefined;
    case "next.distance":
      return g ? distanceParts(g.metersToNext) : undefined;
    default:
      return undefined;
  }
}

/** The value as words, for a Fact. Undefined: no such data in this scene. */
export function textOf(key: ValueKey, live: Live): string | undefined {
  const fig = figureOf(key, live);
  if (fig) return "min" in fig ? duration(fig.min) : `${fig.num} ${fig.unit}`.trim();
  const g = guidanceOf(live.f);
  const st = live.f.nav.state;
  const now = NOW + live.t * 1000;
  const sum = live.extras.summary;
  switch (key) {
    case "nav.next":
      return g ? `${distance(g.metersToNext)} ${shortRoad(g.nextStop.street || g.nextStop.instruction)}` : undefined;
    case "trip.eta":
      return g ? arrival(g.arriveAt, now) : undefined;
    case "next.road":
      return g ? shortRoad(g.nextStop.street || g.nextStop.instruction) : undefined;
    case "weather.now":
      return live.extras.weather?.now;
    case "weather.next":
      return live.extras.weather?.next;
    case "playback.title": {
      const np = live.f.listening.nowPlaying;
      return np ? cleanTitle(np.item.title, np.item.by) : undefined;
    }
    case "trip.avg":
      return sum ? `${Math.round(sum.meters / 1000 / (sum.min / 60))} km/h` : undefined;
    case "trip.stops":
      return sum ? (sum.stops === 0 ? "No stops" : sum.stops === 1 ? "1 stop" : `${sum.stops} stops`) : undefined;
    case "dest.name":
      return st.kind === "arrived" || st.kind === "routing" ? placeName(st.destination.name) : g ? placeName(g.route.destination.name) : undefined;
    case "clock":
      return live.f.nav.readouts.clock;
    default:
      return undefined;
  }
}

export interface BoundPlace {
  place: Place;
  meters?: number | undefined;
  detourMin?: number | undefined;
  icon: GlyphName;
}

export function placeOf(key: PlaceKey, live: Live): BoundPlace | undefined {
  if (key === "dest") {
    const st = live.f.nav.state;
    const g = guidanceOf(live.f);
    const place = st.kind === "arrived" || st.kind === "routing" ? st.destination : g?.route.destination;
    return place ? { place, meters: g?.metersLeft, icon: "flag" } : undefined;
  }
  const s = live.extras.suggest?.[Number(key.split(".")[1])];
  return s ? { place: s.place, meters: s.meters, detourMin: s.detourMin, icon: s.icon } : undefined;
}

export function mediaOf(key: MediaKey, live: Live): Item | undefined {
  return key === "media.now" ? live.f.listening.nowPlaying?.item : live.extras.next;
}

/** Every key with its value now: the data half of the model's context. */
export function contextData(live: Live): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const keys: ValueKey[] = ["nav.next", "trip.left", "trip.distance", "trip.eta", "next.road", "next.distance", "car.range", "weather.now", "weather.next", "playback.title", "playback.left", "trip.driven", "trip.time", "trip.avg", "trip.stops", "dest.name", "clock"];
  for (const k of keys) {
    const v = textOf(k, live);
    if (v !== undefined) out[k] = v;
  }
  const np = live.f.listening.nowPlaying;
  if (np) out.playback = { source: np.item.source, title: cleanTitle(np.item.title, np.item.by), by: np.item.by, transport: np.transport };
  for (const k of ["suggest.0", "suggest.1", "suggest.2", "dest"] as const) {
    const p = placeOf(k, live);
    if (p) out[k] = { name: placeName(p.place.name), address: p.place.address, ahead: p.meters === undefined ? undefined : distance(p.meters), detour: p.detourMin === undefined ? undefined : `${p.detourMin} min` };
  }
  const next = live.extras.next;
  if (next) out["media.next"] = { source: next.source, title: next.title, by: next.by, length: next.durationSec ? duration(Math.round(next.durationSec / 60)) : undefined };
  const st = live.f.nav.state;
  out.route = st.kind === "guiding" ? "guiding" : st.kind;
  return out;
}
