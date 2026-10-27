/** Pure guidance arithmetic: from a position along the Route to every number the driving view shows. */
import type { Guidance, Route, Stop } from "../contract";
import { type PlannedRoute, secondsAt } from "./valhalla";

/** A Stop counts as reached this many metres before its point, to absorb snapping near corners. */
export const STOP_PASS_METERS = 10;

export interface GuidanceInput {
  readonly planned: PlannedRoute;
  /** Metres from Route start to the car's snapped position. */
  readonly along: number;
  readonly now: number;
  readonly offRoute: boolean;
  readonly offline: boolean;
}

/** The next actionable Stop after `along`. Informational Stops are skipped; the Destination never is. */
export function nextActionableStop(stops: readonly Stop[], along: number, after?: Stop): Stop | undefined {
  const fromIndex = after ? after.index + 1 : 0;
  for (let i = fromIndex; i < stops.length; i++) {
    const stop = stops[i] as Stop;
    if (stop.info && i < stops.length - 1) continue;
    if (!after && stop.routeMeters - STOP_PASS_METERS < along) continue;
    return stop;
  }
  return undefined;
}

/**
 * The arrival Stops of the stops on the way, in order. Every leg but the last ends at one, so the
 * first `route.via.length` arrival Stops belong to `route.via`.
 */
function viaArrivals(route: Route): Stop[] {
  return route.stops.filter((s) => s.maneuver === "arrive").slice(0, route.via.length);
}

/** How many of the Route's stops on the way the car has reached at `along`. */
export function passedViaCount(route: Route, along: number): number {
  return viaArrivals(route).filter((s) => s.routeMeters - STOP_PASS_METERS < along).length;
}

export function computeGuidance(input: GuidanceInput): Guidance {
  const { planned, now } = input;
  const { route } = planned;
  const along = Math.max(0, Math.min(route.totalMeters, input.along));
  const destination = route.stops[route.stops.length - 1] as Stop;
  const nextStop = nextActionableStop(route.stops, along) ?? destination;
  const thenStop = nextStop === destination ? undefined : nextActionableStop(route.stops, along, nextStop);

  const previous = previousActionableMeters(route.stops, nextStop);
  const legLength = nextStop.routeMeters - previous;
  const metersToNext = Math.max(0, nextStop.routeMeters - along);
  const nowSec = secondsAt(planned.timeline, along);
  const secToNext = Math.max(0, secondsAt(planned.timeline, nextStop.routeMeters) - nowSec);
  const secLeft = Math.max(0, route.totalSec - nowSec);
  const metersLeft = Math.max(0, route.totalMeters - along);
  const viaIndex = passedViaCount(route, along);
  const nextVias = viaArrivals(route).slice(viaIndex, viaIndex + 3).flatMap((stop, offset) => {
    const place = route.via[viaIndex + offset];
    if (!place) return [];
    const secTo = Math.max(0, secondsAt(planned.timeline, stop.routeMeters) - nowSec);
    return [{ place, metersTo: Math.max(0, stop.routeMeters - along), secTo, arriveAt: now + secTo * 1000 }];
  });
  const nextVia = nextVias[0];

  return {
    route,
    nextStop,
    ...(thenStop ? { thenStop } : {}),
    metersToNext,
    secToNext,
    progress: route.totalMeters > 0 ? along / route.totalMeters : 1,
    legProgress: legLength > 0 ? clamp01((along - previous) / legLength) : 1,
    metersLeft,
    secLeft,
    arriveAt: now + secLeft * 1000,
    offRoute: input.offRoute,
    offline: input.offline,
    ...(nextVia ? { nextVia } : {}),
    nextVias,
  };
}

function previousActionableMeters(stops: readonly Stop[], next: Stop): number {
  for (let i = next.index - 1; i >= 0; i--) {
    const stop = stops[i] as Stop;
    if (!stop.info) return stop.routeMeters;
  }
  return 0;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
