import type { Fix } from "../contract";
import { destinationPoint, decodePolyline, encodePolyline } from "./geo";
import { GeolocationFixSource } from "./position";
import { maneuverKind } from "./valhalla";

/** A Geolocation that replays positions the test hands it. */
class ReplayGeolocation implements Geolocation {
  options: PositionOptions | undefined;
  cleared = false;
  private success: PositionCallback | undefined;
  watchPosition(success: PositionCallback, _error?: PositionErrorCallback | null, options?: PositionOptions): number {
    this.success = success;
    this.options = options;
    return 7;
  }
  clearWatch(id: number): void {
    this.cleared = id === 7;
  }
  getCurrentPosition(): void {}
  emit(lat: number, lng: number, timestamp: number, speed: number | null): void {
    const coords = { latitude: lat, longitude: lng, accuracy: 4, speed, heading: null, altitude: null, altitudeAccuracy: null };
    this.success?.({ coords, timestamp } as unknown as GeolocationPosition);
  }
}

test("watches with high accuracy, maps coordinates and derives a missing speed", () => {
  const geo = new ReplayGeolocation();
  const source = new GeolocationFixSource(geo);
  const seen: Fix[] = [];
  source.subscribe((f) => seen.push(f));
  expect(geo.options?.enableHighAccuracy).toBe(true);
  geo.emit(10, 20, 1_000, null);
  const p = destinationPoint({ lat: 10, lng: 20 }, 0, 25);
  geo.emit(p.lat, p.lng, 2_000, null);
  expect(seen[0]).toEqual({ lat: 10, lng: 20, at: 1_000, accuracyM: 4 });
  expect(seen[1]?.speedMps).toBeCloseTo(25, 3);
  expect(source.status).toBe("ok");
  source.stop();
  expect(geo.cleared).toBe(true);
});

test("polyline precision 6 round-trips, including negative coordinates", () => {
  const points = [
    { lat: -33.123456, lng: 151.654321 },
    { lat: -33.2, lng: 151.7 },
    { lat: 10, lng: -20.000001 },
  ];
  expect(decodePolyline(encodePolyline(points))).toEqual(points);
  // The precision-5 example from Google's encoded polyline documentation.
  expect(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@", 5)).toEqual([
    { lat: 38.5, lng: -120.2 },
    { lat: 40.7, lng: -120.95 },
    { lat: 43.252, lng: -126.453 },
  ]);
});

test("Valhalla maneuver types map to the contract's Maneuver", () => {
  expect(maneuverKind(1).skip).toBe(true);
  expect(maneuverKind(4).maneuver).toBe("arrive");
  expect(maneuverKind(7)).toEqual({ maneuver: "straight", info: true });
  expect([9, 10, 11, 12, 14, 15, 16].map((t) => maneuverKind(t).maneuver)).toEqual([
    "slight-right",
    "right",
    "sharp-right",
    "uturn",
    "sharp-left",
    "left",
    "slight-left",
  ]);
  expect([18, 19, 20, 21, 23, 24, 25, 26].map((t) => maneuverKind(t).maneuver)).toEqual([
    "ramp-right",
    "ramp-left",
    "exit-right",
    "exit-left",
    "keep-right",
    "keep-left",
    "merge",
    "roundabout",
  ]);
});
