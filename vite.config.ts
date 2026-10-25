import { defineConfig } from "vitest/config";

export default defineConfig({
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
