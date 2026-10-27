/** Keep a visible dashboard awake. Refusals (policy, battery, unsupported API) are harmless. */
export interface ScreenLock extends EventTarget {
  readonly released: boolean;
  release(): Promise<void>;
}

export function keepScreenAwake(env: {
  readonly page: EventTarget & { readonly visibilityState: string };
  readonly taps: EventTarget;
  readonly wakeLock?: { request(type: "screen"): Promise<ScreenLock> };
}): () => void {
  let stopped = false;
  let pending = false;
  let lock: ScreenLock | undefined;
  const release = (held: ScreenLock) => { void held.release().catch(() => undefined); };
  const request = async () => {
    if (stopped || pending || lock || env.page.visibilityState !== "visible" || !env.wakeLock) return;
    pending = true;
    try {
      const held = await env.wakeLock.request("screen");
      if (stopped || env.page.visibilityState !== "visible") release(held);
      else if (!held.released) {
        lock = held;
        held.addEventListener("release", onRelease, { once: true });
      }
    } catch {
      // Android may refuse until a tap. Visibility changes also retry after a refusal.
    } finally { pending = false; }
  };
  function onRelease(): void { lock = undefined; void request(); }
  const drop = () => {
    const held = lock; lock = undefined;
    if (held) { held.removeEventListener("release", onRelease); release(held); }
  };
  const visibility = () => { if (env.page.visibilityState === "visible") void request(); else drop(); };
  env.page.addEventListener("visibilitychange", visibility);
  env.taps.addEventListener("pointerdown", request, { capture: true });
  void request();
  return () => {
    stopped = true;
    env.page.removeEventListener("visibilitychange", visibility);
    env.taps.removeEventListener("pointerdown", request, { capture: true });
    drop();
  };
}
