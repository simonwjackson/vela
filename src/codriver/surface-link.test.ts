import { MOMENT_RULES, MOMENT_RULES_TEXT, MOMENT_POSTURES } from "../contract";
import type { Place, VelaConfig, SoundMode } from "../contract";
import { createListeningFixture, settle } from "../audio/testing/listening-fixture";
import { createNavEngine } from "../nav/engine";
import { ORIGIN, SwitchableNetwork, VALHALLA, ValhallaServer } from "../nav/fixtures";
import { destinationPoint } from "../nav/geo";
import { ManualFixSource } from "../nav/position";
import { InMemoryStore } from "../nav/storage";
import { createSurfaceLink } from "./surface-link";
import { InMemorySocketServer } from "./testing/in-memory-socket";

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
  turnSoundLeadMs: 250,
};

const cafe: Place = { name: "Invented Cafe", ...destinationPoint(ORIGIN, 0, 1500) };
const fuel: Place = { name: "Invented Fuel", ...destinationPoint(ORIGIN, 10, 700) };

function setup(path = "/surface") {
  const server = new InMemorySocketServer();
  const fixes = new ManualFixSource();
  fixes.push({ ...ORIGIN, at: Date.now(), accuracyM: 5 });
  const valhalla = new ValhallaServer();
  const places: Record<string, Place> = { cafe, fuel };
  const nav = createNavEngine({
    config,
    fixes,
    store: new InMemoryStore(),
    network: new SwitchableNetwork(),
    fetcher: valhalla.fetch,
    search: async (q) => (places[q] ? [places[q] as Place] : []),
  });
  const audio = createListeningFixture();
  let coDriver = "navigator";
  let soundMode: SoundMode = { kind: "sounds" };
  let clock = Date.now();
  const link = createSurfaceLink({
    origin: config.origins.assistant,
    path,
    connect: server.connect,
    coDriver: () => coDriver,
    soundMode: () => soundMode,
    now: () => clock,
    nav,
    listening: audio.listening,
    initialBackoffMs: 1_000,
    maxBackoffMs: 8_000,
  });
  return {
    server,
    nav,
    audio,
    link,
    elapse(ms: number) { clock += ms; link.refreshContext(); },
    mode(value: SoundMode) { soundMode = value; link.refreshContext(); },
    choose(id: string) {
      coDriver = id;
    },
    dispose() {
      link.close();
      nav.dispose();
      audio.listening.dispose();
    },
  };
}

/** Run one tool call and return its result frame. */
async function call(h: ReturnType<typeof setup>, name: string, args: unknown) {
  const socket = h.server.latest;
  const id = `call-${socket.sent.length}`;
  socket.push({ type: "tool.call", id, name, args });
  for (let i = 0; i < 50; i++) {
    const result = socket.sent.find((m) => m.type === "tool.result" && m.id === id);
    if (result) return result;
    await new Promise((r) => setTimeout(r, 0));
  }
  throw new Error(`no result for ${name}`);
}

afterEach(() => vi.useRealTimers());

test("hello names the Co-driver and every car tool, then context follows", () => {
  const h = setup();
  h.link.start();
  const socket = h.server.latest;
  expect(socket.url).toBe("wss://assistant.test/surface");
  socket.accept();
  const [hello, context] = socket.sent;
  expect(hello).toMatchObject({ type: "surface.hello", surface: "vela", version: 1, coDriver: "navigator" });
  expect((hello?.tools as { name: string }[]).map((t) => t.name)).toEqual([
    "trip.status",
    "playback.control",
    "playback.find",
    "route.setDestination",
    "route.addStop",
    "route.end",
  ]);
  expect(context).toEqual({ type: "context.update", soundMode: { kind: "sounds" }, stops: [] });
  h.dispose();
});

test("the SurfaceLink path comes from the config, on the assistant's origin", () => {
  const h = setup("/people/someone/surface");
  h.link.start();
  expect(h.server.latest.url).toBe("wss://assistant.test/people/someone/surface");
  h.dispose();
});

