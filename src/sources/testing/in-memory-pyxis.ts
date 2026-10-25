/**
 * An in-memory Pyxis core behind a real `fetch` function and a real socket factory.
 * Invented content only; origin `https://pyxis.test`.
 *
 * It enforces what the car must get right: the `x-pyxis-contract` header, a device Bearer
 * token, host-only `session.command.run`, idempotent command ids, `realtime.hello` as the first
 * frame. Knobs: `offline`, `claimStatus`, and `direct()` to push a console directive.
 */
import { applySessionCommand } from "../pyxis-session";
import {
  PYXIS_CONTRACT_ID,
  type PyxisLibraryAlbum,
  type PyxisListenEvent,
  type PyxisSession,
  type PyxisSessionCommand,
} from "../pyxis-rpc";
import type { SocketLike } from "../pyxis-realtime";

export const PYXIS_ORIGIN = "https://pyxis.test";
export const PYXIS_DEVICE_TOKEN = "device-token-test";

export class InMemorySocket implements SocketLike {
  onopen: (() => void) | null = null;
  onmessage: ((event: { readonly data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly sent: unknown[] = [];
  open = true;

  constructor(
    readonly url: string,
    private readonly server: { receive(socket: InMemorySocket, frame: unknown): void },
  ) {
    queueMicrotask(() => this.onopen?.());
  }

  send(data: string): void {
    const frame: unknown = JSON.parse(data);
    this.sent.push(frame);
    this.server.receive(this, frame);
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.onclose?.();
  }

  /** Deliver a server frame. */
  push(frame: unknown): void {
    if (this.open) this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

export interface InMemoryPyxis {
  readonly origin: string;
  readonly fetch: typeof fetch;
  readonly connect: (url: string) => InMemorySocket;
  offline: boolean;
  claimStatus: "ready" | "pairingRequired";
  readonly sockets: InMemorySocket[];
  readonly sessions: Map<string, PyxisSession>;
  /** Every session.command.run the core received: command id and tag. */
  readonly runs: { readonly commandId?: string; readonly tag: string }[];
  readonly listens: PyxisListenEvent[];
  readonly albums: PyxisLibraryAlbum[];
  /** Calls that arrived without the contract header. */
  readonly missingContract: string[];
  /** Push a console directive to the newest socket. */
  direct(command: PyxisSessionCommand, directiveId: string, expectedRevision?: number): void;
}

export function createInMemoryPyxis(): InMemoryPyxis {
  const sessions = new Map<string, PyxisSession>();
  const receipts = new Map<string, string>();
  const runs: InMemoryPyxis["runs"] = [];
  const listens: PyxisListenEvent[] = [];
  const sockets: InMemorySocket[] = [];
  const missingContract: string[] = [];
  let deviceClaimed = false;
  const deviceId = "dev-car";
  const albums: PyxisLibraryAlbum[] = [
    {
      id: "alb-harbor",
      title: "Harbor Lights",
      artist: "The Invented Quartet",
      artworkUrl: "https://art.test/harbor.jpg",
      tracks: [
        { id: "t-1", title: "Low Tide Overture", artist: "The Invented Quartet", durationMs: 200_000, trackNumber: 1 },
        { id: "t-2", title: "Gull Waltz", artist: "The Invented Quartet", durationMs: 180_000, trackNumber: 2 },
        { id: "t-3", title: "Fog Signal", artist: "The Invented Quartet", durationMs: 240_000, trackNumber: 3 },
      ],
    },
  ];

  const failure = (code: string, message: string) => ({
    _tag: "rpc.failure",
    outcome: { status: "rejected", value: { code, message, retryable: false } },
  });

  function handle(tag: string, payload: Record<string, unknown>, token: string | undefined): unknown {
    if (tag === "auth.device.claim") {
      if (pyxis.claimStatus === "pairingRequired") return { _tag: tag, outcome: { status: "pairingRequired" } };
      deviceClaimed = true;
      return {
        _tag: tag,
        outcome: {
          status: "ready",
          value: {
            account: { id: "default", name: "default", isDefault: true, createdAt: "2026-01-01T00:00:00Z" },
            device: { id: deviceId, name: String(payload.name) },
            bearerToken: PYXIS_DEVICE_TOKEN,
          },
        },
      };
    }
    if (token !== PYXIS_DEVICE_TOKEN || !deviceClaimed) return failure("auth.invalidToken", "bearer token is invalid");
    switch (tag) {
      case "session.create": {
        const session: PyxisSession = {
          repeat: "off",
          shuffle: false,
          id: `sess-${sessions.size + 1}`,
          name: String(payload.name),
          hostDeviceId: deviceId,
          queue: [],
          transport: "stopped",
          positionMs: 0,
          volume: 80,
          reachable: true,
          revision: 1,
          updatedAt: new Date().toISOString(),
        };
        sessions.set(session.id, session);
        return { _tag: tag, outcome: { status: "ready", value: session } };
      }
      case "session.state.get": {
        const session = sessions.get(String(payload.sessionId));
        return { _tag: tag, outcome: session === undefined ? { status: "unknown" } : { status: "ready", value: session } };
      }
      case "session.command.run": {
        const session = sessions.get(String(payload.sessionId));
        if (session === undefined) return { _tag: tag, outcome: { status: "unknownSession" } };
        const command = payload.command as PyxisSessionCommand;
        const commandId = payload.commandId as string | undefined;
        runs.push({ ...(commandId === undefined ? {} : { commandId }), tag: command._tag });
        if (commandId !== undefined && receipts.has(commandId)) {
          return { _tag: tag, outcome: { status: "applied", value: session } };
        }
        try {
          const next = applySessionCommand(session, command);
          sessions.set(next.id, next);
          if (commandId !== undefined) receipts.set(commandId, JSON.stringify(command));
          return { _tag: tag, outcome: { status: "applied", value: next } };
        } catch (error) {
          return {
            _tag: tag,
            outcome: { status: "rejected", value: { code: "session.rejected", message: String(error), retryable: false } },
          };
        }
      }
      case "source.search.run": {
        const needle = String(payload.query).toLowerCase();
        const tracks = albums.flatMap((album) =>
          album.tracks
            .filter((track) => track.title.toLowerCase().includes(needle))
            .map((track) => ({
              id: track.id,
              externalId: `ext-${track.id}`,
              title: track.title,
              artist: track.artist,
              album: album.title,
              durationMs: track.durationMs,
              sourcePluginId: "invented-source",
            })),
        );
        return { _tag: tag, outcome: { status: "ready", value: { tracks, albums: [], artists: [], failures: [] } } };
      }
      case "library.albums.list":
        return { _tag: tag, outcome: { status: "ready", value: albums } };
      case "listen.events.append": {
        const events = payload.events as PyxisListenEvent[];
        let duplicates = 0;
        for (const event of events) {
          if (listens.some((known) => known.id === event.id)) duplicates += 1;
          else listens.push(event);
        }
        return { _tag: tag, outcome: { status: "ready", value: { accepted: events.length - duplicates, duplicates } } };
      }
      default:
        return failure("request.unknownOperation", tag);
    }
  }

  const server = {
    receive(socket: InMemorySocket, frame: unknown) {
      const message = frame as { _tag?: string; payload?: Record<string, unknown> };
      if (socket.sent.length === 1) {
        if (message._tag !== "realtime.hello" || message.payload?.contractId !== PYXIS_CONTRACT_ID) {
          socket.push({ _tag: "realtime.failure", payload: { code: "realtime.helloRequired", message: "hello first", retryable: false } });
          socket.close();
          return;
        }
        if (message.payload.bearerToken !== PYXIS_DEVICE_TOKEN) {
          socket.push({ _tag: "realtime.failure", payload: { code: "auth.invalidToken", message: "bad token", retryable: false } });
          socket.close();
          return;
        }
        queueMicrotask(() =>
          socket.push({
            _tag: "realtime.welcome",
            payload: {
              accountId: "default",
              contractId: PYXIS_CONTRACT_ID,
              topics: [],
              resumeToken: `epoch:${sockets.length}`,
              resumed: false,
              missedEventsDropped: false,
            },
          }),
        );
      }
    },
  };

  const pyxis: InMemoryPyxis = {
    origin: PYXIS_ORIGIN,
    offline: false,
    claimStatus: "ready",
    sockets,
    sessions,
    runs,
    listens,
    albums,
    missingContract,
    connect(url) {
      const socket = new InMemorySocket(url, server);
      sockets.push(socket);
      if (pyxis.offline) queueMicrotask(() => socket.close());
      return socket;
    },
    direct(command, directiveId, expectedRevision) {
      const socket = [...sockets].reverse().find((candidate) => candidate.open);
      const session = [...sessions.values()][0];
      if (socket === undefined || session === undefined) throw new Error("no host socket or session");
      socket.push({
        _tag: "realtime.command",
        payload: {
          sessionId: session.id,
          command,
          issuedBy: "dev-kitchen",
          directiveId,
          ...(expectedRevision === undefined ? {} : { expectedRevision }),
        },
      });
    },
    fetch: async (input, init) => {
      if (pyxis.offline) throw new TypeError("Failed to fetch");
      const url = new URL(input instanceof Request ? input.url : String(input));
      const headers = new Headers(input instanceof Request ? input.headers : init?.headers);
      if (url.pathname === "/rpc" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { _tag: string; payload: Record<string, unknown> };
        if (headers.get("x-pyxis-contract") !== PYXIS_CONTRACT_ID) missingContract.push(body._tag);
        const token = headers.get("authorization")?.replace(/^Bearer /, "");
        return Response.json(handle(body._tag, body.payload, token));
      }
      if (url.pathname.startsWith("/stream/")) {
        if (headers.get("authorization") !== `Bearer ${PYXIS_DEVICE_TOKEN}`) return new Response("auth.required", { status: 401 });
        return new Response(new Uint8Array(100).fill(1), { status: 200, headers: { "content-type": "audio/webm" } });
      }
      return new Response("not found", { status: 404 });
    },
  };
  return pyxis;
}
