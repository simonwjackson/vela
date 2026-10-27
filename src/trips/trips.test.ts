import type { Fix, VelaConfig } from "../contract";
import { ORIGIN, SwitchableNetwork } from "../nav/fixtures";
import { destinationPoint } from "../nav/geo";
import { ManualFixSource } from "../nav/position";
import { InMemoryStore } from "../nav/storage";
import { type Motion, PARKED, PARK_AFTER_MS, nextMotion } from "./motion";
import { PERSIST_EVERY_MS, createTripsReporter, osmAndUrl } from "./reporter";

const T0 = Date.parse("2026-06-01T08:00:00Z");
const config: VelaConfig = {
  origins: {
    pyxis: "https://pyxis.test",
    ossicle: "https://ossicle.test",
    assistant: "https://assistant.test",
    voice: "https://voice.test",
    valhalla: "https://valhalla.test",
    traccar: "https://osmand.traccar.test",
  },
  photonUrl: "https://photon.test",
  traccarDeviceId: "car-test",
  turnSoundLeadMs: 250,
};

/** One fix per second: `parkedSec` standing still, `drivingSec` north at 12 m/s, `parkedSec` again. */
function drive(opts: { parkedSec: number; drivingSec: number; startAt?: number }): Fix[] {
  const fixes: Fix[] = [];
  let at = opts.startAt ?? T0;
  let here = ORIGIN;
  const push = (speedMps: number) => {
    fixes.push({ ...here, at, accuracyM: 6, speedMps, headingDeg: 0 });
    at += 1000;
  };
  for (let i = 0; i < opts.parkedSec; i++) push(0);
  for (let i = 0; i < opts.drivingSec; i++) {
    here = destinationPoint(here, 0, 12);
    push(12);
  }
  for (let i = 0; i < opts.parkedSec; i++) push(0);
  return fixes;
}

/**
 * An in-process Traccar OsmAnd endpoint as a browser sees it: it sends no CORS headers, so a
 * no-cors request resolves with an opaque response (status 0, unreadable), or rejects without signal.
 */
class TraccarServer {
  behavior: "ok" | "no-signal" = "ok";
  readonly received: URL[] = [];
  readonly inits: (RequestInit | undefined)[] = [];
  readonly fetch: typeof fetch = async (input, init) => {
    this.inits.push(init);
    if (this.behavior === "no-signal") throw new TypeError("Failed to fetch");
    this.received.push(new URL(String(input)));
    return Response.error();
  };
}

describe("moving and parked", () => {
  function run(fixes: readonly Fix[]): { motion: Motion; recorded: Fix[]; kinds: string[] } {
    let motion = PARKED;
    const recorded: Fix[] = [];
    const kinds: string[] = [];
    for (const fix of fixes) {
      const step = nextMotion(motion, fix);
      motion = step.motion;
      recorded.push(...step.record);
      kinds.push(motion.kind);
    }
    return { motion, recorded, kinds };
  }

  test("a parked car records nothing, even with GPS jitter", () => {
    const jitter = Array.from({ length: 60 }, (_, i) => ({
      ...destinationPoint(ORIGIN, i * 37, 8),
      at: T0 + i * 1000,
      accuracyM: 10,
      speedMps: 0.4,
    }));
    const one = { ...ORIGIN, at: T0 + 61_000, accuracyM: 10, speedMps: 5 };
    const { recorded, motion } = run([...jitter, one]);
    expect(recorded).toHaveLength(0);
    expect(motion.kind).toBe("parked");
  });

  test("a drive starts after two fast fixes and ends after three slow minutes", () => {
    const fixes = drive({ parkedSec: 200, drivingSec: 60 });
    const { recorded, kinds } = run(fixes);
    expect(kinds[200]).toBe("parked");
    expect(kinds[201]).toBe("moving");
    // Every driving fix, plus the slow fixes until three minutes have passed.
    expect(recorded[0]?.at).toBe(fixes[200]?.at);
    expect(recorded).toHaveLength(60 + PARK_AFTER_MS / 1000 + 1);
    expect(kinds[kinds.length - 1]).toBe("parked");
  });

  test("a two-minute red light stays inside the Trip", () => {
    const fixes = drive({ parkedSec: 120, drivingSec: 30, startAt: T0 }).slice(120);
    const { kinds } = run(fixes);
    expect(kinds[kinds.length - 1]).toBe("moving");
  });

  test("a fix without speed counts as moving once far from the parking spot", () => {
    const parked = { ...ORIGIN, at: T0, accuracyM: 5, speedMps: 0 };
    const far = { ...destinationPoint(ORIGIN, 0, 400), at: T0 + 60_000, accuracyM: 5 };
    expect(run([parked, far]).motion.kind).toBe("moving");
  });
});

