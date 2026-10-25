import type { Fix, Guidance, NavState, Place, TurnSoundEvent, VelaConfig } from "../contract";
import { type DisposableNavEngine, createNavEngine } from "./engine";
import {
  type BuiltLeg,
  ORIGIN,
  SwitchableNetwork,
  VALHALLA,
  ValhallaServer,
  buildLeg,
  straightLeg,
  traceAlong,
} from "./fixtures";
import { destinationPoint } from "./geo";
import { ManualFixSource } from "./position";
import { InMemoryStore } from "./storage";
import { approachMeters, turnNowMeters } from "./turnSounds";

const LEAD_MS = 250;
const config: VelaConfig = {
  origins: {
    pyxis: "https://pyxis.test",
    ossicle: "https://ossicle.test",
    assistant: "https://assistant.test",
    voice: "https://voice.test",
    valhalla: VALHALLA,
    traccar: "https://traccar.test",
  },
  photonUrl: "https://photon.test",
  traccarDeviceId: "car-test",
  turnSoundLeadMs: LEAD_MS,
};

/** North 1000 m on Alpha Road, right onto Beta Street for 500 m, left onto Gamma Lane for 300 m. */
function threeTurnLeg(start = ORIGIN): BuiltLeg {
  return buildLeg(
    start,
    [
      { headingDeg: 0, meters: 1000, street: "Alpha Road", speedMps: 15, type: 1, speedLimitKmh: 60 },
      { headingDeg: 90, meters: 500, street: "Beta Street", speedMps: 15, type: 10 },
      { headingDeg: 0, meters: 300, street: "Gamma Lane", speedMps: 15, type: 15, speedLimitKmh: 30 },
    ],
    "Invented Cafe",
  );
}

const T0 = Date.parse("2026-06-01T12:00:00Z");

interface Harness {
  engine: DisposableNavEngine;
  fixes: ManualFixSource;
  valhalla: ValhallaServer;
  network: SwitchableNetwork;
  store: InMemoryStore;
  sounds: { event: TurnSoundEvent; emittedAt: number }[];
  leg: BuiltLeg;
  destination: Place;
}

function setup(opts: { leg?: BuiltLeg; store?: InMemoryStore; now?: () => number } = {}): Harness {
  const leg = opts.leg ?? threeTurnLeg();
  const destination: Place = { name: "Invented Cafe", ...leg.end };
  const valhalla = new ValhallaServer();
  let first = true;
  const straight = valhalla.plan;
  valhalla.plan = (locations) => {
    if (first) {
      first = false;
      return [leg];
    }
    return straight(locations);
  };
  const fixes = new ManualFixSource();
  const network = new SwitchableNetwork();
  const store = opts.store ?? new InMemoryStore();
  const now = opts.now ?? Date.now;
  const engine = createNavEngine({
    config,
    fixes,
    store,
    network,
    fetcher: valhalla.fetch,
    now,
    formatClock: (ms) => new Date(ms).toISOString().slice(11, 16),
  });
  const sounds: Harness["sounds"] = [];
  engine.onTurnSound((event) => sounds.push({ event, emittedAt: now() }));
  return { engine, fixes, valhalla, network, store, sounds, leg, destination };
}

function guidanceOf(state: NavState): Guidance {
  if (state.kind !== "guiding" && state.kind !== "rerouting") throw new Error(`no guidance in ${state.kind}`);
  return state.guidance;
}

