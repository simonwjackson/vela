/**
 * The live data a Moment binds to, read from what Vela already holds: the mapping's input (the
 * engines' state and what the screen remembers), the Screen it maps to, and the car's readings.
 * Pure: the same input gives the same values, so the renderer redraws each tick and the program
 * never changes. Undefined means "no such data now" (the gate refuses a part bound to it).
 */
import type { CarReadings, CarState, Guidance, Item, Weather, WeatherStretch } from "../app/contract";
import type { Screen, ScreenInput } from "../app/screen";
import { arrival, cleanTitle, distance, distanceParts, duration, km, minutesOf, placeName, shortRoad } from "../core/format";
import { viaTicks, currentRoad } from "../app/screen";
import type { BarKey, FactKey, NameKey, SequenceKey, ValueKey } from "./keys";
import { NAME_KEYS } from "./keys";

export interface MomentData {
  readonly input: ScreenInput;
  /** The Screen `input` maps to (app/screen.ts screen()). */
  readonly screen: Screen;
  readonly weather: Pick<Weather, "stretches">;
  readonly car: { readonly state: CarState; readonly readings: CarReadings };
}

/** A figure: `num` + `unit`, or minutes (drawn "1 h 35 min"). */
export type Figure = { num: string; unit: string } | { min: number };

export function guidanceOf(d: MomentData): Guidance | undefined {
  const n = d.input.nav;
  return n.kind === "guiding" || n.kind === "rerouting" ? n.guidance : undefined;
}

const split = (text: string): { num: string; unit: string } => {
  const m = /^([+\-\d.,:]+)\s*(.*)$/.exec(text);
  return m ? { num: m[1] ?? text, unit: m[2] ?? "" } : { num: text, unit: "" };
};

/** Readings older than this are not shown as live (the adapter went quiet). */
export const STALE_READING_MS = 60_000;

function reading(d: MomentData): CarReadings | undefined {
  const r = d.car.readings;
  if (d.car.state.kind !== "connected" || !r.at || d.input.now - r.at > STALE_READING_MS) return undefined;
  return r;
}

/** The trip that ended, while arrived: the route as planned (distance, time). */
function ended(d: MomentData): { meters: number; sec: number } | undefined {
  if (d.input.nav.kind !== "arrived") return undefined;
  const r = d.input.memory.lastGuidance?.route;
  return r ? { meters: r.totalMeters, sec: r.totalSec } : undefined;
}

const weatherNext = (d: MomentData): WeatherStretch | undefined => guidanceOf(d) && d.weather.stretches.some((s) => s.current) ? d.weather.stretches.find((s) => !s.current) : undefined;
const rain = (d: MomentData): WeatherStretch | undefined => guidanceOf(d) ? d.weather.stretches.find((s) => s.kind === "rain") : undefined;

const nowPlaying = (d: MomentData) => d.input.nowPlaying;

