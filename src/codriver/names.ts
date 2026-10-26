/**
 * Co-driver names. The assistant gives ids only (no display names yet), so the three default
 * ids show as their capitalised names, and any other id has no display name: the UI then says
 * CO_DRIVER_FALLBACK_NAME.
 */
import type { CoDriverId, CoDriverInfo } from "../contract";

export const CO_DRIVER_FALLBACK_NAME = "Your co-driver";

const KINDS = ["navigator", "companion", "guide"] as const;

export function coDriverInfo(id: CoDriverId): CoDriverInfo {
  const kind = KINDS.find((k) => k === id);
  if (!kind) return { id };
  return { id, kind, displayName: kind.charAt(0).toUpperCase() + kind.slice(1) };
}

/** The Co-driver choices, in the assistant's default order. */
export const DEFAULT_CO_DRIVERS: readonly CoDriverInfo[] = KINDS.map(coDriverInfo);

/** The name to show in sentences. */
export function coDriverName(info: CoDriverInfo): string {
  return info.displayName ?? CO_DRIVER_FALLBACK_NAME;
}