/** Let pending promise chains (the router) finish. Real timers only. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("guidance along a trace", () => {
  test("every number the driving view shows", async () => {
    const h = setup({ now: () => T0 });
    h.fixes.push({ ...ORIGIN, at: T0, accuracyM: 5, speedMps: 0 });
    await h.engine.start(h.destination);

    const g0 = guidanceOf(h.engine.state);
    expect(g0.route.stops.map((s) => s.maneuver)).toEqual(["right", "left", "arrive"]);
    expect(g0.route.stops.map((s) => s.street)).toEqual(["Beta Street", "Gamma Lane", "Invented Cafe"]);
    expect(g0.route.totalMeters).toBeCloseTo(1800, -1);

    // 20 m/s for 20 s: exactly 400 m. The router's own estimate (15 m/s) sets the seconds.
    for (const fix of traceAlong(h.leg.points, { speedMps: 20, startAt: T0, toMeters: 400 })) h.fixes.push(fix);
    const g = guidanceOf(h.engine.state);
    expect(g.nextStop.street).toBe("Beta Street");
    expect(g.nextStop.instruction).toBe("Turn right onto Beta Street");
    expect(g.thenStop?.street).toBe("Gamma Lane");
    expect(g.metersToNext).toBeCloseTo(600, -1);
    expect(g.secToNext).toBeCloseTo(40, 0);
    expect(g.progress).toBeCloseTo(400 / 1800, 2);
    expect(g.legProgress).toBeCloseTo(0.4, 2);
    expect(g.metersLeft).toBeCloseTo(1400, -1);
    expect(g.secLeft).toBeCloseTo(1400 / 15, 0);
    expect(g.arriveAt).toBeCloseTo(T0 + (1400 / 15) * 1000, -3);
    expect(g.offRoute).toBe(false);
    expect(g.offline).toBe(false);
    expect(h.engine.readouts.speedKmh).toBeCloseTo(72, 5);
    expect(h.engine.readouts.speedLimitKmh).toBe(60);
    expect(h.engine.readouts.clock).toBe("12:00");

    // Past the right turn, the next leg is measured from it.
    for (const fix of traceAlong(h.leg.points, { speedMps: 15, startAt: T0, fromMeters: 1250, toMeters: 1250 })) {
      h.fixes.push(fix);
    }
    const g2 = guidanceOf(h.engine.state);
    expect(g2.nextStop.street).toBe("Gamma Lane");
    expect(g2.thenStop?.maneuver).toBe("arrive");
    expect(g2.legProgress).toBeCloseTo(0.5, 2);
    expect(h.engine.readouts.speedLimitKmh).toBeUndefined();
    h.engine.dispose();
  });

  test("a long leg: the next Stop 300 km away", async () => {
    const leg = buildLeg(
      ORIGIN,
      [
        { headingDeg: 0, meters: 2_000, street: "Spur Road", speedMps: 15, type: 1 },
        { headingDeg: 20, meters: 300_000, street: "Long Highway", speedMps: 30, type: 23 },
        { headingDeg: 90, meters: 1_000, street: "Last Street", speedMps: 10, type: 10 },
      ],
      "Far Town",
    );
    const h = setup({ leg });
    h.fixes.push({ ...ORIGIN, at: Date.now(), accuracyM: 5 });
    await h.engine.start(h.destination);
    const startG = guidanceOf(h.engine.state);
    expect(startG.nextStop.maneuver).toBe("keep-right");
    expect(startG.thenStop?.street).toBe("Last Street");

    // 50 km into the highway, after a 90-second GPS gap (a tunnel) that outruns the snap window.
    const [before] = traceAlong(leg.points, { speedMps: 30, startAt: Date.now(), fromMeters: 49_000, toMeters: 49_000 });
    const [after] = traceAlong(leg.points, { speedMps: 30, startAt: Date.now(), fromMeters: 52_000, toMeters: 52_000 });
    h.fixes.push(before as Fix);
    h.fixes.push(after as Fix);
    const g = guidanceOf(h.engine.state);
    expect(g.nextStop.street).toBe("Last Street");
    expect(g.metersToNext).toBeCloseTo(302_000 - 52_000, -2);
    expect(g.secToNext).toBeCloseTo(250_000 / 30, -1);
    expect(g.legProgress).toBeCloseTo(50_000 / 300_000, 2);
    expect(g.offRoute).toBe(false);
    h.engine.dispose();
  });
});

test("Valhalla requests are CORS simple requests: no preflight-triggering header", async () => {
  const h = setup();
  h.fixes.push({ ...ORIGIN, at: Date.now(), accuracyM: 5 });
  await h.engine.start(h.destination);
  const urls = h.valhalla.requests.map((r) => r.url);
  expect(urls).toEqual([`${VALHALLA}/route`, `${VALHALLA}/trace_attributes`]);
  for (const { url, init } of h.valhalla.requests) {
    expect(init?.method).toBe("POST");
    expect(init?.headers).toBeUndefined();
    expect(typeof init?.body).toBe("string");
    // What the browser would send: only a safelisted content type, set from the string body.
    const sent = new Request(url, init);
    expect([...sent.headers.keys()].map((k) => k.toLowerCase())).toEqual(["content-type"]);
    expect(sent.headers.get("content-type")).toBe("text/plain;charset=UTF-8");
  }
  h.engine.dispose();
});

describe("off route", () => {
  /** Drive 400 m along the Route, then 300 m due west, away from it. */
  function leaveRoute(h: Harness): void {
    const along = traceAlong(h.leg.points, { speedMps: 15, startAt: Date.now(), toMeters: 400 });
    for (const fix of along) h.fixes.push(fix);
    const turnAt = along[along.length - 1] as Fix;
    for (let i = 1; i <= 6; i++) {
      const p = destinationPoint(turnAt, 270, i * 50);
      h.fixes.push({ ...p, at: Date.now(), accuracyM: 5, speedMps: 10, headingDeg: 270 });
    }
  }

  test("one stray fix does not count; leaving re-routes when there is signal", async () => {
    const h = setup();
    h.fixes.push({ ...ORIGIN, at: Date.now(), accuracyM: 5 });
    await h.engine.start(h.destination);
    for (const fix of traceAlong(h.leg.points, { speedMps: 15, startAt: Date.now(), toMeters: 300 })) h.fixes.push(fix);
    const stray = destinationPoint(h.leg.points[6] as Fix, 270, 120);
    h.fixes.push({ ...stray, at: Date.now(), accuracyM: 5 });
    expect(guidanceOf(h.engine.state).offRoute).toBe(false);

    leaveRoute(h);
    expect(h.sounds.map((s) => s.event.sound)).toContain("off-route");
    await settle();
    expect(h.valhalla.routeRequests()).toHaveLength(2);
    const reroute = h.valhalla.routeRequests()[1]?.body as { locations: { lat: number; lon: number; heading?: number }[] };
    expect(reroute.locations[0]?.heading).toBe(270);
    expect(reroute.locations[1]?.lat).toBeCloseTo(h.destination.lat, 5);
    const g = guidanceOf(h.engine.state);
    expect(h.engine.state.kind).toBe("guiding");
    expect(g.offRoute).toBe(false);
    expect(g.offline).toBe(false);
    expect(g.route.stops).toHaveLength(1);
    expect(g.nextStop.maneuver).toBe("arrive");
    h.engine.dispose();
  });

  test("without signal it keeps guiding from the cached Route, then re-routes when signal returns", async () => {
    const h = setup();
    h.fixes.push({ ...ORIGIN, at: Date.now(), accuracyM: 5 });
    await h.engine.start(h.destination);
    const cachedShape = guidanceOf(h.engine.state).route.shape;

    h.valhalla.behavior = "no-signal";
    leaveRoute(h);
    await settle();
    const g = guidanceOf(h.engine.state);
    expect(h.engine.state.kind).toBe("guiding");
    expect(g.offRoute).toBe(true);
    expect(g.offline).toBe(true);
    expect(g.route.shape).toBe(cachedShape);
    expect(g.nextStop.street).toBe("Beta Street");
    expect(g.metersLeft).toBeGreaterThan(1300);

    h.valhalla.behavior = "ok";
    h.network.set(false);
    h.network.set(true);
    await settle();
    const back = guidanceOf(h.engine.state);
    expect(back.offline).toBe(false);
    expect(back.offRoute).toBe(false);
    expect(back.route.shape).not.toBe(cachedShape);
    h.engine.dispose();
  });

  test("a reload with no signal resumes guidance from the device cache", async () => {
    const store = new InMemoryStore();
    const h = setup({ store });
    h.fixes.push({ ...ORIGIN, at: Date.now(), accuracyM: 5 });
    await h.engine.start(h.destination);
    h.engine.dispose();

    const again = setup({ store });
    again.valhalla.behavior = "no-signal";
    again.network.set(false);
    expect(again.engine.state.kind).toBe("guiding");
    const [fix] = traceAlong(h.leg.points, { speedMps: 15, startAt: Date.now(), fromMeters: 1200, toMeters: 1200 });
    again.fixes.push(fix as Fix);
    const g = guidanceOf(again.engine.state);
    expect(g.nextStop.street).toBe("Gamma Lane");
    expect(g.offline).toBe(true);
    expect(again.valhalla.requests).toHaveLength(0);
    again.engine.dispose();
  });
});

