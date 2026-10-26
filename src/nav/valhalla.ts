/**
 * Valhalla client: one POST /route for the whole Route, plus a best-effort
 * POST /trace_attributes for speed limits along it.
 *
 * Response shapes follow the Valhalla API reference:
 * https://valhalla.github.io/valhalla/api/turn-by-turn/api-reference/ (route, maneuver types)
 * https://valhalla.github.io/valhalla/api/map-matching/api-reference/ (trace_attributes)
 */
import type { LatLng, Maneuver, Place, Route, Stop } from "../contract";
import { decodePolyline, encodePolyline } from "./geo";
import { RouteTrack } from "./track";

/** A Route plus what the engine needs to guide from it offline. Cached as JSON. */
export interface PlannedRoute {
  readonly route: Route;
  /** Places still to visit, in order; the last one is the Destination. */
  readonly via: readonly Place[];
  /** Knots of [routeMeters, secondsFromStart], increasing; seconds are the router's estimate. */
  readonly timeline: readonly (readonly [number, number])[];
  /** [startMeters, endMeters, kmh] where the legal limit is known. Often empty. */
  readonly speedLimits: readonly (readonly [number, number, number])[];
}

export interface RouteRequest {
  readonly from: LatLng & { readonly headingDeg?: number };
  /** Places to visit in order; the last one is the Destination. */
  readonly via: readonly Place[];
}

/** Why a route request failed. `network` means no signal: keep guiding from the cache. */
export type RouteFailure =
  | { readonly kind: "network"; readonly message: string }
  | { readonly kind: "no-route"; readonly message: string }
  | { readonly kind: "bad-response"; readonly message: string };

export class RouteError extends Error {
  readonly failure: RouteFailure;
  constructor(failure: RouteFailure) {
    super(failure.message);
    this.failure = failure;
  }
}

export interface ValhallaOptions {
  readonly origin: string;
  readonly fetcher?: typeof fetch;
  readonly timeoutMs?: number;
  readonly now?: () => number;
}

/** How the engine asks for Routes. Speed limits come separately, so they never delay a Route. */
export interface Router {
  /** The whole Route; its `speedLimits` is empty. */
  route(request: RouteRequest): Promise<PlannedRoute>;
  /** Speed limits along an encoded Route shape. Never rejects; unknown is an empty list. */
  speedLimits(shape: string): Promise<PlannedRoute["speedLimits"]>;
}

export function valhallaRouter(options: ValhallaOptions): Router {
  const fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? 20_000;
  const now = options.now ?? Date.now;

  async function route(request: RouteRequest): Promise<PlannedRoute> {
    const destination = request.via[request.via.length - 1];
    if (!destination) throw new Error("A route needs a Destination");
    const origin: Record<string, unknown> = { lat: request.from.lat, lon: request.from.lng, type: "break" };
    if (request.from.headingDeg !== undefined) {
      origin.heading = Math.round(request.from.headingDeg);
      origin.heading_tolerance = 60;
    }
    const body = {
      locations: [origin, ...request.via.map((p) => ({ lat: p.lat, lon: p.lng, type: "break" }))],
      costing: "auto",
      directions_options: { units: "kilometers" },
    };
    const raw = await postJson(fetcher, `${options.origin}/route`, body, timeoutMs);
    return { ...parseRoute(raw, request.via, now()), speedLimits: [] };
  }

  return { route, speedLimits: (shape) => fetchSpeedLimits(fetcher, options.origin, shape, timeoutMs) };
}

