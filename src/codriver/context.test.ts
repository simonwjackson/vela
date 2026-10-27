import type { ContextUpdate, ViaGuidance, Weather } from "../contract";
import { guidance } from "../events/fixtures";
import { fakes } from "../ui/dev/fakes";
import { CONTEXT_MAX_BYTES, contextChanged, contextSnapshot } from "./context";
import { createSurfaceLink } from "./surface-link";
import { InMemorySocketServer } from "./testing/in-memory-socket";
const vias: ViaGuidance[] = Array.from({ length: 4 }, (_, i) => ({ place: { name: `Invented Stop ${i}`, lat: 10 + i / 100, lng: 20 }, metersTo: (i + 1) * 2000, secTo: (i + 1) * 120, arriveAt: 1000000 + (i + 1) * 120000 }));
function setup() {
  const f = fakes(); const server = new InMemorySocketServer();
  f.nav.set({ kind: "guiding", guidance: guidance({ nextVias: vias }) });
  f.car.set({ kind: "connected" }, { at: 1000000, fuelPercent: 50, rangeKm: 250, ambientC: 12, mil: false, dtcs: [] });
  f.weather.set(Array.from({ length: 4 }, (_, i) => ({ fromKm: i * 10, toKm: (i + 1) * 10, kind: i % 2 ? "rain" : "clear", label: i % 2 ? "Rain" : "Clear", current: i === 0 })));
  const weather: Weather = { get stretches() { return f.weather.stretches; }, fetchedAt: 900000, subscribe: (fn) => f.weather.subscribe(fn) };
  const link = createSurfaceLink({ origin: "https://assistant.test", path: "/surface", connect: server.connect, coDriver: () => "guide", nav: f.nav, listening: f.listening, car: f.car, weather });
  const snapshot = () => contextSnapshot({ state: f.nav.state, car: f.car, weather, nowPlaying: f.listening.nowPlaying });
  const messages = () => server.latest.sent.filter((m) => m.type === "context.update") as unknown as ContextUpdate[];
  return { f, server, weather, link, snapshot, messages, open() { link.start(); server.latest.accept(); } };
}
afterEach(() => vi.useRealTimers());
test("context sends the car's known values, three upcoming stops and three weather stretches", () => {
  const h = setup();
  try {
    h.open(); const context = h.messages()[0];
    expect(context?.car).toEqual({ fuelPercent: 50, rangeKm: 250, ambientC: 12, mil: false, dtcCount: 0 });
    expect(context?.stops).toEqual(vias.slice(0, 3).map((via) => ({ name: via.place.name, kmAhead: via.metersTo / 1000, arriveAt: via.arriveAt })));
    expect(context?.weather).toEqual({ fetchedAt: 900000, stretches: h.weather.stretches.slice(0, 3).map(({ fromKm, toKm, kind, label }) => ({ fromKm, toKm, kind, label })) });
  } finally { h.link.close(); }
});
test("fuel and Range thresholds accumulate against the last sent values, not each reading", async () => {
  vi.useFakeTimers(); const h = setup();
  try {
    h.open(); h.f.car.set({ kind: "connected" }, { fuelPercent: 50.6, rangeKm: 253 });
    await vi.advanceTimersByTimeAsync(10000); expect(h.messages()).toHaveLength(1);
    h.f.car.set({ kind: "connected" }, { fuelPercent: 50.9, rangeKm: 254.9 });
    expect(h.messages()).toHaveLength(1);
    h.f.car.set({ kind: "connected" }, { fuelPercent: 51 }); expect(h.messages()).toHaveLength(2);
    h.f.car.set({ kind: "connected" }, { rangeKm: 260 });
    await vi.advanceTimersByTimeAsync(9999); expect(h.messages()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1); expect(h.messages()).toHaveLength(3);
    expect(h.messages().at(-1)?.car?.rangeKm).toBe(260);
  } finally { h.link.close(); }
});
test("stop, weather, MIL and stored-code changes coalesce to the latest snapshot every ten seconds", async () => {
  vi.useFakeTimers(); const h = setup();
  try {
    h.open();
    h.f.nav.set({ kind: "guiding", guidance: guidance({ nextVias: vias.slice(1) }) });
    h.f.weather.set([{ fromKm: 0, toKm: 30, kind: "storm", label: "Storm", current: true }]);
    h.f.car.set({ kind: "connected" }, { mil: true, dtcs: ["P0133"], ambientC: 13 });
    expect(h.messages()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(9999); expect(h.messages()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1); expect(h.messages()).toHaveLength(2);
    expect(h.messages().at(-1)).toMatchObject({ car: { mil: true, dtcCount: 1, ambientC: 13 }, weather: { stretches: [{ kind: "storm" }] }, stops: [{ name: "Invented Stop 1" }, { name: "Invented Stop 2" }, { name: "Invented Stop 3" }] });
    h.f.car.set({ kind: "unavailable" }); h.f.nav.set({ kind: "idle" }); h.f.weather.set([]);
    await vi.advanceTimersByTimeAsync(10000);
    expect(h.messages().at(-1)).toMatchObject({ car: {}, stops: [], weather: { stretches: [] } });
  } finally { h.link.close(); }
});
test("pending snapshots cancel on close and reconnect sends fresh context after hello", async () => {
  vi.useFakeTimers(); const h = setup();
  h.open(); h.f.car.set({ kind: "connected" }, { fuelPercent: 51 }); h.server.latest.drop(1006);
  await vi.advanceTimersByTimeAsync(1000); h.server.latest.accept();
  expect(h.server.latest.types().slice(0, 2)).toEqual(["surface.hello", "context.update"]);
  expect(h.messages()[0]?.car?.fuelPercent).toBe(51);
  h.f.car.set({ kind: "connected" }, { fuelPercent: 52 }); const socket = h.server.latest; h.link.close();
  await vi.advanceTimersByTimeAsync(30000); expect(socket.types().filter((t) => t === "context.update")).toHaveLength(1);
});
test("whole context stays under 2 KB with escaped Unicode copy and huge optional metadata", () => {
  const h = setup(); const long = '\u0001😀"'.repeat(3000);
  const state = guidance({ nextVias: vias.map((via) => ({ ...via, place: { ...via.place, name: long } })) });
  h.f.nav.set({ kind: "guiding", guidance: { ...state, nextStop: { ...state.nextStop, instruction: long }, route: { ...state.route, destination: { ...state.route.destination, name: long, address: long } } } });
  h.f.listening.set({ transport: "playing", positionSec: 5, item: { source: "music", id: long, title: long, by: long, from: long, artUrl: `https://covers.test/${long}` } });
  h.f.weather.set(h.weather.stretches.map((s) => ({ ...s, label: long })));
  const message = h.snapshot();
  expect(new TextEncoder().encode(JSON.stringify(message)).length).toBeLessThan(CONTEXT_MAX_BYTES);
  expect(message.stops).toHaveLength(3); expect(message.weather?.stretches).toHaveLength(3); expect(message.car?.fuelPercent).toBe(50);
  expect(message.nowPlaying?.item.artUrl).toBeUndefined(); expect(message.trip?.destination.address).toBeUndefined();
  h.link.close();
});
test("small numerical movement is not a new stop or stretch, but a new forecast is meaningful", () => {
  const h = setup(); const before = h.snapshot();
  h.f.weather.set(h.weather.stretches.map((s) => ({ ...s, fromKm: s.fromKm + 0.1, toKm: s.toKm + 0.1 })));
  expect(contextChanged(before, h.snapshot())).toBe(false);
  expect(contextChanged(before, { ...before, weather: { stretches: before.weather?.stretches ?? [], fetchedAt: 1000001 } })).toBe(true);
  h.link.close();
});

test("exact fuel and Range thresholds trigger, while sub-threshold changes do not", () => {
  const h = setup(); const before = h.snapshot();
  const car = before.car ?? {};
  expect(contextChanged(before, { ...before, car: { ...car, fuelPercent: 50.999 } })).toBe(false);
  expect(contextChanged(before, { ...before, car: { ...car, fuelPercent: 51 } })).toBe(true);
  expect(contextChanged(before, { ...before, car: { ...car, rangeKm: 254.999 } })).toBe(false);
  expect(contextChanged(before, { ...before, car: { ...car, rangeKm: 255 } })).toBe(true);
  h.link.close();
});
