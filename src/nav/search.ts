/**
 * Place search behind one swappable function. The default asks Photon.
 * Photon answers GeoJSON: https://github.com/komoot/photon#search-api
 */
import type { LatLng, Place } from "../contract";

export type PlaceSearch = (query: string, near?: LatLng) => Promise<readonly Place[]>;

export function photonSearch(photonUrl: string, fetcher: typeof fetch = (i, init) => fetch(i, init)): PlaceSearch {
  return async (query, near) => {
    const q = query.trim();
    if (!q) return [];
    const params = new URLSearchParams({ q, limit: "8" });
    // Photon may be a public server: bias to about 1 km, and send no referrer.
    if (near) {
      params.set("lat", near.lat.toFixed(2));
      params.set("lon", near.lng.toFixed(2));
    }
    let res: Response;
    try {
      res = await fetcher(`${photonUrl}/api?${params}`, { referrerPolicy: "no-referrer" });
    } catch (error) {
      throw new Error(`Search needs signal: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!res.ok) throw new Error(`Search failed: HTTP ${res.status}`);
    return parsePhoton(await res.json());
  };
}

export function parsePhoton(raw: unknown): Place[] {
  if (typeof raw !== "object" || raw === null || !Array.isArray((raw as { features?: unknown }).features)) {
    throw new Error("Search answered without results");
  }
  const places: Place[] = [];
  for (const f of (raw as { features: unknown[] }).features) {
    if (typeof f !== "object" || f === null) continue;
    const { geometry, properties } = f as { geometry?: { coordinates?: unknown }; properties?: Record<string, unknown> };
    const coords = geometry?.coordinates;
    if (!Array.isArray(coords) || typeof coords[0] !== "number" || typeof coords[1] !== "number") continue;
    const props = properties ?? {};
    const text = (k: string) => (typeof props[k] === "string" ? (props[k] as string) : undefined);
    const streetLine = [text("housenumber"), text("street")].filter(Boolean).join(" ");
    const name = text("name") ?? (streetLine || text("city") || "Unnamed place");
    const parts = [streetLine !== name ? streetLine : undefined, text("city"), text("state"), text("country")];
    const address = parts.filter((s): s is string => Boolean(s) && s !== name).join(", ");
    places.push({ name, lat: coords[1], lng: coords[0], ...(address ? { address } : {}) });
  }
  return places;
}
