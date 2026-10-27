import type { CarConnectReason, CarLink, CarReadings, CarState } from "../contract";
import { ELM_INIT, FUEL_RATE_SUPPORT, POLL_MS, pollPlan, supportsFuelRate } from "./elm";
import { type BluetoothAccess, type GattDevice, type ElmConnection, connectElm, OBD_SERVICE } from "./gatt";
import { createRange } from "./range";
export interface CarEngine extends CarLink { start(): Promise<void>; newDrive(): void; dispose(): void }
export const CAR_RETRY_MS = [2000, 5000, 15000, 30000, 60000] as const;
export interface CarPage {
  readonly hidden: boolean;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}
export function createCarLink(options: { bluetooth?: BluetoothAccess; tankLitres?: number; now?: () => number; page?: CarPage }): CarEngine {
  let state: CarState = { kind: options.bluetooth ? "connect" : "unavailable" };
  const now = options.now ?? Date.now;
  const page = options.page ?? globalThis.document;
  let readings: CarReadings = { at: now() };
  let connection: ElmConnection | undefined; let device: GattDevice | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false; let generation = 0; const lastRead = new Map<string, number>();
  let fuelRate = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retryDelay: number | undefined;
  let retryStep = 0;
  let lookupInFlight = false;
  const range = createRange(options.tankLitres);
  const listeners = new Set<() => void>();
  const notify = () => { for (const fn of listeners) fn(); };
  function disconnect() {
    generation++; clearTimeout(timer); clearTimeout(retryTimer); retryTimer = undefined;
    device?.removeEventListener("gattserverdisconnected", lost);
    const old = connection; connection = undefined;
    if (old) old.close(); else device?.gatt?.disconnect();
    device = undefined;
    readings = { at: now() }; range.reset(); lastRead.clear();
  }
  function needsTap(reason: CarConnectReason): void {
    disconnect(); retryDelay = undefined;
    if (!disposed) { state = options.bluetooth ? { kind: "connect", reason } : { kind: "unavailable" }; notify(); }
  }
  function armRetry(): void {
    clearTimeout(retryTimer); retryTimer = undefined;
    if (disposed || retryDelay === undefined) return;
    const visible = !page?.hidden;
    state = { kind: "reconnecting", attempt: retryStep, ...(visible ? { retryAt: now() + retryDelay } : {}) };
    if (visible) retryTimer = setTimeout(() => {
      retryTimer = undefined; retryDelay = undefined;
      void remembered();
    }, retryDelay);
    notify();
  }
  function scheduleRetry(): void {
    if (disposed) return;
    if (!options.bluetooth?.getDevices) { needsTap("unavailable-api"); return; }
    retryDelay = CAR_RETRY_MS[Math.min(retryStep, CAR_RETRY_MS.length - 1)] ?? 60000;
    retryStep++; armRetry();
  }
  function failed(error?: unknown): void {
    disconnect();
    if (error instanceof Error && ["NotAllowedError", "SecurityError"].includes(error.name)) needsTap("permission");
    else scheduleRetry();
  }
  function lost() { failed(); }
  async function remembered(): Promise<void> {
    if (disposed || lookupInFlight || retryDelay !== undefined || state.kind === "connected") return;
    if (!options.bluetooth?.getDevices) { needsTap("unavailable-api"); return; }
    if (page?.hidden) { scheduleRetry(); return; }
    lookupInFlight = true;
    const run = generation;
    state = { kind: "connecting" }; notify();
    try {
      const devices = await options.bluetooth.getDevices();
      if (disposed || run !== generation) return;
      if (!devices[0]) { needsTap("no-device"); return; }
      if (page?.hidden) { scheduleRetry(); return; }
      await open(devices[0]);
    } catch { if (!disposed && run === generation) needsTap("permission"); }
    finally { lookupInFlight = false; }
  }
  async function poll(run: number): Promise<void> {
    const elm = connection;
    if (!elm || disposed || run !== generation) return;
    try {
      const started = now();
      let next: CarReadings = { at: now(), ...(readings.fuelPercent !== undefined ? { fuelPercent: readings.fuelPercent } : {}) };
      const plan = pollPlan(fuelRate, started, lastRead);
      if (plan.some((read) => read.cadenceMs > POLL_MS)) next = { at: started };
      for (const read of plan) {
        next = { ...next, ...read.decode(await elm.command(read.command)) };
        lastRead.set(read.command, started);
      }
      if (run !== generation || disposed) return;
      const rangeKm = range.update(next);
      const { rangeKm: _old, ...withoutRange } = next;
      readings = rangeKm === undefined ? withoutRange : { ...withoutRange, rangeKm };
      // Adapter initialization alone does not prove that the polling connection recovered.
      retryStep = 0;
      notify(); timer = setTimeout(() => { void poll(run); }, Math.max(0, POLL_MS - (now() - started)));
    } catch (error) { if (run === generation) failed(error); }
  }
  async function open(selected: GattDevice): Promise<void> {
    if (disposed) return;
    disconnect(); const run = generation;
    retryDelay = undefined;
    state = { kind: "connecting" }; notify(); device = selected;
    try {
      const elm = await connectElm(selected);
      if (disposed || run !== generation) { elm.close(); return; }
      connection = elm; selected.addEventListener("gattserverdisconnected", lost);
      for (const command of ELM_INIT) await elm.command(command);
      fuelRate = supportsFuelRate(await elm.command(FUEL_RATE_SUPPORT.command)); lastRead.clear();
      if (disposed || run !== generation) return;
      state = { kind: "connected" }; notify(); await poll(run);
    } catch (error) { if (run === generation) failed(error); }
  }
  page?.addEventListener("visibilitychange", armRetry);
  return {
    get state() { return state; }, get readings() { return readings; },
    start: remembered,
    async connect() {
      if (!options.bluetooth || disposed || state.kind === "connecting" || state.kind === "connected") return;
      disconnect(); retryDelay = undefined; const run = generation;
      state = { kind: "connecting" }; notify();
      try {
        const selected = await options.bluetooth.requestDevice({ filters: [{ services: [OBD_SERVICE] }] });
        if (!disposed && run === generation) await open(selected);
      } catch { if (!disposed && run === generation) needsTap("cancelled"); }
    },
    newDrive() { if (state.kind === "connect" || state.kind === "unavailable") notify(); },
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    dispose() { disposed = true; retryDelay = undefined; disconnect(); page?.removeEventListener("visibilitychange", armRetry); listeners.clear(); },
  };
}
