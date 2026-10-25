/**
 * An in-memory Ossicle (and the reader behind `/comics/*`) behind a real `fetch` function.
 * Invented content only; origin `https://ossicle.test`. Position writes follow Ossicle's rules
 * (ossicle services/ossicle/src/position.rs): revision check, 5 s agreement window, force
 * against the seen revision.
 *
 * Knobs: `offline` (fetch rejects), `windowAfterPolls` (narration synthesis delay),
 * `positions` and `bookPositions` to seed another device's progress.
 */
import type { OssicleEpisode, OssiclePodcast, OssiclePosition } from "../ossicle-rpc";

export const OSSICLE_ORIGIN = "https://ossicle.test";

export interface BookSeed {
  readonly id: string;
  readonly title: string;
  readonly authors: readonly string[];
  readonly generation: string;
  /** Number of sentences; each is 10 s in the timeline estimate. */
  readonly sentences: number;
}

export interface InMemoryOssicle {
  readonly origin: string;
  readonly fetch: typeof fetch;
  offline: boolean;
  windowAfterPolls: number;
  readonly podcasts: OssiclePodcast[];
  readonly episodes: OssicleEpisode[];
  readonly queue: string[];
  readonly positions: Map<string, OssiclePosition>;
  readonly bookPositions: Map<string, { locator: Record<string, unknown>; revision: number; deviceId: string; updatedAt: string }>;
  /** Every RPC request body, in order. */
  readonly calls: { readonly tag: string; readonly payload: Record<string, unknown> }[];
  /** Write a position as another device would. */
  writeFromOtherDevice(episodeId: string, seconds: number): OssiclePosition;
}

const SENTENCE_MS = 10_000;

