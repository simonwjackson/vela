/**
 * SurfaceLink, the Vela side (ADR 0007, src/contract/surface.ts).
 *
 * - Opens `wss://<origins.assistant><assistantSurfacePath>` (default `/surface`) and sends `surface.hello` with the chosen Co-driver
 *   and the car tools. One Co-driver per link: choosing another reconnects.
 * - Car tools run only when the assistant sends `tool.call`; every call gets one `tool.result`.
 * - `context.update` goes out on open, then coalesces meaningful changes at most once per
 *   CONTEXT_MIN_MS. Ordinary guidance numbers refresh every CONTEXT_EVERY_MS. Every frame
 *   stays under 2 KB, including the next three stops and forecast stretches.
 * - Reconnects with backoff, but never after close code REPLACED (4000): another Vela took the
 *   link, and two would fight. `restart()` takes it back on the driver's request.
 */
import { createMomentChannel } from "../moments/channel";
import { contextSnapshot, contextChanged, tripContext, CONTEXT_EVERY_MS, CONTEXT_MIN_MS } from "./context";
import type { MomentCapabilities, Moments, EventReport, ContextUpdate, CarLink, Weather } from "../contract";
import {
  type CarToolName,
  type CoDriverId,
  type Guidance,
  type ListenCommand,
  type Listening,
  type NavEngine,
  type NavState,
  type NowPlaying,
  type Place,
  SURFACE_CLOSE,
  SURFACE_PROTOCOL_VERSION,
  type SourceId,
  type SurfaceDown,
  type SurfaceUp,
  type ToolSpec,
} from "../contract";
import {
  type LinkStatus,
  type ReconnectingSocket,
  type Timers,
  type WebSocketFactory,
  browserTimers,
  createReconnectingSocket,
  socketUrl,
} from "./socket";

const SOURCES: readonly SourceId[] = ["music", "podcasts", "books"];
const COMMANDS = ["play", "pause", "toggle", "back", "forward", "seek", "resume", "playItem"] as const;

export const CAR_TOOLS: readonly ToolSpec[] = [
  {
    name: "trip.status",
    description: "The current Route, next instruction, arrival time, speed and Now playing.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "playback.control",
    description: "Control listening: play, pause, toggle, back, forward, seek, resume a Source.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "object",
          properties: {
            type: { enum: [...COMMANDS] },
            positionSec: { type: "number", minimum: 0 },
            source: { enum: [...SOURCES] },
          },
          required: ["type"],
        },
      },
      required: ["command"],
    },
  },
  {
    name: "playback.find",
    description: "Search one Source; with play true, play the best match.",
    parameters: {
      type: "object",
      properties: { source: { enum: [...SOURCES] }, query: { type: "string", minLength: 1 }, play: { type: "boolean" } },
      required: ["source", "query", "play"],
    },
  },
  {
    name: "route.setDestination",
    description: "Search for a place and start a Route to the best match.",
    parameters: { type: "object", properties: { query: { type: "string", minLength: 1 } }, required: ["query"] },
  },
  {
    name: "route.addStop",
    description: "Search for a place and add it as a stop on the way, before the Destination.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", minLength: 1 }, kind: { enum: ["fuel", "food", "rest", "place"] } },
      required: ["query"],
    },
  },
  {
    name: "route.end",
    description: "End the current Route.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
];

export interface SurfaceLinkOptions {
  readonly capabilities?: MomentCapabilities;
  readonly car?: CarLink;
  readonly weather?: Weather;
  readonly soundMode?: () => import("../contract").SoundMode;
  readonly origin: string;
  /** `VelaConfig.assistantSurfacePath`, starting with "/". */
  readonly path: string;
  readonly connect: WebSocketFactory;
  readonly coDriver: () => CoDriverId;
  readonly nav: NavEngine;
  readonly listening: Listening;
  readonly timers?: Timers;
  readonly now?: () => number;
  readonly initialBackoffMs?: number;
  readonly maxBackoffMs?: number;
}

