/**
 * A Route's shape prepared for snapping: cumulative metres per point and nearest-point search.
 * Pure; built once per Route.
 */
import type { LatLng } from "../contract";
import { haversineMeters } from "./geo";

export interface Snap {
  /** Metres from Route start to the snapped point. */
  readonly along: number;
  /** Metres from the fix to the snapped point. */
  readonly offset: number;
  /** Index of the shape segment the fix snapped to (segment i runs from point i to i+1). */
  readonly segment: number;
}

const M_PER_DEG_LAT = 111_320;

export class RouteTrack {
  readonly points: readonly LatLng[];
  /** cumulative[i] = metres from point 0 to point i. */
  readonly cumulative: readonly number[];
  readonly totalMeters: number;

  constructor(points: readonly LatLng[]) {
    if (points.length < 2) throw new Error("A Route shape needs at least two points");
    this.points = points;
    const cumulative = [0];
    for (let i = 1; i < points.length; i++) {
      cumulative.push((cumulative[i - 1] as number) + haversineMeters(at(points, i - 1), at(points, i)));
    }
    this.cumulative = cumulative;
    this.totalMeters = cumulative[cumulative.length - 1] as number;
  }

  /** The point on the shape `meters` from the start. */
  pointAt(meters: number): LatLng {
    const m = Math.max(0, Math.min(this.totalMeters, meters));
    const i = this.segmentAt(m);
    const a = at(this.points, i);
    const b = at(this.points, i + 1);
    const len = (this.cumulative[i + 1] as number) - (this.cumulative[i] as number);
    const t = len > 0 ? (m - (this.cumulative[i] as number)) / len : 0;
    return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
  }

  /** Index of the segment containing `meters` along the shape. */
  segmentAt(meters: number): number {
    let lo = 0;
    let hi = this.points.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((this.cumulative[mid] as number) <= meters) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /**
   * Nearest point on the shape between `fromMeters` and `toMeters` (whole shape by default).
   * A window keeps a fix from jumping to another part of a Route that passes close by.
   */
  snap(p: LatLng, fromMeters = 0, toMeters = Number.POSITIVE_INFINITY): Snap {
    const first = this.segmentAt(Math.max(0, fromMeters));
    const last = this.segmentAt(Math.min(this.totalMeters, toMeters));
    const cosLat = Math.cos((p.lat * Math.PI) / 180);
    let best: Snap = { along: 0, offset: Number.POSITIVE_INFINITY, segment: first };
    for (let i = first; i <= last; i++) {
      const a = at(this.points, i);
      const b = at(this.points, i + 1);
      // Local flat projection in metres around the fix; exact enough for one segment.
      const ax = (a.lng - p.lng) * M_PER_DEG_LAT * cosLat;
      const ay = (a.lat - p.lat) * M_PER_DEG_LAT;
      const bx = (b.lng - p.lng) * M_PER_DEG_LAT * cosLat;
      const by = (b.lat - p.lat) * M_PER_DEG_LAT;
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
      const x = ax + dx * t;
      const y = ay + dy * t;
      const offset = Math.sqrt(x * x + y * y);
      if (offset < best.offset) {
        const segLen = (this.cumulative[i + 1] as number) - (this.cumulative[i] as number);
        best = { along: (this.cumulative[i] as number) + segLen * t, offset, segment: i };
      }
    }
    return best;
  }
}

function at(points: readonly LatLng[], i: number): LatLng {
  const p = points[i];
  if (!p) throw new Error(`Route shape has no point ${i}`);
  return p;
}
