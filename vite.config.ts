import { defineConfig } from "vitest/config";

/**
 * The build version shown in Settings: the package version, which npm passes to every script
 * (`npm run build`, also inside the Nix build). Without npm, "dev".
 */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const version = env.npm_package_version ?? "dev";

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