test("car tools run on tool.call and answer with tool.result", async () => {
  const h = setup();
  h.link.start();
  h.server.latest.accept();

  const set = await call(h, "route.setDestination", { query: "cafe" });
  expect(set).toMatchObject({ ok: true, value: { destination: { name: "Invented Cafe" }, state: "guiding" } });
  // Trip changes share the ten-second whole-context rate limit.
  h.elapse(10000);
  expect(h.server.latest.sent.some((m) => m.type === "context.update" && (m.trip as { destination: Place })?.destination.name === "Invented Cafe")).toBe(true);

  const stop = await call(h, "route.addStop", { query: "fuel", kind: "fuel" });
  expect(stop).toMatchObject({ ok: true, value: { stop: { name: "Invented Fuel" } } });
  const status = await call(h, "trip.status", {});
  expect(status).toMatchObject({ ok: true, value: { state: "guiding", stopsOnTheWay: ["Invented Fuel"], nextVia: { place: { name: "Invented Fuel" } } } });

  const found = await call(h, "playback.find", { source: "music", query: "Gull", play: true });
  expect(found).toMatchObject({ ok: true, value: { playing: "Gull Waltz" } });
  await settle();
  const paused = await call(h, "playback.control", { command: { type: "pause" } });
  expect(paused).toMatchObject({ ok: true });

  expect(await call(h, "route.setDestination", { query: "nowhere" })).toMatchObject({ ok: false, error: expect.stringContaining("No place") });
  expect(await call(h, "playback.control", { command: { type: "explode" } })).toMatchObject({ ok: false });
  expect(await call(h, "route.end", {})).toMatchObject({ ok: true, value: { state: "idle" } });
  h.dispose();
});

test("reconnects with growing backoff, and says hello again", async () => {
  vi.useFakeTimers();
  const h = setup();
  h.link.start();
  h.server.latest.drop(1006);
  expect(h.link.status).toEqual({ kind: "retrying", inMs: 1_000, code: 1006 });
  vi.advanceTimersByTime(1_000);
  expect(h.server.connections).toHaveLength(2);
  h.server.latest.drop(1006);
  expect(h.link.status).toMatchObject({ inMs: 2_000 });
  vi.advanceTimersByTime(2_000);
  h.server.latest.accept();
  expect(h.server.latest.types()[0]).toBe("surface.hello");
  // An open link resets the wait.
  h.server.latest.drop(1011);
  expect(h.link.status).toMatchObject({ inMs: 1_000 });
  h.dispose();
});

test("never reconnects after REPLACED, until the driver takes the link back", () => {
  vi.useFakeTimers();
  const h = setup();
  h.link.start();
  h.server.latest.accept();
  h.server.latest.drop(4000);
  expect(h.link.status).toEqual({ kind: "stopped", code: 4000 });
  expect(h.link.replaced).toBe(true);
  vi.advanceTimersByTime(120_000);
  expect(h.server.connections).toHaveLength(1);

  h.choose("guide");
  h.link.restart();
  expect(h.link.replaced).toBe(false);
  h.server.latest.accept();
  expect(h.server.latest.sent[0]).toMatchObject({ type: "surface.hello", coDriver: "guide" });
  expect(h.server.connections).toHaveLength(2);
  h.dispose();
});


test("context includes Sound mode on connect and coalesces setting changes", () => {
  const f = setup(); f.link.start(); f.server.latest.accept();
  expect(f.server.latest.sent.find((m) => m.type === "context.update")?.soundMode).toEqual({ kind: "sounds" });
  f.mode({ kind: "co-driver", coDriver: "guide" });
  f.elapse(10000);
  expect(f.server.latest.sent.at(-1)?.soundMode).toEqual({ kind: "co-driver", coDriver: "guide" });
  f.dispose();
});

test("capabilities follow hello and switching Moments off suppresses events", () => {
  const f = setup();
  const capabilities = { enabled: true, version: 1, schema: {}, rules: { numbers: MOMENT_RULES, text: MOMENT_RULES_TEXT }, examples: ["root = Frame()"], postures: MOMENT_POSTURES };
  f.link.setCapabilities(capabilities); f.link.start(); f.server.latest.accept();
  expect(f.server.latest.types().slice(0, 3)).toEqual(["surface.hello", "moment.capabilities", "context.update"]);
  expect(f.link.report({ type: "event.report", id: "event-1", kind: "setting-off", context: {} })).toBe(true);
  f.link.setCapabilities({ ...capabilities, enabled: false });
  expect(f.server.latest.sent.at(-1)).toMatchObject({ type: "moment.capabilities", enabled: false });
  expect(f.link.report({ type: "event.report", id: "event-2", kind: "arrived", context: {} })).toBe(false);
  f.dispose();
});
