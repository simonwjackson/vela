/**
 * The programs the spike shows: the five approved states, written by hand, and the novel screens
 * the model composed (tools/openui-compose.mjs writes those files). Each runs on its scene's data.
 */
const files = import.meta.glob<string>("./programs/*.oui", { query: "?raw", import: "default", eager: true });
const text = (name: string): string | undefined => files[`./programs/${name}.oui`];

export interface ProgramEntry {
  id: string;
  label: string;
  scene: string;
  program: string;
  /** Approved: written by hand to match a Signal state. Novel: composed by the model. */
  kind: "approved" | "novel" | "mutation";
}

const APPROVED: [id: string, label: string][] = [
  ["near", "Turn ahead"],
  ["far", "Long leg (podcast)"],
  ["noroute", "No route"],
  ["speaking", "Co-driver answers"],
  ["stops", "Route"],
];
const NOVEL: [id: string, label: string, scene: string][] = [
  ["novel-a", "(a) Rain on a long leg", "rain"],
  ["novel-b", "(b) Episode ends before arrival", "episode"],
  ["novel-c", "(c) Fuel low", "fuel"],
  ["novel-d", "(d) Parked at the destination", "parked"],
  ["novel-a-after", "(a) after the patch", "rain"],
];

/** The approved programs: also the prompt's examples. */
export const APPROVED_PROGRAMS: readonly ProgramEntry[] = APPROVED.map(([id, label]) => ({ id, label, scene: id, program: text(id) ?? "", kind: "approved" }));

export const PROGRAMS: readonly ProgramEntry[] = [
  ...APPROVED_PROGRAMS,
  ...NOVEL.flatMap(([id, label, scene]): ProgramEntry[] => {
    const program = text(id);
    return program === undefined ? [] : [{ id, label, scene, program, kind: id.endsWith("-after") ? "mutation" : "novel" }];
  }),
];

/** The mutation's patch, when composed: the statements it changed. */
export const PATCH_A: string | undefined = text("novel-a-patch");

export const programById = (id: string): ProgramEntry | undefined => PROGRAMS.find((p) => p.id === id);
