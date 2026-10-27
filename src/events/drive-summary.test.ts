import { createDriveSummary } from "./drive-summary";
import { destinationPoint } from "../nav/geo";
test("arrival summary uses Vela fixes, moving time, stops and place names", () => {
  const summary = createDriveSummary(); summary.reset("Invented Start");
  const start = { lat: 10, lng: 20 }; const next = destinationPoint(start, 0, 100);
  summary.record({ ...start, at: 0, accuracyM: 5, speedMps: 10 });
  summary.record({ ...next, at: 10000, accuracyM: 5, speedMps: 10 });
  summary.record({ ...next, at: 20000, accuracyM: 5, speedMps: 0 });
  const result = summary.snapshot("Invented End");
  expect(result).toEqual({ source: "vela", meters: 100, movingSeconds: 10, totalSeconds: 20, averageMovingKmh: expect.closeTo(36), stopsMade: 1, start: "Invented Start", destination: "Invented End" });
});
