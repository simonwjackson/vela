/**
 * AppStatus: what the app as a whole needs from the driver.
 *
 * - Update ready: the service worker activates new versions at once (skipWaiting + claim), so a
 *   new version is ready when the controlling worker changes under a page that already had one.
 *   The running page is still the old code; `applyUpdate` reloads into the new one.
 * - Update checks: a car app stays open for hours, so Vela asks the host for a new `/sw.js`
 *   (every build stamps its version into it) every UPDATE_EVERY_MS, when the page becomes visible
 *   again, and when the network comes back. Automatic checks are at least UPDATE_GAP_MS apart;
 *   `checkForUpdate` (the driver's tap) always runs, and waits until a new version installs.
 * - Sound blocked: browsers keep audio suspended until the first tap after a load. That matters
 *   only when Vela must make sound without a tap: while a Route is guided (Turn sounds) or the
 *   wake word is on (the Co-driver answers). `unblockSound` must run inside a tap.
 * - Permissions: location and microphone, from the Permissions API and from what the engines
 *   learn when they ask (a denied getUserMedia).
 * - First run: until `finishFirstRun`, stored on the phone.
 */
import type { AppStatus, NavState, Permission, Settings, UpdateCheck } from "../contract";

export const FIRST_RUN_KEY = "vela.firstRunDone";
/** Look for a new version this often while Vela is open. */
export const UPDATE_EVERY_MS = 30 * 60_000;
/** Automatic checks (visible again, back online, the timer) are at least this far apart. */
export const UPDATE_GAP_MS = 60_000;
/** `registration.update()` fetches /sw.js; longer than this counts as no answer. */
export const UPDATE_FETCH_TIMEOUT_MS = 15_000;
/** A new version that has not taken over after this long counts as a failed install. */
export const UPDATE_INSTALL_TIMEOUT_MS = 30_000;

export interface AudioUnlock {
  readonly state: string;
  resume(): Promise<void>;
  addEventListener(type: "statechange", listener: () => void): void;
}

export interface WorkerUpdates {
  readonly controller: unknown;
  addEventListener(type: "controllerchange", listener: () => void): void;
  removeEventListener?(type: "controllerchange", listener: () => void): void;
}

/** The parts of a ServiceWorker an update check watches. */
export interface IncomingWorker {
  readonly state: string;
  addEventListener(type: "statechange", listener: () => void): void;
  removeEventListener(type: "statechange", listener: () => void): void;
}

/** The parts of a ServiceWorkerRegistration an update check uses. */
export interface RegistrationLike {
  update(): Promise<unknown>;
  readonly installing: IncomingWorker | null;
  readonly waiting: IncomingWorker | null;
}

/** Something that fires events (document, window). */
export interface EventSourceLike {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface UpdateDeps {
  /** Vela's registration, or undefined when the worker is not registered. */
  registration(): Promise<RegistrationLike | undefined>;
  /** The document: a check runs when it becomes visible again. */
  page?: EventSourceLike & { readonly visibilityState: string };
  /** The window: a check runs when it fires `online`. */
  network?: EventSourceLike;
  now?: () => number;
  /** Timers, replaceable in tests. */
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (id: unknown) => void;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (id: unknown) => void;
}

export interface PermissionsLike {
  query(descriptor: { name: string }): Promise<{ readonly state: string; addEventListener(type: "change", fn: () => void): void }>;
}

export interface AppStatusDeps {
  readonly audio: AudioUnlock;
  readonly worker?: WorkerUpdates;
  /** Present when Vela can look for updates (a service worker is supported). */
  readonly updates?: UpdateDeps;
  readonly reload: () => void;
  readonly permissions?: PermissionsLike;
  readonly storage?: Pick<Storage, "getItem" | "setItem">;
  readonly nav: { readonly state: NavState; subscribe(fn: (state: NavState) => void): () => void };
  readonly settings: { readonly value: Pick<Settings, "wakeWord">; subscribe(fn: () => void): () => void };
}

export interface VelaAppStatus extends AppStatus {
  /** An engine learned a permission state by asking (for example getUserMedia was refused). */
  notePermission(kind: "location" | "mic", state: Permission): void;
  dispose(): void;
}

const PERMISSION_NAMES = { location: "geolocation", mic: "microphone" } as const;

function asPermission(state: string): Permission {
  return state === "granted" || state === "denied" ? state : "prompt";
}

export function createAppStatus(deps: AppStatusDeps): VelaAppStatus {
  const listeners = new Set<() => void>();
  const hadController = Boolean(deps.worker?.controller);
  let updateReady = false;
  let permissions: { location: Permission; mic: Permission } = { location: "prompt", mic: "prompt" };
  let firstRun = readFirstRun();
  let soundBlocked = false;

  const notify = () => {
    for (const fn of [...listeners]) fn();
  };

  function readFirstRun(): boolean {
    try {
      return deps.storage?.getItem(FIRST_RUN_KEY) !== "1";
    } catch {
      return true;
    }
  }

  function needsSound(): boolean {
    const kind = deps.nav.state.kind;
    return kind === "guiding" || kind === "rerouting" || deps.settings.value.wakeWord;
  }

  function refreshSound(): void {
    const next = deps.audio.state === "suspended" && needsSound();
    if (next === soundBlocked) return;
    soundBlocked = next;
    notify();
  }

  function setPermission(kind: "location" | "mic", state: Permission): void {
    if (permissions[kind] === state) return;
    permissions = { ...permissions, [kind]: state };
    notify();
  }

  // Fired when a new worker takes over; `takeovers` also wakes a check waiting for its install.
  const takeovers = new Set<() => void>();
  const onControllerChange = () => {
    for (const fn of [...takeovers]) fn();
    if (!hadController || updateReady) return;
    updateReady = true;
    notify();
  };
  deps.worker?.addEventListener("controllerchange", onControllerChange);
  const updates = watchUpdates();
  deps.audio.addEventListener("statechange", refreshSound);
  const offNav = deps.nav.subscribe(refreshSound);
  const offSettings = deps.settings.subscribe(refreshSound);
  refreshSound();

  for (const kind of ["location", "mic"] as const) {
    deps.permissions
      ?.query({ name: PERMISSION_NAMES[kind] })
      .then((status) => {
        setPermission(kind, asPermission(status.state));
        status.addEventListener("change", () => setPermission(kind, asPermission(status.state)));
      })
      .catch(() => undefined); // Not supported for this name: stays "prompt" until an engine learns more.
  }

  /**
   * One check: fetch /sw.js; if it changed, wait until the new worker takes over (it calls
   * skipWaiting and claims the page). Concurrent calls share one check.
   */
  function watchUpdates() {
    const u = deps.updates;
    const now = u?.now ?? Date.now;
    const later = u?.setTimeout ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
    const cancel = u?.clearTimeout ?? ((id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>));
    let running: Promise<UpdateCheck> | undefined;
    let lastCheck = Number.NEGATIVE_INFINITY;

    const within = <T>(promise: Promise<T>, ms: number): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        const timer = later(() => reject(new Error("timed out")), ms);
        promise.then(
          (value) => {
            cancel(timer);
            resolve(value);
          },
          (error: unknown) => {
            cancel(timer);
            reject(error);
          },
        );
      });

