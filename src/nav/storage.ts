/**
 * Device storage seam for Navigation and Trips. Everything stored here stays on the phone:
 * the cached Route, Saved places, Recent destinations, the last position and queued Trip fixes.
 * None of it is a secret, but it is personal (ADR 0005), so it never leaves the device
 * except to the driver's own services.
 */
export interface KeyValueStore {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): void;
}

/** localStorage, or memory when storage is unavailable (private mode, quota). */
export function deviceStore(storage: Storage | undefined = globalThis.localStorage): KeyValueStore {
  const memory = new InMemoryStore();
  return {
    get(key) {
      try {
        return storage?.getItem(key) ?? memory.get(key);
      } catch {
        return memory.get(key);
      }
    },
    set(key, value) {
      memory.set(key, value);
      try {
        storage?.setItem(key, value);
      } catch {
        // Quota or private mode: the in-memory copy keeps this session working.
      }
    },
    remove(key) {
      memory.remove(key);
      try {
        storage?.removeItem(key);
      } catch {
        // Nothing to do.
      }
    },
  };
}

export class InMemoryStore implements KeyValueStore {
  private readonly values = new Map<string, string>();
  get(key: string): string | undefined {
    return this.values.get(key);
  }
  set(key: string, value: string): void {
    this.values.set(key, value);
  }
  remove(key: string): void {
    this.values.delete(key);
  }
}

export function readJson<T>(store: KeyValueStore, key: string, isValid: (v: unknown) => v is T): T | undefined {
  const raw = store.get(key);
  if (raw === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    return isValid(value) ? value : undefined;
  } catch {
    return undefined;
  }
}
