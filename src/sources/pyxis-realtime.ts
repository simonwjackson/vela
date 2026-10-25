/**
 * The car's Pyxis `/realtime` socket (pyxis docs/api/realtime.md).
 *
 * It makes the car reachable as a host: directed commands from consoles arrive here as
 * `realtime.command`. The first frame is `realtime.hello` with the contract id, the device
 * token and topics (the token travels in the frame, never in the URL). The socket subscribes to
 * no topics: the car is the host and owns its session's truth, so it does not need fan-out.
 * In a dead zone the socket drops; it reconnects with exponential backoff and sends the last
 * resume token.
 */
import { PYXIS_CONTRACT_ID, type PyxisDirective, type PyxisFailure } from "./pyxis-rpc";

/** The part of WebSocket the connection uses. */
export interface SocketLike {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
}

export type SocketFactory = (url: string) => SocketLike;

export type RealtimeStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "connecting" }
  | { readonly kind: "connected" }
  | { readonly kind: "retrying"; readonly inMs: number }
  | { readonly kind: "failed"; readonly failure: PyxisFailure };

export interface RealtimeWelcome {
  readonly accountId: string;
  readonly resumeToken: string;
  readonly resumed: boolean;
  readonly missedEventsDropped: boolean;
}

export interface PyxisRealtimeOptions {
  readonly origin: string;
  readonly connect: SocketFactory;
  readonly token: () => Promise<string>;
  readonly onWelcome: (welcome: RealtimeWelcome) => void;
  readonly onDirective: (directive: PyxisDirective) => void;
  readonly onStatus?: (status: RealtimeStatus) => void;
  readonly initialBackoffMs?: number;
  readonly maxBackoffMs?: number;
}

export interface PyxisRealtime {
  start(): void;
  stop(): void;
  readonly status: RealtimeStatus;
}

export function realtimeUrl(origin: string): string {
  return `${origin.replace(/^http/, "ws")}/realtime`;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function isDirective(value: unknown): value is PyxisDirective {
  return (
    isRecord(value) &&
    typeof value.sessionId === "string" &&
    typeof value.directiveId === "string" &&
    isRecord(value.command) &&
    typeof value.command._tag === "string"
  );
}

export function createPyxisRealtime(options: PyxisRealtimeOptions): PyxisRealtime {
  const initial = options.initialBackoffMs ?? 1000;
  const max = options.maxBackoffMs ?? 30_000;
  let socket: SocketLike | undefined;
  let running = false;
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let resumeToken: string | undefined;
  let status: RealtimeStatus = { kind: "idle" };

  const setStatus = (next: RealtimeStatus) => {
    status = next;
    options.onStatus?.(next);
  };

  const scheduleRetry = () => {
    if (!running || retryTimer !== undefined) return;
    const inMs = Math.min(max, initial * 2 ** attempt);
    attempt += 1;
    setStatus({ kind: "retrying", inMs });
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      void open();
    }, inMs);
  };

  const onFrame = (raw: unknown) => {
    if (typeof raw !== "string") return;
    let frame: unknown;
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }
    if (!isRecord(frame) || !isRecord(frame.payload)) return;
    const payload = frame.payload;
    switch (frame._tag) {
      case "realtime.welcome":
        attempt = 0;
        if (typeof payload.resumeToken === "string") resumeToken = payload.resumeToken;
        setStatus({ kind: "connected" });
        options.onWelcome({
          accountId: String(payload.accountId ?? ""),
          resumeToken: resumeToken ?? "",
          resumed: payload.resumed === true,
          missedEventsDropped: payload.missedEventsDropped === true,
        });
        return;
      case "realtime.event":
        // No topics are subscribed; still advance the cursor if one arrives.
        if (typeof payload.resumeToken === "string") resumeToken = payload.resumeToken;
        return;
      case "realtime.command":
        if (isDirective(payload)) options.onDirective(payload);
        return;
      case "realtime.failure": {
        const failure: PyxisFailure = {
          code: String(payload.code ?? "realtime.unknown"),
          message: String(payload.message ?? "Pyxis closed the realtime socket"),
          retryable: payload.retryable === true,
        };
        if (!failure.retryable) {
          running = false;
          setStatus({ kind: "failed", failure });
        }
        // An invalid resume point is refused rather than replayed; start fresh next time.
        if (failure.code.startsWith("realtime.")) resumeToken = undefined;
        return;
      }
      default:
        return;
    }
  };

  async function open(): Promise<void> {
    if (!running) return;
    setStatus({ kind: "connecting" });
    let token: string;
    try {
      token = await options.token();
    } catch {
      scheduleRetry();
      return;
    }
    if (!running) return;
    let next: SocketLike;
    try {
      next = options.connect(realtimeUrl(options.origin));
    } catch {
      scheduleRetry();
      return;
    }
    socket = next;
    next.onopen = () => {
      next.send(
        JSON.stringify({
          _tag: "realtime.hello",
          payload: {
            contractId: PYXIS_CONTRACT_ID,
            bearerToken: token,
            topics: [],
            ...(resumeToken === undefined ? {} : { resumeToken }),
          },
        }),
      );
    };
    next.onmessage = (event) => onFrame(event.data);
    next.onerror = () => undefined;
    next.onclose = () => {
      if (socket !== next) return;
      socket = undefined;
      scheduleRetry();
    };
  }

  return {
    start() {
      if (running) return;
      running = true;
      attempt = 0;
      void open();
    },
    stop() {
      running = false;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      retryTimer = undefined;
      const current = socket;
      socket = undefined;
      current?.close();
      setStatus({ kind: "idle" });
    },
    get status() {
      return status;
    },
  };
}
