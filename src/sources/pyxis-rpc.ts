/**
 * Pyxis `POST {origin}/rpc` (contract `pyxis-rpc-v3`). Shapes are hand-carried from Pyxis's
 * generated contracts/generated/pyxis.ts; only what Vela uses is listed.
 *
 * Envelope rules (pyxis docs/api/README.md): the response tag equals the request tag, except
 * `rpc.failure` for protocol rejections; operation failure lives in the outcome; unknown
 * request fields are rejected; `retryable` is what to branch on.
 */

export const PYXIS_CONTRACT_ID = "pyxis-rpc-v3";

export type PyxisTransport = "stopped" | "playing" | "paused" | "ended";

export interface PyxisFailure {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export interface PyxisSession {
  readonly repeat: "off" | "all" | "one";
  readonly shuffle: boolean;
  readonly queueOrder?: readonly number[];
  readonly id: string;
  readonly name: string;
  readonly hostDeviceId: string;
  readonly queue: readonly string[];
  readonly cursor?: number;
  readonly currentTrackId?: string;
  readonly streamPath?: string;
  readonly transport: PyxisTransport;
  readonly positionMs: number;
  readonly durationMs?: number;
  readonly volume: number;
  readonly reachable: boolean;
  readonly revision: number;
  readonly updatedAt: string;
}

export type PyxisSessionCommand =
  | { readonly _tag: "queue.add"; readonly payload: { readonly trackIds: readonly string[] } }
  | { readonly _tag: "queue.remove"; readonly payload: { readonly index: number } }
  | { readonly _tag: "queue.clear"; readonly payload: Record<string, never> }
  | { readonly _tag: "repeat.set"; readonly payload: { readonly mode: "off" | "all" | "one" } }
  | { readonly _tag: "shuffle.set"; readonly payload: { readonly enabled: boolean } }
  | { readonly _tag: "cursor.jump"; readonly payload: { readonly index: number } }
  | { readonly _tag: "transport.seek"; readonly payload: { readonly positionMs: number } }
  | { readonly _tag: "transport.play"; readonly payload: Record<string, never> }
  | { readonly _tag: "transport.pause"; readonly payload: Record<string, never> }
  | { readonly _tag: "transport.stop"; readonly payload: Record<string, never> }
  | { readonly _tag: "transport.trackEnded"; readonly payload: Record<string, never> }
  | { readonly _tag: "position.report"; readonly payload: { readonly positionMs: number; readonly durationMs?: number } }
  | { readonly _tag: "volume.set"; readonly payload: { readonly volume: number } };

export interface PyxisDirective {
  readonly expectedRevision?: number;
  readonly sessionId: string;
  readonly command: PyxisSessionCommand;
  readonly issuedBy: string;
  readonly directiveId: string;
}

export interface PyxisAuthGrant {
  readonly account: { readonly id: string };
  readonly device: { readonly id: string; readonly name: string };
  readonly bearerToken: string;
}

export interface PyxisLibraryTrack {
  readonly id: string;
  readonly title: string;
  readonly artist: string;
  readonly durationMs?: number;
  readonly trackNumber?: number;
  readonly artworkUrl?: string;
}

export interface PyxisLibraryAlbum {
  readonly id: string;
  readonly title: string;
  readonly artist: string;
  readonly artworkUrl?: string;
  readonly tracks: readonly PyxisLibraryTrack[];
}

export interface PyxisSearchTrack {
  readonly id: string;
  readonly title: string;
  readonly artist: string;
  readonly album?: string;
  readonly durationMs?: number;
  readonly artworkUrl?: string;
  readonly sourcePluginId: string;
}

export interface PyxisListenEvent {
  readonly id: string;
  readonly trackId: string;
  readonly albumId?: string;
  readonly deviceId: string;
  readonly sourcePluginId?: string;
  readonly listenedAt: string;
  readonly playedMs?: number;
  readonly completed: boolean;
  readonly context: string;
  readonly contextId?: string;
}

type Unavailable = { readonly status: "unavailable"; readonly value: PyxisFailure };
type Empty = Record<string, never>;

export interface PyxisOperations {
  "auth.device.claim": {
    payload: { readonly name: string };
    outcome: { readonly status: "ready"; readonly value: PyxisAuthGrant } | { readonly status: "pairingRequired" } | Unavailable;
  };
  "session.create": {
    payload: { readonly name: string };
    outcome: { readonly status: "ready"; readonly value: PyxisSession } | { readonly status: "notDevice" } | Unavailable;
  };
  "session.state.get": {
    payload: { readonly sessionId: string };
    outcome: { readonly status: "ready"; readonly value: PyxisSession } | { readonly status: "unknown" } | Unavailable;
  };
  "session.command.run": {
    payload: { readonly sessionId: string; readonly commandId?: string; readonly command: PyxisSessionCommand };
    outcome:
      | { readonly status: "applied"; readonly value: PyxisSession }
      | { readonly status: "unknownSession" }
      | { readonly status: "notHost" }
      | { readonly status: "notDevice" }
      | { readonly status: "rejected"; readonly value: PyxisFailure }
      | Unavailable;
  };
  "source.search.run": {
    payload: { readonly query: string; readonly limit?: number };
    outcome:
      | { readonly status: "ready"; readonly value: { readonly tracks: readonly PyxisSearchTrack[] } }
      | { readonly status: "noSources" }
      | Unavailable;
  };
  "library.albums.list": {
    payload: Empty;
    outcome: { readonly status: "ready"; readonly value: readonly PyxisLibraryAlbum[] } | Unavailable;
  };
  "listen.events.append": {
    payload: { readonly events: readonly PyxisListenEvent[] };
    outcome:
      | { readonly status: "ready"; readonly value: { readonly accepted: number; readonly duplicates: number } }
      | { readonly status: "invalid"; readonly value: PyxisFailure }
      | { readonly status: "conflict"; readonly value: PyxisFailure }
      | Unavailable;
  };
}

export type PyxisOperation = keyof PyxisOperations;

export class PyxisRpcError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly code?: string,
  ) {
    super(message);
    this.name = "PyxisRpcError";
  }

  get auth(): boolean {
    return this.code === "auth.invalidToken" || this.code === "auth.required";
  }
}

