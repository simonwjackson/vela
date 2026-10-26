/**
 * AppStatus: what the app as a whole needs from the driver.
 *
 * - Update ready: the service worker activates new versions at once (skipWaiting + claim), so a
 *   new version is ready when the controlling worker changes under a page that already had one.
 *   The running page is still the old code; `applyUpdate` reloads into the new one.
 * - Sound blocked: browsers keep audio suspended until the first tap after a load. That matters
 *   only when Vela must make sound without a tap: while a Route is guided (Turn sounds) or the
 *   wake word is on (the Co-driver answers). `unblockSound` must run inside a tap.
 * - Permissions: location and microphone, from the Permissions API and from what the engines
 *   learn when they ask (a denied getUserMedia).
 * - First run: until `finishFirstRun`, stored on the phone.
 */
import type { AppStatus, NavState, Permission, Settings } from "../contract";

export const FIRST_RUN_KEY = "vela.firstRunDone";

export interface AudioUnlock {
  readonly state: string;
  resume(): Promise<void>;
  addEventListener(type: "statechange", listener: () => void): void;
}

export interface WorkerUpdates {
  readonly controller: unknown;
  addEventListener(type: "controllerchange", listener: () => void): void;
}

export interface PermissionsLike {
  query(descriptor: { name: string }): Promise<{ readonly state: string; addEventListener(type: "change", fn: () => void): void }>;
}

export interface AppStatusDeps {
  readonly audio: AudioUnlock;
  readonly worker?: WorkerUpdates;
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

  deps.worker?.addEventListener("controllerchange", () => {
    if (!hadController || updateReady) return;
    updateReady = true;
    notify();
  });
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

  return {
    get updateReady() {
      return updateReady;
    },
    applyUpdate() {
      if (updateReady) deps.reload();
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
      listeners.clear();
    },
  };
}