export interface SurfaceLink {
  readonly moments: Moments;
  report(event: EventReport): boolean;
  setCapabilities(capabilities: MomentCapabilities): void;
  refreshContext(): void;
  readonly status: LinkStatus;
  /** True after the assistant closed the link with REPLACED, until `restart`. */
  readonly replaced: boolean;
  start(): void;
  /** Reconnect now: after choosing a Co-driver, or to take the link back after REPLACED. */
  restart(): void;
  close(): void;
  subscribe(fn: (status: LinkStatus) => void): () => void;
}

class ToolError extends Error {}

function record(v: unknown): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new ToolError("args must be an object");
  return v as Record<string, unknown>;
}

function text(v: unknown, name: string): string {
  if (typeof v !== "string" || v.trim() === "") throw new ToolError(`${name} must be a non-empty string`);
  return v.trim();
}

function source(v: unknown): SourceId {
  if (!SOURCES.includes(v as SourceId)) throw new ToolError(`source must be one of ${SOURCES.join(", ")}`);
  return v as SourceId;
}

/** A ListenCommand from untrusted args. `playItem` is refused: items come from playback.find. */
export function listenCommandFrom(v: unknown): ListenCommand {
  const c = record(v);
  switch (c.type) {
    case "play":
    case "pause":
    case "toggle":
    case "back":
    case "forward":
      return { type: c.type };
    case "seek":
      if (typeof c.positionSec !== "number" || !Number.isFinite(c.positionSec) || c.positionSec < 0) {
        throw new ToolError("seek needs positionSec >= 0");
      }
      return { type: "seek", positionSec: c.positionSec };
    case "resume":
      return { type: "resume", source: source(c.source) };
    default:
      throw new ToolError("command.type must be play, pause, toggle, back, forward, seek or resume");
  }
}

function guidanceOf(state: NavState): Guidance | undefined {
  return state.kind === "guiding" || state.kind === "rerouting" ? state.guidance : undefined;
}


