import type { KeyValueStorage } from "../audio/shelf-store";

/**
 * A stable per-install device id for Ossicle position writes. Stored on the device; it is a
 * random label, not a secret.
 */
export function deviceIdFrom(storage: KeyValueStorage, key: string, prefix: string): string {
  const stored = storage.getItem(key);
  if (stored !== null && stored.length > 0) return stored;
  const minted = `${prefix}-${randomId().slice(0, 12)}`;
  try {
    storage.setItem(key, minted);
  } catch {
    // Without storage the id lasts for this run only.
  }
  return minted;
}

export function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
