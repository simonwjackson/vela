/**
 * The Shelf, persisted on the device. Storage seam: `localStorage` under one key.
 * The Shelf holds titles of things the driver listened to; it never leaves the phone and is
 * never written to the repository (ADR 0005).
 */
import type { Item, Shelf, SourceId } from "../contract";

export const SHELF_STORAGE_KEY = "vela.listening.shelf";

const SOURCES: readonly SourceId[] = ["music", "podcasts", "books"];

export const EMPTY_SHELF: Shelf = { music: undefined, podcasts: undefined, books: undefined };

export interface ShelfStore {
  read(): Shelf;
  write(shelf: Shelf): void;
}

/** The part of the Web Storage API the stores use. */
export type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function isItem(value: unknown, source: SourceId): value is Item {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    item.source === source &&
    typeof item.id === "string" &&
    typeof item.title === "string" &&
    typeof item.by === "string" &&
    (item.from === undefined || typeof item.from === "string") &&
    (item.artUrl === undefined || typeof item.artUrl === "string") &&
    (item.durationSec === undefined || typeof item.durationSec === "number")
  );
}

/** Read a Shelf from untrusted JSON. Invalid entries become empty, never errors. */
export function parseShelf(raw: string | null): Shelf {
  if (raw === null) return EMPTY_SHELF;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return EMPTY_SHELF;
  }
  if (typeof value !== "object" || value === null) return EMPTY_SHELF;
  const record = value as Record<string, unknown>;
  const shelf: Record<SourceId, Item | undefined> = { ...EMPTY_SHELF };
  for (const source of SOURCES) {
    const entry = record[source];
    if (isItem(entry, source)) shelf[source] = entry;
  }
  return shelf;
}

export function createShelfStore(storage: KeyValueStorage): ShelfStore {
  return {
    read: () => parseShelf(storage.getItem(SHELF_STORAGE_KEY)),
    write(shelf) {
      try {
        storage.setItem(SHELF_STORAGE_KEY, JSON.stringify(shelf));
      } catch (error) {
        // A full or blocked storage loses the Shelf, not the music.
        console.error("Vela could not save the Shelf", error);
      }
    },
  };
}

/** A Shelf store that keeps the Shelf in memory, for previews and tests. */
export function createMemoryShelfStore(initial: Shelf = EMPTY_SHELF): ShelfStore & { readonly saved: Shelf } {
  let saved = initial;
  return {
    read: () => saved,
    write(shelf) {
      saved = shelf;
    },
    get saved() {
      return saved;
    },
  };
}

/** Same item: same Source and same id. */
export const sameItem = (left: Item | undefined, right: Item | undefined): boolean =>
  left !== undefined && right !== undefined && left.source === right.source && left.id === right.id;
