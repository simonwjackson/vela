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
  const trips = createTripsReporter({ config, network });
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
  const surface = createSurfaceLink({
    origin: config.origins.assistant,
    path: config.assistantSurfacePath,
    connect: browserWebSocket,
    coDriver: () => settings.value.coDriver,
    nav,
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
    ...("serviceWorker" in navigator ? { worker: navigator.serviceWorker } : {}),
    reload: () => location.reload(),
    ...("permissions" in navigator ? { permissions: navigator.permissions } : {}),
    storage: localStorage,
    nav,
    settings,
  });

  surface.start();
  coDriver.start();

  return {
    trips,
    testTurnSound: () => playTurnSound(vela.listening, earcons, "approach"),
    deps: { nav, trips, listening: vela.listening, downloads: vela.downloads, coDriver, wake, settings, app },
    dispose() {
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
