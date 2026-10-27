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
/**
 * Row flow: the unit follows the height until the frame is less than this much wider than tall;
 * then the width pays. The answer column is about .64 of the width, so on a squarer landscape frame
 * (the Fold 8 unfolded, 1000×755) a height-only unit draws a hero wider than its column ("Arrived"
 * ran into the card). At 932×553 and 711×374 the height still decides.
 */
export const ROW_UNIT_RATIO = 1.65;
/** The stage title (Now playing at no route) is this share of the road size: not an answer. */
export const STAGE_TITLE_SCALE = 0.75;

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
  /** The stage title: one step under the road size, never under the road's floor. */
  readonly stagetitle: number;
}

export function plan(w: number, h: number): Plan {
  const flow: Flow = w / h >= ROW_FLOW_RATIO ? "row" : "col";
  const short = Math.min(w, h);
  const u = flow === "row" ? Math.min(short, w / ROW_UNIT_RATIO) / 100 : Math.min(w / 100, h / 150);
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
    stagetitle: Math.max(MIN_ROAD, Math.round(road * STAGE_TITLE_SCALE)),
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
    "--stagetitle": `${p.stagetitle}px`,
  };
}

/** The on-screen keyboard: under this visual-viewport height the sheet takes all of it. */
export const FULL_SHEET_BELOW = 300;
/** A visual viewport this much shorter than the frame means the keyboard is open. */
export const KEYBOARD_MIN = 80;
