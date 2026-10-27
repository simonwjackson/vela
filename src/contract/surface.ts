/**
 * SurfaceLink: how the personal assistant uses Vela as a surface (ADR 0007).
 *
 * Vela opens a WebSocket to `${origins.assistant}${assistantSurfacePath}` (VelaConfig; default
 * `/surface`) and announces itself. The assistant,
 * speaking as the chosen Co-driver, calls car tools; Vela executes them and replies. Vela also
 * pushes context so the assistant can answer trip questions without a round trip.
 * JSON text frames only. Every message has `type`.
 */
import type { EventReport, MomentCapabilities, MomentShow, UiProblem, MomentDismissBy } from "./moments";
import type { ListenCommand, NowPlaying, SourceId } from "./listening";
import type { WeatherKind } from "./weather";
import type { Guidance, Place } from "./navigation";

export const SURFACE_PROTOCOL_VERSION = 1;

/** Matches `^[a-z0-9][a-z0-9-]{0,39}$`. Defaults: "navigator", "companion", "guide". */
export type CoDriverId = string;
export const CO_DRIVER_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** WebSocket close codes the assistant uses. Do not auto-reconnect on REPLACED. */
export const SURFACE_CLOSE = { REFUSED: 1002, REPLACED: 4000 } as const;

export interface ToolSpec {
  readonly name: CarToolName;
  readonly description: string;
  /** JSON Schema for `args`. */
  readonly parameters: Readonly<Record<string, unknown>>;
}

export type CarToolName =
  | "trip.status"
  | "playback.control"
  | "playback.find"
  | "route.setDestination"
  | "route.addStop"
  | "route.end";

export interface CarToolArgs {
  "trip.status": Record<string, never>;
  "playback.control": { readonly command: ListenCommand };
  "playback.find": { readonly source: SourceId; readonly query: string; readonly play: boolean };
  "route.setDestination": { readonly query: string };
  "route.addStop": { readonly query: string; readonly kind?: "fuel" | "food" | "rest" | "place" };
  "route.end": Record<string, never>;
}

/** Vela → assistant. */
export type SurfaceUp =
  | ({ readonly type: "moment.capabilities" } & MomentCapabilities)
  | EventReport
  | { readonly type: "moment.problems"; readonly id: string; readonly problems: readonly UiProblem[] }
  | { readonly type: "moment.dismissed"; readonly id: string; readonly by: MomentDismissBy }
  | { readonly type: "surface.hello"; readonly surface: "vela"; readonly version: number;
      readonly coDriver: CoDriverId; readonly tools: readonly ToolSpec[] }
  | ContextUpdate
  | { readonly type: "tool.result"; readonly id: string; readonly ok: true; readonly value: unknown }
  | { readonly type: "tool.result"; readonly id: string; readonly ok: false; readonly error: string }
  /** A finished Trip, for the assistant's memory. Recall itself reads Traccar (ADR 0008). */
  | { readonly type: "trip.ended"; readonly from?: Place; readonly to?: Place; readonly startedAt: number;
      readonly endedAt: number; readonly meters: number }
  /**
   * Rewrite a Route's direction lines in the Co-driver's voice, for caching at route start.
   * Up to 400 lines; the result has exactly as many lines, in order, or fails as a whole.
   */
  | { readonly type: "directions.request"; readonly id: string; readonly coDriver?: CoDriverId; readonly lines: readonly string[] };

/** Assistant → Vela. */
export type SurfaceDown =
  | MomentShow
  | { readonly type: "moment.dismiss"; readonly id: string }
  | { readonly type: "surface.welcome"; readonly version: number }
  | { readonly type: "tool.call"; readonly id: string; readonly name: CarToolName; readonly args: unknown }
  | { readonly type: "error"; readonly message: string }
  | { readonly type: "directions.result"; readonly id: string; readonly ok: true; readonly lines: readonly string[] }
  | { readonly type: "directions.result"; readonly id: string; readonly ok: false; readonly error: string };

/**
 * Notes for the Vela side of SurfaceLink and voice-gateway (from the assistant and gateway builds):
 * - One Co-driver per link. A second surface.hello is an error; reconnect to change Co-driver.
 * - The assistant matches tools by name and uses its own parameter schemas.
 * - voice-gateway: send `session.update { voice: <coDriver id> }`; Talk opens with
 *   `input_audio_buffer.clear` (this also stops the Co-driver at once) and closes with
 *   `input_audio_buffer.commit` then `response.create`; after a barge-in send `conversation.item.truncate`.
 * - Browsers cannot send a bearer token on a WebSocket; both services rely on tailnet auth plus
 *   their exact-origin allowlists.
 */

export interface TripContext {
  readonly destination: Place;
  readonly guidance: Pick<Guidance, "metersLeft" | "secLeft" | "arriveAt" | "metersToNext" | "progress">;
  readonly nextInstruction: string;
}

/** Sound mode: how Stops are announced. Talking works in both modes. */
export type SoundMode = { readonly kind: "sounds" } | { readonly kind: "co-driver"; readonly coDriver: CoDriverId };


/** The live car values a Moment may bind. An absent field is unknown, not zero. */
export interface CarContext {
  readonly fuelPercent?: number;
  readonly rangeKm?: number;
  readonly ambientC?: number;
  readonly mil?: boolean;
  readonly dtcCount?: number;
}
export interface StopContext {
  readonly name: string;
  readonly kmAhead: number;
  /** Estimated arrival, epoch milliseconds. */
  readonly arriveAt: number;
}
export interface WeatherContext {
  /** At most three intervals, relative to the car, including the current one when known. */
  readonly stretches: readonly { readonly fromKm: number; readonly toKm: number; readonly kind: WeatherKind; readonly label: string }[];
  readonly fetchedAt?: number;
}
/** Full snapshot, UTF-8 JSON under 2 KB; updates coalesce to at most one per 10 seconds. */
export interface ContextUpdate {
  readonly type: "context.update";
  readonly soundMode?: SoundMode;
  readonly trip?: TripContext;
  readonly nowPlaying?: NowPlaying;
  readonly car?: CarContext;
  /** At most three stops on the way, in route order. Empty means none remain. */
  readonly stops?: readonly StopContext[];
  readonly weather?: WeatherContext;
}
