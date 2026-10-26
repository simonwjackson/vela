/**
 * Vela's service worker entry. It must be served from the site root as `/sw.js` so its scope
 * covers the page; see src/sw/register.ts. The fetch rules (app shell offline, Listening audio)
 * are in worker-fetch.ts.
 *
 * The build stamps its version (vite.config.ts `define`) into this file, so every release gives a
 * byte-different `/sw.js` and the browser installs it; see AppStatus in src/shell/app-status.ts.
 */
import { createCacheCredentialStore } from "../sources/pyxis-credentials";
import { createCacheOfflineAudio } from "./offline-cache";
import { SHELL_CACHE, WAKE_CACHE, WAKE_CACHE_PREFIX, createWorkerFetch, precacheShell } from "./worker-fetch";

const worker = self as unknown as ServiceWorkerGlobalScope;

/** The build this worker belongs to. */
const WORKER_VERSION = __VELA_VERSION__;

const shell = createCacheOfflineAudio(caches, SHELL_CACHE);
const fetchNetwork: typeof fetch = (input, init) => fetch(input, init);

const handle = createWorkerFetch({
  scopeOrigin: worker.location.origin,
  shell,
  wake: createCacheOfflineAudio(caches, WAKE_CACHE),
  offline: createCacheOfflineAudio(caches),
  credentials: createCacheCredentialStore(caches),
  fetch: fetchNetwork,
});

worker.addEventListener("install", (event) => {
  event.waitUntil(
    precacheShell({ scopeOrigin: worker.location.origin, shell, fetch: fetchNetwork }).then(() => worker.skipWaiting()),
  );
});

worker.addEventListener("activate", (event) => {
  const oldWake = caches
    .keys()
    .then((names) => Promise.all(names.filter((n) => n.startsWith(WAKE_CACHE_PREFIX) && n !== WAKE_CACHE).map((n) => caches.delete(n))));
  event.waitUntil(Promise.all([worker.clients.claim(), handle.loadOrigins(), oldWake]));
});

// `{ type: "vela-version" }` answers with the worker's build, so a page can tell which one runs.
worker.addEventListener("message", (event) => {
  if ((event.data as { type?: unknown } | null)?.type === "vela-version") event.ports[0]?.postMessage({ version: WORKER_VERSION });
});

worker.addEventListener("fetch", (event) => {
  const response = handle(event.request);
  if (response !== undefined) event.respondWith(response);
});
