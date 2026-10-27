import type { EventReport } from "../contract";
import { createEventDetectors } from "./detectors";
import { guidance, guiding } from "./fixtures";
test("events fire once per situation, with bounded context and an injected clock", () => {
  const events: EventReport[] = []; let clock = 1000;
  const detectors = createEventDetectors((e) => { events.push(e); return true; }, () => clock++);
  const place = { name: "Invented Fuel", lat: 10, lng: 20 };
  const state = guiding({ nextVia: { place, metersTo: 2000, secTo: 120, arriveAt: 120000 } });
  detectors.update(state, { at: 0, rangeKm: 50 }); detectors.update(state, { at: 0, rangeKm: 50 });
  expect(events.map((e) => e.kind)).toEqual(["setting-off", "long-leg", "stop-near", "range-short"]);
  detectors.update({ kind: "arrived", destination: guidance().route.destination }, { at: 0 }, { source: "vela", meters: 70000 });
  detectors.update({ kind: "arrived", destination: guidance().route.destination }, { at: 0 });
  detectors.weather("rain", { to: "rain" }); detectors.weather("rain", { to: "rain" });
  expect(events.map((e) => e.kind)).toEqual(["setting-off", "long-leg", "stop-near", "range-short", "arrived", "weather-ahead"]);
  expect(new Set(events.map((e) => e.id)).size).toBe(6);
  for (const e of events) expect(new TextEncoder().encode(JSON.stringify(e.context)).length).toBeLessThanOrEqual(1024);
  detectors.weather("too-big", { text: "x".repeat(1025) }); expect(events).toHaveLength(6);
  detectors.reset(); detectors.update(state, { at: 0 }); expect(events.filter((e) => e.kind === "setting-off")).toHaveLength(2);
});
test("thresholds do not report idle, short legs, distant stops or adequate Range", () => {
  const events: EventReport[] = []; const detectors = createEventDetectors((e) => { events.push(e); return true; });
  detectors.update({ kind: "idle" }, { at: 0 });
  detectors.update(guiding({ secToNext: 1799, nextVia: { place: { name: "Invented Stop", lat: 0, lng: 0 }, metersTo: 2001, secTo: 200, arriveAt: 0 } }), { at: 0, rangeKm: 77.01 });
  expect(events.map((e) => e.kind)).toEqual(["setting-off"]);
});

test("an unavailable transport does not consume a situation before reconnect", () => {
  let connected = false; const sent: EventReport[] = [];
  const detectors = createEventDetectors((event) => { if (!connected) return false; sent.push(event); return true; });
  detectors.update(guiding({ secToNext: 100 }), { at: 0 }); expect(sent).toHaveLength(0);
  connected = true; detectors.update(guiding({ secToNext: 100 }), { at: 0 });
  detectors.update(guiding({ secToNext: 100 }), { at: 0 }); expect(sent.map((e) => e.kind)).toEqual(["setting-off"]);
});
