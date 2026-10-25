/**
 * Books: the driver's reader library, reached through Ossicle's proxy at
 * `{origin}/comics/*`. Calls go to `POST {origin}/comics/rpc` with the same tagged-union
 * envelope as Ossicle. Shapes follow Ossicle's own client (clients/player/src/Books/comics.ts)
 * and the reader's contract (comics contracts/generated/comics.ts).
 *
 * The book revision is passed back exactly as received. Ossicle's client types it as
 * `{counter, token}`; the reader's generated contract types it as a number. Treating it as an
 * opaque value works with both.
 */
import { OssicleRpcError, isRecord } from "./ossicle-rpc";

export interface BookPublication {
  readonly id: string;
  readonly title: string;
  readonly authors: readonly string[];
  readonly generation: string;
  readonly cover?: string;
}

export interface BookLocator {
  readonly generation: string;
  readonly resource: string;
  readonly selector: string;
  readonly characterOffset: number;
  readonly textContext: string;
  readonly resourceProgression: number;
  readonly wholeBookProgression: number;
}

/** Opaque; sent back verbatim as `baseRevision`. */
export type BookRevision = unknown;

export interface BookPosition {
  readonly bookId: string;
  readonly locator: BookLocator;
  readonly revision: BookRevision;
  readonly deviceId: string;
  readonly updatedAt: string;
}

export interface TimelineSegment {
  readonly ordinal: number;
  readonly resource: string;
  readonly selector: string;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly estimatedStartMs: number;
  readonly estimatedDurationMs: number;
}

export interface NarrationTimeline {
  readonly segments: readonly TimelineSegment[];
  readonly estimatedDurationMs: number;
}

export interface NarrationWindow {
  readonly id: string;
  /** Relative to the reader; Vela plays `{origin}/comics{audioUrl}`. */
  readonly audioUrl: string;
  readonly mediaType: string;
  readonly durationMs: number;
  readonly startsMs: readonly number[];
  readonly durationsMs: readonly number[];
}

export interface NarrationSegment {
  readonly id: string;
  readonly ordinal: number;
  readonly resource: string;
  readonly selector: string;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly text: string;
}

export interface NarrationBatch {
  readonly segments: readonly NarrationSegment[];
  readonly window?: NarrationWindow;
}

export interface NarrationAnchor {
  readonly resource: string;
  readonly selector: string;
  readonly characterOffset: number;
  readonly textContext: string;
}

export type NarrationVoice = "af_bella" | "af_heart";
export const DEFAULT_VOICE: NarrationVoice = "af_bella";
/** The reader rejects more than 8 sentences per prepare. */
export const BATCH_SENTENCES = 8;

export type BookPositionWriteResult =
  | { readonly status: "accepted"; readonly position: BookPosition }
  | { readonly status: "conflict"; readonly theirs: BookPosition }
  | { readonly status: "other"; readonly detail: string };

export interface ComicsClient {
  booksList(): Promise<readonly BookPublication[]>;
  positionRead(bookId: string, generation: string): Promise<BookPosition | undefined>;
  positionWrite(
    bookId: string,
    locator: BookLocator,
    deviceId: string,
    baseRevision: BookRevision | undefined,
    force: boolean,
  ): Promise<BookPositionWriteResult>;
  timeline(bookId: string, generation: string): Promise<NarrationTimeline>;
  prepare(bookId: string, generation: string, anchor: NarrationAnchor, voice: NarrationVoice): Promise<NarrationBatch>;
  /** Absolute URL for a reader-relative path. */
  url(path: string): string;
}

const isPublication = (value: unknown): value is BookPublication =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.title === "string" &&
  typeof value.generation === "string" &&
  Array.isArray(value.authors);

const isLocator = (value: unknown): value is BookLocator =>
  isRecord(value) &&
  typeof value.resource === "string" &&
  typeof value.characterOffset === "number" &&
  typeof value.wholeBookProgression === "number";

const isBookPosition = (value: unknown): value is BookPosition =>
  isRecord(value) && typeof value.bookId === "string" && isLocator(value.locator) && "revision" in value;

const isWindow = (value: unknown): value is NarrationWindow =>
  isRecord(value) &&
  typeof value.audioUrl === "string" &&
  typeof value.durationMs === "number" &&
  Array.isArray(value.startsMs);

const isSegment = (value: unknown): value is NarrationSegment =>
  isRecord(value) && typeof value.ordinal === "number" && typeof value.resource === "string";

