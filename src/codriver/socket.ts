/**
 * One WebSocket that reconnects with exponential backoff, for SurfaceLink and Talk.
 *
 * - The first attempt starts at `start()`. After a close, the next attempt waits
 *   `initialBackoffMs`, doubling up to `maxBackoffMs`; an open resets the wait.
 * - `retry(code)` decides per close code; a refused close ends the socket for good (`stopped`).
 * - `restart()` opens a fresh connection now, whatever the state (for a new Co-driver, or the
 *   driver taking the link back after it was replaced).
 */

/** The part of the browser WebSocket used here. Tests use an in-memory one. */
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  onclose: ((event: { readonly code: number }) => void) | null;
  onerror: (() => void) | null;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export const browserWebSocket: WebSocketFactory = (url) => new WebSocket(url) as unknown as WebSocketLike;

export const OPEN = 1;

export type LinkStatus =
  | { readonly kind: "connecting" }
  | { readonly kind: "open" }
  | { readonly kind: "retrying"; readonly inMs: number; readonly code: number }
  | { readonly kind: "stopped"; readonly code: number };

export interface Timers {
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const browserTimers: Timers = {
  setTimeout: (run, ms) => globalThis.setTimeout(run, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface ReconnectingSocketOptions {
  readonly url: () => string;
  readonly connect: WebSocketFactory;
  readonly onOpen: (send: (message: unknown) => boolean) => void;
  readonly onMessage: (data: unknown) => void;
  readonly onStatus: (status: LinkStatus) => void;
  /** Whether to reconnect after this close code. Default: always. */
  readonly retry?: (code: number) => boolean;
  readonly initialBackoffMs?: number;
  readonly maxBackoffMs?: number;
  readonly timers?: Timers;
}

export interface ReconnectingSocket {
  readonly status: LinkStatus;
  start(): void;
  restart(): void;
  /** Sends JSON when open. Returns false when it could not. */
  send(message: unknown): boolean;
  close(): void;
}

/** `https://host` → `wss://host`, `http://host` → `ws://host`, plus a path. */
export function socketUrl(origin: string, path: string): string {
  const url = new URL(path, origin);
  url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
  return url.toString();
}

export function createReconnectingSocket(options: ReconnectingSocketOptions): ReconnectingSocket {
  const timers = options.timers ?? browserTimers;
  const initial = options.initialBackoffMs ?? 1_000;
  const max = options.maxBackoffMs ?? 30_000;
  let socket: WebSocketLike | undefined;
  let status: LinkStatus = { kind: "stopped", code: 1000 };
  let wait = initial;
  let timer: unknown;
  let closed = true;

  const setStatus = (next: LinkStatus) => {
    status = next;
    options.onStatus(next);
  };

  const send = (message: unknown): boolean => {
    if (!socket || socket.readyState !== OPEN) return false;
    try {
      socket.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  };

  function detach(): void {
    if (!socket) return;
    socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
    try {
      socket.close(1000);
    } catch {
      // Already closed.
    }
    socket = undefined;
  }

  function open(): void {
    if (timer !== undefined) timers.clearTimeout(timer);
    timer = undefined;
    detach();
    setStatus({ kind: "connecting" });
    let next: WebSocketLike;
    try {
      next = options.connect(options.url());
    } catch {
      onClose(1006);
      return;
    }
    socket = next;
    next.onopen = () => {
      wait = initial;
      setStatus({ kind: "open" });
      options.onOpen(send);
    };
    next.onmessage = (event) => options.onMessage(event.data);
    next.onerror = () => undefined; // A close always follows.
    next.onclose = (event) => {
      if (socket !== next) return;
      socket = undefined;
      onClose(event.code);
    };
  }

  function onClose(code: number): void {
    if (closed) return;
    if (options.retry && !options.retry(code)) {
      setStatus({ kind: "stopped", code });
      return;
    }
    const inMs = wait;
    wait = Math.min(max, wait * 2);
    setStatus({ kind: "retrying", inMs, code });
    timer = timers.setTimeout(() => {
      timer = undefined;
      if (!closed) open();
    }, inMs);
  }

  return {
    get status() {
      return status;
    },
    start() {
      if (!closed) return;
      closed = false;
      open();
    },
    restart() {
      closed = false;
      wait = initial;
      open();
    },
    send,
    close() {
      closed = true;
      if (timer !== undefined) timers.clearTimeout(timer);
      timer = undefined;
      detach();
      setStatus({ kind: "stopped", code: 1000 });
    },
  };
}
