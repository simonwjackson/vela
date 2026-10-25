/**
 * The service worker's fetch rule for listening audio.
 *
 * - `GET {pyxis}/stream/*`: a media element cannot send the Pyxis Bearer token, so the worker
 *   re-issues the request as a CORS request with `Authorization: Bearer <device token>` and the
 *   element's `Range` header unchanged. Pyxis's CORS allows both and exposes `Content-Range`
 *   (ADR 0001).
 * - `GET {ossicle}/audio/*` and `GET {ossicle}/comics/*`: passed through unchanged.
 * - Any of these with an offline copy is answered from Cache Storage, with real 206 slices for
 *   Range requests.
 * - Without signal and without a copy, the answer is 503, so the player shows an error instead
 *   of waiting.
 */
import type { PyxisCredentialStore } from "../sources/pyxis-credentials";
import type { OfflineAudio } from "./offline-cache";
import { rangeResponse } from "./range";

export interface ListeningOrigins {
  readonly pyxis: string;
  readonly ossicle: string;
}

export type ListeningRequestKind = "pyxis-stream" | "ossicle-audio";

export function listeningRequestKind(request: Request, origins: ListeningOrigins): ListeningRequestKind | undefined {
  if (request.method !== "GET") return undefined;
  const url = new URL(request.url);
  if (url.origin === new URL(origins.pyxis).origin && url.pathname.startsWith("/stream/")) return "pyxis-stream";
  if (
    url.origin === new URL(origins.ossicle).origin &&
    (url.pathname.startsWith("/audio/") || url.pathname.startsWith("/comics/"))
  ) {
    return "ossicle-audio";
  }
  return undefined;
}

export interface StreamFetchDeps {
  readonly origins: ListeningOrigins;
  readonly offline: OfflineAudio;
  readonly credentials: PyxisCredentialStore;
  readonly fetch: typeof fetch;
}

/** Build the authenticated Pyxis request. Only Range is carried over from the element. */
export function authorizedStreamRequest(request: Request, token: string | undefined): Request {
  const headers = new Headers();
  const range = request.headers.get("range");
  if (range !== null) headers.set("range", range);
  if (token !== undefined) headers.set("authorization", `Bearer ${token}`);
  return new Request(request.url, { method: "GET", headers, mode: "cors", credentials: "omit", redirect: "follow" });
}

const unavailable = () =>
  new Response("This audio is not downloaded and there is no signal.", {
    status: 503,
    headers: { "content-type": "text/plain" },
  });

/**
 * The offline copy for a URL. An unversioned Ossicle `/audio/:id` (used when the episode's
 * versioned `audioPath` is unknown) also finds a copy stored under `/audio/:id?v=…`.
 */
export async function offlineCopy(url: string, offline: OfflineAudio): Promise<Response | undefined> {
  const exact = await offline.match(url).catch(() => undefined);
  if (exact !== undefined) return exact;
  const parsed = new URL(url);
  if (parsed.search === "" && parsed.pathname.startsWith("/audio/")) {
    return offline.matchIgnoringSearch(url).catch(() => undefined);
  }
  return undefined;
}

export async function handleListeningFetch(
  request: Request,
  kind: ListeningRequestKind,
  deps: StreamFetchDeps,
): Promise<Response> {
  const cached = await offlineCopy(request.url, deps.offline);
  if (cached !== undefined) return rangeResponse(cached, request.headers.get("range"));
  try {
    if (kind === "pyxis-stream") {
      const credentials = await deps.credentials.read().catch(() => undefined);
      return await deps.fetch(authorizedStreamRequest(request, credentials?.token));
    }
    return await deps.fetch(request);
  } catch {
    return unavailable();
  }
}
