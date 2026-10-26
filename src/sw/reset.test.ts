import { CREDENTIALS_CACHE } from "../sources/pyxis-credentials";
import { NARRATION_CACHE } from "../sources/narration-store";
import { OFFLINE_AUDIO_CACHE } from "./offline-cache";
import { SHELL_CACHE_PREFIX, isShellCache, resetShellAndReload } from "./reset";
import { SHELL_CACHE, WAKE_CACHE } from "./worker-fetch";

function browser(names: string[], opts: { hang?: boolean; unregisterFails?: boolean } = {}) {
  const left = new Set(names);
  const unregistered: string[] = [];
  const order: string[] = [];
  const registration = (scope: string) => ({
    scope,
    unregister: async () => {
      if (opts.unregisterFails) throw new Error("InvalidStateError");
      unregistered.push(scope);
      order.push("unregister");
      return true;
    },
  });
  const deps = {
    container: {
      getRegistrations: () =>
        opts.hang ? new Promise<never>(() => undefined) : Promise.resolve([registration("https://vela.test/")] as unknown as ServiceWorkerRegistration[]),
    },
    caches: {
      keys: async () => [...left],
      delete: async (name: string) => {
        order.push(`delete ${name}`);
        return left.delete(name);
      },
    },
    reload: () => order.push("reload"),
    timeoutMs: 20,
  };
  return { deps, left, unregistered, order };
}

const DRIVER_DATA = [OFFLINE_AUDIO_CACHE, NARRATION_CACHE, WAKE_CACHE, "vela-wake-v0", CREDENTIALS_CACHE];

test("Try again on the boot error: removes the worker and every shell cache, keeps the driver's data, then reloads", async () => {
  const b = browser([SHELL_CACHE, "vela-shell-v0", ...DRIVER_DATA]);
  await resetShellAndReload(b.deps);
  expect(b.unregistered).toEqual(["https://vela.test/"]);
  expect([...b.left].sort()).toEqual([...DRIVER_DATA].sort());
  expect(b.order.at(-1)).toBe("reload");
});

test("the reload happens even when the browser refuses or hangs", async () => {
  const refused = browser([SHELL_CACHE], { unregisterFails: true });
  await resetShellAndReload(refused.deps);
  expect(refused.order).toEqual([`delete ${SHELL_CACHE}`, "reload"]);

  const hung = browser([SHELL_CACHE], { hang: true });
  await resetShellAndReload(hung.deps);
  expect(hung.order.at(-1)).toBe("reload");

  const bare = { reload: vi.fn() };
  await resetShellAndReload(bare);
  expect(bare.reload).toHaveBeenCalledOnce();
});

test("the reset's idea of a shell cache matches the worker's", () => {
  expect(SHELL_CACHE.startsWith(SHELL_CACHE_PREFIX)).toBe(true);
  expect(isShellCache(SHELL_CACHE)).toBe(true);
  for (const name of DRIVER_DATA) expect(isShellCache(name), name).toBe(false);
});
