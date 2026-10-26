/**
 * Signal icons: 24 grid, round caps and joins. Colour with `color`, weight with `--stroke`.
 * Static markup only (no data goes into these strings). Ported from the mockup's icons2.js,
 * icons.js, drive/icons.js, plan/components.js and talk/components.js.
 */
import type { Maneuver } from "../app/contract";

const s = (d: string): string =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" style="stroke-width:var(--stroke,1.75)">${d}</svg>`;
const f = (d: string): string => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">${d}</svg>`;
/** The road not taken: same stroke, same colour, faint. */
const other = (d: string): string => `<path opacity=".35" d="${d}"/>`;

export const glyph = {
  search: s('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>'),
  home: s('<path d="M4 10.5L12 4l8 6.5V20H4z"/><path d="M10 20v-5h4v5"/>'),
  work: s('<rect x="3.5" y="7.5" width="17" height="12" rx="2"/><path d="M9 7.5V5.5h6v2"/>'),
  recent: s('<circle cx="12" cy="12" r="8"/><path d="M12 8v4.5l3 2"/>'),
  flag: s('<path d="M6 21V4"/><path d="M6 4.5h11l-2.5 4 2.5 4H6"/>'),
  nosignal: s('<path d="M4 18h.01M8 18v-3M12 18v-6M16 18V8M20 18V5"/><path d="M3 3l18 18"/>'),
  locate: s('<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/><circle cx="12" cy="12" r="7"/>'),
  close: s('<path d="M6 6l12 12M18 6L6 18"/>'),
  mic: s('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>'),
  music: s('<path d="M9 18V5.5l11-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>'),
  podcast: s('<circle cx="12" cy="11" r="2.5"/><path d="M7.5 15.5a6.5 6.5 0 1 1 9 0"/><path d="M4.5 18.5a10.5 10.5 0 1 1 15 0"/>'),
  book: s('<path d="M4 5.5c3-1.5 5.5-1.5 8 .5v13c-2.5-2-5-2-8-.5zM20 5.5c-3-1.5-5.5-1.5-8 .5v13c2.5-2 5-2 8-.5z"/>'),
  reroute: s('<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4.5V9h-4.5"/>'),
  check: s('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  chevron: s('<path d="M9.5 6l6 6-6 6"/>'),
  back: s('<path d="M14.5 6l-6 6 6 6"/>'),
  pin: s('<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>'),
  alert: s('<path d="M12 4l9 16H3z"/><path d="M12 10v4.5M12 17.5h.01"/>'),
  settings: s('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>'),
  micOff: s(
    '<path d="M15 10.5V6a3 3 0 0 0-5.6-1.5M9 9v2a3 3 0 0 0 4.6 2.5"/><path d="M5.5 11a6.5 6.5 0 0 0 10.4 5.2M18.4 12.5c.07-.5.1-1 .1-1.5M12 17.5V21"/><path d="M3 3l18 18"/>',
  ),
  download: s('<path d="M12 4v11"/><path d="M7.5 10.5L12 15l4.5-4.5"/><path d="M5 19.5h14"/>'),
  retry: s('<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4 3.5V7h3.5"/>'),
  plus: s('<path d="M12 5v14M5 12h14"/>'),
  locationOff: s(
    '<path d="M12 21s-6.5-6.2-6.5-11c0-1.2.3-2.3.9-3.3M9 4.2A6.5 6.5 0 0 1 18.5 10c0 2-1.1 4.2-2.5 6.1"/><path d="M3 3l18 18"/>',
  ),
  // Plan: the car tool's stop kinds.
  fuel: s(
    '<path d="M5 20V5.5A1.5 1.5 0 0 1 6.5 4h6A1.5 1.5 0 0 1 14 5.5V20M3.5 20h12M7.5 8h4"/><path d="M14 10h1.5a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 0 3 0V8.5L17.5 6"/>',
  ),
  food: s('<path d="M7 3.5v5.5a2 2 0 0 0 4 0V3.5M9 11v9.5"/><path d="M17 20.5v-17c-2 1.5-3 4-3 7v3.5h3"/>'),
  rest: s('<path d="M5 10h11v4a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z"/><path d="M16 11.5h1a2.5 2.5 0 0 1 0 5h-1.8M9 4v2.5M12.5 4v2.5"/>'),
  // Talk and system.
  soundOff: s('<path d="M4 9.5h3l4.5-4v13l-4.5-4H4z"/><path d="M15.5 9.5l5 5M20.5 9.5l-5 5"/>'),
  sound: s('<path d="M4 9.5h3l4.5-4v13l-4.5-4H4z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6"/>'),
  unlinked: s(
    '<path d="M9.5 14.5l-2 2a3.2 3.2 0 0 1-4.5-4.5l2-2"/><path d="M14.5 9.5l2-2a3.2 3.2 0 0 1 4.5 4.5l-2 2"/><path d="M8 3.5v2.5M3.5 8H6M16 20.5V18M20.5 16H18"/>',
  ),
  bubble: s(
    '<path d="M5 5.5h14A1.5 1.5 0 0 1 20.5 7v8a1.5 1.5 0 0 1-1.5 1.5h-8.5L6 20v-3.5H5A1.5 1.5 0 0 1 3.5 15V7A1.5 1.5 0 0 1 5 5.5z"/>',
  ),
  compass: s('<circle cx="12" cy="12" r="8.5"/><path d="M15 9l-1.9 4.1L9 15l1.9-4.1z"/>'),
  wake: s('<path d="M4.5 10.5v3M8.25 7.5v9M12 4.5v15M15.75 7.5v9M19.5 10.5v3"/>'),
  bell: s('<path d="M6.5 16v-4.5a5.5 5.5 0 0 1 11 0V16l1.5 2h-14z"/><path d="M10 20.5a2.1 2.1 0 0 0 4 0"/>'),
  contrast: s('<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17M12 8h4.5M12 12h5.5M12 16h4.5"/>'),
  trip: s('<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h6.5a3 3 0 0 0 0-6h-5a3 3 0 0 1 0-6H16"/>'),
  screens: s('<rect x="2.5" y="5" width="11" height="8" rx="1.5"/><rect x="10.5" y="11" width="11" height="8" rx="1.5"/>'),
  wifi: s('<path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.5 16a5 5 0 0 1 7 0"/><path d="M12 19.5h.01"/>'),
} as const;

export type GlyphName = keyof typeof glyph;

/** Transport keys. The 15 and 30 numerals are drawn inside the ring, as the roundabout exit is. */
export const keyIcon = {
  play: f('<path d="M8 5.6v12.8a1 1 0 0 0 1.52.85l10.4-6.4a1 1 0 0 0 0-1.7L9.52 4.75A1 1 0 0 0 8 5.6z"/>'),
  pause: f('<rect x="6.5" y="5" width="3.6" height="14" rx="1.2"/><rect x="13.9" y="5" width="3.6" height="14" rx="1.2"/>'),
  prev: s(
    '<path d="M6 5v14"/><path d="M18 6.2v11.6a.8.8 0 0 1-1.25.66L9 12.66a.8.8 0 0 1 0-1.32l7.75-5.8A.8.8 0 0 1 18 6.2z" fill="currentColor"/>',
  ),
  next: s(
    '<path d="M18 5v14"/><path d="M6 6.2v11.6a.8.8 0 0 0 1.25.66L15 12.66a.8.8 0 0 0 0-1.32L7.25 5.54A.8.8 0 0 0 6 6.2z" fill="currentColor"/>',
  ),
  back: s(
    '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4 3.5V7h3.5"/><text x="12.4" y="15.4" font-size="7" font-weight="600" text-anchor="middle" fill="currentColor" stroke="none" font-family="inherit">15</text>',
  ),
  fwd: s(
    '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M20 3.5V7h-3.5"/><text x="11.6" y="15.4" font-size="7" font-weight="600" text-anchor="middle" fill="currentColor" stroke="none" font-family="inherit">30</text>',
  ),
} as const;

const right = s('<path d="M7 21v-8.5A4.5 4.5 0 0 1 11.5 8H19"/><path d="M15 4l4 4-4 4"/>');
const left = s('<path d="M17 21v-8.5A4.5 4.5 0 0 0 12.5 8H5"/><path d="M9 4L5 8l4 4"/>');
const straight = s('<path d="M12 21V4"/><path d="M7 9l5-5 5 5"/>');
const exitRight = s(
  `${other("M8 21V3")}<path d="M8 21v-3.5c0-2.5 1.3-4.4 3.4-5.6L18 8"/><path d="M12.7 6.6L18 8l-1.4 5.3"/>`,
);
const exitLeft = s(
  `${other("M16 21V3")}<path d="M16 21v-3.5c0-2.5-1.3-4.4-3.4-5.6L6 8"/><path d="M11.3 6.6L6 8l1.4 5.3"/>`,
);

/** Every Maneuver, by the contract's names. The roundabout is drawn by `roundabout()`. */
export const maneuver: Readonly<Record<Exclude<Maneuver, "roundabout">, string>> = {
  straight,
  right,
  left,
  "slight-right": s('<path d="M9 21v-6.4c0-1.1.4-2.1 1.2-2.9L17.5 4.5"/><path d="M12 4.5h5.5V10"/>'),
  "slight-left": s('<path d="M15 21v-6.4c0-1.1-.4-2.1-1.2-2.9L6.5 4.5"/><path d="M12 4.5H6.5V10"/>'),
  "sharp-right": s('<path d="M7 21V9a4 4 0 0 1 6.83-2.83L19.5 11.8"/><path d="M19.5 6.3v5.5H14"/>'),
  "sharp-left": s('<path d="M17 21V9a4 4 0 0 0-6.83-2.83L4.5 11.8"/><path d="M4.5 6.3v5.5H10"/>'),
  uturn: s('<path d="M16 21V9a4 4 0 0 0-8 0v7"/><path d="M4 12l4 4 4-4"/>'),
  "keep-right": s(
    `${other("M12 21v-5.5c0-1.2-.5-2.3-1.3-3.2L6.5 8")}<path d="M12 21v-5.5c0-1.2.5-2.3 1.3-3.2L18 7.6"/><path d="M12.5 7.6H18v5.5"/>`,
  ),
  "keep-left": s(
    `${other("M12 21v-5.5c0-1.2.5-2.3 1.3-3.2L17.5 8")}<path d="M12 21v-5.5c0-1.2-.5-2.3-1.3-3.2L6 7.6"/><path d="M11.5 7.6H6v5.5"/>`,
  ),
  "exit-right": exitRight,
  "exit-left": exitLeft,
  "ramp-right": exitRight,
  "ramp-left": exitLeft,
  merge: s(`${other("M14 21v-7")}<path d="M6 21v-2.6c0-1.5.6-2.9 1.7-4L14 9V3.5"/><path d="M10 7.5l4-4 4 4"/>`),
  arrive: glyph.flag,
};

export type ExitToward = "right" | "slightRight" | "straight" | "slightLeft" | "left";

// The roundabout: the exit numeral inside the ring (the method of the 15/30 keys). Entered from
// below; traffic goes round anticlockwise. The arc driven is full, the rest of the ring faint.
const R = 6.5;
const CX = 12;
const CY = 12.5;
const GAP = 30;
const ARM = 2.6;
const HEAD = 2.6;
const EXIT_ANGLE: Readonly<Record<ExitToward, number>> = { right: 0, slightRight: -45, straight: -90, slightLeft: -135, left: -180 };
const f2 = (v: number): number => +v.toFixed(2);
const at = (deg: number, r = R): [number, number] => [
  f2(CX + r * Math.cos((deg * Math.PI) / 180)),
  f2(CY + r * Math.sin((deg * Math.PI) / 180)),
];
const arc = (a: number, b: number): string => {
  const [x, y] = at(b);
  return `A${R} ${R} 0 ${a - b > 180 ? 1 : 0} 0 ${x} ${y}`;
};

/** The roundabout glyph with exit numeral 1–9. */
export function roundabout(exit: number | undefined, toward: ExitToward = "straight"): string {
  const e = EXIT_ANGLE[toward];
  const n = exit === undefined ? "" : String(Math.max(1, Math.min(9, Math.round(exit))));
  const [tx, ty] = at(e, R + ARM + 1.6);
  const back = (turn: number): string => {
    const d = ((e + 180 + turn) * Math.PI) / 180;
    return `${f2(tx + HEAD * Math.cos(d))} ${f2(ty + HEAD * Math.sin(d))}`;
  };
  const [fx, fy] = at(e - GAP);
  const rest = e - GAP > -270 + GAP ? other(`M${fx} ${fy}${arc(e - GAP, -270 + GAP)}`) : "";
  const numeral = n
    ? `<text x="12" y="15.75" font-size="9" font-weight="600" text-anchor="middle" fill="currentColor" stroke="none" font-family="Inter, sans-serif" style="font-style:normal">${n}</text>`
    : "";
  return s(`${rest}<path d="M12 22.8V19${arc(90, e)}L${tx} ${ty}"/><path d="M${back(45)}L${tx} ${ty}L${back(-45)}"/>${numeral}`);
}

export function maneuverIcon(m: Maneuver, exit?: number): string {
  return m === "roundabout" ? roundabout(exit) : maneuver[m];
}
