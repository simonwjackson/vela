/**
 * Ossicle `POST {origin}/rpc`: JSON tagged unions, `{_tag, payload}` in and `{_tag, outcome}`
 * out, where `outcome` is `{status, value}`. Shapes are hand-carried from Ossicle's
 * services/ossicle/src/rpc/contract.rs (wire id `podcasts-rpc-v1`) because its generated
 * types do not live in this repository. Only the operations Vela uses are listed.
 *
 * Ossicle rejects unknown request fields (`deny_unknown_fields`), so optional fields are
 * omitted, never sent as null.
 */

export interface OssiclePosition {
  readonly episodeId: string;
  readonly seconds: number;
  readonly revision: number;
  readonly deviceId: string;
  readonly updatedAt: string;
  readonly played: boolean;
}

export interface OssicleEpisode {
  readonly id: string;
  readonly podcastId: string;
  readonly title: string;
  readonly description?: string;
  readonly durationSeconds?: number;
  readonly publishedAt?: string;
  /** Same-origin, version-scoped path, e.g. `/audio/:id?v=…`. */
  readonly audioPath: string;
  readonly audioCached: boolean;
  /** YouTube episodes only. Vela never plays video. */
  readonly videoPath?: string;
  readonly hasChapters?: boolean;
  readonly position?: OssiclePosition;
}

export interface OssiclePodcast {
  readonly id: string;
  readonly feedUrl: string;
  readonly title: string;
  readonly description?: string;
  readonly coverPath?: string;
  readonly episodeCount: number;
}

export interface OssicleQueueEntry {
  readonly episode: OssicleEpisode;
  readonly podcastTitle: string;
  readonly coverPath?: string;
  readonly addedAt: string;
}

export interface OssicleFailure {
  readonly message: string;
}

type Unavailable = { readonly status: "unavailable"; readonly value: OssicleFailure };

export type PositionWriteOutcome =
  | { readonly status: "accepted"; readonly value: OssiclePosition }
  | { readonly status: "conflict"; readonly value: { readonly theirs: OssiclePosition; readonly yours: number } }
  | { readonly status: "unknownEpisode" }
  | Unavailable;

export interface OssicleOperations {
  "library.snapshot": {
    payload: Record<string, never>;
    outcome: { readonly status: "ready"; readonly value: readonly OssiclePodcast[] } | Unavailable;
  };
  "library.episodes": {
    payload: { readonly limit: number };
    outcome:
      | { readonly status: "ready"; readonly value: { readonly episodes: readonly OssicleEpisode[]; readonly truncated: boolean } }
      | Unavailable;
  };
  "queue.list": {
    payload: Record<string, never>;
    outcome: { readonly status: "ready"; readonly value: readonly OssicleQueueEntry[] } | Unavailable;
  };
  "position.list": {
    payload: Record<string, never>;
    outcome: { readonly status: "ready"; readonly value: readonly OssiclePosition[] } | Unavailable;
  };
  "position.write": {
    payload: {
      readonly episodeId: string;
      readonly seconds: number;
      readonly baseRevision?: number;
      readonly deviceId: string;
      readonly force: boolean;
    };
    outcome: PositionWriteOutcome;
  };
  "position.markPlayed": {
    payload: { readonly episodeId: string; readonly played: boolean; readonly deviceId: string };
    outcome:
      | { readonly status: "accepted"; readonly value: OssiclePosition }
      | { readonly status: "unknownEpisode" }
      | Unavailable;
  };
}

export type OssicleOperation = keyof OssicleOperations;

export interface OssicleRpc {
  call<K extends OssicleOperation>(
    tag: K,
    payload: OssicleOperations[K]["payload"],
  ): Promise<OssicleOperations[K]["outcome"]>;
}

export class OssicleRpcError extends Error {
  constructor(
    message: string,
    /** True for transport failures worth retrying later (offline, 5xx). */
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "OssicleRpcError";
  }
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

export function isOssiclePosition(value: unknown): value is OssiclePosition {
  return (
    isRecord(value) &&
    typeof value.episodeId === "string" &&
    count(value.seconds) &&
    count(value.revision) &&
    typeof value.deviceId === "string" &&
    typeof value.updatedAt === "string" &&
    typeof value.played === "boolean"
  );
}

export function isOssicleEpisode(value: unknown): value is OssicleEpisode {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.podcastId === "string" &&
    typeof value.title === "string" &&
    typeof value.audioPath === "string" &&
    (value.durationSeconds === undefined || count(value.durationSeconds)) &&
    (value.position === undefined || isOssiclePosition(value.position))
  );
}

export function isOssiclePodcast(value: unknown): value is OssiclePodcast {
  return isRecord(value) && typeof value.id === "string" && typeof value.title === "string";
}

/**
 * Trust boundary. The envelope and status are checked here; each caller checks the value
 * shapes it reads with the guards above.
 */
export function createOssicleRpc(options: {
  readonly origin: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}): OssicleRpc {
  const request = options.fetch ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? 10_000;
  return {
    async call(tag, payload) {
      let response: Response;
      try {
        response = await request(`${options.origin}/rpc`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ _tag: tag, payload }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (cause) {
        throw new OssicleRpcError(`Ossicle is unreachable: ${cause instanceof Error ? cause.message : String(cause)}`, true);
      }
      if (!response.ok) {
        throw new OssicleRpcError(`Ossicle answered HTTP ${response.status}`, response.status >= 500 || response.status === 429);
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new OssicleRpcError("Ossicle answered with something that is not JSON", true);
      }
      if (!isRecord(body) || body._tag !== tag || !isRecord(body.outcome) || typeof body.outcome.status !== "string") {
        throw new OssicleRpcError(`Ossicle answered '${tag}' with an invalid envelope`, false);
      }
      return body.outcome as OssicleOperations[typeof tag]["outcome"];
    },
  };
}

/** The value of a `ready` outcome, or an error naming the operation and status. */
export function readyValue<T>(tag: string, outcome: { readonly status: string; readonly value?: unknown }, guard: (value: unknown) => value is T): T {
  if (outcome.status !== "ready") {
    const detail = isRecord(outcome.value) && typeof outcome.value.message === "string" ? `: ${outcome.value.message}` : "";
    throw new OssicleRpcError(`Ossicle '${tag}' is ${outcome.status}${detail}`, outcome.status === "unavailable");
  }
  if (!guard(outcome.value)) throw new OssicleRpcError(`Ossicle '${tag}' returned an invalid value`, false);
  return outcome.value;
}

export const arrayOf =
  <T>(guard: (value: unknown) => value is T) =>
  (value: unknown): value is readonly T[] =>
    Array.isArray(value) && value.every(guard);
