/** Pure guidance arithmetic: from a position along the Route to every number the driving view shows. */
import type { Guidance, Stop } from "../contract";
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
