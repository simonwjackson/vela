import { assertMomentBundle, type ClientChunk } from "./moment-bundle";
const runtime = ["/project/node_modules/@openuidev/lang-core/dist/index.mjs", "/project/node_modules/zod/v4/index.js"];
const main: ClientChunk = { fileName: "main.js", isEntry: true, imports: [], dynamicImports: ["moment.js"], modules: ["/project/src/main.ts"] };
const lazy: ClientChunk = { fileName: "moment.js", isEntry: false, imports: [], dynamicImports: [], modules: runtime };

test("lang-core and its zod can share the one dynamically imported runtime chunk", () => {
  expect(() => assertMomentBundle([main, lazy], [])).not.toThrow();
});
test("runtime code cannot enter main", () => {
  expect(() => assertMomentBundle([{ ...main, modules: runtime }], [])).toThrow("static dependency graph");
});
test("a shared static entry dependency cannot hide runtime code", () => {
  expect(() => assertMomentBundle([{ ...main, imports: [lazy.fileName] }, lazy], [])).toThrow("static dependency graph");
});
test("the build-time vocabulary cannot enter even a lazy chunk", () => {
  expect(() => assertMomentBundle([main, { ...lazy, modules: ["/project/src/ui/moment/vocabulary.ts"] }], [])).toThrow("build-time");
});
test("local zod schema modules cannot enter even a lazy chunk", () => {
  const schema = "/project/src/contract/program-schema.ts";
  expect(() => assertMomentBundle([main, { ...lazy, modules: [schema] }], [schema])).toThrow("local zod schema");
});
test("the runtime and its zod must remain in the same lazy chunk", () => {
  const zod: ClientChunk = { ...lazy, fileName: "zod.js", modules: runtime.slice(1) };
  expect(() => assertMomentBundle([main, { ...lazy, imports: [zod.fileName], modules: runtime.slice(0, 1) }, zod], [])).toThrow("one lazy");
});
