import { keepScreenAwake, type ScreenLock } from "./screen-lock";

const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

function setup(options: { hidden?: boolean; refused?: boolean; supported?: boolean; deferred?: boolean } = {}) {
  const page = Object.assign(new EventTarget(), { visibilityState: options.hidden ? "hidden" : "visible" });
  const taps = new EventTarget();
  const locks: (ScreenLock & { drop(): void; released: boolean })[] = [];
  let requests = 0;
  let refused = options.refused ?? false;
  let resolve: ((lock: ScreenLock) => void) | undefined;
  const wakeLock = options.supported === false ? undefined : {
    request: async (type: "screen") => {
      expect(type).toBe("screen"); requests++;
      if (refused) throw new Error("refused");
      const events = new EventTarget();
      const lock = Object.assign(events, {
        released: false,
        drop() { this.released = true; events.dispatchEvent(new Event("release")); },
        async release() { this.drop(); },
      });
      locks.push(lock);
      if (options.deferred) return new Promise<ScreenLock>((done) => { resolve = done; });
      return lock;
    },
  };
  const stop = keepScreenAwake({ page, taps, ...(wakeLock ? { wakeLock } : {}) });
  return {
    stop, locks, taps,
    get requests() { return requests; },
    allow() { refused = false; },
    finish() { if (locks[0]) resolve?.(locks[0]); },
    visible(visible: boolean) { page.visibilityState = visible ? "visible" : "hidden"; page.dispatchEvent(new Event("visibilitychange")); },
  };
}

test("holds the screen while visible and reacquires on release and visibility", async () => {
  const h = setup(); await settle(); expect(h.requests).toBe(1);
  h.locks[0]?.drop(); await settle(); expect(h.requests).toBe(2);
  h.visible(false); await settle(); expect(h.requests).toBe(2); expect(h.locks[1]?.released).toBe(true);
  h.visible(true); await settle(); expect(h.requests).toBe(3);
  h.stop(); await settle(); expect(h.locks[2]?.released).toBe(true); expect(h.requests).toBe(3);
  h.visible(true); h.taps.dispatchEvent(new Event("pointerdown")); await settle(); expect(h.requests).toBe(3);
});

test("a refused request is retried on the first tap, without throwing", async () => {
  const h = setup({ refused: true }); await settle(); expect(h.requests).toBe(1);
  h.allow(); h.taps.dispatchEvent(new Event("pointerdown")); await settle(); expect(h.requests).toBe(2);
  h.taps.dispatchEvent(new Event("pointerdown")); await settle(); expect(h.requests).toBe(2);
  h.stop();
});

test("unsupported browsers and initially hidden pages are safe", async () => {
  const unsupported = setup({ supported: false }); unsupported.visible(true); unsupported.taps.dispatchEvent(new Event("pointerdown")); unsupported.stop();
  const h = setup({ hidden: true }); await settle(); expect(h.requests).toBe(0);
  h.visible(true); await settle(); expect(h.requests).toBe(1); h.stop();
});

test("pending requests are not duplicated and a late lock is released after disposal", async () => {
  const h = setup({ deferred: true }); h.visible(true); h.taps.dispatchEvent(new Event("pointerdown"));
  expect(h.requests).toBe(1); h.stop(); h.finish(); await settle(); expect(h.locks[0]?.released).toBe(true); expect(h.requests).toBe(1);
});
