/**
 * The frames every layout change is checked at. `um` is measured: the Fold 8 unfolded in
 * landscape, Vela installed as a full-screen PWA (a 2000×1510 screenshot at DPR 2). The other four
 * are the original guesses from the Signal brief, kept as the ladder's awkward shapes until each is
 * measured on the device. Plain data, so the Node capture tools import it too.
 *
 * The Moment gate still probes the four contract postures (src/contract MOMENT_POSTURES).
 */
export const POSTURES = [
  { id: "um", w: 1000, h: 755, label: "Unfolded landscape, measured" },
  { id: "ul", w: 932, h: 553, label: "Unfolded landscape, guess" },
  { id: "up", w: 704, h: 783, label: "Unfolded portrait, guess" },
  { id: "fl", w: 711, h: 374, label: "Folded landscape, guess" },
  { id: "fp", w: 475, h: 638, label: "Folded portrait, guess" },
] as const;

export type Posture = (typeof POSTURES)[number];
export type PostureId = Posture["id"];

export const posture = (id: string | null): Posture | undefined => POSTURES.find((p) => p.id === id);
