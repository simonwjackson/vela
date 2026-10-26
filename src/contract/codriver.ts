/**
 * Talk with the Co-driver, and the "Hey Vela" wake word. Words follow CONTEXT.md.
 * The Co-driver is the personal assistant reached over SurfaceLink and voice-gateway (ADR 0007);
 * the wake word runs entirely on the phone (ADR 0009).
 */
import type { CoDriverId } from "./surface";

export type TalkState =
  | { kind: "idle" }
  | { kind: "wake" }                                   // "Hey Vela" heard, the mic is opening
  | { kind: "listening"; transcript: string }          // live words so far
  | { kind: "thinking"; said: string }
  | { kind: "speaking"; text: string; progress: number } // 0..1 through the answer
  | { kind: "offline" }                                // no link; directions continue from the saved route
  | { kind: "unreachable"; reason: "error" | "replaced" }
  | { kind: "mic-denied" };
export interface CoDriverInfo { id: CoDriverId; displayName?: string; kind?: "navigator" | "companion" | "guide" }
export interface CoDriver {
  readonly state: TalkState;
  readonly current: CoDriverInfo;
  list(): readonly CoDriverInfo[];
  press(): void; release(): void; cancel(): void;
  choose(id: CoDriverId): void;
  subscribe(fn: (state: TalkState) => void): () => void;
}
export type WakeState = { kind: "off" } | { kind: "loading"; progress: number } | { kind: "listening" } | { kind: "unavailable"; reason: string };
export interface WakeWord { readonly state: WakeState; enable(on: boolean): void; subscribe(fn: (s: WakeState) => void): () => void }
