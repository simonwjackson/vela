/**
 * Vela's service worker entry. It must be served from the site root (for example `/sw.js`)
 * so its scope covers the page; see src/sw/register.ts.
 *
 * It only handles listening audio (stream-fetch.ts). Everything else goes to the network
 * untouched.
 */
import { loadConfig } from "../contract/config";
import { createCacheCredentialStore } from "../sources/pyxis-credentials";
import { createCacheOfflineAudio } from "./offline-cache";
import { type ListeningOrigins, handleListeningFetch, listeningRequestKind } from "./stream-fetch";

const worker = self as unknown as ServiceWorkerGlobalScope;

let origins: ListeningOrigins | undefined;
let loading: Promise<ListeningOrigins | undefined> | undefined;

function loadOrigins(): Promise<ListeningOrigins | undefined> {
  if (origins !== undefined) return Promise.resolve(origins);
  loading ??= loadConfig((input, init) => fetch(input, init))
    .then((config) => {
      origins = { pyxis: config.origins.pyxis, ossicle: config.origins.ossicle };
      return origins;
    })
    .catch(() => {
      loading = undefined;
      return undefined;
    });
  return loading;
}

const deps = (known: ListeningOrigins) => ({
  origins: known,
  offline: createCacheOfflineAudio(caches),
  credentials: createCacheCredentialStore(caches),
  fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),
});

/** Could this be listening audio? Decided before the config is known. */
const mayBeAudio = (request: Request) => {
  if (request.method !== "GET") return false;
  const path = new URL(request.url).pathname;
  return path.startsWith("/stream/") || path.startsWith("/audio/") || path.startsWith("/comics/");
};

worker.addEventListener("install", (event) => {
  event.waitUntil(worker.skipWaiting());
});

worker.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([worker.clients.claim(), loadOrigins()]));
});

worker.addEventListener("fetch", (event) => {
  const request = event.request;
  if (origins !== undefined) {
    const kind = listeningRequestKind(request, origins);
    if (kind !== undefined) event.respondWith(handleListeningFetch(request, kind, deps(origins)));
    return;
  }
  if (!mayBeAudio(request)) return;
  event.respondWith(
    (async () => {
      const known = await loadOrigins();
      const kind = known === undefined ? undefined : listeningRequestKind(request, known);
      if (known === undefined || kind === undefined) return fetch(request);
      return handleListeningFetch(request, kind, deps(known));
    })(),
  );
});
