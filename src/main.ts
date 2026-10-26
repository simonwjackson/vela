/**
 * Shell. Loads config, registers the service worker, builds every engine (src/shell/compose.ts)
 * and mounts the Signal UI with them. A failed start shows the boot error screen; its "Try again"
 * removes the service worker and the app shell caches before it reloads (src/sw/reset.ts).
 * AppStatus looks for new versions (src/shell/app-status.ts).
 */
import { loadConfig } from "./contract";
import { composeVela } from "./shell/compose";
import { registerListeningWorker } from "./sw/register";
import { browserShellReset } from "./sw/reset";
import { mount, mountBootError } from "./ui/app/mount";

async function main(): Promise<void> {
  const root = document.getElementById("app");
  if (!root) return;
  try {
    const config = await loadConfig();
    // The worker adds the Pyxis token to /stream and serves offline copies; Music needs it.
    // On the very first visit the worker is installed but not yet in control, so reload once.
    // If registration fails the app still runs (navigation works; Music streaming and offline audio do not),
    // so never wait for a worker that is not coming.
    const registration = await registerListeningWorker("/sw.js").catch(() => undefined);
    if (registration && "serviceWorker" in navigator) {
      await Promise.race([navigator.serviceWorker.ready, new Promise((resolve) => setTimeout(resolve, 5_000))]);
      if (!navigator.serviceWorker.controller && !sessionStorage.getItem("vela.swReload")) {
        sessionStorage.setItem("vela.swReload", "1");
        location.reload();
        return;
      }
    }

    const vela = composeVela(config);
    mount(root, vela.deps, { version: __VELA_VERSION__, testTurnSound: vela.testTurnSound });
  } catch (error) {
    mountBootError(root, error instanceof Error ? error.message : String(error), { retry: browserShellReset() });
  }
}

void main();
