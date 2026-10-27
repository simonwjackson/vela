import { assertMomentBundle, isZodModule } from "./src/build/moment-bundle";
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
  plugins: [{
    name: "moment-client-schema-only",
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).flatMap((output) => output.type === "chunk" ? [{
        fileName: output.fileName, isEntry: output.isEntry, imports: output.imports,
        dynamicImports: output.dynamicImports, modules: Object.keys(output.modules),
      }] : []);
      const localSchemas = chunks.flatMap((chunk) => chunk.modules.filter((id) =>
        /\/src\//.test(id) && !id.includes("/node_modules/") &&
        this.getModuleInfo(id)?.importedIds.some(isZodModule),
      ));
      assertMomentBundle(chunks, localSchemas);
    },
  }],
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
