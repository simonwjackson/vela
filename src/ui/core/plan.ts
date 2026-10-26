/**
 * Layout policy: a pure function of the container's width and height (intrinsic design). Ported
 * from the Signal mockup's `core.js`. Every threshold is a guess until it is tried on the Fold.
 */

/** Row flow (answer and card side by side) when the container is at least this much wider than tall. */
export const ROW_FLOW_RATIO = 1.2;
/** Under this height the hero uses the short scale and the card art is 48. */
export const SHORT_FRAME_H = 430;
export const MIN_MARGIN = 24;
export const MIN_ROAD = 20;
export const STAGE_ART_MAX = 232;

export type Flow = "row" | "col";

export interface Plan {
  readonly flow: Flow;
  /** The unit the fluid sizes are made from. */
  readonly u: number;
  /** The posture margin. */
  readonly m: number;
  /** Card column width in row flow; "1fr" in col flow. */
  readonly side: string;
  readonly hero: number;
  readonly road: number;
  readonly trip: number;
  readonly art: number;
  readonly stageart: number;
}

export function plan(w: number, h: number): Plan {
  const flow: Flow = w / h >= ROW_FLOW_RATIO ? "row" : "col";
  const short = Math.min(w, h);
  const u = flow === "row" ? short / 100 : Math.min(w / 100, h / 150);
  const road = Math.max(MIN_ROAD, Math.round(u * 5.6));
  return {
    flow,
    u,
    m: Math.max(MIN_MARGIN, Math.round(short * 0.06)),
    side: flow === "row" ? `${Math.round(w * 0.36)}px` : "1fr",
    hero: Math.round(u * (h < SHORT_FRAME_H ? 21 : 23)),
    road,
    trip: road,
    art: h < SHORT_FRAME_H ? 48 : 64,
    stageart: Math.round(Math.min(flow === "row" ? h * 0.42 : w * 0.24, STAGE_ART_MAX)),
  };
}

/** The custom properties a plan sets on the frame. */
export function planVars(p: Plan): Record<string, string> {
  return {
    "--u": `${p.u}px`,
    "--m": `${p.m}px`,
    "--side": p.side,
    "--hero": `${p.hero}px`,
    "--road": `${p.road}px`,
    "--trip": `${p.trip}px`,
    "--art": `${p.art}px`,
    "--stageart": `${p.stageart}px`,
  };
}

/** The on-screen keyboard: under this visual-viewport height the sheet takes all of it. */
export const FULL_SHEET_BELOW = 300;
/** A visual viewport this much shorter than the frame means the keyboard is open. */
export const KEYBOARD_MIN = 80;
