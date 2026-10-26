/**
 * Presentation rules shared by every part of the screen (docs: design-principles). Pure functions.
 * Ported from the Signal mockup's `format.js` and `drive/components.js`.
 */

/** A podcast title that repeats its show loses the repeat. */
export function cleanTitle(title: string, by: string | undefined): string {
  const show = (by ?? "").toLowerCase();
  if (!show) return title;
  const parts = title.split(/\s+\|\s+/).filter((part, i) => i === 0 || !part.toLowerCase().includes(show));
  let first = parts[0] ?? title;
  if (first.toLowerCase().startsWith(show)) {
    const tail = first.slice(show.length);
    const rest = tail.replace(/^\s*(#\d+)?\s*[:\-–]\s*/, "");
    if (rest && rest !== tail) first = (rest[0] ?? "").toUpperCase() + rest.slice(1);
  }
  parts[0] = first;
  return parts.join(" | ");
}

/** The short form of a road: strips " toward …", then a leading verb, then "Take the 2nd exit onto". */
export function shortRoad(road: string | undefined): string {
  return String(road ?? "")
    .replace(/^take the \d+(st|nd|rd|th) exit\s+(onto|on|to)\s+/i, "")
    .replace(/\s+toward\s+.*$/i, "")
    .replace(
      /^(turn|keep|bear|stay|continue|merge|take the (exit|ramp))(\s+(slightly\s+|sharp\s+)?(left|right|straight))?\s+(onto|on|to)\s+/i,
      "",
    )
    .trim();
}

/** The place name only: "Harbour Fuel, 1150 Larch Avenue, …" → "Harbour Fuel". */
export const placeName = (name: string | undefined): string => String(name ?? "").split(",")[0]?.trim() ?? "";

/** Seconds to whole minutes, never 0 ("0 min left" never shows). */
export const minutesOf = (sec: number): number => Math.max(1, Math.round(sec / 60));

export function hm(totalMin: number): { h: number; m: number } {
  return { h: Math.floor(totalMin / 60), m: totalMin % 60 };
}

/** 705 → "11 h 45 min"; 52 → "52 min"; 120 → "2 h". */
export function duration(totalMin: number): string {
  const t = hm(totalMin);
  if (!t.h) return `${t.m} min`;
  return t.m ? `${t.h} h ${t.m} min` : `${t.h} h`;
}

/** A distance split for the hero: { num: "1.9", unit: "km" }. */
export function distanceParts(meters: number): { num: string; unit: string } {
  if (meters < 100) return { num: String(Math.round(meters / 5) * 5), unit: "m" };
  if (meters < 1_000) return { num: String(Math.round(meters / 10) * 10), unit: "m" };
  if (meters < 10_000) {
    const km = (meters / 1000).toFixed(1);
    // 9.96 km rounds to "10.0": say "10".
    return { num: km === "10.0" ? "10" : km, unit: "km" };
  }
  return { num: Math.round(meters / 1000).toLocaleString("en-US"), unit: "km" };
}

export const distance = (meters: number): string => {
  const d = distanceParts(meters);
  return `${d.num} ${d.unit}`;
};

/** Whole kilometres for trip totals: 900 km, 1,240 km; under 10 km keeps one decimal. */
export const km = (meters: number): string => (meters < 10_000 ? distance(meters) : `${Math.round(meters / 1000).toLocaleString("en-US")} km`);

const clockFormat = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
const dayFormat = new Intl.DateTimeFormat("en-US", { weekday: "short" });

/** "1:10 AM". The narrow no-break space Intl may put before AM is a plain space here. */
export const clockTime = (at: number): string => clockFormat.format(at).replace(/\u202f/g, " ");

/** Arrival time; names the day when it is not today ("Tue 1:10 AM"). */
export function arrival(at: number, now: number): string {
  const time = clockTime(at);
  return new Date(at).toDateString() === new Date(now).toDateString() ? time : `${dayFormat.format(at)} ${time}`;
}

/** Position into a duration: "54 min left" (row meta). */
export function left(positionSec: number, durationSec: number): string {
  return `${duration(Math.max(1, Math.round((durationSec - positionSec) / 60)))} left`;
}

/** "4,812". */
export const count = (n: number): string => n.toLocaleString("en-US");
