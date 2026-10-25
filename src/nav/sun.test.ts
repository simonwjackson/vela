import { isDaylight, sunTimes } from "./sun";

const MIN = 60_000;

/** Expect `actual` within `tolMin` minutes of the ISO time. */
function near(actual: number, iso: string, tolMin = 3): void {
  expect(Math.abs(actual - Date.parse(iso)) / MIN).toBeLessThan(tolMin);
}

// Bare latitudes on invented longitudes, not places (ADR 0005). Reference times are NOAA Solar
// Calculator values (https://gml.noaa.gov/grad/solcalc/) at the same latitude, moved to these
// longitudes at 4 minutes per degree.
describe("sunTimes", () => {
  test("equator on the March equinox", () => {
    const day = sunTimes(Date.parse("2024-03-20T12:00:00Z"), { lat: 0, lng: 0 });
    if (day.kind !== "normal") throw new Error(day.kind);
    near(day.sunrise, "2024-03-20T06:04:00Z");
    near(day.sunset, "2024-03-20T18:11:00Z");
  });

  test("51.5 N on the June solstice: a long day", () => {
    const day = sunTimes(Date.parse("2024-06-21T12:00:00Z"), { lat: 51.5, lng: 10 });
    if (day.kind !== "normal") throw new Error(day.kind);
    near(day.sunrise, "2024-06-21T03:03:00Z");
    near(day.sunset, "2024-06-21T19:41:00Z");
  });

  test("33.9 S, far east, in December: the local day straddles UTC midnight", () => {
    const day = sunTimes(Date.parse("2024-12-21T02:00:00Z"), { lat: -33.9, lng: 150 });
    if (day.kind !== "normal") throw new Error(day.kind);
    near(day.sunrise, "2024-12-20T18:46:00Z");
    near(day.sunset, "2024-12-21T09:10:00Z");
  });

  test("70 N has polar day in June and polar night in December", () => {
    expect(sunTimes(Date.parse("2024-06-21T12:00:00Z"), { lat: 70, lng: 0 }).kind).toBe("polar-day");
    expect(sunTimes(Date.parse("2024-12-21T12:00:00Z"), { lat: 70, lng: 0 }).kind).toBe("polar-night");
  });
});

describe("isDaylight", () => {
  test("agrees with sunrise and sunset either side of them", () => {
    const p = { lat: 51.5, lng: 10 };
    expect(isDaylight(Date.parse("2024-06-21T02:50:00Z"), p)).toBe(false);
    expect(isDaylight(Date.parse("2024-06-21T03:20:00Z"), p)).toBe(true);
    expect(isDaylight(Date.parse("2024-06-21T19:30:00Z"), p)).toBe(true);
    expect(isDaylight(Date.parse("2024-06-21T19:55:00Z"), p)).toBe(false);
  });

  test("polar night stays dark at noon, polar day stays light at midnight", () => {
    expect(isDaylight(Date.parse("2024-12-21T11:00:00Z"), { lat: 70, lng: 0 })).toBe(false);
    expect(isDaylight(Date.parse("2024-06-21T23:00:00Z"), { lat: 70, lng: 0 })).toBe(true);
  });
});
