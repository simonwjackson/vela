import { osmAndUrl } from "./reporter";
test("car readings use Traccar extra OsmAnd parameters and omit unknowns", () => {
  const fix = { lat: 10, lng: 20, at: 1000, accuracyM: 5 };
  const url = new URL(osmAndUrl("https://traccar.test", "car", fix, { at: 1000, fuelPercent: 50, rangeKm: 250, ambientC: 20, coolantC: 90, voltage: 14, dtcs: ["P0133"] }));
  expect(Object.fromEntries(["fuel", "range", "temp", "coolant", "power", "dtcs"].map((k) => [k, url.searchParams.get(k)]))).toEqual({ fuel: "50", range: "250", temp: "20", coolant: "90", power: "14", dtcs: "P0133" });
  const bare = new URL(osmAndUrl("https://traccar.test", "car", fix)); expect(bare.searchParams.has("range")).toBe(false);
});