describe("turn sounds", () => {
  beforeEach(() => vi.useFakeTimers({ now: T0 }));
  afterEach(() => vi.useRealTimers());

  test("approach scales with speed, every sound is emitted the lead before it is heard, then arrival", async () => {
    const h = setup();
    h.fixes.push({ ...ORIGIN, at: Date.now(), accuracyM: 5 });
    await h.engine.start(h.destination);
    const startedAt = Date.now();
    const speed = 15;
    const trace = traceAlong(h.leg.points, { speedMps: speed, startAt: startedAt });
    for (const fix of trace) {
      vi.setSystemTime(fix.at);
      h.fixes.push(fix);
      await vi.advanceTimersByTimeAsync(999);
    }
    await vi.advanceTimersByTimeAsync(2000);

    expect(h.sounds.map((s) => `${s.event.sound}:${s.event.stop?.street}`)).toEqual([
      "approach:Beta Street",
      "turn-now:Beta Street",
      "approach:Gamma Lane",
      "turn-now:Gamma Lane",
      "arrived:Invented Cafe",
    ]);
    for (const { event, emittedAt } of h.sounds) expect(event.heardAt - emittedAt).toBe(LEAD_MS);

    // Heard where the car is the approach (or turn-now) distance before the Stop, give or take a metre.
    const [approach, turnNow] = h.sounds;
    const metersAtHeard = (s: typeof approach) => speed * (((s?.event.heardAt ?? 0) - startedAt) / 1000);
    expect(1000 - metersAtHeard(approach)).toBeCloseTo(approachMeters(speed), -0.5);
    expect(1000 - metersAtHeard(turnNow)).toBeCloseTo(turnNowMeters(speed), -0.5);
    expect(approachMeters(30)).toBeGreaterThan(approachMeters(15));

    expect(h.engine.state).toEqual({ kind: "arrived", destination: h.destination });
    expect(h.engine.recentDestinations()[0]?.name).toBe("Invented Cafe");
    expect(h.store.get("vela.nav.route")).toBeUndefined();
    h.engine.dispose();
  });
});

