/**
 * In-memory WebSockets for SurfaceLink and Talk tests: each `connect` makes a socket the test
 * drives from the server side. Nothing touches the network.
 */
import { OPEN, type WebSocketFactory, type WebSocketLike } from "../socket";

export class InMemoryWebSocket implements WebSocketLike {
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { readonly data: unknown }) => void) | null = null;
  onclose: ((event: { readonly code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  /** Every frame the client sent, parsed. */
  readonly sent: Record<string, unknown>[] = [];
  closedByClient: number | undefined;

  constructor(readonly url: string) {}

  send(data: string): void {
    if (this.readyState !== OPEN) throw new Error("not open");
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }

  close(code = 1000): void {
    this.closedByClient = code;
    this.readyState = 3;
  }

  /** Server side: accept the connection. */
  accept(): void {
    this.readyState = OPEN;
    this.onopen?.();
  }

  /** Server side: send one JSON frame. */
  push(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  /** Server side, or the network: close with a code. */
  drop(code: number): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }

  types(): string[] {
    return this.sent.map((m) => String(m.type));
  }
}

export class InMemorySocketServer {
  readonly connections: InMemoryWebSocket[] = [];
  /** When set, `connect` answers with this behaviour at once. */
  behavior: "manual" | "accept" | "refuse" = "manual";

  readonly connect: WebSocketFactory = (url) => {
    const socket = new InMemoryWebSocket(url);
    this.connections.push(socket);
    if (this.behavior === "accept") queueMicrotask(() => socket.accept());
    if (this.behavior === "refuse") queueMicrotask(() => socket.drop(1006));
    return socket;
  };

  get latest(): InMemoryWebSocket {
    const socket = this.connections[this.connections.length - 1];
    if (!socket) throw new Error("no connection yet");
    return socket;
  }
}
