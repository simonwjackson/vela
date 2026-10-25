/**
 * Offline downloads runner. It runs in the page, on Wi-Fi only, and fills Cache Storage with
 * the audio the rules in download-plan.ts select; the service worker then answers the player
 * from those copies.
 *
 * A Source whose Service cannot answer while planning keeps its existing copies: only Sources
 * that were planned successfully have their stale copies evicted.
 */
import type { Item, SourceId } from "../contract";
import { createEmitter, errorMessage } from "../audio/emitter";
import type { KeyValueStorage } from "../audio/shelf-store";
import {
  type ConnectionLike,
  type DownloadTarget,
  NARRATION_AHEAD_MS,
  type NarrationPiece,
  type NetworkVerdict,
  type PodcastCandidates,
  diffDownloads,
  downloadNetwork,
  selectNarrationAhead,
  selectPodcastDownloads,
} from "./download-plan";
import type { OfflineAudio } from "./offline-cache";
import type { ListeningOrigins } from "./stream-fetch";

export const MANUAL_WIFI_KEY = "vela.downloads.manualWifi";

export interface DownloadSources {
  podcasts(): Promise<PodcastCandidates>;
  /** The Book on the Shelf, if any. */
  currentBook(): Item | undefined;
  narrationAhead(book: Item, budgetMs: number): Promise<readonly NarrationPiece[]>;
  pinnedTracks(): Promise<readonly { readonly url: string; readonly label: string }[]>;
}

export type DownloadItemState = "waiting" | "downloading" | "saved" | "failed";

export interface DownloadItem {
  readonly source: SourceId;
  readonly label: string;
  readonly url: string;
  readonly state: DownloadItemState;
  readonly error?: string;
}

export type DownloadPhase =
  | { readonly kind: "idle" }
  | { readonly kind: "blocked"; readonly network: NetworkVerdict }
  | { readonly kind: "planning" }
  | { readonly kind: "downloading"; readonly done: number; readonly total: number }
  | { readonly kind: "done"; readonly saved: number; readonly failed: number; readonly at: number };

export interface DownloadStatus {
  readonly phase: DownloadPhase;
  readonly items: readonly DownloadItem[];
  /** Per-Source planning failures, e.g. "Ossicle is unreachable". */
  readonly problems: Readonly<Partial<Record<SourceId, string>>>;
  readonly manualWifi: boolean;
}

export interface DownloadsOptions {
  readonly origins: ListeningOrigins;
  readonly offline: OfflineAudio;
  readonly sources: DownloadSources;
  readonly fetch: typeof fetch;
  /** The Pyxis device token for /stream downloads. */
  readonly pyxisToken: () => Promise<string | undefined>;
  readonly connection: () => ConnectionLike | undefined;
  readonly storage: KeyValueStorage;
  readonly narrationAheadMs?: number;
  /** How often a running download checks it is still on Wi-Fi. Default 1 s. */
  readonly networkCheckMs?: number;
}

export interface Downloads {
  readonly status: DownloadStatus;
  run(): Promise<void>;
  setManualWifi(allowed: boolean): void;
  subscribe(listener: (status: DownloadStatus) => void): () => void;
}

/** Which Source a cached URL belongs to. */
export function sourceOfUrl(url: string, origins: ListeningOrigins): SourceId | undefined {
  const parsed = new URL(url);
  if (parsed.origin === new URL(origins.pyxis).origin && parsed.pathname.startsWith("/stream/")) return "music";
  if (parsed.origin === new URL(origins.ossicle).origin) {
    if (parsed.pathname.startsWith("/comics/")) return "books";
    if (parsed.pathname.startsWith("/audio/")) return "podcasts";
  }
  return undefined;
}

