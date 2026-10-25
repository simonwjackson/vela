/**
 * Every fetch rule of Vela's service worker, as one function the worker entry calls.
 *
 * App shell (same origin only), so a reload in a dead zone still shows Vela and guidance can
 * resume from its cached Route:
 * - navigations: network first, falling back to the last good page (stored under `/`);
 * - `/config.json`: network first, falling back to the last good copy;
 * - `/assets/*`: cache first, filled on first use (the files are content-hashed);
 * - `/sw.js` is never cached, so worker updates are always seen.
 * A network answer that takes longer than `networkTimeoutMs` counts as no signal.
 *
 * Listening audio (stream-fetch.ts) needs the Service origins from `/config.json`. When the
 * worker restarts without signal, an offline copy is answered by its URL before the config is
 * needed, and the origins come from the last good config copy.
 */
import type { PyxisCredentialStore } from "../sources/pyxis-credentials";
import type { OfflineAudio } from "./offline-cache";
import { rangeResponse } from "./range";
import { type ListeningOrigins, handleListeningFetch, listeningRequestKind, offlineCopy } from "./stream-fetch";

export const SHELL_CACHE = "vela-shell-v1";
export const DEFAULT_NETWORK_TIMEOUT_MS = 4000;

export type ShellRequestKind = "navigation" | "config" | "asset";

export interface WorkerFetchDeps {
  /** The worker's own origin. */
  readonly scopeOrigin: string;
  /** Cache for the app shell. Same shape as the audio cache. */
  readonly shell: OfflineAudio;
  readonly offline: OfflineAudio;
  readonly credentials: PyxisCredentialStore;
  readonly fetch: typeof fetch;
  readonly networkTimeoutMs?: number;
}

export type RequestShape = Pick<Request, "url" | "method" | "mode">;

export function shellRequestKind(request: RequestShape, scopeOrigin: string): ShellRequestKind | undefined {
  if (request.method !== "GET") return undefined;
  const url = new URL(request.url);
  if (url.origin !== scopeOrigin) return undefined;
  if (url.pathname === "/sw.js") return undefined;
  if (request.mode === "navigate") return "navigation";
  if (url.pathname === "/config.json") return "config";
  if (url.pathname.startsWith("/assets/")) return "asset";
  return undefined;
}

/** Could this be listening audio? Decided before the Service origins are known. */
export function mayBeAudio(request: RequestShape): boolean {
  if (request.method !== "GET") return false;
  const path = new URL(request.url).pathname;
  return path.startsWith("/stream/") || path.startsWith("/audio/") || path.startsWith("/comics/");
}

const noSignal = (what: string) =>
  new Response(`${what} is not available without signal.`, { status: 503, headers: { "content-type": "text/plain" } });

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("network timed out")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function networkFirst(
  request: Request,
  key: string,
  deps: WorkerFetchDeps,
  what: string,
  keep: (response: Response) => boolean = () => true,
): Promise<Response> {
  try {
    const response = await withTimeout(deps.fetch(request), deps.networkTimeoutMs ?? DEFAULT_NETWORK_TIMEOUT_MS);
    if (response.status === 200 && keep(response)) {
      await deps.shell.put(key, response.clone()).catch(() => undefined);
      return response;
    }
    // A server error is not a dead zone, but the last good copy still beats an error page.
    return (await deps.shell.match(key).catch(() => undefined)) ?? response;
  } catch {
    return (await deps.shell.match(key).catch(() => undefined)) ?? noSignal(what);
  }
}

async function cacheFirst(request: Request, deps: WorkerFetchDeps): Promise<Response> {
  const cached = await deps.shell.match(request.url).catch(() => undefined);
  if (cached !== undefined) return cached;
  try {
    const response = await deps.fetch(request);
    if (response.status === 200) await deps.shell.put(request.url, response.clone()).catch(() => undefined);
    return response;
  } catch {
    return noSignal("This part of Vela");
  }
}

export function handleShellFetch(request: Request, kind: ShellRequestKind, deps: WorkerFetchDeps): Promise<Response> {
  switch (kind) {
    case "navigation":
      // Only the HTML page becomes the offline page; a navigated-to file is not the app.
      return networkFirst(request, `${deps.scopeOrigin}/`, deps, "Vela", (response) =>
        (response.headers.get("content-type") ?? "").includes("text/html"),
      );
    case "config":
      return networkFirst(request, `${deps.scopeOrigin}/config.json`, deps, "Vela's configuration");
    case "asset":
      return cacheFirst(request, deps);
  }
}

/** Service origins from a `/config.json` body, or undefined when it has none. */
export async function originsFromConfig(response: Response): Promise<ListeningOrigins | undefined> {
  try {
    const value = (await response.json()) as { origins?: { pyxis?: unknown; ossicle?: unknown } };
    const pyxis = value.origins?.pyxis;
    const ossicle = value.origins?.ossicle;
    return typeof pyxis === "string" && typeof ossicle === "string" ? { pyxis, ossicle } : undefined;
  } catch {
    return undefined;
  }
}

export interface WorkerFetch {
  /** A response for requests the worker handles; undefined for the rest (browser default). */
  (request: Request): Promise<Response> | undefined;
  /** Resolve the Service origins now (network first, then the last good config). */
  loadOrigins(): Promise<ListeningOrigins | undefined>;
}

export function createWorkerFetch(deps: WorkerFetchDeps): WorkerFetch {
  let origins: ListeningOrigins | undefined;
  let loading: Promise<ListeningOrigins | undefined> | undefined;

  const loadOrigins = (): Promise<ListeningOrigins | undefined> => {
    if (origins !== undefined) return Promise.resolve(origins);
    loading ??= (async () => {
      const key = `${deps.scopeOrigin}/config.json`;
      const response = await networkFirst(new Request(key, { cache: "no-store" }), key, deps, "Vela's configuration");
      const found = response.ok ? await originsFromConfig(response) : undefined;
      if (found !== undefined) origins = found;
      loading = undefined;
      return found;
    })();
    return loading;
  };

  const listeningDeps = (known: ListeningOrigins) => ({
    origins: known,
    offline: deps.offline,
    credentials: deps.credentials,
    fetch: deps.fetch,
  });

  const handle = (request: Request): Promise<Response> | undefined => {
    const shell = shellRequestKind(request, deps.scopeOrigin);
    if (shell !== undefined) return handleShellFetch(request, shell, deps);
    if (origins !== undefined) {
      const kind = listeningRequestKind(request, origins);
      return kind === undefined ? undefined : handleListeningFetch(request, kind, listeningDeps(origins));
    }
    if (!mayBeAudio(request)) return undefined;
    return (async () => {
      // A restarted worker in a dead zone: answer from the offline copy before anything else.
      const copy = await offlineCopy(request.url, deps.offline);
      if (copy !== undefined) return rangeResponse(copy, request.headers.get("range"));
      const known = await loadOrigins();
      const kind = known === undefined ? undefined : listeningRequestKind(request, known);
      if (known === undefined || kind === undefined) return deps.fetch(request);
      return handleListeningFetch(request, kind, listeningDeps(known));
    })();
  };

  return Object.assign(handle, { loadOrigins });
}
