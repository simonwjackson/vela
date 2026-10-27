/**
 * The composition root: builds every engine from the config and wires them together, and
 * returns the AppDeps that the UI's `mount(root, deps)` takes.
 *
 * Wiring that lives here and nowhere else:
 * - one GPS source feeds Navigation and Trips;
 * - one AudioContext (created at start, so AppStatus can see it is blocked) plays Turn sounds
 *   and Co-driver speech, and is resumed by the first tap;
 * - one microphone stream serves Talk and the wake word;
 * - the settings drive Daylight contrast (Navigation), the wake word, the Co-driver, and
 *   downloads without Wi-Fi (Downloads keeps its own switch; the setting is its source).
 */
import { createCarLink } from "../car/link";
import { browserBluetooth } from "../car/gatt";
import { createEventDetectors } from "../events/detectors";
import { createDriveSummary } from "../events/drive-summary";
import { createWeatherAhead } from "../weather/ahead";
import { momentCapabilities } from "../moments/capabilities";
import { haversineMeters } from "../nav/geo";
import { createVelaListening } from "../audio/vela-listening";
import { browserMic } from "../codriver/mic";
import { browserWebSocket } from "../codriver/socket";
import { webAudioSpeech } from "../codriver/speaker";
import { createSurfaceLink } from "../codriver/surface-link";
import { createTalk } from "../codriver/talk";
import type { AppDeps, LoadedConfig } from "../contract";
import { browserNetwork, createNavEngine } from "../nav/engine";
import { GeolocationFixSource } from "../nav/position";
import { createSettingsStore } from "../settings/store";
import { MANUAL_WIFI_KEY } from "../sw/downloads";
import { type TripsEngine, createTripsReporter } from "../trips/reporter";
import { createWakeWord } from "../wake/wake-word";
import { type VelaAppStatus, createAppStatus } from "./app-status";
import { bridgeTurnSounds, playTurnSound, toneEarcons } from "./turn-sounds";

export interface VelaApp {
  readonly deps: AppDeps;
  /** Trips with its status (AppDeps carries it as the contract's TripsReporter). */
  readonly trips: TripsEngine;
  /** Play the approach Turn sound now, the same way a real one plays (Settings: test sound). */
  testTurnSound(): void;
  dispose(): void;
}

