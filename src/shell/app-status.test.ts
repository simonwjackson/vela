import type { NavState } from "../contract";
import { type AppStatusDeps, createAppStatus } from "./app-status";

class Events {
  private readonly map = new Map<string, Set<() => void>>();
  addEventListener(type: string, fn: () => void): void {
    if (!this.map.has(type)) this.map.set(type, new Set());
    this.map.get(type)?.add(fn);
  }
  fire(type: string): void {
    for (const fn of this.map.get(type) ?? []) fn();
  }
}

class SuspendedAudio extends Events {
  state = "suspended";
  async resume(): Promise<void> {
    this.state = "running";
    this.fire("statechange");
  }
}

function harness(opts: { controller?: boolean; firstRunDone?: boolean; nav?: NavState } = {}) {
  const audio = new SuspendedAudio();
  const worker = Object.assign(new Events(), { controller: opts.controller ? {} : null });
  const reloads: number[] = [];
  const values = new Map<string, string>(opts.firstRunDone ? [["vela.firstRunDone", "1"]] : []);
  let navState: NavState = opts.nav ?? { kind: "idle" };
  const navListeners = new Set<(s: NavState) => void>();
  let wakeWord = false;
  const settingsListeners = new Set<() => void>();
  const perms = new Map<string, Events & { state: string }>([
    ["geolocation", Object.assign(new Events(), { state: "granted" })],
    ["microphone", Object.assign(new Events(), { state: "prompt" })],
  ]);
  const deps: AppStatusDeps = {
    audio,
    worker,
    reload: () => reloads.push(1),
    permissions: {
      query: async ({ name }) => {
        const p = perms.get(name);
        if (!p) throw new TypeError("unsupported");
        return p;
      },
    },
    storage: { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => void values.set(k, v) },
    nav: {
      get state() {
        return navState;
      },
      subscribe(fn) {
        navListeners.add(fn);
        fn(navState);
        return () => navListeners.delete(fn);
      },
    },
    settings: {
      get value() {
        return { wakeWord };
      },
      subscribe(fn) {
        settingsListeners.add(fn);
        return () => settingsListeners.delete(fn);
      },
    },
  };
  const app = createAppStatus(deps);
  return {
    app,
    audio,
    worker,
    reloads,
    values,
    perms,
    setNav(s: NavState) {
      navState = s;
      for (const fn of navListeners) fn(s);
    },
    setWake(on: boolean) {
      wakeWord = on;
      for (const fn of settingsListeners) fn();
    },
  };
}

test("an update is ready only when a new worker takes over a controlled page", () => {
  const fresh = harness({ controller: false });
  fresh.worker.fire("controllerchange");
  expect(fresh.app.updateReady).toBe(false);

  const h = harness({ controller: true });
  let changes = 0;
  h.app.subscribe(() => changes++);
  h.app.applyUpdate();
  expect(h.reloads).toHaveLength(0);
  h.worker.fire("controllerchange");
  expect(h.app.updateReady).toBe(true);
  expect(changes).toBe(1);
  h.app.applyUpdate();
  expect(h.reloads).toHaveLength(1);
});

test("sound is blocked only while Vela needs it without a tap, and a tap unblocks it", async () => {
  const h = harness();
  expect(h.app.soundBlocked).toBe(false);
  h.setWake(true);
  expect(h.app.soundBlocked).toBe(true);
  h.setWake(false);
  h.setNav({ kind: "error", message: "x" });
  expect(h.app.soundBlocked).toBe(false);
  h.setWake(true);
  h.app.unblockSound();
  await Promise.resolve();
  expect(h.app.soundBlocked).toBe(false);
});

test("permissions come from the Permissions API, follow changes, and engines can report them", async () => {
  const h = harness();
  await new Promise((r) => setTimeout(r, 0));
  expect(h.app.permissions).toEqual({ location: "granted", mic: "prompt" });
  const mic = h.perms.get("microphone");
  if (mic) mic.state = "denied";
  mic?.fire("change");
  expect(h.app.permissions.mic).toBe("denied");
  h.app.notePermission("location", "denied");
  expect(h.app.permissions.location).toBe("denied");
});