export function createInMemoryOssicle(options: { readonly books?: readonly BookSeed[] } = {}): InMemoryOssicle {
  const podcasts: OssiclePodcast[] = [
    { id: "p-engine", feedUrl: "https://feeds.test/engine.rss", title: "The Quiet Engine", coverPath: "/covers/p-engine?v=1", episodeCount: 3 },
    { id: "p-tides", feedUrl: "https://feeds.test/tides.rss", title: "Tide Tables", episodeCount: 2 },
  ];
  const episodes: OssicleEpisode[] = [
    { id: "e-5", podcastId: "p-tides", title: "Neap and Spring", durationSeconds: 1800, publishedAt: "2026-10-20T00:00:00Z", audioPath: "/audio/e-5?v=a5", audioCached: true },
    { id: "e-4", podcastId: "p-engine", title: "Gears of Glass", durationSeconds: 2400, publishedAt: "2026-10-18T00:00:00Z", audioPath: "/audio/e-4?v=a4", audioCached: true },
    { id: "e-3", podcastId: "p-engine", title: "A Video Channel Episode", durationSeconds: 900, publishedAt: "2026-10-15T00:00:00Z", audioPath: "/audio/e-3?v=a3", audioCached: false, videoPath: "/video/e-3?v=v3" },
    { id: "e-2", podcastId: "p-tides", title: "Low Water", durationSeconds: 1200, publishedAt: "2026-10-10T00:00:00Z", audioPath: "/audio/e-2?v=a2", audioCached: true },
    { id: "e-1", podcastId: "p-engine", title: "First Turn of the Crank", durationSeconds: 3000, publishedAt: "2026-10-01T00:00:00Z", audioPath: "/audio/e-1?v=a1", audioCached: true },
  ];
  const books = options.books ?? [
    { id: "b-lantern", title: "The Lantern Keeper", authors: ["A. Invented"], generation: "g1", sentences: 40 },
  ];
  const positions = new Map<string, OssiclePosition>();
  const bookPositions: InMemoryOssicle["bookPositions"] = new Map();
  const calls: InMemoryOssicle["calls"] = [];
  const prepares = new Map<string, number>();

  const now = () => new Date().toISOString();

  function writePosition(payload: Record<string, unknown>) {
    const episodeId = String(payload.episodeId);
    if (!episodes.some((episode) => episode.id === episodeId)) return { status: "unknownEpisode" };
    const seconds = Number(payload.seconds);
    const base = payload.baseRevision as number | undefined;
    const force = payload.force === true;
    if (force && base === undefined) return { status: "unavailable", value: { message: "forced position writes require a reported revision" } };
    const existing = positions.get(episodeId);
    if (existing !== undefined && base !== existing.revision) {
      if (Math.abs(existing.seconds - seconds) <= 5) return { status: "accepted", value: existing };
      return { status: "conflict", value: { theirs: existing, yours: seconds } };
    }
    const next: OssiclePosition = {
      episodeId,
      seconds,
      revision: (existing?.revision ?? 0) + 1,
      deviceId: String(payload.deviceId),
      updatedAt: now(),
      played: existing?.played ?? false,
    };
    positions.set(episodeId, next);
    return { status: "accepted", value: next };
  }

  const timelineOf = (book: BookSeed) => ({
    estimatedDurationMs: book.sentences * SENTENCE_MS,
    segments: Array.from({ length: book.sentences }, (_, ordinal) => ({
      ordinal,
      resource: `chapter-${Math.floor(ordinal / 20)}.xhtml`,
      selector: `p:nth-of-type(${ordinal + 1})`,
      startOffset: (ordinal % 20) * 100,
      endOffset: (ordinal % 20) * 100 + 100,
      estimatedStartMs: ordinal * SENTENCE_MS,
      estimatedDurationMs: SENTENCE_MS,
    })),
  });

  function comics(tag: string, payload: Record<string, unknown>) {
    const book = books.find((entry) => entry.id === payload.bookId);
    switch (tag) {
      case "books.list":
        return { status: "ready", value: { publications: books.map(({ sentences: _s, ...rest }) => rest), failures: [] } };
      case "narration.timeline":
        return book === undefined ? { status: "absent" } : { status: "ready", value: timelineOf(book) };
      case "narration.prepare": {
        if (book === undefined) return { status: "absent" };
        const timeline = timelineOf(book);
        const start = timeline.segments.find(
          (segment) => segment.resource === payload.resource && segment.startOffset === payload.characterOffset,
        );
        if (start === undefined) return { status: "invalid", value: { code: "anchor", message: "no such anchor", retryable: false } };
        const key = `${book.id}:${start.ordinal}`;
        const polls = (prepares.get(key) ?? 0) + 1;
        prepares.set(key, polls);
        const segments = timeline.segments.slice(start.ordinal, start.ordinal + 8).map((segment) => ({
          id: `s-${segment.ordinal}`,
          ordinal: segment.ordinal,
          resource: segment.resource,
          selector: segment.selector,
          startOffset: segment.startOffset,
          endOffset: segment.endOffset,
          text: `Sentence ${segment.ordinal} of an invented book.`,
        }));
        if (polls <= ossicle.windowAfterPolls) return { status: "ready", value: { segments } };
        return {
          status: "ready",
          value: {
            segments,
            window: {
              id: `w-${key}`,
              audioUrl: `/narration/${book.id}/${start.ordinal}.ogg`,
              mediaType: "audio/ogg",
              durationMs: segments.length * SENTENCE_MS,
              startsMs: segments.map((_, index) => index * SENTENCE_MS),
              durationsMs: segments.map(() => SENTENCE_MS),
            },
          },
        };
      }
      case "book.position.read": {
        const stored = bookPositions.get(String(payload.bookId));
        return stored === undefined ? { status: "absent" } : { status: "found", value: { bookId: payload.bookId, ...stored } };
      }
      case "book.position.write": {
        const bookId = String(payload.bookId);
        const { bookId: _b, deviceId, force, baseRevision, ...locator } = payload;
        const existing = bookPositions.get(bookId);
        if (existing !== undefined && baseRevision !== existing.revision) {
          const same =
            existing.locator.resource === locator.resource && existing.locator.characterOffset === locator.characterOffset;
          if (same) return { status: "accepted", value: { bookId, ...existing } };
          return { status: "conflict", value: { theirs: { bookId, ...existing }, yours: locator } };
        }
        void force;
        const next = { locator, revision: (existing?.revision ?? 0) + 1, deviceId: String(deviceId), updatedAt: now() };
        bookPositions.set(bookId, next);
        return { status: "accepted", value: { bookId, ...next } };
      }
      default:
        return { status: "unavailable", value: { code: "unknown", message: `unknown ${tag}`, retryable: false } };
    }
  }

  function rpc(tag: string, payload: Record<string, unknown>) {
    switch (tag) {
      case "library.snapshot":
        return { status: "ready", value: podcasts };
      case "library.episodes":
        return {
          status: "ready",
          value: {
            episodes: episodes.slice(0, Number(payload.limit)).map((episode) => {
              const position = positions.get(episode.id);
              return position === undefined ? episode : { ...episode, position };
            }),
            truncated: false,
          },
        };
      case "queue.list":
        return {
          status: "ready",
          value: queue.flatMap((id) => {
            const episode = episodes.find((entry) => entry.id === id);
            if (episode === undefined) return [];
            const podcast = podcasts.find((entry) => entry.id === episode.podcastId);
            return [{ episode, podcastTitle: podcast?.title ?? "", addedAt: now() }];
          }),
        };
      case "position.list":
        return { status: "ready", value: [...positions.values()] };
      case "position.write":
        return writePosition(payload);
      case "position.markPlayed": {
        const id = String(payload.episodeId);
        const existing = positions.get(id);
        const next: OssiclePosition = {
          episodeId: id,
          seconds: existing?.seconds ?? 0,
          revision: (existing?.revision ?? 0) + 1,
          deviceId: String(payload.deviceId),
          updatedAt: now(),
          played: payload.played === true,
        };
        positions.set(id, next);
        return { status: "accepted", value: next };
      }
      default:
        return { status: "unavailable", value: { message: `unknown ${tag}` } };
    }
  }

  const queue: string[] = ["e-1"];

  const ossicle: InMemoryOssicle = {
    origin: OSSICLE_ORIGIN,
    offline: false,
    windowAfterPolls: 0,
    podcasts,
    episodes,
    queue,
    positions,
    bookPositions,
    calls,
    writeFromOtherDevice(episodeId, seconds) {
      const existing = positions.get(episodeId);
      const next: OssiclePosition = {
        episodeId,
        seconds,
        revision: (existing?.revision ?? 0) + 1,
        deviceId: "kitchen-tablet",
        updatedAt: now(),
        played: false,
      };
      positions.set(episodeId, next);
      return next;
    },
    fetch: async (input, init) => {
      if (ossicle.offline) throw new TypeError("Failed to fetch");
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin !== OSSICLE_ORIGIN) return new Response("wrong origin", { status: 404 });
      if (init?.method === "POST" && (url.pathname === "/rpc" || url.pathname === "/comics/rpc")) {
        const body = JSON.parse(String(init.body)) as { _tag: string; payload: Record<string, unknown> };
        calls.push({ tag: body._tag, payload: body.payload });
        const outcome = url.pathname === "/rpc" ? rpc(body._tag, body.payload) : comics(body._tag, body.payload);
        return Response.json({ _tag: body._tag, outcome });
      }
      if (url.pathname.startsWith("/audio/") || url.pathname.startsWith("/comics/narration/")) {
        return new Response(new Uint8Array(64).fill(7), { status: 200, headers: { "content-type": "audio/mpeg" } });
      }
      return new Response("not found", { status: 404 });
    },
  };
  return ossicle;
}
