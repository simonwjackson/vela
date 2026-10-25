/**
 * Moving or parked, with hysteresis. Pure: feed it every fix, it says which fixes belong to a Trip.
 *
 * - Parked to moving: two accurate fixes in a row at walking-plus speed, or the car is found
 *   well away from where it parked (speed is sometimes missing).
 * - Moving to parked: slow for three minutes without leaving a small circle. Traffic lights and
 *   queues are shorter, so they stay inside the Trip.
 */
import type { Fix, LatLng } from "../contract";
import { haversineMeters } from "../nav/geo";

export const START_SPEED_MPS = 3;
export const STOP_SPEED_MPS = 1;
export const PARK_AFTER_MS = 180_000;
const START_FIXES = 2;
/** Without speed, this much displacement from the parking spot means the car is moving. */
const START_DISPLACEMENT_M = 150;
const PARK_RADIUS_M = 60;
const MAX_ACCURACY_M = 100;

export type Motion =
  | { readonly kind: "parked"; readonly anchor?: LatLng; readonly pending: readonly Fix[] }
  | { readonly kind: "moving"; readonly slowSince?: number; readonly slowAnchor?: LatLng };

export const PARKED: Motion = { kind: "parked", pending: [] };

export interface MotionStep {
  readonly motion: Motion;
  /** Fixes to record for the Trip, oldest first. */
  readonly record: readonly Fix[];
}

export function nextMotion(motion: Motion, fix: Fix): MotionStep {
  const accurate = fix.accuracyM <= MAX_ACCURACY_M;
  if (motion.kind === "parked") {
    if (!accurate) return { motion, record: [] };
    const anchor = motion.anchor ?? fix;
    const fast = (fix.speedMps ?? 0) >= START_SPEED_MPS;
    const moved = fix.speedMps === undefined && haversineMeters(anchor, fix) > START_DISPLACEMENT_M;
    if (moved) return { motion: { kind: "moving" }, record: [...motion.pending, fix] };
    if (!fast) return { motion: { kind: "parked", anchor, pending: [] }, record: [] };
    const pending = [...motion.pending, fix];
    if (pending.length >= START_FIXES) return { motion: { kind: "moving" }, record: pending };
    return { motion: { kind: "parked", anchor, pending }, record: [] };
  }

  // Moving: every fix belongs to the Trip, including the slow ones before parking.
  const slow = accurate && (fix.speedMps ?? 0) < STOP_SPEED_MPS;
  if (!slow) return { motion: { kind: "moving" }, record: [fix] };
  const slowSince = motion.slowSince ?? fix.at;
  const slowAnchor = motion.slowAnchor ?? fix;
  if (haversineMeters(slowAnchor, fix) > PARK_RADIUS_M) {
    return { motion: { kind: "moving", slowSince: fix.at, slowAnchor: fix }, record: [fix] };
  }
  if (fix.at - slowSince >= PARK_AFTER_MS) return { motion: { kind: "parked", anchor: fix, pending: [] }, record: [fix] };
  return { motion: { kind: "moving", slowSince, slowAnchor }, record: [fix] };
}
