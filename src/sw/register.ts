/**
 * Register Vela's service worker. The build must emit src/sw/service-worker.ts as a root-level
 * script (default `/sw.js`); the shell calls this once at start.
 */
export async function registerListeningWorker(
  url = "/sw.js",
  container: ServiceWorkerContainer | undefined = typeof navigator === "undefined" ? undefined : navigator.serviceWorker,
): Promise<ServiceWorkerRegistration | undefined> {
  if (container === undefined) return undefined;
  try {
    return await container.register(url, { scope: "/", type: "module" });
  } catch (error) {
    console.warn("Vela could not register its service worker; Music streaming and offline audio need it", error);
    return undefined;
  }
}