async function postJson(fetcher: typeof fetch, url: string, body: unknown, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    // A CORS "simple request": a string body (sent as text/plain;charset=UTF-8) and no custom
    // headers. Valhalla answers the preflight OPTIONS with 405, so a JSON content type would fail.
    res = await fetcher(url, {
      method: "POST",
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    throw new RouteError({ kind: "network", message: `No signal: ${errorMessage(error)}` });
  } finally {
    clearTimeout(timer);
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new RouteError({ kind: "bad-response", message: `The router answered HTTP ${res.status} without JSON` });
  }
  if (!res.ok) {
    const message = isRecord(json) && typeof json.error === "string" ? json.error : `HTTP ${res.status}`;
    // Valhalla answers 400 for "no route" and similar request problems; 5xx are server faults.
    const kind = res.status >= 500 ? "bad-response" : "no-route";
    throw new RouteError({ kind, message: `The router could not find a route: ${message}` });
  }
  return json;
}

interface ValhallaManeuver {
  readonly type: number;
  readonly instruction: string;
  readonly street_names?: readonly string[];
  readonly begin_shape_index: number;
  readonly time: number;
  /** Roundabout entries only: the exit to take, counted from the entry. */
  readonly roundabout_exit_count?: number;
}

interface ValhallaLeg {
  readonly shape: string;
  readonly maneuvers: readonly ValhallaManeuver[];
}

/** Turn one Valhalla /route response into a PlannedRoute. Exported for tests. */
export function parseRoute(raw: unknown, via: readonly Place[], fetchedAt: number): Omit<PlannedRoute, "speedLimits"> {
  const trip = isRecord(raw) ? raw.trip : undefined;
  if (!isRecord(trip) || !Array.isArray(trip.legs) || trip.legs.length === 0) {
    throw new RouteError({ kind: "bad-response", message: "The router's answer has no trip legs" });
  }
  const legs = trip.legs.map(parseLeg);
  const destination = via[via.length - 1];
  if (!destination) throw new Error("A route needs a Destination");

  // Join leg shapes. Each leg starts where the previous one ended, so drop the repeated point.
  const points: LatLng[] = [];
  const legOffsets: number[] = [];
  for (const leg of legs) {
    const legPoints = decodePolyline(leg.shape, 6);
    const skip = points.length > 0 ? 1 : 0;
    legOffsets.push(points.length - skip);
    for (let i = skip; i < legPoints.length; i++) points.push(legPoints[i] as LatLng);
  }
  const track = new RouteTrack(points);

  const stops: Stop[] = [];
  const timeline: [number, number][] = [];
  let seconds = 0;
  legs.forEach((leg, legIndex) => {
    const offset = legOffsets[legIndex] as number;
    for (const m of leg.maneuvers) {
      const pointIndex = Math.min(points.length - 1, offset + m.begin_shape_index);
      const routeMeters = track.cumulative[pointIndex] as number;
      timeline.push([routeMeters, seconds]);
      seconds += m.time;
      const kind = maneuverKind(m.type);
      if (kind.skip) continue;
      // A non-final leg ends at a waypoint, so its arrival Stop names that place.
      const place = via[legIndex];
      const street = kind.maneuver === "arrive" ? (place?.name ?? "") : (m.street_names?.[0] ?? "");
      stops.push({
        index: stops.length,
        maneuver: kind.maneuver,
        street,
        instruction: m.instruction.replace(/\.$/, ""),
        at: points[pointIndex] as LatLng,
        routeMeters,
        ...(kind.info ? { info: true } : {}),
        ...(m.type === ROUNDABOUT_ENTER && m.roundabout_exit_count !== undefined ? { exit: m.roundabout_exit_count } : {}),
      });
    }
  });
  timeline.push([track.totalMeters, seconds]);

  const last = stops[stops.length - 1];
  if (!last || last.maneuver !== "arrive") {
    throw new RouteError({ kind: "bad-response", message: "The router's answer does not end at the Destination" });
  }
  const route: Route = {
    destination,
    via: via.slice(0, -1),
    stops,
    shape: encodePolyline(points, 6),
    totalMeters: track.totalMeters,
    totalSec: seconds,
    fetchedAt,
  };
  return { route, via, timeline: monotonic(timeline) };
}

function parseLeg(raw: unknown): ValhallaLeg {
  if (!isRecord(raw) || typeof raw.shape !== "string" || !Array.isArray(raw.maneuvers)) {
    throw new RouteError({ kind: "bad-response", message: "A trip leg has no shape or maneuvers" });
  }
  const maneuvers = raw.maneuvers.map((m): ValhallaManeuver => {
    if (!isRecord(m) || typeof m.type !== "number" || typeof m.begin_shape_index !== "number") {
      throw new RouteError({ kind: "bad-response", message: "A maneuver has no type or shape index" });
    }
    const names = Array.isArray(m.street_names) ? m.street_names.filter((s) => typeof s === "string") : undefined;
    return {
      type: m.type,
      instruction: typeof m.instruction === "string" ? m.instruction : "",
      ...(names ? { street_names: names } : {}),
      begin_shape_index: m.begin_shape_index,
      time: typeof m.time === "number" ? m.time : 0,
      ...(Number.isInteger(m.roundabout_exit_count) && (m.roundabout_exit_count as number) > 0
        ? { roundabout_exit_count: m.roundabout_exit_count as number }
        : {}),
    };
  });
  return { shape: raw.shape, maneuvers };
}

/** Knots must have strictly increasing metres to interpolate; merge zero-length steps. */
function monotonic(knots: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const k of knots) {
    const prev = out[out.length - 1];
    if (prev && k[0] <= prev[0]) prev[1] = Math.max(prev[1], k[1]);
    else out.push([k[0], k[1]]);
  }
  return out;
}

