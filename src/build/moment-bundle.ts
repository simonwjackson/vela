/** Build-only inspection of the emitted graph, including shared entry dependencies. */
export interface ClientChunk {
  readonly fileName: string;
  readonly isEntry: boolean;
  readonly imports: readonly string[];
  readonly dynamicImports: readonly string[];
  readonly modules: readonly string[];
}
export function isZodModule(id: string): boolean { return /\/node_modules\/zod\//.test(id.replaceAll("\\", "/")); }
function isMomentRuntime(id: string): boolean {
  return isZodModule(id) || /\/node_modules\/@openuidev\/lang-core\//.test(id.replaceAll("\\", "/"));
}
export function assertMomentBundle(chunks: readonly ClientChunk[], localSchemas: readonly string[]): void {
  const byName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  const eager = new Set<string>();
  function visit(name: string, found: Set<string>, dynamic: boolean): void {
    if (found.has(name)) return;
    found.add(name);
    const chunk = byName.get(name);
    if (!chunk) return;
    for (const dependency of chunk.imports) visit(dependency, found, dynamic);
    if (dynamic) for (const dependency of chunk.dynamicImports) visit(dependency, found, dynamic);
  }
  for (const chunk of chunks) if (chunk.isEntry) visit(chunk.fileName, eager, false);
  const lazy = new Set<string>();
  for (const name of eager) for (const dependency of byName.get(name)?.dynamicImports ?? []) visit(dependency, lazy, true);
  const schemas = new Set(localSchemas);
  const runtimeChunks = new Set<string>();
  for (const chunk of chunks) {
    for (const id of chunk.modules) {
      if (/\/src\/ui\/moment\/vocabulary\.ts(?:$|\?)/.test(id.replaceAll("\\", "/")) || schemas.has(id)) {
        throw new Error("A build-time Moment vocabulary or local zod schema entered the client bundle; import moment-schema.json instead");
      }
      if (!isMomentRuntime(id)) continue;
      if (eager.has(chunk.fileName) || !lazy.has(chunk.fileName)) {
        throw new Error("lang-core and zod must stay behind the Moment dynamic import, outside every entry's static dependency graph");
      }
      runtimeChunks.add(chunk.fileName);
    }
  }
  if (runtimeChunks.size > 1) throw new Error("lang-core and zod must share one lazy Moment runtime chunk");
}
