/**
 * SurfaceLink: how the personal assistant uses Vela as a surface (ADR 0007).
 *
 * Vela opens a WebSocket to `${origins.assistant}/surface` and announces itself. The assistant,
 * speaking as the chosen Co-driver, calls car tools; Vela executes them and replies. Vela also
 * pushes context so the assistant can answer trip questions without a round trip.
 * JSON text frames only. Every message has `type`.
 */
import type { ListenCommand, NowPlaying, SourceId } from "./listening";
import type { Guidance, Place } from "./navigation";

export const SURFACE_PROTOCOL_VERSION = 1;

export type CoDriverId = string;

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
  | { readonly type: "surface.hello"; readonly surface: "vela"; readonly version: number;
      readonly coDriver: CoDriverId; readonly tools: readonly ToolSpec[] }
  | { readonly type: "context.update"; readonly trip?: TripContext; readonly nowPlaying?: NowPlaying }
  | { readonly type: "tool.result"; readonly id: string; readonly ok: true; readonly value: unknown }
  | { readonly type: "tool.result"; readonly id: string; readonly ok: false; readonly error: string }
  /** A finished Trip, for the assistant's memory. Recall itself reads Traccar (ADR 0008). */
  | { readonly type: "trip.ended"; readonly from?: Place; readonly to?: Place; readonly startedAt: number;
      readonly endedAt: number; readonly meters: number };

/** Assistant → Vela. */
export type SurfaceDown =
  | { readonly type: "surface.welcome"; readonly version: number }
  | { readonly type: "tool.call"; readonly id: string; readonly name: CarToolName; readonly args: unknown }
  | { readonly type: "error"; readonly message: string };

export interface TripContext {
  readonly destination: Place;
  readonly guidance: Pick<Guidance, "metersLeft" | "secLeft" | "arriveAt" | "metersToNext" | "progress">;
  readonly nextInstruction: string;
}

/** Sound mode: how Stops are announced. Talking works in both modes. */
export type SoundMode = { readonly kind: "sounds" } | { readonly kind: "co-driver"; readonly coDriver: CoDriverId };
