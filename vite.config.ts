import { defineConfig } from "vitest/config";

/**
 * The build version, shown in Settings ("Vela 1a2b3c4") and stamped into /sw.js so every release
 * gives the browser a byte-different worker to install. The Nix build sets VELA_VERSION to the
 * flake's short git revision (flake.nix); any other build is "dev".
 */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const version = env.VELA_VERSION?.trim() || "dev";

export default defineConfig({
  define: { __VELA_VERSION__: JSON.stringify(version) },
  build: {
    target: "es2022",
    outDir: "dist",
    rollupOptions: {
      // The service worker must be served from the site root as /sw.js so its scope covers the app.
      input: { main: "index.html", sw: "src/sw/service-worker.ts" },
      output: { entryFileNames: (chunk) => (chunk.name === "sw" ? "sw.js" : "assets/[name]-[hash].js") },
    },
  },
  test: { globals: true, environment: "happy-dom", include: ["src/**/*.test.ts"] },
});