describe("waypoints, errors and places", () => {
  test("addWaypoint re-routes through the place, before the Destination", async () => {
    const h = setup();
    h.fixes.push({ ...ORIGIN, at: Date.now(), accuracyM: 5 });
    await h.engine.start(h.destination);
    const fuel: Place = { name: "Invented Fuel", ...destinationPoint(ORIGIN, 45, 800) };
    await h.engine.addWaypoint(fuel);
    const body = h.valhalla.routeRequests()[1]?.body as { locations: { lat: number }[] };
    expect(body.locations.map((l) => l.lat.toFixed(4))).toEqual(
      [ORIGIN.lat, fuel.lat, h.destination.lat].map((x) => x.toFixed(4)),
    );
    const g = guidanceOf(h.engine.state);
    expect(g.nextStop.maneuver).toBe("arrive");
    expect(g.nextStop.street).toBe("Invented Fuel");
    expect(g.thenStop?.street).toBe("Invented Cafe");
    h.engine.dispose();
  });

  test("addWaypoint without signal rejects and keeps the current Route", async () => {
    const h = setup();
    h.fixes.push({ ...ORIGIN, at: Date.now(), accuracyM: 5 });
    await h.engine.start(h.destination);
    h.valhalla.behavior = "no-signal";
    await expect(h.engine.addWaypoint({ name: "Invented Diner", ...ORIGIN })).rejects.toThrow("No signal");
    expect(guidanceOf(h.engine.state).route.stops).toHaveLength(3);
    h.engine.dispose();
  });

  test("starting without signal or without a route reports an error", async () => {
    const h = setup();
    h.fixes.push({ ...ORIGIN, at: Date.now(), accuracyM: 5 });
    h.valhalla.behavior = "no-signal";
    await h.engine.start(h.destination);
    expect(h.engine.state).toMatchObject({ kind: "error", message: expect.stringContaining("No signal") });
    h.valhalla.behavior = "no-route";
    await h.engine.start(h.destination);
    expect(h.engine.state).toMatchObject({ kind: "error", message: expect.stringContaining("No path") });
    h.engine.end();
    expect(h.engine.state.kind).toBe("idle");
    h.engine.dispose();
  });

  test("saved places replace by name; recent destinations move to the top", () => {
    const h = setup();
    const a: Place = { name: "x", lat: 10.1, lng: 20.1 };
    const b: Place = { name: "y", lat: 10.2, lng: 20.2 };
    h.engine.savePlace("Home", a);
    h.engine.savePlace("home", b);
    expect(h.engine.savedPlaces()).toEqual([{ name: "home", lat: 10.2, lng: 20.2 }]);
    h.engine.dispose();
  });

  test("search is biased to the current position", async () => {
    const urls: string[] = [];
    const fixes = new ManualFixSource();
    const engine = createNavEngine({
      config,
      fixes,
      store: new InMemoryStore(),
      network: new SwitchableNetwork(),
      fetcher: async (input) => {
        urls.push(String(input));
        return new Response(
          JSON.stringify({
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                geometry: { type: "Point", coordinates: [20.01, 10.02] },
                properties: { name: "Invented Bakery", street: "Alpha Road", housenumber: "7", city: "Nowhere" },
              },
            ],
          }),
        );
      },
    });
    fixes.push({ ...ORIGIN, at: Date.now(), accuracyM: 5 });
    const results = await engine.search("bakery");
    expect(urls[0]).toBe("https://photon.test/api?q=bakery&limit=8&lat=10.00000&lon=20.00000");
    expect(results).toEqual([{ name: "Invented Bakery", lat: 10.02, lng: 20.01, address: "7 Alpha Road, Nowhere" }]);
    engine.dispose();
  });
});

test("straightLeg fixture ends at its target", () => {
  const to = destinationPoint(ORIGIN, 33, 1234);
  const leg = straightLeg(ORIGIN, to, "t");
  expect(leg.end.lat).toBeCloseTo(to.lat, 6);
});
