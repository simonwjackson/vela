/**
 * Position fixes: one source feeds guidance, readouts and Trips.
 * The shell creates one FixSource and hands it to both the NavEngine and the TripsReporter.
 */
import type { Fix } from "../contract";
import { haversineMeters } from "./geo";

export type FixListener = (fix: Fix) => void;

export interface FixSource {
  subscribe(listener: FixListener): () => void;
  /** The most recent fix, if any. */
  latest(): Fix | undefined;
}

/** Fan-out shared by every FixSource; also derives speed when the receiver gives none. */
export class ManualFixSource implements FixSource {
  private readonly listeners = new Set<FixListener>();
  private last: Fix | undefined;

  subscribe(listener: FixListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  latest(): Fix | undefined {
    return this.last;
  }

  push(fix: Fix): void {
    const withSpeed = fix.speedMps === undefined && this.last ? deriveSpeed(this.last, fix) : fix;
    this.last = withSpeed;
    for (const listener of [...this.listeners]) listener(withSpeed);
  }
}

function deriveSpeed(prev: Fix, fix: Fix): Fix {
  const dt = (fix.at - prev.at) / 1000;
  if (dt <= 0 || dt > 10) return fix;
  const meters = haversineMeters(prev, fix);
  // Noise from two poor fixes can look like motion; only trust movement larger than the error.
  if (meters < Math.max(fix.accuracyM, prev.accuracyM)) return { ...fix, speedMps: 0 };
  return { ...fix, speedMps: meters / dt };
}

export type GpsStatus = "waiting" | "ok" | "denied" | "unavailable";

/** navigator.geolocation.watchPosition with high accuracy. Starts at construction. */
export class GeolocationFixSource extends ManualFixSource {
  private readonly geolocation: Geolocation | undefined;
  private watchId: number | undefined;
  status: GpsStatus = "waiting";

  constructor(
    geolocation: Geolocation | undefined = globalThis.navigator?.geolocation,
    private readonly onStatus: (status: GpsStatus) => void = () => undefined,
  ) {
    super();
    this.geolocation = geolocation;
    if (!geolocation) {
      this.setStatus("unavailable");
      return;
    }
    this.watchId = geolocation.watchPosition(
      (pos) => {
        this.setStatus("ok");
        const c = pos.coords;
        this.push({
          lat: c.latitude,
          lng: c.longitude,
          at: pos.timestamp,
          accuracyM: c.accuracy,
          ...(c.speed !== null && Number.isFinite(c.speed) ? { speedMps: c.speed } : {}),
          ...(c.heading !== null && Number.isFinite(c.heading) ? { headingDeg: c.heading } : {}),
        });
      },
      (error) => {
        this.setStatus(error.code === error.PERMISSION_DENIED ? "denied" : "unavailable");
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 },
    );
  }

  private setStatus(status: GpsStatus): void {
    if (status === this.status) return;
    this.status = status;
    this.onStatus(status);
  }

  stop(): void {
    if (this.watchId !== undefined) this.geolocation?.clearWatch(this.watchId);
    this.watchId = undefined;
  }
}