export interface PyxisRpc {
  call<K extends PyxisOperation>(
    tag: K,
    payload: PyxisOperations[K]["payload"],
    token?: string,
  ): Promise<PyxisOperations[K]["outcome"]>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function isPyxisSession(value: unknown): value is PyxisSession {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.hostDeviceId === "string" &&
    Array.isArray(value.queue) &&
    typeof value.transport === "string" &&
    typeof value.positionMs === "number" &&
    typeof value.revision === "number"
  );
}

export function createPyxisRpc(options: {
  readonly origin: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}): PyxisRpc {
  const request = options.fetch ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? 15_000;
  return {
    async call(tag, payload, token) {
      let response: Response;
      try {
        response = await request(`${options.origin}/rpc`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            // Required on every operation but the three public ones; harmless on those.
            "x-pyxis-contract": PYXIS_CONTRACT_ID,
            ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
          },
          body: JSON.stringify({ _tag: tag, payload }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (cause) {
        throw new PyxisRpcError(`Pyxis is unreachable: ${cause instanceof Error ? cause.message : String(cause)}`, true);
      }
      if (!response.ok) {
        const transient = response.status >= 500 || response.status === 408 || response.status === 429;
        throw new PyxisRpcError(`Pyxis answered HTTP ${response.status}`, transient);
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new PyxisRpcError("Pyxis answered with something that is not JSON", true);
      }
      if (!isRecord(body) || typeof body._tag !== "string" || !isRecord(body.outcome)) {
        throw new PyxisRpcError("Pyxis answered with an invalid envelope", true);
      }
      if (body._tag === "rpc.failure") {
        const failure = isRecord(body.outcome.value) ? body.outcome.value : {};
        throw new PyxisRpcError(
          typeof failure.message === "string" ? failure.message : "Pyxis rejected the request",
          failure.retryable === true,
          typeof failure.code === "string" ? failure.code : undefined,
        );
      }
      if (body._tag !== tag || typeof body.outcome.status !== "string") {
        throw new PyxisRpcError(`Pyxis answered '${String(body._tag)}' to '${tag}'`, false);
      }
      return body.outcome as PyxisOperations[typeof tag]["outcome"];
    },
  };
}
