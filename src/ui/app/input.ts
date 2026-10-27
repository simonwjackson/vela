/** Read the engines' current state into the mapping's input. The mount calls this on every render. */
import type { AppDeps, NavState, Readouts } from "./contract";
import type { Memory, ScreenInput, UiState } from "./screen";

export interface InputExtras {
  now: number;
  online: boolean;
  ui: UiState;
  memory: Memory;
  frame: { h: number; keyboard: number };
  version?: string | undefined;
  /** The last state and readouts the mount was told about (subscriptions can run ahead of getters). */
  nav?: NavState;
  readouts?: Readouts;
}

export function inputOf(deps: AppDeps, x: InputExtras): ScreenInput {
  const { nav, listening, downloads, coDriver, wake, settings, app } = deps;
  const status = (deps.trips as { status?: { lastError?: string } }).status;
  return {
    now: x.now,
    nav: x.nav ?? nav.state,
    readouts: x.readouts ?? nav.readouts,
    saved: nav.savedPlaces(),
    recent: nav.recentDestinations(),
    nowPlaying: listening.nowPlaying,
    shelf: listening.shelf,
    downloads: downloads.status,
    talk: coDriver.state,
    coDriver: coDriver.current,
    coDrivers: coDriver.list(),
    wake: wake.state,
    settings: settings.value,
    app: { updateReady: app.updateReady, soundBlocked: app.soundBlocked, permissions: app.permissions, firstRun: app.firstRun },
    trips: { queued: deps.trips.queued, lastError: status?.lastError },
    online: x.online,
    ui: x.ui,
    memory: x.memory,
    frame: x.frame,
    version: x.version,
    car: deps.car ? { state: deps.car.state, readings: deps.car.readings } : undefined,
  };
}
