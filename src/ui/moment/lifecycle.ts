/**
 * A Moment's life on screen, as a pure state machine: no DOM, no clocks, no engines. The mount
 * feeds it what happened and whether the Moment could be seen now, and carries out the effects.
 *
 *   accepted ─▶ waiting ── on screen now, and no turn under MOMENT_RULES.turnMeters for an
 *                          "after-turn" Moment ─▶ showing (speech starts here)
 *   waiting: a sheet, a live Talk turn or the keyboard keeps it off screen; an "after-turn" Moment
 *            also waits (with its chip) while any turn is close, whatever that turn's index
 *   waiting or showing ── its until event happens, or MAX_LIFE_S from acceptance passes ─▶ gone, "until"
 *   showing ── until {seconds} from showing passes ─▶ gone, "until"
 *   waiting or showing ── ✕ or "never mind" ─▶ gone, "tap" or "voice"
 *   any ── the assistant's moment.dismiss, or another Moment ─▶ gone, not reported
 *
 * Speech is asked for only for an event Moment that is not silent: a Talk answer was already
 * spoken. The mount checks the Sound mode at that moment, before it speaks.
 */
import { MOMENT_RULES } from "../../contract/moments";
import type { MomentDismissBy, MomentShow } from "../app/contract";
import { MAX_LIFE_S } from "./keys";

export type Phase =
  | { readonly kind: "none" }
  | { readonly kind: "waiting"; readonly moment: MomentShow; readonly deadline: number }
  | { readonly kind: "showing"; readonly moment: MomentShow; readonly since: number; readonly endsAt: number };

export type Effect = { readonly kind: "speak"; readonly text: string } | { readonly kind: "dismissed"; readonly id: string; readonly by: MomentDismissBy };

export interface Step {
  readonly phase: Phase;
  readonly effects: readonly Effect[];
}

/** What the road looks like now: the next turn's index and distance while guiding. */
export interface Road {
  readonly turn?: { readonly index: number; readonly meters: number; readonly arrive: boolean } | undefined;
}

/** What the mount sees now: the road, and whether a Moment could be on screen (no sheet, Talk, keyboard). */
export interface Now {
  readonly at: number;
  readonly road: Road;
  readonly visible: boolean;
}

export const NONE: Phase = { kind: "none" };

/** A turn under the rule's distance is ahead (an arrival is not a turn). */
export const turnClose = (road: Road): boolean => !!road.turn && !road.turn.arrive && road.turn.meters < MOMENT_RULES.turnMeters;

/** An "after-turn" Moment shows its chip while it waits for a close turn. */
export const waitsForTurn = (phase: Phase, road: Road): boolean => phase.kind === "waiting" && phase.moment.when === "after-turn" && turnClose(road);

const stay = (phase: Phase): Step => ({ phase, effects: [] });

function show(phase: Extract<Phase, { kind: "waiting" }>, now: number): Step {
  const { moment } = phase;
  const life = "seconds" in moment.until ? Math.max(1, moment.until.seconds) : MAX_LIFE_S;
  const speak = "event" in moment.cause && moment.silent !== true && moment.say.trim() !== "";
  return {
    phase: { kind: "showing", moment, since: now, endsAt: Math.min(now + life * 1000, phase.deadline) },
    effects: speak ? [{ kind: "speak", text: moment.say }] : [],
  };
}

/** An accepted Moment arrives (it replaces any other); its life is counted from now. */
export function accept(moment: MomentShow, now: Now): Step {
  return tick({ kind: "waiting", moment, deadline: now.at + MAX_LIFE_S * 1000 }, now);
}

/** Time passed, the road changed, or the screen freed up. */
export function tick(phase: Phase, now: Now): Step {
  if (phase.kind === "waiting") {
    if (now.at >= phase.deadline) return gone(phase, "until");
    if (!now.visible || waitsForTurn(phase, now.road)) return stay(phase);
    return show(phase, now.at);
  }
  if (phase.kind === "showing" && now.at >= phase.endsAt) return gone(phase, "until");
  return stay(phase);
}

/** Something Vela saw happen (turn.passed, arrived, stop.added, …): it ends a Moment, waiting or showing, that names it. */
export function event(phase: Phase, name: string): Step {
  if (phase.kind === "none") return stay(phase);
  const u = phase.moment.until;
  return "event" in u && u.event === name ? gone(phase, "until") : stay(phase);
}

/** The driver dismissed it: ✕ ("tap") or "never mind" ("voice"). */
export function dismiss(phase: Phase, by: MomentDismissBy): Step {
  return phase.kind === "none" ? stay(phase) : gone(phase, by);
}

function gone(phase: Exclude<Phase, { kind: "none" }>, by: MomentDismissBy): Step {
  return { phase: NONE, effects: [{ kind: "dismissed", id: phase.moment.id, by }] };
}

/** "Never mind", as the driver says it to dismiss a Moment. */
export const NEVER_MIND = /^\W*never\s*mind\b/i;

/** "Show car", "open the car": a request to open a Details by its label. */
export function asksFor(said: string, label: string): boolean {
  const l = label.trim().toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "");
  return !!l && new RegExp(`^\\W*(show|open|more)\\s+(me\\s+)?(the\\s+)?${l.replace(/\s+/g, "\\s+")}\\b`, "iu").test(said.trim());
}

// ---- Events Vela can see ---------------------------------------------------------------------------

/** What the events are read from, before and after a change. */
export interface Seen {
  readonly nav: string;
  readonly turn?: number | undefined;
  readonly via: number;
  readonly nextVia?: string | undefined;
  readonly fuel?: number | undefined;
  readonly car: string;
}

/** A refill is the fuel level rising by at least this many points. */
export const REFUEL_POINTS = 10;

/** The until events between two observations. */
export function events(a: Seen, b: Seen): string[] {
  const out: string[] = [];
  const guiding = (s: Seen) => s.nav === "guiding" || s.nav === "rerouting";
  if (guiding(a) && guiding(b) && a.turn !== undefined && b.turn !== undefined && b.turn !== a.turn) out.push("turn.passed");
  if (a.nav !== "arrived" && b.nav === "arrived") out.push("arrived");
  if (guiding(a) && (b.nav === "idle" || b.nav === "error")) out.push("route.ended");
  if (guiding(a) && guiding(b)) {
    if (b.via > a.via) out.push("stop.added");
    else if (b.via < a.via || (a.nextVia !== undefined && b.nextVia !== a.nextVia)) out.push("stop.reached");
  }
  if (a.fuel !== undefined && b.fuel !== undefined && b.fuel - a.fuel >= REFUEL_POINTS) out.push("refuelled");
  if (a.car !== "connected" && b.car === "connected") out.push("car.connected");
  return out;
}