describe("TripsReporter", () => {
  test("OsmAnd query: Unix seconds, knots, bearing, accuracy", () => {
    const url = new URL(osmAndUrl("https://osmand.traccar.test", "car-test", { lat: 10.1234567, lng: 20.5, at: T0 + 999, accuracyM: 4, speedMps: 10, headingDeg: 91 }));
    expect(Object.fromEntries(url.searchParams)).toEqual({
      id: "car-test",
      lat: "10.123457",
      lon: "20.500000",
      timestamp: String(T0 / 1000),
      accuracy: "4.0",
      speed: "19.44",
      bearing: "91.0",
    });
    expect(url.origin).toBe("https://osmand.traccar.test");
    expect(url.pathname).toBe("/");
  });

  test("online: each moving fix is sent as it is recorded", async () => {
    const traccar = new TraccarServer();
    const trips = createTripsReporter({ config, store: new InMemoryStore(), fetcher: traccar.fetch, network: new SwitchableNetwork() });
    const fixes = new ManualFixSource();
    const stop = trips.follow(fixes);
    for (const fix of drive({ parkedSec: 5, drivingSec: 10 }).slice(0, 15)) fixes.push(fix);
    await trips.flush();
    expect(traccar.received).toHaveLength(10);
    // An opaque answer counts as delivered: its status cannot be read.
    expect(trips.queued).toBe(0);
    expect(trips.status.lastError).toBeUndefined();
    for (const init of traccar.inits) expect(init).toMatchObject({ method: "GET", mode: "no-cors", keepalive: true });
    expect(traccar.received[0]?.origin).toBe("https://osmand.traccar.test");
    expect(trips.status.moving).toBe(true);
    stop();
    trips.dispose();
  });

  test("offline fixes queue on the device, survive a reload, and flush in order with original timestamps", async () => {
    const traccar = new TraccarServer();
    const store = new InMemoryStore();
    const network = new SwitchableNetwork();
    traccar.behavior = "no-signal";
    const first = createTripsReporter({ config, store, fetcher: traccar.fetch, network });
    const fixes = drive({ parkedSec: 3, drivingSec: 20 }).slice(0, 23);
    for (const fix of fixes.slice(0, 13)) first.record(fix);
    await first.flush();
    expect(first.queued).toBe(10);
    expect(first.status.lastError).toContain("No signal");
    first.dispose();

    // The app reloads in the dead zone; the queue is still on the device.
    network.up = false;
    const second = createTripsReporter({ config, store, fetcher: traccar.fetch, network });
    expect(second.queued).toBe(10);
    // A reload forgets the motion state, so driving must be seen again before recording resumes.
    for (const fix of fixes.slice(13)) second.record(fix);
    expect(second.queued).toBe(20);
    expect(traccar.received).toHaveLength(0);

    traccar.behavior = "ok";
    network.set(true);
    await second.flush();
    expect(second.queued).toBe(0);
    expect(second.status.lastError).toBeUndefined();
    const sentTimes = traccar.received.map((u) => Number(u.searchParams.get("timestamp")));
    expect(sentTimes).toEqual(fixes.slice(3).map((f) => Math.floor(f.at / 1000)));
    second.dispose();
  });

  test("subscribe hears the queued count each time it changes, and only then", async () => {
    const traccar = new TraccarServer();
    traccar.behavior = "no-signal";
    const network = new SwitchableNetwork();
    network.up = false;
    const trips = createTripsReporter({ config, store: new InMemoryStore(), fetcher: traccar.fetch, network });
    const counts: number[] = [];
    const off = trips.subscribe((queued) => counts.push(queued));
    expect(counts).toEqual([]);
    for (const fix of drive({ parkedSec: 2, drivingSec: 3 })) trips.record(fix);
    // Starting to move records the fixes that showed it in one step, so counts can jump.
    expect(counts).toEqual([2, 3, 4, 5]);
    expect(trips.queued).toBe(5);

    traccar.behavior = "ok";
    network.set(true);
    await trips.flush();
    expect(counts.at(-1)).toBe(0);
    // Never the same count twice in a row: only changes are heard.
    for (let i = 1; i < counts.length; i++) expect(counts[i]).not.toBe(counts[i - 1]);
    off();
    const heard = counts.length;
    for (const fix of drive({ parkedSec: 0, drivingSec: 2 })) trips.record(fix);
    expect(counts).toHaveLength(heard);
    trips.dispose();
  });

  test("queue writes are batched, and a hidden page writes what is pending", async () => {
    vi.useFakeTimers({ now: T0 });
    try {
      class CountingStore extends InMemoryStore {
        writes = 0;
        override set(key: string, value: string): void {
          this.writes++;
          super.set(key, value);
        }
      }
      const store = new CountingStore();
      const network = new SwitchableNetwork();
      network.up = false;
      const trips = createTripsReporter({ config, store, fetcher: new TraccarServer().fetch, network });
      const fixes = drive({ parkedSec: 0, drivingSec: 60 });
      for (const fix of fixes.slice(0, 30)) {
        trips.record(fix);
        await vi.advanceTimersByTimeAsync(1000);
      }
      expect(trips.queued).toBe(30);
      expect(store.writes).toBeLessThanOrEqual(30 / (PERSIST_EVERY_MS / 1000) + 1);
      trips.record(fixes[30] as Fix);
      window.dispatchEvent(new Event("pagehide"));
      expect(JSON.parse(store.get("vela.trips.queue") ?? "[]")).toHaveLength(31);
      trips.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  test("a rejected send stays queued, retries later and never reorders", async () => {
    vi.useFakeTimers({ now: T0 });
    try {
      const traccar = new TraccarServer();
      // The phone believes it is online, but the requests fail (a dead zone with bars).
      traccar.behavior = "no-signal";
      const trips = createTripsReporter({ config, store: new InMemoryStore(), fetcher: traccar.fetch, network: new SwitchableNetwork() });
      for (const fix of drive({ parkedSec: 0, drivingSec: 5 })) trips.record(fix);
      await vi.advanceTimersByTimeAsync(0);
      expect(trips.queued).toBe(5);
      expect(trips.status.lastError).toContain("No signal");
      traccar.behavior = "ok";
      await vi.advanceTimersByTimeAsync(30_000);
      expect(trips.queued).toBe(0);
      const times = traccar.received.map((u) => Number(u.searchParams.get("timestamp")));
      expect(times).toEqual([...times].sort((a, b) => a - b));
      expect(times).toHaveLength(5);
      trips.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});

test("queued positions keep their original car readings across reload", async () => {
  const store = new InMemoryStore(); const network = new SwitchableNetwork(); network.up = false;
  const server = new TraccarServer(); let fuel = 50;
  const reporter = createTripsReporter({ config, store, network, fetcher: server.fetch, carReadings: () => ({ at: T0, fuelPercent: fuel, dtcs: ["P0133"] }) });
  for (const fix of drive({ parkedSec: 0, drivingSec: 3 })) reporter.record(fix);
  expect(reporter.queued).toBe(3); reporter.dispose(); fuel = 20;
  const reloaded = createTripsReporter({ config, store, network, fetcher: server.fetch, carReadings: () => ({ at: T0, fuelPercent: fuel }) });
  await reloaded.flush();
  expect(server.received).toHaveLength(3);
  for (const url of server.received) { expect(url.searchParams.get("fuel")).toBe("50"); expect(url.searchParams.get("dtcs")).toBe("P0133"); }
  reloaded.dispose();
});
