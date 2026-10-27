/** Public SurfaceLink projection, change budgets and the whole-frame byte limit. */
import type { CarContext, CarLink, ContextUpdate, NavState, NowPlaying, SoundMode, TripContext, Weather } from "../contract";
export const CONTEXT_MIN_MS = 10_000;
export const CONTEXT_EVERY_MS = 30_000;
export const CONTEXT_MAX_BYTES = 2048;
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const finite = (value: number | undefined): value is number => value !== undefined && Number.isFinite(value);
const rounded = (value: number) => Math.round(value * 100) / 100;
function text(value: string, maxBytes: number): string {
  let result = ""; let used = 0;
  for (const c of value) { const n = new TextEncoder().encode(c).length; if (used + n > maxBytes) break; result += c; used += n; }
  return result;
}
export function tripContext(state: NavState): TripContext | undefined {
  if (state.kind !== "guiding" && state.kind !== "rerouting") return undefined;
  const g = state.guidance;
  return { destination: { name: g.route.destination.name, lat: g.route.destination.lat, lng: g.route.destination.lng },
    guidance: { metersLeft: g.metersLeft, secLeft: g.secLeft, arriveAt: g.arriveAt, metersToNext: g.metersToNext, progress: g.progress },
    nextInstruction: g.nextStop.instruction };
}
function carContext(car: CarLink): CarContext {
  if (car.state.kind !== "connected") return {};
  const r = car.readings;
  return {
    ...(finite(r.fuelPercent) ? { fuelPercent: r.fuelPercent } : {}),
    ...(finite(r.rangeKm) ? { rangeKm: r.rangeKm } : {}),
    ...(finite(r.ambientC) ? { ambientC: r.ambientC } : {}),
    ...(r.mil !== undefined ? { mil: r.mil } : {}),
    ...(r.dtcs ? { dtcCount: r.dtcs.length } : {}),
  };
}
export function contextSnapshot(options: {
  state: NavState; nowPlaying?: NowPlaying | undefined; soundMode?: SoundMode | undefined;
  car?: CarLink | undefined; weather?: Weather | undefined;
}): ContextUpdate {
  const trip = tripContext(options.state);
  const g = options.state.kind === "guiding" || options.state.kind === "rerouting" ? options.state.guidance : undefined;
  const vias = g?.nextVias ?? (g?.nextVia ? [g.nextVia] : []);
  const np = options.nowPlaying;
  const weather = options.weather;
  const base: ContextUpdate = {
    type: "context.update",
    ...(options.soundMode ? { soundMode: options.soundMode } : {}),
    ...(trip ? { trip } : {}),
    ...(np ? { nowPlaying: { item: { source: np.item.source, id: np.item.id, title: np.item.title, by: np.item.by,
      ...(np.item.from ? { from: np.item.from } : {}), ...(finite(np.item.durationSec) ? { durationSec: np.item.durationSec } : {}) },
      transport: np.transport, positionSec: np.positionSec } } : {}),
    ...(options.car ? { car: carContext(options.car) } : {}),
    stops: vias.slice(0, 3).map((via) => ({ name: via.place.name, kmAhead: rounded(via.metersTo / 1000), arriveAt: via.arriveAt })),
    ...(weather ? { weather: { stretches: weather.stretches.slice(0, 3).map((s) => ({ fromKm: rounded(s.fromKm), toKm: rounded(s.toKm), kind: s.kind, label: s.label })),
      ...(finite(weather.fetchedAt) ? { fetchedAt: weather.fetchedAt } : {}) } } : {}),
  };
  // Do not transmit cover URLs or addresses. Shorten descriptive copy before dropping any values.
  for (const limit of [96, 48, 24, 12, 0]) {
    const message: ContextUpdate = { ...base,
      ...(base.trip ? { trip: { ...base.trip, destination: { ...base.trip.destination, name: text(base.trip.destination.name, limit) }, nextInstruction: text(base.trip.nextInstruction, limit) } } : {}),
      ...(base.nowPlaying ? { nowPlaying: { ...base.nowPlaying, item: { ...base.nowPlaying.item, id: text(base.nowPlaying.item.id, limit), title: text(base.nowPlaying.item.title, limit), by: text(base.nowPlaying.item.by, limit),
        ...(base.nowPlaying.item.from ? { from: text(base.nowPlaying.item.from, limit) } : {}) } } } : {}),
      stops: base.stops?.map((stop) => ({ ...stop, name: text(stop.name, limit) })) ?? [],
      ...(base.weather ? { weather: { ...base.weather, stretches: base.weather.stretches.map((s) => ({ ...s, label: text(s.label, limit) })) } } : {}),
    };
    if (bytes(message) < CONTEXT_MAX_BYTES) return message;
  }
  // Defensive fallback for malformed internal numeric/config data; never violate the wire budget.
  return { type: "context.update" };
}
function changed(a: number | undefined, b: number | undefined, threshold: number): boolean {
  return a === undefined || b === undefined ? a !== b : Math.abs(a - b) >= threshold;
}
export function contextChanged(a: ContextUpdate, b: ContextUpdate): boolean {
  const identity = (m: ContextUpdate) => JSON.stringify([m.soundMode, m.trip?.destination, m.trip?.nextInstruction, m.nowPlaying?.item.id, m.nowPlaying?.transport]);
  if (identity(a) !== identity(b)) return true;
  if (!!a.car !== !!b.car || changed(a.car?.fuelPercent, b.car?.fuelPercent, 1) || changed(a.car?.rangeKm, b.car?.rangeKm, 5) ||
    changed(a.car?.ambientC, b.car?.ambientC, 1) || a.car?.mil !== b.car?.mil || a.car?.dtcCount !== b.car?.dtcCount) return true;
  const stopsA = a.stops ?? []; const stopsB = b.stops ?? [];
  if (stopsA.length !== stopsB.length || stopsA.some((s, i) => s.name !== stopsB[i]?.name || changed(s.kmAhead, stopsB[i]?.kmAhead, 1) || changed(s.arriveAt, stopsB[i]?.arriveAt, 60000))) return true;
  if (!!a.weather !== !!b.weather || a.weather?.fetchedAt !== b.weather?.fetchedAt) return true;
  const weatherA = a.weather?.stretches ?? []; const weatherB = b.weather?.stretches ?? [];
  return weatherA.length !== weatherB.length || weatherA.some((s, i) => s.kind !== weatherB[i]?.kind || s.label !== weatherB[i]?.label || changed(s.fromKm, weatherB[i]?.fromKm, 1) || changed(s.toKm, weatherB[i]?.toKm, 1));
}