export function createDownloads(options: DownloadsOptions): Downloads {
  const { offline, sources, storage, origins } = options;
  const changes = createEmitter<DownloadStatus>();
  let status: DownloadStatus = {
    phase: { kind: "idle" },
    items: [],
    problems: {},
    manualWifi: storage.getItem(MANUAL_WIFI_KEY) === "true",
  };
  let running: Promise<void> | undefined;

  const update = (next: Partial<DownloadStatus>) => {
    status = { ...status, ...next };
    changes.emit(status);
  };

  const setItem = (url: string, next: Partial<DownloadItem>) => {
    update({ items: status.items.map((item) => (item.url === url ? { ...item, ...next } : item)) });
  };

  async function plan(): Promise<{ wanted: DownloadTarget[]; planned: Set<SourceId>; problems: Partial<Record<SourceId, string>> }> {
    const wanted: DownloadTarget[] = [];
    const planned = new Set<SourceId>();
    const problems: Partial<Record<SourceId, string>> = {};
    const attempt = async (source: SourceId, task: () => Promise<readonly DownloadTarget[]>) => {
      try {
        wanted.push(...(await task()));
        planned.add(source);
      } catch (error) {
        problems[source] = errorMessage(error);
      }
    };
    await attempt("podcasts", async () =>
      selectPodcastDownloads(await sources.podcasts()).map((episode) => ({
        source: "podcasts" as const,
        url: episode.url,
        label: episode.title,
        auth: "none" as const,
      })),
    );
    await attempt("books", async () => {
      const book = sources.currentBook();
      if (book === undefined) return [];
      const budget = options.narrationAheadMs ?? NARRATION_AHEAD_MS;
      const pieces = selectNarrationAhead(await sources.narrationAhead(book, budget), budget);
      return pieces.map((piece, index) => ({
        source: "books" as const,
        url: piece.url,
        label: `${book.title}, part ${index + 1}`,
        auth: "none" as const,
      }));
    });
    await attempt("music", async () =>
      (await sources.pinnedTracks()).map((track) => ({
        source: "music" as const,
        url: track.url,
        label: track.label,
        auth: "pyxis" as const,
      })),
    );
    return { wanted, planned, problems };
  }

  async function download(target: DownloadTarget): Promise<void> {
    setItem(target.url, { state: "downloading" });
    // Leaving Wi-Fi stops the file in flight, not only the files after it.
    const abort = new AbortController();
    const watch = setInterval(() => {
      if (downloadNetwork(options.connection(), status.manualWifi).kind === "blocked") {
        abort.abort(new Error("Wi-Fi was lost"));
      }
    }, options.networkCheckMs ?? 1000);
    try {
      const headers = new Headers();
      if (target.auth === "pyxis") {
        const token = await options.pyxisToken();
        if (token === undefined) throw new Error("Music has no Pyxis device token yet");
        headers.set("authorization", `Bearer ${token}`);
      }
      const response = await options.fetch(target.url, { headers, mode: "cors", credentials: "omit", signal: abort.signal });
      if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
      // Read the whole body before storing, so an abort mid-body never stores a partial file.
      const body = await response.blob();
      if (abort.signal.aborted) throw abort.signal.reason;
      await offline.put(target.url, new Response(body, { headers: response.headers }));
      setItem(target.url, { state: "saved" });
    } catch (error) {
      setItem(target.url, { state: "failed", error: errorMessage(abort.signal.aborted ? abort.signal.reason : error) });
    } finally {
      clearInterval(watch);
    }
  }

  async function runOnce(): Promise<void> {
    const network = downloadNetwork(options.connection(), status.manualWifi);
    if (network.kind === "blocked") {
      update({ phase: { kind: "blocked", network } });
      return;
    }
    update({ phase: { kind: "planning" } });
    const { wanted, planned, problems } = await plan();
    const cached = await offline.keys();
    const diff = diffDownloads(wanted, cached);
    for (const url of diff.evict) {
      const source = sourceOfUrl(url, origins);
      if (source !== undefined && planned.has(source)) await offline.delete(url);
    }
    const wantedUrls = new Set(diff.fetch.map((target) => target.url));
    update({
      problems,
      items: wanted.map((target) => ({
        source: target.source,
        label: target.label,
        url: target.url,
        state: wantedUrls.has(target.url) ? "waiting" : "saved",
      })),
      phase: { kind: "downloading", done: 0, total: diff.fetch.length },
    });
    let done = 0;
    for (const target of diff.fetch) {
      // Leaving Wi-Fi mid-run stops the run; what is saved stays.
      if (downloadNetwork(options.connection(), status.manualWifi).kind === "blocked") break;
      await download(target);
      done += 1;
      update({ phase: { kind: "downloading", done, total: diff.fetch.length } });
    }
    update({
      phase: {
        kind: "done",
        saved: status.items.filter((item) => item.state === "saved").length,
        failed: status.items.filter((item) => item.state === "failed").length,
        at: Date.now(),
      },
    });
  }

  return {
    get status() {
      return status;
    },
    run() {
      running ??= runOnce().finally(() => {
        running = undefined;
      });
      return running;
    },
    setManualWifi(allowed) {
      try {
        storage.setItem(MANUAL_WIFI_KEY, String(allowed));
      } catch {
        // The flag lasts for this run only.
      }
      update({ manualWifi: allowed });
    },
    subscribe: (listener) => changes.subscribe(listener),
  };
}
