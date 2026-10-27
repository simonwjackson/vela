/** Build-only: vocabulary's zod schemas never enter the browser dependency graph. */
import { createServer } from "vite";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function generatedSchema(vocabulary = "src/ui/moment/vocabulary.ts") {
  // Reuse Vite's existing TypeScript loader rather than own a third build dependency.
  const server = await createServer({
    configFile: false,
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true },
  });
  try {
    const { buildLibrary } = await server.ssrLoadModule(resolve(vocabulary));
    return `${JSON.stringify(buildLibrary().toJSONSchema(), null, 2)}\n`;
  } finally { await server.close(); }
}
if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href) {
  const expected = await generatedSchema(process.env.MOMENT_VOCABULARY);
  const path = "src/contract/moment-schema.json";
  if (process.argv.includes("--check")) {
    if (await readFile(path, "utf8") !== expected) throw new Error("Moment schema is stale; run npm run schema:generate");
  } else await writeFile(path, expected);
}
