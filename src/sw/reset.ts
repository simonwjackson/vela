/**
 * The broken-worker escape. When Vela cannot start, "Try again" removes the service worker and
 * Vela's app shell caches, then reloads, so the next load comes from the network as on a first
 * visit. A bad release (a broken worker, a bad cached page) can then never trap the phone.
 *
 * Only the shell goes. The driver's offline audio and downloads (vela-audio-*), Books narration
 * (vela-narration-*), the wake-word model (vela-wake-*) and the Pyxis device credentials stay.
 *
 * Cost: without signal the reload has no offline page until the next load with signal.
 */

/**
 * Every app shell cache, past and present (worker-fetch.ts SHELL_CACHE starts with it). Not
 * imported from worker-fetch.ts: a module shared by the page and the worker would split /sw.js
 * into a chunk under /assets.
 */
export const SHELL_CACHE_PREFIX = "vela-shell-";

/** Each step may hang in a broken browser state; the reload happens after this at the latest. */
export const RESET_STEP_TIMEOUT_MS = 3_000;

export interface ShellResetDeps {
  readonly container?: Pick<ServiceWorkerContainer, "getRegistrations">;
  readonly caches?: Pick<CacheStorage, "keys" | "delete">;
  readonly reload: () => void;
  readonly timeoutMs?: number;
}

/** True for the caches the reset deletes. */
export const isShellCache = (name: string): boolean => name.startsWith(SHELL_CACHE_PREFIX);

async function bounded(work: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  await Promise.race([work.catch(() => undefined), timeout]);
  clearTimeout(timer);
}

/** Unregister Vela's worker, delete the shell caches, then reload. The reload always happens. */
export async function resetShellAndReload(deps: ShellResetDeps): Promise<void> {
  const ms = deps.timeoutMs ?? RESET_STEP_TIMEOUT_MS;
  const unregister = (async () => {
    const registrations = (await deps.container?.getRegistrations()) ?? [];
    await Promise.all(registrations.map((r) => r.unregister().catch(() => false)));
  })();
  const clear = (async () => {
    const names = (await deps.caches?.keys()) ?? [];
    await Promise.all(names.filter(isShellCache).map((n) => deps.caches?.delete(n).catch(() => false)));
  })();
  await bounded(Promise.all([unregister, clear]), ms);
  deps.reload();
}

/** The browser's own pieces, for main.ts. */
export function browserShellReset(): () => Promise<void> {
  return () =>
    resetShellAndReload({
      ...("serviceWorker" in navigator ? { container: navigator.serviceWorker } : {}),
      ...(typeof caches === "undefined" ? {} : { caches }),
      reload: () => location.reload(),
    });
}
