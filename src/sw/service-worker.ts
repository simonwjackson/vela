/**
 * Vela's service worker entry. It must be served from the site root as `/sw.js` so its scope
 * covers the page; see src/sw/register.ts. The fetch rules (app shell offline, Listening audio)
 * are in worker-fetch.ts.
 */
import { createCacheCredentialStore } from "../sources/pyxis-credentials";
import { createCacheOfflineAudio } from "./offline-cache";
import { SHELL_CACHE, createWorkerFetch } from "./worker-fetch";

const worker = self as unknown as ServiceWorkerGlobalScope;

const handle = createWorkerFetch({
  scopeOrigin: worker.location.origin,
  shell: createCacheOfflineAudio(caches, SHELL_CACHE),
  offline: createCacheOfflineAudio(caches),
  credentials: createCacheCredentialStore(caches),
  fetch: (input, init) => fetch(input, init),
});

worker.addEventListener("install", (event) => {
  event.waitUntil(worker.skipWaiting());
});

worker.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([worker.clients.claim(), handle.loadOrigins()]));
});

worker.addEventListener("fetch", (event) => {
  const response = handle(event.request);
  if (response !== undefined) event.respondWith(response);
});
