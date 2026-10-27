import type { Guidance, LatLng, Weather, WeatherKind, WeatherStretch } from "../contract";
import { DEFAULT_WEATHER_URL } from "../contract";
import { RouteTrack } from "../nav/track";
import { decodePolyline } from "../nav/geo";

export const WEATHER_EVERY_MS = 600_000;
/** Refresh cadence is not validity: a retained forecast survives signal loss for three hours. */
export const WEATHER_VALID_FOR_MS = 3 * 60 * 60 * 1000;
export interface WeatherChange { from: WeatherKind; to: WeatherKind; meters: number; at: LatLng }
export interface WeatherEngine extends Weather {
  reset(): void;
  check(guidance: Guidance): Promise<void>;
}
const LABELS: Readonly<Record<WeatherKind, string>> = { clear: "Clear", rain: "Rain", snow: "Snow", fog: "Fog", storm: "Storm" };
function condition(code: number): WeatherKind | undefined {
  if (![0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99].includes(code)) return undefined;
  if (code >= 95) return "storm";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 51) return "rain";
  if (code >= 45) return "fog";
  return "clear";
}
/** Sample the remaining route, not a straight line to the destination. */
export function routeSamples(g: Guidance): { at: LatLng; meters: number }[] {
  const track = new RouteTrack(decodePolyline(g.route.shape));
  const start = Math.max(0, Math.min(track.totalMeters, g.route.totalMeters - g.metersLeft));
  const samples = [{ at: track.pointAt(start), meters: 0 }];
  const end = Math.min(track.totalMeters, start + 60000);
  // Route-anchored grid makes one weather boundary keep its identity as the car moves.
  for (let along = (Math.floor(start / 10000) + 1) * 10000; along <= end; along += 10000) {
    samples.push({ at: track.pointAt(along), meters: along - start });
  }
  return samples;
}
const routeKm = (g: Guidance) => (g.route.totalMeters - g.metersLeft) / 1000;
export function createWeatherAhead(options: {
  url?: string; fetcher?: typeof fetch; online: () => boolean; now?: () => number;
  emit: (change: WeatherChange) => void;
}): WeatherEngine {
  let lastAttemptAt = Number.NEGATIVE_INFINITY;
  let busy = false;
  let generation = 0;
  let routeKey: string | undefined;
  let latest: Guidance | undefined;
  let forecast: { originKm: number; at: number; stretches: WeatherStretch[] } | undefined;
  let stretches: readonly WeatherStretch[] = [];
  let publishedFetchedAt: number | undefined;
  const listeners = new Set<() => void>();
  const now = options.now ?? Date.now;
  function publish(): void {
    if (forecast && now() - forecast.at >= WEATHER_VALID_FOR_MS) forecast = undefined;
    const g = latest; const observed = forecast;
    const next = !observed || !g ? [] : observed.stretches.flatMap((s) => {
      const offset = observed.originKm - routeKm(g);
      const fromKm = Math.max(0, s.fromKm + offset);
      const toKm = Math.min(g.metersLeft / 1000, 60, s.toKm + offset);
      return toKm > fromKm ? [{ ...s, fromKm, toKm, current: fromKm === 0 }] : [];
    });
    if (JSON.stringify(next) === JSON.stringify(stretches) && publishedFetchedAt === observed?.at) return;
    stretches = next; publishedFetchedAt = observed?.at;
    for (const fn of listeners) fn();
  }
  return {
    get stretches() { return stretches; },
    get fetchedAt() { return publishedFetchedAt; },
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    reset() {
      generation++; lastAttemptAt = Number.NEGATIVE_INFINITY; routeKey = undefined;
      latest = undefined; forecast = undefined; publish();
    },
    async check(g: Guidance): Promise<void> {
      latest = g;
      if (g.route.shape !== routeKey) { generation++; lastAttemptAt = Number.NEGATIVE_INFINITY; routeKey = g.route.shape; forecast = undefined; }
      // Reproject the cached forecast on every fix, even between fetches or without signal.
      publish();
      if (busy || !options.online() || now() - lastAttemptAt < WEATHER_EVERY_MS) return;
      busy = true;
      lastAttemptAt = now();
      const run = generation;
      try {
        const samples = routeSamples(g);
        if (samples.length < 2) return;
        const url = new URL(options.url ?? DEFAULT_WEATHER_URL);
        url.searchParams.set("latitude", samples.map((s) => s.at.lat).join(","));
        url.searchParams.set("longitude", samples.map((s) => s.at.lng).join(","));
        url.searchParams.set("hourly", "weather_code");
        url.searchParams.set("forecast_days", "2");
        url.searchParams.set("timeformat", "unixtime");
        const response = await (options.fetcher ?? fetch)(url, { signal: AbortSignal.timeout(15000) });
        if (!response.ok) return;
        const raw: unknown = await response.json();
        if (!Array.isArray(raw) || raw.length !== samples.length || run !== generation || !options.online()) return;
        const conditions = raw.map((entry: unknown, index) => {
          const h = (entry as { hourly?: { time?: unknown[]; weather_code?: unknown[] } } | null)?.hourly;
          const sample = samples[index];
          if (!h || !sample || !Array.isArray(h.time) || !Array.isArray(h.weather_code) || !h.time.length ||
            h.time.length !== h.weather_code.length || h.time.some((t) => typeof t !== "number" || !Number.isFinite(t))) return undefined;
          const arrival = (now() + (g.secLeft * sample.meters / Math.max(g.metersLeft, 1)) * 1000) / 1000;
          let nearest = 0;
          for (let i = 1; i < h.time.length; i++) if (Math.abs(Number(h.time[i]) - arrival) < Math.abs(Number(h.time[nearest]) - arrival)) nearest = i;
          const code = h.weather_code[nearest];
          return typeof code === "number" ? condition(code) : undefined;
        });
        if (conditions.some((kind) => kind === undefined)) return;
        const observed: WeatherStretch[] = [];
        for (let i = 0; i < samples.length; i++) {
          const sample = samples[i]; const kind = conditions[i];
          if (!sample || !kind) continue;
          const fromKm = sample.meters / 1000;
          const toKm = Math.min(g.metersLeft, 60000, samples[i + 1]?.meters ?? 60000) / 1000;
          if (toKm <= fromKm) continue;
          const previous = observed.at(-1);
          if (previous?.kind === kind) observed[observed.length - 1] = { ...previous, toKm };
          else observed.push({ fromKm, toKm, kind, label: LABELS[kind], current: fromKm === 0 });
        }
        forecast = { originKm: routeKm(g), at: now(), stretches: observed }; publish();
        const current = stretches[0]; const next = stretches[1];
        if (current?.current && next && latest) {
          const boundary = routeKm(latest) + next.fromKm - forecast.originKm;
          const sample = samples.find((s) => Math.abs(s.meters / 1000 - boundary) < 0.001);
          if (sample) options.emit({ from: current.kind, to: next.kind, meters: next.fromKm * 1000, at: sample.at });
        }
      } catch { /* No signal or invalid forecast: no event. */ }
      finally {
        // Failed refreshes retain the last valid observation, but cannot extend its horizon.
        publish();
        busy = false;
      }
    },
  };
}