test("first run lasts until finished, and is remembered", () => {
  const h = harness();
  expect(h.app.firstRun).toBe(true);
  h.app.finishFirstRun();
  expect(h.app.firstRun).toBe(false);
  expect(h.values.get("vela.firstRunDone")).toBe("1");
  expect(harness({ firstRunDone: true }).app.firstRun).toBe(false);
});

// ---- Update checks -----------------------------------------------------------------------------

class Doc extends Events {
  visibilityState = "visible";
  removeEventListener(): void {}
}

class Incoming extends Events {
  constructor(public state: string) {
    super();
  }
  removeEventListener(): void {}
  become(state: string): void {
    this.state = state;
    this.fire("statechange");
  }
}

/**
 * An app with a fake registration. `next` is what the next `update()` finds: nothing new, a new
 * worker that installs, or a failed fetch. Timers are manual: `tick(ms)` runs what is due.
 */
function updates(opts: { registered?: boolean; next?: "nothing" | "new" | "fail" | "hang" } = {}) {
  const worker = Object.assign(new Events(), { controller: {}, removeEventListener: () => undefined });
  const page = new Doc();
  const network = Object.assign(new Events(), { removeEventListener: () => undefined });
  let clock = 0;
  const timers: { at: number; fn: () => void; every?: number; id: number }[] = [];
  let ids = 0;
  const schedule = (fn: () => void, ms: number, every?: number) => {
    const t = { at: clock + ms, fn, id: ++ids, ...(every ? { every } : {}) };
    timers.push(t);
    return t.id;
  };
  const drop = (id: unknown) => {
    const i = timers.findIndex((t) => t.id === id);
    if (i >= 0) timers.splice(i, 1);
  };
  const state = { next: opts.next ?? "nothing", updates: 0, incoming: undefined as Incoming | undefined };
  const registration = {
    installing: null as Incoming | null,
    waiting: null as Incoming | null,
    update: () => {
      state.updates++;
      if (state.next === "fail") return Promise.reject(new TypeError("Failed to fetch"));
      if (state.next === "hang") return new Promise(() => undefined);
      if (state.next === "new") {
        state.incoming = new Incoming("installing");
        registration.installing = state.incoming;
      }
      return Promise.resolve(registration);
    },
  };
  const reloads: number[] = [];
  const app = createAppStatus({
    audio: new SuspendedAudio(),
    worker,
    updates: {
      registration: async () => (opts.registered === false ? undefined : registration),
      page,
      network,
      now: () => clock,
      setTimeout: (fn, ms) => schedule(fn, ms),
      clearTimeout: drop,
      setInterval: (fn, ms) => schedule(fn, ms, ms),
      clearInterval: drop,
    },
    reload: () => reloads.push(1),
    nav: { state: { kind: "idle" }, subscribe: () => () => undefined },
    settings: { value: { wakeWord: false }, subscribe: () => () => undefined },
  });
  const flush = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  return {
    app,
    state,
    page,
    network,
    worker,
    reloads,
    registration,
    flush,
    async tick(ms: number) {
      clock += ms;
      for (const t of [...timers].sort((a, b) => a.at - b.at)) {
        if (t.at > clock) continue;
        if (t.every) t.at += t.every;
        else drop(t.id);
        t.fn();
      }
      await flush();
    },
    /** The new worker activates and claims the page, as Vela's worker does (skipWaiting + claim). */
    takeOver() {
      state.incoming?.become("activated");
      worker.fire("controllerchange");
    },
  };
}