    /** Resolves "updated" once the incoming worker takes over, "failed" if it dies or stalls. */
    const takeOver = (incoming: IncomingWorker): Promise<UpdateCheck> =>
      new Promise<UpdateCheck>((resolve) => {
        let done = false;
        const finish = (result: UpdateCheck) => {
          if (done) return;
          done = true;
          cancel(timer);
          takeovers.delete(onTakeover);
          incoming.removeEventListener("statechange", onState);
          resolve(result);
        };
        const onTakeover = () => finish("updated");
        const onState = () => {
          if (incoming.state === "activated") finish("updated");
          else if (incoming.state === "redundant") finish("failed");
        };
        const timer = later(() => finish(updateReady ? "updated" : "failed"), UPDATE_INSTALL_TIMEOUT_MS);
        takeovers.add(onTakeover);
        incoming.addEventListener("statechange", onState);
        onState();
      });

    const run = async (): Promise<UpdateCheck> => {
      lastCheck = now();
      if (!u) return "failed";
      try {
        const registration = await within(u.registration(), UPDATE_FETCH_TIMEOUT_MS);
        if (!registration) return "failed";
        await within(registration.update(), UPDATE_FETCH_TIMEOUT_MS);
        if (updateReady) return "updated";
        const incoming = registration.installing ?? registration.waiting;
        return incoming ? await takeOver(incoming) : "current";
      } catch {
        return "failed";
      }
    };

    const check = (): Promise<UpdateCheck> => {
      if (updateReady) return Promise.resolve("updated");
      running ??= run().finally(() => {
        running = undefined;
      });
      return running;
    };

    /** An automatic check: quiet, and not more often than UPDATE_GAP_MS. */
    const auto = () => {
      if (updateReady || running || now() - lastCheck < UPDATE_GAP_MS) return;
      void check();
    };
    const onVisible = () => {
      if (u?.page?.visibilityState === "visible") auto();
    };

    let interval: unknown;
    if (u) {
      u.page?.addEventListener("visibilitychange", onVisible);
      u.network?.addEventListener("online", auto);
      interval = (u.setInterval ?? ((fn: () => void, ms: number) => setInterval(fn, ms)))(auto, UPDATE_EVERY_MS);
    }
    return {
      check,
      dispose() {
        if (!u) return;
        u.page?.removeEventListener("visibilitychange", onVisible);
        u.network?.removeEventListener("online", auto);
        (u.clearInterval ?? ((id: unknown) => clearInterval(id as ReturnType<typeof setInterval>)))(interval);
      },
    };
  }

  return {
    get updateReady() {
      return updateReady;
    },
    applyUpdate() {
      if (updateReady) deps.reload();
    },
    checkForUpdate: () => updates.check(),
    restart() {
      deps.reload();
    },
    get soundBlocked() {
      return soundBlocked;
    },
    unblockSound() {
      deps.audio.resume().then(refreshSound, refreshSound);
    },
    get permissions() {
      return permissions;
    },
    get firstRun() {
      return firstRun;
    },
    finishFirstRun() {
      if (!firstRun) return;
      firstRun = false;
      try {
        deps.storage?.setItem(FIRST_RUN_KEY, "1");
      } catch {
        // Private mode: first run ends for this session only.
      }
      notify();
    },
    notePermission: setPermission,
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    dispose() {
      offNav();
      offSettings();
      updates.dispose();
      deps.worker?.removeEventListener?.("controllerchange", onControllerChange);
      takeovers.clear();
      listeners.clear();
    },
  };
}
