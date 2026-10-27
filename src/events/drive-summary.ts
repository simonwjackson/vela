import type { Fix } from "../contract";
import { haversineMeters } from "../nav/geo";
/** Vela's own record of this drive, not a Traccar history report. */
export function createDriveSummary() {
  let first: Fix | undefined; let last: Fix | undefined;
  let meters = 0; let movingMs = 0; let stopsMade = 0; let stopped = false;
  let startName: string | undefined;
  return {
    reset(name?: string, keepLast = false) { first = last = keepLast ? last : undefined; meters = movingMs = stopsMade = 0; stopped = false; startName = name; },
    record(fix: Fix) {
      if (fix.accuracyM > 100 || (last && fix.at <= last.at)) return;
      first ??= fix;
      if (last && fix.at - last.at <= 30000) {
        const distance = haversineMeters(last, fix); meters += distance;
        const moving = (fix.speedMps ?? distance / ((fix.at - last.at) / 1000)) >= 1;
        if (moving) { movingMs += fix.at - last.at; stopped = false; }
        else if (!stopped) { stopped = true; stopsMade++; }
      }
      last = fix;
    },
    snapshot(destination: string) {
      return { source: "vela", meters: Math.round(meters), movingSeconds: movingMs / 1000,
        totalSeconds: first && last ? (last.at - first.at) / 1000 : 0,
        averageMovingKmh: movingMs > 0 ? meters / movingMs * 3600 : 0, stopsMade,
        ...(startName ? { start: startName } : {}), destination };
    },
  };
}
