import { defineConfig } from "vitest/config";

export default defineConfig({
  build: { target: "es2022", outDir: "dist" },
  test: { globals: true, environment: "happy-dom", include: ["src/**/*.test.ts"] },
});
