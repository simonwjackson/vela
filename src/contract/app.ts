/** App-level status, and everything the shell hands to the UI's `mount(root, deps)`. */
import type { Downloads } from "../sw/downloads";
import type { CoDriver, WakeWord } from "./codriver";
import type { Listening } from "./listening";
import type { NavEngine, TripsReporter } from "./navigation";
import type { SettingsStore } from "./settings";

export type Permission = "granted" | "denied" | "prompt";
/**
 * What one update check found:
 * - "updated": a new version installed and took over; `applyUpdate()` reloads into it;
 * - "current": the running version is the newest;
 * - "failed": the check could not run (no service worker, no signal, timeout, a broken install).
 */
export type UpdateCheck = "updated" | "current" | "failed";
export interface AppStatus {
  /** A new version took over the service worker; the page still runs the old code. */
  readonly updateReady: boolean;
  /** Reload into the new version. Does nothing when no update is ready. */
  applyUpdate(): void;
  /**
   * Ask the host for a new version now (`registration.update()`), and wait until it installs.
   * Never rejects. Vela also checks by itself: on a timer, when it becomes visible, and when
   * the network comes back.
   */
  checkForUpdate(): Promise<UpdateCheck>;
  /** Reload Vela whatever the update state: the escape when a check fails. */
  restart(): void;
  readonly soundBlocked: boolean; unblockSound(): void;
  readonly permissions: { location: Permission; mic: Permission };
  readonly firstRun: boolean; finishFirstRun(): void;
  subscribe(fn: () => void): () => void;
}
export interface AppDeps {
  nav: NavEngine; trips: TripsReporter; listening: Listening; downloads: Downloads; // Downloads: the existing type from src/sw/downloads
  coDriver: CoDriver; wake: WakeWord; settings: SettingsStore; app: AppStatus;
}
