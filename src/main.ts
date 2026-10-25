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
    await registerListeningWorker("/sw.js").catch((error: unknown) => console.warn("Vela could not start its service worker", error));

    // One GPS source feeds both guidance and Trips.
    const fixes = new GeolocationFixSource();
    const network = browserNetwork();
    const nav = createNavEngine({ config, fixes, network });
    const trips = createTripsReporter({ config, network });
    trips.follow(fixes);

    const vela = createVelaListening(config);
    let audio: AudioContext | undefined;
    bridgeTurnSounds(nav, vela.listening, toneEarcons(() => { audio ??= new AudioContext(); return audio; }), config.turnSoundLeadMs);

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