export function figureOf(key: ValueKey, d: MomentData): Figure | undefined {
  const g = guidanceOf(d);
  const np = nowPlaying(d);
  const r = reading(d);
  const end = ended(d);
  switch (key) {
    case "weather.change.in": {
      const next = weatherNext(d);
      return next ? split(km(next.fromKm * 1000)) : undefined;
    }
    case "weather.rain.in": {
      const wet = rain(d);
      return wet && !wet.current ? split(km(wet.fromKm * 1000)) : undefined;
    }
    case "weather.rain.length": {
      const wet = rain(d);
      return wet ? split(km((wet.toKm - wet.fromKm) * 1000)) : undefined;
    }
    case "weather.rain.at": {
      const wet = rain(d);
      return wet && !wet.current && g && g.metersLeft > 0 ? split(arrival(d.input.now + g.secLeft * 1000 * (wet.fromKm * 1000 / g.metersLeft), d.input.now)) : undefined;
    }
    case "trip.left":
      return g ? { min: minutesOf(g.secLeft) } : undefined;
    case "trip.distance":
      return g ? split(km(g.metersLeft)) : undefined;
    case "trip.eta":
      return g ? split(arrival(g.arriveAt, d.input.now)) : undefined;
    case "next.distance":
      return g ? distanceParts(g.metersToNext) : undefined;
    case "stop.next.in":
      return g?.nextVia ? { min: minutesOf(g.nextVia.secTo) } : undefined;
    case "stop.next.eta":
      return g?.nextVia ? split(arrival(g.nextVia.arriveAt, d.input.now)) : undefined;
    case "stops.left": {
      const n = g ? viaAhead(g) : 0;
      return g && n > 0 ? { num: String(n), unit: n === 1 ? "stop" : "stops" } : undefined;
    }
    case "playback.left": {
      const dur = np?.item.durationSec;
      return np && dur ? { min: Math.max(1, Math.round((dur - np.positionSec) / 60)) } : undefined;
    }
    case "playback.spare": {
      const dur = np?.item.durationSec;
      if (!np || !dur || !g) return undefined;
      const spare = Math.round((g.secLeft - (dur - np.positionSec)) / 60);
      return spare > 0 ? { min: spare } : undefined;
    }
    case "car.range":
      return r?.rangeKm !== undefined ? split(km(r.rangeKm * 1000)) : undefined;
    case "range.short":
      return r?.rangeKm !== undefined && g && g.metersLeft > r.rangeKm * 1000 ? split(km(g.metersLeft - r.rangeKm * 1000)) : undefined;
    case "car.fuel":
      return r?.fuelPercent !== undefined ? { num: String(Math.round(r.fuelPercent)), unit: "%" } : undefined;
    case "car.ambient":
      return r?.ambientC !== undefined ? { num: String(Math.round(r.ambientC)).replace(/^-/, "\u2212"), unit: "°C" } : undefined;
    case "car.coolant":
      return r?.coolantC !== undefined ? { num: String(Math.round(r.coolantC)), unit: "°C" } : undefined;
    case "car.voltage":
      return r?.voltage !== undefined ? { num: r.voltage.toFixed(1), unit: "V" } : undefined;
    case "trip.driven":
      return end ? split(km(end.meters)) : undefined;
    case "trip.time":
      return end ? { min: minutesOf(end.sec) } : undefined;
    case "trip.avg":
      return end && end.sec > 0 ? { num: String(Math.round(end.meters / 1000 / (end.sec / 3600))), unit: "km/h" } : undefined;
  }
}

/** Stops on the way not yet reached: from the next one to the last before the Destination. */
function viaAhead(g: Guidance): number {
  const via = g.route.via;
  if (!g.nextVia) return 0;
  const i = via.findIndex((p) => p.name === g.nextVia?.place.name && p.lat === g.nextVia?.place.lat);
  return i < 0 ? 1 : via.length - i;
}

export function nameOf(key: NameKey, d: MomentData): string | undefined {
  const g = guidanceOf(d);
  const np = nowPlaying(d);
  const nav = d.input.nav;
  switch (key) {
    case "weather.now":
      return g ? d.weather.stretches.find((s) => s.current)?.label : undefined;
    case "weather.next":
      return weatherNext(d)?.label;
    case "dest": {
      const p = nav.kind === "arrived" || nav.kind === "routing" ? nav.destination : g?.route.destination;
      return p ? placeName(p.name) : undefined;
    }
    case "next.road":
      return g ? (g.nextStop.maneuver === "arrive" ? placeName(g.route.destination.name) : shortRoad(g.nextStop.street || g.nextStop.instruction)) || undefined : undefined;
    case "road.now":
      return g ? currentRoad(g) : undefined;
    case "stop.next":
      return g?.nextVia ? placeName(g.nextVia.place.name) : undefined;
    case "media.now":
      return np ? cleanTitle(np.item.title, np.item.by) : undefined;
    case "media.by":
      return np?.item.by || undefined;
    case "car.codes": {
      const r = reading(d);
      return r?.dtcs?.length ? r.dtcs.join(", ") : undefined;
    }
  }
}

