import type { CarReadings } from "../contract";

export const ELM_INIT = ["ATZ", "ATE0", "ATL0", "ATS1", "ATH0", "ATSP0"] as const;
export const POLL_MS = 2000;
export interface ObdRead {
  readonly pid: string;
  readonly command: string;
  readonly cadenceMs: number;
  readonly choice?: "fuel-rate" | "maf";
  decode(reply: string): Partial<CarReadings>;
}
function pidRead(pid: string, cadenceMs: number, decode: (bytes: readonly number[]) => Partial<CarReadings>, choice?: ObdRead["choice"]): ObdRead {
  return { pid, command: `01${pid}`, cadenceMs, ...(choice ? { choice } : {}), decode: (reply) => decode(payload(reply, `41${pid}`)) };
}
const byte = (fn: (a: number) => Partial<CarReadings>) => (bytes: readonly number[]): Partial<CarReadings> => bytes[0] === undefined ? {} : fn(bytes[0]);
const pair = (fn: (value: number) => Partial<CarReadings>) => (bytes: readonly number[]): Partial<CarReadings> => bytes[0] === undefined || bytes[1] === undefined ? {} : fn(bytes[0] * 256 + bytes[1]);
export const FUEL_RATE_SUPPORT = pidRead("40", 0, () => ({}));
/** The single catalog owns decoders, polling cadence, consumption choice and permitted reads. */
export const OBD_READS: readonly ObdRead[] = [
  pidRead("46", POLL_MS, byte((a) => ({ ambientC: a - 40 }))),
  pidRead("05", POLL_MS, byte((a) => ({ coolantC: a - 40 }))),
  pidRead("42", POLL_MS, pair((value) => ({ voltage: value / 1000 }))),
  pidRead("0D", POLL_MS, byte((a) => ({ speedKmh: a }))),
  pidRead("5E", POLL_MS, pair((value) => ({ fuelLitresHour: value * 0.05 })), "fuel-rate"),
  pidRead("10", POLL_MS, pair((value) => ({ mafGramsSec: value / 100 })), "maf"),
  pidRead("01", POLL_MS, byte((a) => ({ mil: (a & 128) !== 0 }))),
  pidRead("2F", 30000, byte((a) => ({ fuelPercent: a * 100 / 255 }))),
  { pid: "", command: "03", cadenceMs: POLL_MS, decode: (reply) => ({ dtcs: decodeDtcs(reply) }) },
  FUEL_RATE_SUPPORT,
];
export function pollPlan(fuelRate: boolean, now: number, lastRead: ReadonlyMap<string, number>): readonly ObdRead[] {
  const consumption = fuelRate ? "fuel-rate" : "maf";
  return OBD_READS.filter((read) => read.cadenceMs > 0 && (!read.choice || read.choice === consumption) && now - (lastRead.get(read.command) ?? Number.NEGATIVE_INFINITY) >= read.cadenceMs);
}
const READ_COMMANDS = new Set([...ELM_INIT, ...OBD_READS.map((read) => read.command)]);
/** Only the catalog's adapter setup and OBD reads may reach the characteristic. */
export function readCommand(command: string): string {
  if (!READ_COMMANDS.has(command)) throw new Error("OBD command is not read-only");
  return `${command}\r`;
}
function payload(reply: string, header: string): number[] {
  for (const line of reply.toUpperCase().split(/[\r\n>]+/)) {
    const compact = line.replace(/\s/g, "");
    if (!compact.startsWith(header)) continue;
    const hex = compact.slice(header.length);
    if (!/^(?:[0-9A-F]{2})+$/.test(hex)) continue;
    return (hex.match(/../g) ?? []).map((h) => Number.parseInt(h, 16));
  }
  return [];
}
export function decodePid(pid: string, reply: string): Partial<CarReadings> {
  return OBD_READS.find((read) => read.pid === pid.toUpperCase())?.decode(reply) ?? {};
}

export function supportsFuelRate(reply: string): boolean {
  const b = payload(reply, `41${FUEL_RATE_SUPPORT.pid}`);
  return b.length >= 4 && ((b[3] ?? 0) & 4) !== 0;
}
export function decodeDtcs(reply: string): string[] {
  const bytes = payload(reply, "43"); const codes: string[] = [];
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const a = bytes[i] ?? 0; const b = bytes[i + 1] ?? 0;
    if (a === 0 && b === 0) continue;
    const code = `${"PCBU"[a >> 6]}${((a & 63) * 256 + b).toString(16).toUpperCase().padStart(4, "0")}`;
    if (!codes.includes(code)) codes.push(code);
  }
  return codes;
}
