import type { Guidance, NavState } from "../contract";
import { destinationPoint, encodePolyline } from "../nav/geo";
export function guidance(overrides: Partial<Guidance> = {}): Guidance {
  const start = { lat: 10, lng: 20 }; const end = destinationPoint(start, 0, 70000);
  const stop = { index: 0, maneuver: "right" as const, street: "Invented Road", instruction: "Turn right", at: end, routeMeters: 70000 };
  return {
    route: { destination: { ...end, name: "Invented Village" }, via: [], stops: [stop], shape: encodePolyline(Array.from({ length: 71 }, (_, i) => destinationPoint(start, 0, i * 1000))), totalMeters: 70000, totalSec: 3600, fetchedAt: 1000 },
    nextStop: stop, metersToNext: 70000, secToNext: 3600, progress: 0, legProgress: 0,
    metersLeft: 70000, secLeft: 3600, arriveAt: 3601000, offRoute: false, offline: false, ...overrides,
  };
}
export function guiding(overrides: Partial<Guidance> = {}): NavState { return { kind: "guiding", guidance: guidance(overrides) }; }
