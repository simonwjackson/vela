/**
 * Shell. Loads config, builds the engines, and mounts the plain reference UI. The real visual
 * design is not decided yet; this exists only to prove the engines work together.
 */
import { createVelaListening } from "./audio/vela-listening";
import { loadConfig } from "./contract";
import { browserNetwork, createNavEngine } from "./nav/engine";
import { GeolocationFixSource } from "./nav/position";
import { bridgeTurnSounds, toneEarcons } from "./shell/turn-sounds";
import { registerListeningWorker } from "./sw/register";
import { createTripsReporter } from "./trips/reporter";
import { mount as mountDrive } from "./ui/drive/mount";
import { mount as mountListen } from "./ui/listen/mount";

async function main(): Promise<void> {
  const root = document.getElementById("app");
  if (!root) return;
  try {
    const config = await loadConfig();
    // The worker adds the Pyxis token to /stream and serves offline copies; Music needs it.
    // On the very first visit the worker is installed but not yet in control, so reload once.
    await registerListeningWorker("/sw.js").catch((error: unknown) => console.warn("Vela could not start its service worker", error));
    if ("serviceWorker" in navigator) {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller && !sessionStorage.getItem("vela.swReload")) {
        sessionStorage.setItem("vela.swReload", "1");
        location.reload();
        return;
      }
    }

    // One GPS source feeds both guidance and Trips.
    const fixes = new GeolocationFixSource();
    const network = browserNetwork();
    const nav = createNavEngine({ config, fixes, network });
    const trips = createTripsReporter({ config, network });
    trips.follow(fixes);

    const vela = createVelaListening(config);
    // Browsers only let audio start after a tap: create the context on the first one, and
    // resume it before every earcon in case the browser suspended it.
    let audio: AudioContext | undefined;
    const context = (): AudioContext => { audio ??= new AudioContext(); if (audio.state === "suspended") void audio.resume(); return audio; };
    addEventListener("pointerdown", () => context(), { once: true, capture: true });
    bridgeTurnSounds(nav, vela.listening, toneEarcons(context), config.turnSoundLeadMs);

    root.replaceChildren();
    const drive = document.createElement("section");
    const listen = document.createElement("section");
    root.append(drive, listen);
    mountDrive(drive, { nav, trips });
    mountListen(listen, { listening: vela.listening, downloads: vela.downloads });
  } catch (error) {
    root.textContent = error instanceof Error ? error.message : String(error);
  }
}

void main();
