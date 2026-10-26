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
