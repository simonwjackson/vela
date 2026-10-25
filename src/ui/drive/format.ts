/** Plain-text formatting for driving numbers. Long legs read as "250 km" and "3 h 05 min". */

export function formatDistance(meters: number): string {
  if (meters < 100) return `${Math.round(meters / 5) * 5} m`;
  if (meters < 1_000) return `${Math.round(meters / 10) * 10} m`;
  if (meters < 10_000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters / 1000).toLocaleString("en-US")} km`;
}

export function formatDuration(sec: number): string {
  if (sec < 60) return "under 1 min";
  const totalMin = Math.round(sec / 60);
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h} h ${String(m).padStart(2, "0")} min`;
}

const clockFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: "short" });

/** Arrival time; names the day when it is not today. */
export function formatArrival(arriveAt: number, now: number): string {
  const time = clockFormat.format(arriveAt);
  return new Date(arriveAt).toDateString() === new Date(now).toDateString()
    ? time
    : `${dayFormat.format(arriveAt)} ${time}`;
}

export function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}