/** Valhalla's kRoundaboutEnter; only it carries `roundabout_exit_count`. */
const ROUNDABOUT_ENTER = 26;

interface Kind {
  readonly maneuver: Maneuver;
  readonly info?: boolean;
  /** Start maneuvers describe departure, not a point the driver reaches. */
  readonly skip?: boolean;
}

/**
 * Valhalla maneuver type numbers to the contract's Maneuver.
 * https://valhalla.github.io/valhalla/api/turn-by-turn/api-reference/#trip-legs-and-maneuvers
 */
export function maneuverKind(type: number): Kind {
  switch (type) {
    case 1: // kStart
    case 2: // kStartRight
    case 3: // kStartLeft
      return { maneuver: "straight", skip: true };
    case 4: // kDestination
    case 5: // kDestinationRight
    case 6: // kDestinationLeft
      return { maneuver: "arrive" };
    case 7: // kBecomes: the road changes name, no action
      return { maneuver: "straight", info: true };
    case 8: // kContinue
    case 22: // kStayStraight
    case 17: // kRampStraight
      return { maneuver: "straight" };
    case 9:
      return { maneuver: "slight-right" };
    case 10:
      return { maneuver: "right" };
    case 11:
      return { maneuver: "sharp-right" };
    case 12: // kUturnRight
    case 13: // kUturnLeft
      return { maneuver: "uturn" };
    case 14:
      return { maneuver: "sharp-left" };
    case 15:
      return { maneuver: "left" };
    case 16:
      return { maneuver: "slight-left" };
    case 18:
      return { maneuver: "ramp-right" };
    case 19:
      return { maneuver: "ramp-left" };
    case 20:
      return { maneuver: "exit-right" };
    case 21:
      return { maneuver: "exit-left" };
    case 23:
      return { maneuver: "keep-right" };
    case 24:
      return { maneuver: "keep-left" };
    case 25: // kMerge
    case 37: // kMergeRight
    case 38: // kMergeLeft
      return { maneuver: "merge" };
    case 26: // kRoundaboutEnter
    case 27: // kRoundaboutExit
      return { maneuver: "roundabout" };
    case 28: // kFerryEnter
    case 29: // kFerryExit
      return { maneuver: "straight" };
    default:
      // Transit, elevator, steps and unknown future types: show the instruction, no turn arrow.
      return { maneuver: "straight" };
  }
}

/**
 * Speed limits along the Route shape. Unknown is normal; any failure yields an empty list.
 * Valhalla reports `edge.speed_limit` in the request's units, or "unlimited", or omits it.
 */
async function fetchSpeedLimits(
  fetcher: typeof fetch,
  origin: string,
  shape: string,
  timeoutMs: number,
): Promise<[number, number, number][]> {
  const body = {
    encoded_polyline: shape,
    shape_match: "edge_walk",
    costing: "auto",
    directions_options: { units: "kilometers" },
    filters: { attributes: ["edge.length", "edge.speed_limit"], action: "include" },
  };
  try {
    const raw = await postJson(fetcher, `${origin}/trace_attributes`, body, timeoutMs);
    if (!isRecord(raw) || !Array.isArray(raw.edges)) return [];
    const out: [number, number, number][] = [];
    let meters = 0;
    for (const edge of raw.edges) {
      if (!isRecord(edge) || typeof edge.length !== "number") return [];
      const end = meters + edge.length * 1000;
      if (typeof edge.speed_limit === "number" && edge.speed_limit > 0) out.push([meters, end, edge.speed_limit]);
      meters = end;
    }
    return out;
  } catch {
    return [];
  }
}

/** Router-estimated seconds from Route start to `meters`. */
export function secondsAt(timeline: PlannedRoute["timeline"], meters: number): number {
  const first = timeline[0];
  if (!first) return 0;
  if (meters <= first[0]) return first[1];
  for (let i = 1; i < timeline.length; i++) {
    const b = timeline[i] as readonly [number, number];
    if (meters <= b[0]) {
      const a = timeline[i - 1] as readonly [number, number];
      return a[1] + ((b[1] - a[1]) * (meters - a[0])) / (b[0] - a[0]);
    }
  }
  return (timeline[timeline.length - 1] as readonly [number, number])[1];
}

export function speedLimitAt(limits: PlannedRoute["speedLimits"], meters: number): number | undefined {
  for (const [start, end, kmh] of limits) if (meters >= start && meters < end) return kmh;
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
