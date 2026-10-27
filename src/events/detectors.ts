import { MOMENT_RULES, type EventKind, type EventReport, type NavState, type CarReadings } from "../contract";

/** Stateful edge detector; reset at the next Route after the motion tracker ends the drive. */
export function createEventDetectors(emit: (event: EventReport) => boolean, now: () => number = Date.now) {
  const seen = new Set<string>();
  let serial = 0;
  let routeKey: string | undefined;
  function report(kind: EventKind, key: string, context: Record<string, unknown>): void {
    const situation = `${kind}:${key}`;
    if (seen.has(situation)) return;
    if (new TextEncoder().encode(JSON.stringify(context)).length > MOMENT_RULES.contextBytes) return;
    const delivered = emit({ type: "event.report", id: `${now()}-${++serial}`, kind, context });
    if (delivered !== false) seen.add(situation);
  }
  return {
    reset() { seen.clear(); routeKey = undefined; },
    weather(key: string, context: Record<string, unknown>) { report("weather-ahead", key, context); },
    update(state: NavState, car: CarReadings, summary?: Record<string, unknown>) {
      if (state.kind === "arrived") { report("arrived", routeKey ?? JSON.stringify(state.destination), summary ?? { destination: state.destination }); return; }
      if (state.kind !== "guiding" && state.kind !== "rerouting") return;
      const g = state.guidance;
      routeKey = `${g.route.fetchedAt}:${JSON.stringify(g.route.destination)}`;
      report("setting-off", "drive", { destination: g.route.destination, meters: g.route.totalMeters, seconds: g.route.totalSec });
      if (g.secToNext >= 1800) report("long-leg", JSON.stringify(g.nextStop.at), { instruction: g.nextStop.instruction, seconds: g.secToNext, meters: g.metersToNext });
      if (g.nextVia && g.nextVia.metersTo <= 2000) report("stop-near", JSON.stringify(g.nextVia.place), { stop: g.nextVia.place, meters: g.nextVia.metersTo });
      const neededKm = g.metersLeft * 1.1 / 1000;
      if (car.rangeKm !== undefined && car.rangeKm < neededKm) report("range-short", "drive", { rangeKm: car.rangeKm, shortfallKm: neededKm - car.rangeKm });
      else if (car.rangeKm !== undefined) seen.delete("range-short:drive");
    },
  };
}
