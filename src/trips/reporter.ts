/**
 * Trips: records every fix while the car is moving and reports it to Traccar (ADR 0008).
 *
 * Traccar's OsmAnd protocol takes one position per GET:
 *   {origins.traccar}/?id=…&lat=…&lon=…&timestamp=…&speed=…&bearing=…&accuracy=…
 * `timestamp` is Unix seconds and `speed` is in knots, as the Traccar Client app sends them.
 * https://www.traccar.org/osmand/
 * https://github.com/traccar/traccar/blob/master/src/main/java/org/traccar/protocol/OsmAndProtocolDecoder.java
 *
 * Fixes wait in a queue on the device and are sent oldest first, one at a time, with their
 * original timestamps. A failed send stops the flush; the queue keeps its order.
 */
import type { Fix, TripsReporter, VelaConfig } from "../contract";
import type { Network } from "../nav/engine";
import type { FixSource } from "../nav/position";
import { type KeyValueStore, deviceStore, readJson } from "../nav/storage";
import { type Motion, PARKED, nextMotion } from "./motion";

const QUEUE_KEY = "vela.trips.queue";
/** About five and a half hours of driving at one fix per second. Oldest fixes go first. */
export const MAX_QUEUED = 20_000;
export const RETRY_MS = 30_000;
const MPS_TO_KNOTS = 1.943844;
const SEND_TIMEOUT_MS = 15_000;

export interface TripsStatus {
  readonly moving: boolean;
  readonly queued: number;
  /** Why the last send failed, until a send succeeds. */
  readonly lastError?: string;
}

export interface TripsDeps {
  readonly config: VelaConfig;
  readonly store?: KeyValueStore;
  readonly fetcher?: typeof fetch;
  readonly network?: Network;
}

export interface TripsEngine extends TripsReporter {
  readonly status: TripsStatus;
  subscribe(listener: (status: TripsStatus) => void): () => void;
  /** Record every fix from `fixes` until the returned function is called. */
  follow(fixes: FixSource): () => void;
  dispose(): void;
}

/** Compact queue entry: [at, lat, lng, accuracyM, speedMps|null, headingDeg|null]. */
type Row = [number, number, number, number, number | null, number | null];

export function osmAndUrl(origin: string, deviceId: string, fix: Fix): string {
  const params = new URLSearchParams({
    id: deviceId,
    lat: fix.lat.toFixed(6),
    lon: fix.lng.toFixed(6),
    timestamp: String(Math.floor(fix.at / 1000)),
    accuracy: fix.accuracyM.toFixed(1),
  });
  if (fix.speedMps !== undefined) params.set("speed", (fix.speedMps * MPS_TO_KNOTS).toFixed(2));
  if (fix.headingDeg !== undefined) params.set("bearing", fix.headingDeg.toFixed(1));
  return `${origin}/?${params}`;
}

export function createTripsReporter(deps: TripsDeps): TripsEngine {
  const store = deps.store ?? deviceStore();
  const fetcher = deps.fetcher ?? ((input, init) => fetch(input, init));
  const online = () => deps.network?.online() ?? globalThis.navigator?.onLine ?? true;
  const listeners = new Set<(status: TripsStatus) => void>();

  let queue: Row[] = readJson(store, QUEUE_KEY, isRows) ?? [];
  let motion: Motion = PARKED;
  let lastError: string | undefined;
  let flushing: Promise<void> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const unsubscribeNetwork = deps.network?.subscribe(() => {
    if (online()) void reporter.flush();
  });

  function status(): TripsStatus {
    return { moving: motion.kind === "moving", queued: queue.length, ...(lastError ? { lastError } : {}) };
  }

  function notify(): void {
    const s = status();
    for (const l of [...listeners]) l(s);
  }

  function persist(): void {
    store.set(QUEUE_KEY, JSON.stringify(queue));
  }

  function scheduleRetry(): void {
    if (retryTimer !== undefined || disposed) return;
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      void reporter.flush();
    }, RETRY_MS);
  }

  async function send(row: Row): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetcher(osmAndUrl(deps.config.origins.traccar, deps.config.traccarDeviceId, fromRow(row)), {
        method: "GET",
        signal: controller.signal,
      });
    } catch (error) {
      throw new Error(`No signal: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timer);
    }
    // Traccar answers 400 when it does not know the device id. Keep the fixes; the id may be added.
    if (res.status === 400) throw new Error(`Traccar does not accept device "${deps.config.traccarDeviceId}"`);
    if (!res.ok) throw new Error(`Traccar answered HTTP ${res.status}`);
  }

  async function drain(): Promise<void> {
    while (queue.length > 0 && !disposed) {
      const row = queue[0] as Row;
      try {
        await send(row);
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        notify();
        scheduleRetry();
        return;
      }
      // The queue may have been trimmed while the send was in flight; drop only what was sent.
      if (queue[0] === row) queue = queue.slice(1);
      lastError = undefined;
      persist();
      notify();
    }
  }

  const reporter: TripsEngine = {
    get queued() {
      return queue.length;
    },
    get status() {
      return status();
    },

    record(fix) {
      const step = nextMotion(motion, fix);
      const changed = (step.motion.kind === "moving") !== (motion.kind === "moving");
      motion = step.motion;
      if (step.record.length > 0) {
        queue = [...queue, ...step.record.map(toRow)];
        if (queue.length > MAX_QUEUED) queue = queue.slice(queue.length - MAX_QUEUED);
        persist();
        if (online()) void reporter.flush();
      }
      if (changed || step.record.length > 0) notify();
    },

    flush() {
      if (!flushing) {
        if (retryTimer !== undefined) clearTimeout(retryTimer);
        retryTimer = undefined;
        flushing = drain().finally(() => {
          flushing = undefined;
        });
      }
      return flushing;
    },

    subscribe(listener) {
      listeners.add(listener);
      listener(status());
      return () => listeners.delete(listener);
    },

    follow(fixes) {
      return fixes.subscribe((fix) => reporter.record(fix));
    },

    dispose() {
      disposed = true;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      unsubscribeNetwork?.();
      listeners.clear();
    },
  };
  return reporter;
}

function toRow(f: Fix): Row {
  return [f.at, f.lat, f.lng, f.accuracyM, f.speedMps ?? null, f.headingDeg ?? null];
}

function fromRow([at, lat, lng, accuracyM, speed, heading]: Row): Fix {
  return {
    at,
    lat,
    lng,
    accuracyM,
    ...(speed !== null ? { speedMps: speed } : {}),
    ...(heading !== null ? { headingDeg: heading } : {}),
  };
}

function isRows(v: unknown): v is Row[] {
  return Array.isArray(v) && v.every((r) => Array.isArray(r) && r.length === 6 && typeof r[0] === "number");
}
