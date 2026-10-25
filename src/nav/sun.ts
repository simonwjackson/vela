/**
 * Sunrise, sunset and solar elevation. Low-precision formulas (about one minute), which is plenty
 * for Daylight contrast. Based on the sunrise equation and the Astronomical Almanac's low-precision
 * solar coordinates: https://en.wikipedia.org/wiki/Sunrise_equation
 */
import type { LatLng } from "../contract";

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
const J1970 = 2_440_587.5;
const J2000 = 2_451_545;
const OBLIQUITY = 23.4397 * RAD;
/** Upper limb on the horizon, with standard refraction. */
const SUNRISE_ALTITUDE_DEG = -0.833;

export type SunDay =
  | { readonly kind: "normal"; readonly sunrise: number; readonly sunset: number }
  | { readonly kind: "polar-day" }
  | { readonly kind: "polar-night" };

function daysSinceJ2000(ms: number): number {
  return ms / DAY_MS + J1970 - J2000;
}

function solarCoordinates(d: number): { declination: number; rightAscension: number; meanAnomaly: number; eclipticLongitude: number } {
  const meanAnomaly = (357.5291 + 0.98560028 * d) * RAD;
  const center =
    (1.9148 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly) + 0.0003 * Math.sin(3 * meanAnomaly)) * RAD;
  const eclipticLongitude = meanAnomaly + center + (180 + 102.9372) * RAD;
  return {
    meanAnomaly,
    eclipticLongitude,
    declination: Math.asin(Math.sin(eclipticLongitude) * Math.sin(OBLIQUITY)),
    rightAscension: Math.atan2(Math.cos(OBLIQUITY) * Math.sin(eclipticLongitude), Math.cos(eclipticLongitude)),
  };
}

/** Sun elevation above the horizon in degrees at instant `at` (epoch ms). */
export function solarElevationDeg(at: number, p: LatLng): number {
  const d = daysSinceJ2000(at);
  const { declination, rightAscension } = solarCoordinates(d);
  const siderealTime = (280.16 + 360.9856235 * d + p.lng) * RAD;
  const hourAngle = siderealTime - rightAscension;
  const lat = p.lat * RAD;
  const sinH = Math.sin(lat) * Math.sin(declination) + Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle);
  return Math.asin(sinH) / RAD;
}

/** Sunrise and sunset (epoch ms) of the local solar day nearest `at`. */
export function sunTimes(at: number, p: LatLng): SunDay {
  // Whole days since J2000 at local mean noon, then back to UTC.
  const n = Math.round(daysSinceJ2000(at) + p.lng / 360);
  const meanNoon = n - p.lng / 360;
  const { meanAnomaly, eclipticLongitude, declination } = solarCoordinates(meanNoon);
  const transit = meanNoon + 0.0053 * Math.sin(meanAnomaly) - 0.0069 * Math.sin(2 * eclipticLongitude);
  const lat = p.lat * RAD;
  const cosHourAngle =
    (Math.sin(SUNRISE_ALTITUDE_DEG * RAD) - Math.sin(lat) * Math.sin(declination)) /
    (Math.cos(lat) * Math.cos(declination));
  if (cosHourAngle < -1) return { kind: "polar-day" };
  if (cosHourAngle > 1) return { kind: "polar-night" };
  const halfDay = Math.acos(cosHourAngle) / (2 * Math.PI);
  const toMs = (days: number) => Math.round((days + J2000 - J1970) * DAY_MS);
  return { kind: "normal", sunrise: toMs(transit - halfDay), sunset: toMs(transit + halfDay) };
}

/** Daylight contrast: on between sunrise and sunset at the position. */
export function isDaylight(at: number, p: LatLng): boolean {
  return solarElevationDeg(at, p) > SUNRISE_ALTITUDE_DEG;
}