export function createComicsClient(options: { readonly origin: string; readonly fetch?: typeof fetch }): ComicsClient {
  const request = options.fetch ?? globalThis.fetch.bind(globalThis);
  const base = `${options.origin}/comics`;

  async function call(tag: string, payload: unknown): Promise<{ status: string; value?: unknown }> {
    let response: Response;
    try {
      response = await request(`${base}/rpc`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ _tag: tag, payload }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (cause) {
      throw new OssicleRpcError(`The books server is unreachable: ${cause instanceof Error ? cause.message : String(cause)}`, true);
    }
    if (!response.ok) throw new OssicleRpcError(`The books server answered HTTP ${response.status}`, response.status >= 500);
    const body: unknown = await response.json().catch(() => undefined);
    if (!isRecord(body) || !isRecord(body.outcome) || typeof body.outcome.status !== "string") {
      throw new OssicleRpcError(`The books server answered '${tag}' with an invalid envelope`, false);
    }
    return body.outcome as { status: string; value?: unknown };
  }

  const notReady = (tag: string, outcome: { status: string; value?: unknown }) =>
    new OssicleRpcError(
      `Books '${tag}' is ${outcome.status}${isRecord(outcome.value) && typeof outcome.value.message === "string" ? `: ${outcome.value.message}` : ""}`,
      outcome.status === "unavailable" || outcome.status === "scanning",
    );

  return {
    async booksList() {
      const outcome = await call("books.list", {});
      if (outcome.status !== "ready" || !isRecord(outcome.value) || !Array.isArray(outcome.value.publications)) {
        throw notReady("books.list", outcome);
      }
      return outcome.value.publications.filter(isPublication);
    },
    async positionRead(bookId, generation) {
      const outcome = await call("book.position.read", { bookId, generation });
      // missing / sourceChanged / absent all mean: start from the top.
      return outcome.status === "found" && isBookPosition(outcome.value) ? outcome.value : undefined;
    },
    async positionWrite(bookId, locator, deviceId, baseRevision, force) {
      const outcome = await call("book.position.write", {
        bookId,
        generation: locator.generation,
        resource: locator.resource,
        selector: locator.selector,
        characterOffset: locator.characterOffset,
        textContext: locator.textContext,
        resourceProgression: locator.resourceProgression,
        wholeBookProgression: locator.wholeBookProgression,
        deviceId,
        force,
        ...(baseRevision === undefined ? {} : { baseRevision }),
      });
      if (outcome.status === "accepted" && isBookPosition(outcome.value)) return { status: "accepted", position: outcome.value };
      if (outcome.status === "conflict" && isRecord(outcome.value) && isBookPosition(outcome.value.theirs)) {
        return { status: "conflict", theirs: outcome.value.theirs };
      }
      return { status: "other", detail: outcome.status };
    },
    async timeline(bookId, generation) {
      const outcome = await call("narration.timeline", { bookId, generation });
      if (
        outcome.status !== "ready" ||
        !isRecord(outcome.value) ||
        !Array.isArray(outcome.value.segments) ||
        typeof outcome.value.estimatedDurationMs !== "number"
      ) {
        throw notReady("narration.timeline", outcome);
      }
      return outcome.value as unknown as NarrationTimeline;
    },
    async prepare(bookId, generation, anchor, voice) {
      const outcome = await call("narration.prepare", {
        bookId,
        generation,
        resource: anchor.resource,
        selector: anchor.selector,
        characterOffset: anchor.characterOffset,
        textContext: anchor.textContext,
        maxSegments: BATCH_SENTENCES,
        voice,
      });
      if (outcome.status !== "ready" || !isRecord(outcome.value)) throw notReady("narration.prepare", outcome);
      const segments = Array.isArray(outcome.value.segments) ? outcome.value.segments.filter(isSegment) : [];
      return isWindow(outcome.value.window) ? { segments, window: outcome.value.window } : { segments };
    },
    url: (path) => (path.startsWith("/") ? `${base}${path}` : `${base}/${path}`),
  };
}

// Pure narration rules: text-anchored reading positions <-> narration time.

/** The sentence a stored reading position lands in. No position means the first sentence. */
export function startOrdinalFor(
  timeline: NarrationTimeline,
  locator: { readonly resource: string; readonly characterOffset: number } | undefined,
): number {
  const first = timeline.segments[0]?.ordinal ?? 0;
  if (locator === undefined) return first;
  const inResource = timeline.segments.filter((segment) => segment.resource === locator.resource);
  if (inResource.length === 0) return first;
  for (const segment of inResource) if (locator.characterOffset < segment.endOffset) return segment.ordinal;
  const last = inResource[inResource.length - 1];
  if (last === undefined) return first;
  return timeline.segments.find((segment) => segment.ordinal > last.ordinal)?.ordinal ?? last.ordinal;
}

/** Which sentence of a window sounds at `positionMs`. */
export function windowIndexAt(startsMs: readonly number[], positionMs: number): number {
  let index = 0;
  for (const [candidate, start] of startsMs.entries()) {
    if (positionMs >= start) index = candidate;
  }
  return index;
}

/** The reading position to write while a sentence narrates. */
export function locatorForSegment(timeline: NarrationTimeline, generation: string, segment: NarrationSegment): BookLocator {
  const inResource = timeline.segments.filter((entry) => entry.resource === segment.resource);
  const rank = inResource.findIndex((entry) => entry.ordinal === segment.ordinal);
  const timed = timeline.segments.find((entry) => entry.ordinal === segment.ordinal);
  return {
    generation,
    resource: segment.resource,
    selector: segment.selector,
    characterOffset: segment.startOffset,
    textContext: segment.text.slice(0, 200),
    resourceProgression: rank >= 0 && inResource.length > 0 ? rank / inResource.length : 0,
    wholeBookProgression:
      timed !== undefined && timeline.estimatedDurationMs > 0
        ? Math.min(timed.estimatedStartMs / timeline.estimatedDurationMs, 1)
        : 0,
  };
}

/** The timeline sentence a narration time falls in. */
export function segmentAtTime(timeline: NarrationTimeline, timeMs: number): TimelineSegment | undefined {
  let found = timeline.segments[0];
  for (const segment of timeline.segments) {
    if (segment.estimatedStartMs <= timeMs) found = segment;
    else break;
  }
  return found;
}

export function anchorFor(segment: TimelineSegment, textContext = ""): NarrationAnchor {
  return { resource: segment.resource, selector: segment.selector, characterOffset: segment.startOffset, textContext };
}