describe("checkForUpdate", () => {
  test("nothing new: current", async () => {
    const u = updates();
    expect(await u.app.checkForUpdate()).toBe("current");
    expect(u.state.updates).toBe(1);
    expect(u.app.updateReady).toBe(false);
  });

  test("a new version: waits until it takes over, then updated (and the chip's flag is set)", async () => {
    const u = updates({ next: "new" });
    let result: string | undefined;
    void u.app.checkForUpdate().then((r) => {
      result = r;
    });
    await u.flush();
    expect(result).toBeUndefined();
    u.takeOver();
    await u.flush();
    expect(result).toBe("updated");
    expect(u.app.updateReady).toBe(true);
    // Once ready, a check does not fetch again.
    expect(await u.app.checkForUpdate()).toBe("updated");
    expect(u.state.updates).toBe(1);
  });

  test("a new version that dies while installing: failed", async () => {
    const u = updates({ next: "new" });
    const result = u.app.checkForUpdate();
    await u.flush();
    u.state.incoming?.become("redundant");
    expect(await result).toBe("failed");
    expect(u.app.updateReady).toBe(false);
  });

  test("a new version that never takes over: failed after the install timeout", async () => {
    const u = updates({ next: "new" });
    let result: string | undefined;
    void u.app.checkForUpdate().then((r) => {
      result = r;
    });
    await u.flush();
    await u.tick(29_000);
    expect(result).toBeUndefined();
    await u.tick(1_000);
    expect(result).toBe("failed");
  });

  test("no signal, a hung fetch, or no service worker: failed, and nothing reloads by itself", async () => {
    expect(await updates({ next: "fail" }).app.checkForUpdate()).toBe("failed");
    expect(await updates({ registered: false }).app.checkForUpdate()).toBe("failed");
    const hung = updates({ next: "hang" });
    let result: string | undefined;
    void hung.app.checkForUpdate().then((r) => {
      result = r;
    });
    await hung.tick(15_000);
    expect(result).toBe("failed");
    expect(hung.reloads).toHaveLength(0);
  });

  test("two taps share one check", async () => {
    const u = updates();
    const [a, b] = await Promise.all([u.app.checkForUpdate(), u.app.checkForUpdate()]);
    expect([a, b]).toEqual(["current", "current"]);
    expect(u.state.updates).toBe(1);
  });

  test("restart always reloads; applyUpdate only with an update ready", () => {
    const u = updates();
    u.app.applyUpdate();
    expect(u.reloads).toHaveLength(0);
    u.app.restart();
    expect(u.reloads).toHaveLength(1);
  });
});

describe("automatic checks", () => {
  test("when Vela becomes visible again, not while hidden", async () => {
    const u = updates();
    await u.tick(2 * 60_000);
    u.page.visibilityState = "hidden";
    u.page.fire("visibilitychange");
    await u.flush();
    expect(u.state.updates).toBe(0);
    u.page.visibilityState = "visible";
    u.page.fire("visibilitychange");
    await u.flush();
    expect(u.state.updates).toBe(1);
  });

  test("when the network comes back", async () => {
    const u = updates();
    u.network.fire("online");
    await u.flush();
    expect(u.state.updates).toBe(1);
  });

  test("on the 30 minute timer", async () => {
    const u = updates();
    await u.tick(30 * 60_000 - 1);
    expect(u.state.updates).toBe(0);
    await u.tick(1);
    expect(u.state.updates).toBe(1);
    await u.tick(30 * 60_000);
    expect(u.state.updates).toBe(2);
  });

  test("at most one a minute, so a phone that wakes often does not hammer the host", async () => {
    const u = updates();
    u.network.fire("online");
    await u.flush();
    u.page.fire("visibilitychange");
    await u.tick(59_000);
    u.network.fire("online");
    await u.flush();
    expect(u.state.updates).toBe(1);
    await u.tick(1_000);
    u.page.fire("visibilitychange");
    await u.flush();
    expect(u.state.updates).toBe(2);
    // The driver's tap is never held back.
    await u.app.checkForUpdate();
    expect(u.state.updates).toBe(3);
  });

  test("an automatic check that finds a new version makes the update ready", async () => {
    const u = updates({ next: "new" });
    let changes = 0;
    u.app.subscribe(() => changes++);
    u.network.fire("online");
    await u.flush();
    u.takeOver();
    await u.flush();
    expect(u.app.updateReady).toBe(true);
    expect(changes).toBe(1);
    // Ready: no more checks.
    await u.tick(30 * 60_000);
    expect(u.state.updates).toBe(1);
  });

  test("dispose stops the timer", async () => {
    const u = updates();
    u.app.dispose();
    await u.tick(60 * 60_000);
    expect(u.state.updates).toBe(0);
  });
});
