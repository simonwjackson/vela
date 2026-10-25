/** Saved places and Recent destinations, kept on the device. */
import type { Place } from "../contract";
import { haversineMeters } from "./geo";
import { type KeyValueStore, readJson } from "./storage";

const SAVED_KEY = "vela.nav.saved";
const RECENT_KEY = "vela.nav.recent";
const MAX_RECENT = 12;
/** Two Destinations closer than this are the same place. */
const SAME_PLACE_M = 75;

export class PlaceBook {
  private readonly store: KeyValueStore;
  constructor(store: KeyValueStore) {
    this.store = store;
  }

  saved(): readonly Place[] {
    return readJson(this.store, SAVED_KEY, isPlaceList) ?? [];
  }

  /** Save under `name`, replacing any Saved place with the same name. */
  save(name: string, place: Place): void {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("A Saved place needs a name");
    const entry = toPlace({ ...place, name: trimmed });
    const others = this.saved().filter((p) => p.name.toLowerCase() !== trimmed.toLowerCase());
    this.store.set(SAVED_KEY, JSON.stringify([...others, entry]));
  }

  recent(): readonly Place[] {
    return readJson(this.store, RECENT_KEY, isPlaceList) ?? [];
  }

  /** Most recent first; a place used again moves to the top. */
  addRecent(place: Place): void {
    const entry = toPlace(place);
    const others = this.recent().filter((p) => haversineMeters(p, entry) > SAME_PLACE_M);
    this.store.set(RECENT_KEY, JSON.stringify([entry, ...others].slice(0, MAX_RECENT)));
  }
}

function toPlace(p: Place): Place {
  return { name: p.name, lat: p.lat, lng: p.lng, ...(p.address !== undefined ? { address: p.address } : {}) };
}

export function isPlace(v: unknown): v is Place {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.name === "string" &&
    typeof p.lat === "number" &&
    typeof p.lng === "number" &&
    (p.address === undefined || typeof p.address === "string")
  );
}

function isPlaceList(v: unknown): v is Place[] {
  return Array.isArray(v) && v.every(isPlace);
}