export function composeVela(config: LoadedConfig): VelaApp {
  const settings = createSettingsStore(localStorage, {
    // Before the setting existed, the downloads switch was stored on its own.
    downloadsOnWifiOnly: localStorage.getItem(MANUAL_WIFI_KEY) !== "true",
  });

  const fixes = new GeolocationFixSource(undefined, (status) => {
    // Fixes and permission answers always arrive after composeVela returns, so `app` exists.
    if (status === "denied") app.notePermission("location", "denied");
    if (status === "ok") app.notePermission("location", "granted");
  });
  const network = browserNetwork();
  const nav = createNavEngine({ config, fixes, network, settings });
  const bluetooth = browserBluetooth();
  const car = createCarLink({ ...(bluetooth ? { bluetooth } : {}), ...(config.tankLitres ? { tankLitres: config.tankLitres } : {}) });
  const trips = createTripsReporter({ config, network, carReadings: () => car.readings });
  const unfollow = trips.follow(fixes);

  const vela = createVelaListening(config);
  const applyDownloads = () => vela.downloads.setManualWifi(!settings.value.downloadsOnWifiOnly);
  applyDownloads();
  const offDownloads = settings.subscribe(applyDownloads);

  // Browsers keep audio suspended until a tap after each load; the first tap resumes it.
  const audio = new AudioContext();
  const context = (): AudioContext => {
    if (audio.state === "suspended") void audio.resume();
    return audio;
  };
  addEventListener("pointerdown", () => void audio.resume(), { capture: true });
  const earcons = toneEarcons(context);
  const unbridge = bridgeTurnSounds(nav, vela.listening, earcons, config.turnSoundLeadMs);

  const mic = browserMic();
  const onMicPermission = (state: "granted" | "denied") => app.notePermission("mic", state);
  const weather = createWeatherAhead({ url: config.weatherUrl, online: () => network.online(), emit: (change) => {
    events.weather(`${change.to}:${Math.round(change.at.lat * 100)}:${Math.round(change.at.lng * 100)}`, { ...change });
  } });
  const surface = createSurfaceLink({
    capabilities: momentCapabilities(settings.value.moments),
    soundMode: () => settings.value.soundMode,
    origin: config.origins.assistant,
    path: config.assistantSurfacePath,
    connect: browserWebSocket,
    coDriver: () => settings.value.coDriver,
    nav, car, weather,
    listening: vela.listening,
  });
  const coDriver = createTalk({
    origin: config.origins.voice,
    model: config.talkModel,
    connect: browserWebSocket,
    settings,
    mic,
    speech: webAudioSpeech(context),
    listening: vela.listening,
    surface,
    network,
    onMicPermission,
  });
  const wake = createWakeWord({ settings, mic, onWake: (before) => coDriver.wake(before), onMicPermission });

  const app: VelaAppStatus = createAppStatus({
    audio,
    ...("serviceWorker" in navigator
      ? {
          worker: navigator.serviceWorker,
          updates: {
            registration: () => navigator.serviceWorker.getRegistration("/"),
            page: document,
            network: window,
          },
        }
      : {}),
    reload: () => location.reload(),
    ...("permissions" in navigator ? { permissions: navigator.permissions } : {}),
    storage: localStorage,
    nav,
    settings,
  });

  const summary = createDriveSummary();
  const events = createEventDetectors((event) => settings.value.moments && surface.report(event));
  let resetBeforeRoute = false;
  let lastNavKind = nav.state.kind;
  const updateEvents = () => {
    const state = nav.state;
    if (resetBeforeRoute && state.kind === "guiding" && lastNavKind !== "guiding" && lastNavKind !== "rerouting") {
      events.reset(); weather.reset(); resetBeforeRoute = false;
    }
    lastNavKind = state.kind;
    events.update(state, car.readings, state.kind === "arrived" ? summary.snapshot(state.destination.name) : undefined);
    if (state.kind === "guiding" || state.kind === "rerouting") void weather.check(state.guidance);
    else weather.reset();
  };
  let eventsDisposed = false;
  const afterFix = () => queueMicrotask(() => { if (!eventsDisposed) updateEvents(); });
  const offEventsNav = nav.subscribe(afterFix);
  const offEventsSurface = surface.subscribe((status) => { if (status.kind === "open") afterFix(); });
  const offEventsCar = car.subscribe(updateEvents);
  let startName = "Starting point";
  const offSummary = fixes.subscribe((fix) => {
    const nearby = nav.savedPlaces().find((place) => haversineMeters(place, fix) <= 200);
    startName = nearby?.name ?? "Starting point";
    summary.record(fix);
  });
  let wasMoving = false;
  const offDrive = trips.subscribeStatus((status) => {
    if (status.moving && !wasMoving) {
      summary.reset(startName, true); car.newDrive();
    }
    if (!status.moving && wasMoving) resetBeforeRoute = true;
    wasMoving = status.moving;
  });
  let enabled = settings.value.moments;
  const offMomentsSettings = settings.subscribe((value) => {
    surface.refreshContext();
    if (value.moments !== enabled) { enabled = value.moments; surface.setCapabilities(momentCapabilities(enabled)); if (enabled) afterFix(); }
  });
  void car.start();
  surface.start();
  coDriver.start();

  return {
    trips,
    testTurnSound: () => playTurnSound(vela.listening, earcons, "approach"),
    deps: { moments: surface.moments, weather, car, nav, trips, listening: vela.listening, downloads: vela.downloads, coDriver, wake, settings, app },
    dispose() {
      eventsDisposed = true; offEventsSurface();
      offEventsNav(); offEventsCar(); offSummary(); offDrive(); offMomentsSettings(); car.dispose(); weather.reset();
      wake.dispose();
      coDriver.dispose();
      surface.close();
      app.dispose();
      unbridge();
      offDownloads();
      vela.dispose();
      unfollow();
      trips.dispose();
      nav.dispose();
      fixes.stop();
      void audio.close();
    },
  };
}
