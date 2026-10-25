import { isDaylight, sunTimes } from "./sun";

const MIN = 60_000;

/** Expect `actual` within `tolMin` minutes of the ISO time. */
function near(actual: number, iso: string, tolMin = 3): void {
  expect(Math.abs(actual - Date.parse(iso)) / MIN).toBeLessThan(tolMin);
}

// Reference times come from the NOAA Solar Calculator (https://gml.noaa.gov/grad/solcalc/),
// for bare coordinates rather than named places.
describe("sunTimes", () => {
  test("equator on the March equinox", () => {
    const day = sunTimes(Date.parse("2024-03-20T12:00:00Z"), { lat: 0, lng: 0 });
    if (day.kind !== "normal") throw new Error(day.kind);
    near(day.sunrise, "2024-03-20T06:04:00Z");
    near(day.sunset, "2024-03-20T18:11:00Z");
  });

  test("51.5 N on the June solstice: a long day", () => {
    const day = sunTimes(Date.parse("2024-06-21T12:00:00Z"), { lat: 51.5, lng: 0 });
    if (day.kind !== "normal") throw new Error(day.kind);
    near(day.sunrise, "2024-06-21T03:43:00Z");
    near(day.sunset, "2024-06-21T20:21:00Z");
  });

  test("33.9 S, 151.2 E in December: the local day straddles UTC midnight", () => {
    const day = sunTimes(Date.parse("2024-12-21T02:00:00Z"), { lat: -33.87, lng: 151.21 });
    if (day.kind !== "normal") throw new Error(day.kind);
    near(day.sunrise, "2024-12-20T18:41:00Z");
    near(day.sunset, "2024-12-21T09:05:00Z");
  });

  test("70 N has polar day in June and polar night in December", () => {
    expect(sunTimes(Date.parse("2024-06-21T12:00:00Z"), { lat: 70, lng: 20 }).kind).toBe("polar-day");
    expect(sunTimes(Date.parse("2024-12-21T12:00:00Z"), { lat: 70, lng: 20 }).kind).toBe("polar-night");
  });
});

describe("isDaylight", () => {
  test("agrees with sunrise and sunset either side of them", () => {
    const p = { lat: 51.5, lng: 0 };
    expect(isDaylight(Date.parse("2024-06-21T03:30:00Z"), p)).toBe(false);
    expect(isDaylight(Date.parse("2024-06-21T04:00:00Z"), p)).toBe(true);
    expect(isDaylight(Date.parse("2024-06-21T20:10:00Z"), p)).toBe(true);
    expect(isDaylight(Date.parse("2024-06-21T20:35:00Z"), p)).toBe(false);
  });

  test("polar night stays dark at noon, polar day stays light at midnight", () => {
    expect(isDaylight(Date.parse("2024-12-21T11:00:00Z"), { lat: 70, lng: 20 })).toBe(false);
    expect(isDaylight(Date.parse("2024-06-21T23:00:00Z"), { lat: 70, lng: 20 })).toBe(true);
  });
});