export function createSurfaceLink(options: SurfaceLinkOptions): SurfaceLink {
  const { nav, listening } = options;
  const now = options.now ?? Date.now;
  const listeners = new Set<(status: LinkStatus) => void>();
  let capabilities = options.capabilities;
  let replaced = false;
  const timers = options.timers ?? browserTimers;
  let lastContext: ContextUpdate | undefined;
  let contextOpen = false;
  let contextTimer: unknown;
  let lastContextAt = Number.NEGATIVE_INFINITY;
  let send: (message: SurfaceUp) => boolean = () => false;

  const channel = createMomentChannel((message) => send(message));

  const socket: ReconnectingSocket = createReconnectingSocket({
    url: () => socketUrl(options.origin, options.path),
    connect: options.connect,
    retry: (code) => code !== SURFACE_CLOSE.REPLACED,
    onOpen(raw) {
      send = (message) => raw(message);
      send({
        type: "surface.hello",
        surface: "vela",
        version: SURFACE_PROTOCOL_VERSION,
        coDriver: options.coDriver(),
        tools: CAR_TOOLS,
      });
      if (capabilities) send({ type: "moment.capabilities", ...capabilities });
      lastContext = undefined; lastContextAt = Number.NEGATIVE_INFINITY; contextOpen = true;
      pushContext();
    },
    onMessage: (data) => void onMessage(data),
    onStatus(status) {
      if (status.kind === "stopped" && status.code === SURFACE_CLOSE.REPLACED) replaced = true;
      if (status.kind !== "open") {
        contextOpen = false; clearContextTimer(); send = () => false;
      }
      for (const fn of [...listeners]) fn(status);
    },
    ...(options.timers ? { timers: options.timers } : {}),
    ...(options.initialBackoffMs !== undefined ? { initialBackoffMs: options.initialBackoffMs } : {}),
    ...(options.maxBackoffMs !== undefined ? { maxBackoffMs: options.maxBackoffMs } : {}),
  });

  function clearContextTimer(): void {
    if (contextTimer !== undefined) timers.clearTimeout(contextTimer);
    contextTimer = undefined;
  }
  function pushContext(): void {
    if (!contextOpen) return;
    const message = contextSnapshot({ state: nav.state, nowPlaying: listening.nowPlaying,
      soundMode: options.soundMode?.(), car: options.car, weather: options.weather });
    const t = now();
    if (lastContext && !contextChanged(lastContext, message) && t - lastContextAt < CONTEXT_EVERY_MS) {
      clearContextTimer(); return;
    }
    const wait = CONTEXT_MIN_MS - (t - lastContextAt);
    if (wait > 0) {
      if (contextTimer === undefined) contextTimer = timers.setTimeout(() => { contextTimer = undefined; pushContext(); }, wait);
      return;
    }
    clearContextTimer();
    if (!send(message)) return;
    lastContext = message;
    lastContextAt = t;
  }

  async function onMessage(data: unknown): Promise<void> {
    let message: SurfaceDown;
    try {
      message = JSON.parse(String(data)) as SurfaceDown;
    } catch {
      return;
    }
    if (!message || typeof message !== "object") return;
    channel.receive(message);
    if (message.type === "tool.call") {
      const { id } = message;
      try {
        const value = await runTool(message.name, message.args);
        send({ type: "tool.result", id, ok: true, value });
      } catch (error) {
        send({ type: "tool.result", id, ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    } else if (message.type === "error") {
      console.warn("The assistant reported a SurfaceLink error", message.message);
    }
  }

  async function firstPlace(query: string): Promise<Place> {
    const [place] = await nav.search(query);
    if (!place) throw new ToolError(`No place found for "${query}"`);
    return place;
  }

  function routeOutcome(): unknown {
    const state = nav.state;
    if (state.kind === "error") throw new ToolError(state.message);
    return { state: state.kind, trip: tripContext(state) };
  }

  async function runTool(name: CarToolName, rawArgs: unknown): Promise<unknown> {
    switch (name) {
      case "trip.status": {
        const state = nav.state;
        const g = guidanceOf(state);
        return {
          state: state.kind,
          trip: tripContext(state),
          nextVia: g?.nextVia,
          stopsOnTheWay: g?.route.via.map((p) => p.name) ?? [],
          offRoute: g?.offRoute ?? false,
          offline: g?.offline ?? false,
          speedKmh: nav.readouts.speedKmh,
          speedLimitKmh: nav.readouts.speedLimitKmh,
          nowPlaying: listening.nowPlaying,
        };
      }
      case "playback.control": {
        const command = listenCommandFrom(record(rawArgs).command);
        await listening.send(command);
        return { nowPlaying: listening.nowPlaying };
      }
      case "playback.find": {
        const args = record(rawArgs);
        const items = await listening.search(source(args.source), text(args.query, "query"));
        const [best] = items;
        if (args.play === true) {
          if (!best) throw new ToolError(`Nothing found for "${String(args.query)}"`);
          await listening.send({ type: "playItem", item: best });
        }
        return { items: items.slice(0, 5).map((i) => ({ title: i.title, by: i.by, from: i.from })), playing: args.play === true ? best?.title : undefined };
      }
      case "route.setDestination": {
        const place = await firstPlace(text(record(rawArgs).query, "query"));
        await nav.start(place);
        return { destination: place, ...(routeOutcome() as object) };
      }
      case "route.addStop": {
        const place = await firstPlace(text(record(rawArgs).query, "query"));
        await nav.addStop(place);
        return { stop: place, ...(routeOutcome() as object) };
      }
      case "route.end":
        nav.end();
        return { state: nav.state.kind };
      default:
        throw new ToolError(`Unknown car tool ${String(name)}`);
    }
  }

  const offNav = nav.subscribe(() => pushContext());
  const offListening = listening.subscribe(() => pushContext());
  const offCar = options.car?.subscribe(pushContext);
  const offWeather = options.weather?.subscribe(pushContext);

  return {
    moments: channel.moments,
    refreshContext: pushContext,
    report: (event) => capabilities?.enabled !== false && send(event),
    setCapabilities(next) { capabilities = next; send({ type: "moment.capabilities", ...next }); },
    get status() {
      return socket.status;
    },
    get replaced() {
      return replaced;
    },
    start: () => socket.start(),
    restart() {
      replaced = false;
      socket.restart();
    },
    close() {
      clearContextTimer();
      offNav();
      offListening(); offCar?.(); offWeather?.();
      socket.close();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}
