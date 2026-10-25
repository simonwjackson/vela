/**
 * Test fixtures: a configurable in-process Valhalla, synthetic Routes in invented places,
 * and GPS traces driven along them. No network (ADR 0005: `*.test` origins only).
 */
import type { Fix, LatLng } from "../contract";
import { bearingDeg, destinationPoint, encodePolyline, haversineMeters } from "./geo";
import { RouteTrack } from "./track";

export const VALHALLA = "https://valhalla.test";
/** An invented starting point in open country. */
export const ORIGIN: LatLng = { lat: 10, lng: 20 };

export interface Segment {
  readonly headingDeg: number;
  readonly meters: number;
  readonly street: string;
  readonly speedMps: number;
  /** Valhalla maneuver type at the start of the segment. */
  readonly type: number;
  readonly speedLimitKmh?: number;
}

export interface BuiltLeg {
  readonly json: Record<string, unknown>;
  readonly points: LatLng[];
  readonly end: LatLng;
  readonly segments: readonly Segment[];
}

const SPACING_M = 50;

export function buildLeg(start: LatLng, segments: readonly Segment[], arriveName: string): BuiltLeg {
  const points: LatLng[] = [start];
  const maneuvers: Record<string, unknown>[] = [];
  let here = start;
  for (const seg of segments) {
    const begin = points.length - 1;
    const steps = Math.max(1, Math.round(seg.meters / SPACING_M));
    for (let i = 1; i <= steps; i++) {
      here = destinationPoint(here, seg.headingDeg, seg.meters / steps);
      points.push(here);
    }
    maneuvers.push({
      type: seg.type,
      instruction: `${verb(seg.type)} ${seg.street}.`,
      street_names: [seg.street],
      begin_shape_index: begin,
      end_shape_index: points.length - 1,
      length: seg.meters / 1000,
      time: seg.meters / seg.speedMps,
    });
  }
  maneuvers.push({
    type: 4,
    instruction: `You have arrived at ${arriveName}.`,
    begin_shape_index: points.length - 1,
    end_shape_index: points.length - 1,
    length: 0,
    time: 0,
  });
  const length = segments.reduce((s, x) => s + x.meters, 0) / 1000;
  const time = segments.reduce((s, x) => s + x.meters / x.speedMps, 0);
  return {
    json: { shape: encodePolyline(points, 6), maneuvers, summary: { length, time } },
    points,
    end: here,
    segments,
  };
}

function verb(type: number): string {
  if (type === 10) return "Turn right onto";
  if (type === 15) return "Turn left onto";
  if (type === 1) return "Drive on";
  return "Continue on";
}

export function tripJson(legs: readonly BuiltLeg[]): Record<string, unknown> {
  const length = legs.reduce((s, l) => s + ((l.json.summary as { length: number }).length ?? 0), 0);
  const time = legs.reduce((s, l) => s + ((l.json.summary as { time: number }).time ?? 0), 0);
  return { trip: { legs: legs.map((l) => l.json), summary: { length, time }, status: 0, units: "kilometers" } };
}

/** A straight leg from `from` to `to`, as Valhalla might answer a re-route across open country. */
export function straightLeg(from: LatLng, to: LatLng, name: string, speedMps = 15): BuiltLeg {
  const meters = haversineMeters(from, to);
  return buildLeg(from, [{ headingDeg: bearingDeg(from, to), meters, street: "Detour Road", speedMps, type: 1 }], name);
}

export type ValhallaBehavior = "ok" | "no-signal" | "no-route";

interface Location {
  readonly lat: number;
  readonly lon: number;
}

/**
 * An in-process Valhalla. `plan` answers /route from the request's locations; by default it
 * joins every pair of locations with a straight leg. Speed limits come from the legs it built.
 */
export class ValhallaServer {
  behavior: ValhallaBehavior = "ok";
  readonly requests: { url: string; body: Record<string, unknown>; init: RequestInit | undefined }[] = [];
  plan: (locations: readonly Location[]) => BuiltLeg[];
  private lastLegs: BuiltLeg[] = [];

  constructor(plan?: (locations: readonly Location[]) => BuiltLeg[]) {
    this.plan =
      plan ??
      ((locations) =>
        locations.slice(1).map((loc, i) => {
          const from = locations[i] as Location;
          return straightLeg({ lat: from.lat, lng: from.lon }, { lat: loc.lat, lng: loc.lon }, `place ${i + 1}`);
        }));
  }

  routeRequests(): ValhallaServer["requests"] {
    return this.requests.filter((r) => r.url.endsWith("/route"));
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    this.requests.push({ url, body, init });
    if (this.behavior === "no-signal") throw new TypeError("Failed to fetch");
    if (url === `${VALHALLA}/route`) {
      if (this.behavior === "no-route") {
        return json(400, { error_code: 442, error: "No path could be found for input", status_code: 400 });
      }
      this.lastLegs = this.plan(body.locations as Location[]);
      return json(200, tripJson(this.lastLegs));
    }
    if (url === `${VALHALLA}/trace_attributes`) {
      const edges = this.lastLegs.flatMap((leg) =>
        leg.segments.map((s) => ({
          length: s.meters / 1000,
          ...(s.speedLimitKmh !== undefined ? { speed_limit: s.speedLimitKmh } : {}),
        })),
      );
      return json(200, { edges, units: "kilometers" });
    }
    return json(404, { error: "not found" });
  };
}

/** A Network whose signal the test switches. */
export class SwitchableNetwork {
  up = true;
  private readonly listeners = new Set<() => void>();
  online = (): boolean => this.up;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  set(up: boolean): void {
    this.up = up;
    for (const l of [...this.listeners]) l();
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** GPS fixes every `everyMs` while driving `points` at `speedMps`, from `fromMeters` to `toMeters`. */
export function traceAlong(
  points: readonly LatLng[],
  opts: { speedMps: number; startAt: number; everyMs?: number; fromMeters?: number; toMeters?: number; accuracyM?: number },
): Fix[] {
  const track = new RouteTrack(points);
  const every = opts.everyMs ?? 1000;
  const from = opts.fromMeters ?? 0;
  const to = Math.min(opts.toMeters ?? track.totalMeters, track.totalMeters);
  const fixes: Fix[] = [];
  for (let i = 0; ; i++) {
    const m = from + (opts.speedMps * i * every) / 1000;
    if (m > to + 1e-6) break;
    const p = track.pointAt(m);
    const ahead = track.pointAt(Math.min(track.totalMeters, m + 5));
    fixes.push({
      lat: p.lat,
      lng: p.lng,
      at: opts.startAt + i * every,
      accuracyM: opts.accuracyM ?? 5,
      speedMps: opts.speedMps,
      headingDeg: bearingDeg(p, ahead),
    });
  }
  return fixes;
}
