/** App-level status, and everything the shell hands to the UI's `mount(root, deps)`. */
import type { Downloads } from "../sw/downloads";
import type { CoDriver, WakeWord } from "./codriver";
import type { Listening } from "./listening";
import type { NavEngine, TripsReporter } from "./navigation";
import type { SettingsStore } from "./settings";

export type Permission = "granted" | "denied" | "prompt";
export interface AppStatus {
  readonly updateReady: boolean; applyUpdate(): void;
  readonly soundBlocked: boolean; unblockSound(): void;
  readonly permissions: { location: Permission; mic: Permission };
  readonly firstRun: boolean; finishFirstRun(): void;
  subscribe(fn: () => void): () => void;
}
export interface AppDeps {
  nav: NavEngine; trips: TripsReporter; listening: Listening; downloads: Downloads; // Downloads: the existing type from src/sw/downloads
  coDriver: CoDriver; wake: WakeWord; settings: SettingsStore; app: AppStatus;
}