const NAMES = new Set<string>(NAME_KEYS);

/** A Fact's value as words. */
export function textOf(key: FactKey, d: MomentData): string | undefined {
  if (NAMES.has(key)) return nameOf(key as NameKey, d);
  const fig = figureOf(key as ValueKey, d);
  if (!fig) return undefined;
  return "min" in fig ? duration(fig.min) : `${fig.num}${fig.unit === "%" ? "" : " "}${fig.unit}`.trim();
}

export function barOf(key: BarKey, d: MomentData): { fraction: number; ticks?: readonly number[] } | undefined {
  const g = guidanceOf(d);
  const r = reading(d);
  switch (key) {
    case "trip":
      return g ? { fraction: g.progress, ticks: viaTicks(g.route) } : undefined;
    case "playback": {
      const np = nowPlaying(d);
      const dur = np?.item.durationSec;
      return np && dur ? { fraction: np.positionSec / dur } : undefined;
    }
    case "range":
      return r?.rangeKm !== undefined && g ? { fraction: Math.min(1, (r.rangeKm * 1000) / Math.max(1, g.metersLeft)) } : undefined;
    case "fuel":
      return r?.fuelPercent !== undefined ? { fraction: Math.max(0, Math.min(1, r.fuelPercent / 100)) } : undefined;
  }
}

export interface SeqItem {
  label: string;
  sub?: string;
  /** Where it sits, 0..1 of the sequence. */
  at: number;
  /** Interval endpoints and condition flags let the renderer add a weather highlight. */
  to?: number;
  marked?: boolean;
  current?: boolean;
}

/** The stops on the way still ahead, then the Destination, placed along what is left of the route. */
export function sequenceOf(key: SequenceKey, d: MomentData): SeqItem[] | undefined {
  if (key === "weather.stretches" || key === "route.weather") {
    const stretches = d.weather.stretches;
    if (!guidanceOf(d) || !stretches.length) return undefined;
    const end = Math.max(...stretches.map((s) => s.toKm), 1);
    return stretches.map((s) => ({ label: s.label, sub: s.current ? "now" : `in ${km(s.fromKm * 1000)}`,
      at: s.fromKm / end, to: s.toKm / end, marked: s.kind !== "clear", current: s.current }));
  }
  const g = guidanceOf(d);
  if (!g || !g.nextVia) return undefined;
  const r = g.route;
  const ticks = viaTicks(r);
  const done = r.totalMeters - g.metersLeft;
  const left = Math.max(1, g.metersLeft);
  const first = Math.max(0, r.via.findIndex((p) => p.name === g.nextVia?.place.name && p.lat === g.nextVia?.place.lat));
  const out: SeqItem[] = [];
  for (let i = first; i < r.via.length; i++) {
    const p = r.via[i];
    if (!p) continue;
    const t = ticks[i];
    const ahead = i === first ? g.nextVia.metersTo : t !== undefined ? t * r.totalMeters - done : undefined;
    if (ahead === undefined || ahead < 0) continue;
    out.push({ label: placeName(p.name), sub: distance(ahead), at: Math.min(1, ahead / left) });
  }
  out.push({ label: placeName(r.destination.name), sub: km(g.metersLeft), at: 1 });
  return out;
}

export function mediaOf(d: MomentData): Item | undefined {
  return nowPlaying(d)?.item;
}

/** Every key with data now, with its value as words: what the gate checks typed copy against. */
export function boundTexts(d: MomentData, keys: readonly FactKey[]): [FactKey, string][] {
  const out: [FactKey, string][] = [];
  for (const k of keys) {
    const t = textOf(k, d);
    if (t !== undefined) out.push([k, t]);
  }
  return out;
}
