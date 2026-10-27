/**
 * The lazy half of Moments: lang-core's parser (with the zod it runs at load), the evaluator,
 * mergeStatements and the gate, in one chunk the mount imports the first time a Moment arrives or
 * Moments are switched on. App startup and the main bundle stay as they were; the service worker
 * caches the chunk on first use, so it works offline after that.
 */
export type MomentEngine = typeof import("./engine");

let loading: Promise<MomentEngine> | undefined;

export function loadMoments(): Promise<MomentEngine> {
  loading ??= import("./engine");
  // A failed load (no signal before the chunk was ever cached) may be tried again.
  loading.catch(() => {
    loading = undefined;
  });
  return loading;
}
