/**
 * Shell. Loads config, then mounts the plain reference UI. The real visual design is not
 * decided yet; this exists only to prove the engines work. Engines are wired in by their owners
 * through src/ui/listen/mount.ts and src/ui/drive/mount.ts.
 */
import { loadConfig } from "./contract";

async function main(): Promise<void> {
  const root = document.getElementById("app");
  if (!root) return;
  try {
    const config = await loadConfig();
    root.textContent = `Vela is configured for ${Object.keys(config.origins).length} services.`;
  } catch (error) {
    root.textContent = error instanceof Error ? error.message : String(error);
  }
}

void main();
