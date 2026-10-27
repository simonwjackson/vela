import { MOMENT_RULES } from "../../contract/moments";
import type { MomentShow } from "../app/contract";
import { mount } from "../app/mount";
import { renderScreen } from "../app/render";
import { fakes } from "../dev/fakes";
import { NOW, fixtures } from "../dev/fixtures";
import { MOMENT_SCENES, carReadings, dataOf, momentScene, passTurn, setUp } from "../dev/moments";
import { scenario } from "../dev/scenarios";
import { APPROVED_EXAMPLES, COMPOSED_EXAMPLES, MOMENT_EXAMPLES } from "./examples";
import { MAX_BYTES, checkProgram } from "./gate";
import { MAX_LIFE_S } from "./keys";
import { type Now, type Road, accept, asksFor, dismiss, event, events, tick } from "./lifecycle";
import { patch, read } from "./program";
import { countWords } from "./reflow";
import { DEFAULT_TREE, drawTree } from "./render";
import { buildLibrary } from "./vocabulary";

const settle = () => new Promise((r) => setTimeout(r, 5));
afterEach(() => document.body.replaceChildren());

/** A scene's fakes and data. */
function sceneData(id: string, stress = false) {
  const sc = momentScene(id);
  if (!sc) throw new Error(id);
  const f = fakes();
  const setup = setUp(sc, f, stress);
  return { f, setup, show: sc.show(stress), data: dataOf(f, setup) };
}
const codes = (program: string, id = "fuel", show: { when?: MomentShow["when"]; chip?: string | undefined } = {}): string[] => {
  const s = sceneData(id);
  const { chip, ...rest } = { chip: s.show.chip, ...show };
  return checkProgram({ program, show: { ...s.show, ...rest, ...(chip === undefined ? { chip: undefined } : { chip }) } as MomentShow, data: s.data }).map((p) => p.code);
};
const FUEL = COMPOSED_EXAMPLES[0]?.[1] ?? "";
const draw = (program: string, id = "fuel") => {
  const root = read(program).root;
  if (!root) throw new Error("no root");
  const app = document.createElement("main");
  app.className = "app";
  app.append(...drawTree(root, sceneData(id).data, { keyboard: 0, close: true }).els);
  document.body.append(app);
  return app;
};

describe("the vocabulary and its examples", () => {
  test("8 examples: the 5 approved states and 3 composed shapes", () => {
    expect(MOMENT_EXAMPLES).toHaveLength(8);
    expect(new Set(MOMENT_EXAMPLES).size).toBe(8);
  });
  test("the library builds in Node, with every action", () => {
    const schema = buildLibrary().toJSONSchema() as { $defs: Record<string, unknown>; actions: Record<string, unknown> };
    expect(Object.keys(schema.actions).sort()).toEqual(["ConnectCar", "Dismiss", "FindStop", "OpenSheet", "Resume"]);
    expect(schema.$defs.Screen).toBeDefined();
  });
  test.each(APPROVED_EXAMPLES.map(([s, p]) => [s, p]))("approved %s passes the gate and draws Vela's own screen whole", (id, program) => {
    const f = fakes();
    const setup = scenario(id)?.setup(f, fixtures(false), false) ?? {};
    const data = dataOf(f, setup);
    expect(checkProgram({ program, show: { say: "As it is.", when: "now" }, data })).toEqual([]);
    const root = read(program).root;
    if (!root) throw new Error("no root");
    const drawn = drawTree(root, data, { keyboard: 0 });
    expect(drawn.free).toBe(false);
    const own = renderScreen(data.screen, { keyboard: 0 });
    expect(drawn.els.map((e) => e.outerHTML)).toEqual(own.map((e) => e.outerHTML));
  });
  test.each(MOMENT_SCENES.filter((s) => s.id !== "refused").map((s) => [s.id]))("scene %s passes the static gate, normal and worst case", (id) => {
    for (const stress of [false, true]) {
      const s = sceneData(id, stress);
      expect(checkProgram({ program: s.show.program, show: s.show, data: s.data })).toEqual([]);
    }
  });
  test("the refused scene is refused, with problems the model can act on", () => {
    const c = codes(momentScene("refused")?.show(false).program ?? "", "refused", { when: "now" });
    expect(c).toContain("one-lead");
    expect(c).toContain("turn-wait");
  });
});

describe("the calm rules gate", () => {
  test("numbers come from MOMENT_RULES", () => expect(MOMENT_RULES.supportingItems).toBe(2));
  test("a chip has at most chipWords words", () => expect(codes(FUEL, "fuel", { chip: "Fuel is low now" })).toContain("chip"));
  test("near a turn the Moment waits, or the turn leads", () => {
    expect(codes(FUEL, "fuel", { when: "now" })).toContain("turn-wait");
    expect(codes(FUEL, "fuel", { when: "after-turn", chip: undefined })).toContain("when");
    expect(codes('root = Screen([Lead(Hero("nav.next")), TripRow()])', "fuel", { when: "now" })).not.toContain("turn-wait");
  });
  test("at most 2 supporting items, and which to cut", () => {
    const s = sceneData("fuel");
    const p = checkProgram({ program: patch(FUEL, 'root = Screen([lead, short, act, a, b, trip])\na = Facts([Fact("Fuel", "car.fuel")])\nb = Facts([Fact("Outside", "car.ambient")])'), show: s.show, data: s.data });
    expect(p.find((x) => x.code === "items")?.message).toMatch(/Cut a and b/);
  });
  test("the Lead's label has at most 4 words", () =>
    expect(codes(patch(FUEL, 'lead = Lead(Stack([Row([Glyph("fuel"), Value("car.range")]), Label("of fuel left in the tank")]))'))).toContain("lead-label"));
  test("no whole phrase of say on screen", () =>
    expect(codes(patch(FUEL, 'root = Screen([lead, note, trip])\nnote = Text("Shall I find fuel on the way")'))).toContain("repeats-say"));
  test("every fact once", () => expect(codes(patch(FUEL, 'short = Row([Bar("trip"), Fact("Short by", "range.short")])'))).toContain("repeats"));
  test("a key with no data now", () => {
    const s = sceneData("fuel");
    s.f.car.set({ kind: "connect" }, {});
    expect(checkProgram({ program: FUEL, show: s.show, data: dataOf(s.f) }).map((p) => p.code)).toContain("no-data");
  });
  test("a part where it may not go, an unknown action, $state and the byte limit", () => {
    expect(codes(patch(FUEL, "short = Row([Listening()])"))).toContain("wrong-component");
    expect(codes(patch(FUEL, 'act = Actions([Button("Go", @Navigate("x"))])'))).toContain("unknown-function");
    expect(codes(`$x = "a"\n${FUEL}`)).toContain("no-state");
    expect(codes(`${FUEL}\n${'x = Text("a")\n'.repeat(Math.ceil(MAX_BYTES / 14))}`)).toEqual(["too-large"]);
  });
  test("the place name sits beside its distance", () =>
    expect(codes('root = Screen([Lead(Row([Glyph("pin"), Value("stops.left")])), Facts([Fact("In", "stop.next.in")]), TripRow()])', "stops", { when: "now" })).toContain("name-beside"));
});

describe("the renderer", () => {
  test("a free Moment: the body holds the blocks, the trip row holds Talk, the X leads the top row", () => {
    const app = draw(FUEL);
    expect(app.querySelector(".m-lead .m-big")?.textContent).toBe("30km");
    expect(app.querySelectorAll("[data-talk]").length).toBe(1);
    expect(app.querySelector(".trip [data-talk]")).not.toBeNull();
    expect(app.querySelector('.top .chip-slot > [data-action="moment-close"]')).not.toBeNull();
    // Nothing shows the turn, so the trip row leads with it.
    expect(app.querySelector(".trip .m-trip-turn")?.textContent).toBe("400m");
  });
  test("a bound value with its unit is one word; the Lead and the base row do not count", () => {
    // "Short by" + 1, "Find fuel", "Not now".
    expect(countWords(draw(FUEL))).toBe(7);
  });
  test("Details is one button until a merged statement opens it; open, it takes the items' place", () => {
    const src = momentScene("arrived")?.show(false).program ?? "";
    let app = draw(src, "arrived");
    expect(app.querySelector('.m-details [data-action="moment-details"]')).not.toBeNull();
    expect(app.textContent).toContain("Average");
    document.body.replaceChildren();
    app = draw(patch(src, 'car = Details("Car", [Facts([Fact("Fuel", "car.fuel"), Fact("Range", "car.range")])], true)'), "arrived");
    expect(app.querySelector(".m-details-body")?.textContent).toContain("62%");
    expect(app.textContent).not.toContain("Average");
  });
  test("the default tree is Vela's own screen", () => {
    const { data } = sceneData("fuel");
    expect(drawTree(DEFAULT_TREE, data, { keyboard: 0 }).els.map((e) => e.outerHTML)).toEqual(renderScreen(data.screen, { keyboard: 0 }).map((e) => e.outerHTML));
  });
  test("a Sequence lists the stops ahead, then the destination", () => {
    const app = draw(momentScene("stops")?.show(false).program ?? "", "stops");
    expect([...app.querySelectorAll(".m-seq-item b")].map((b) => b.textContent)).toEqual(["Harbour Fuel", "Fernley Market", "Coast Road Services", "Port Ellery"]);
  });
});

describe("the lifecycle", () => {
  const m = (more: Partial<MomentShow> = {}): MomentShow => ({ type: "moment.show", id: "a", program: "", say: "Hello.", when: "now", until: { seconds: 60 }, cause: { event: "e" }, ...more });
  const close = { turn: { index: 1, meters: 400, arrive: false } };
  const at = (t: number, road: Road = {}, visible = true): Now => ({ at: t, road, visible });
  test("now: shows at once and asks to speak an event Moment", () => {
    const s = accept(m(), at(0, close));
    expect(s.phase.kind).toBe("showing");
    expect(s.effects).toEqual([{ kind: "speak", text: "Hello." }]);
  });
  test("silent and Talk Moments do not speak", () => {
    expect(accept(m({ silent: true }), at(0)).effects).toEqual([]);
    expect(accept(m({ cause: { talk: true } }), at(0)).effects).toEqual([]);
  });
  test("after-turn: the chip while a turn is close, the screen (and speech) once none is", () => {
    const w = accept(m({ when: "after-turn", chip: "Fuel low" }), at(0, close));
    expect(w.phase.kind).toBe("waiting");
    expect(w.effects).toEqual([]);
    expect(tick(w.phase, at(1000, { turn: { index: 1, meters: 200, arrive: false } })).phase.kind).toBe("waiting");
    const shown = tick(w.phase, at(2000, { turn: { index: 2, meters: 2400, arrive: false } }));
    expect(shown.phase.kind).toBe("showing");
    expect(shown.effects).toEqual([{ kind: "speak", text: "Hello." }]);
  });
  test("review 2: a new turn index that is also close keeps an after-turn Moment waiting", () => {
    const w = accept(m({ when: "after-turn", chip: "Fuel low" }), at(0, close));
    expect(tick(w.phase, at(1000, { turn: { index: 2, meters: 200, arrive: false } })).phase.kind).toBe("waiting");
  });
  test("after-turn with no close turn shows now", () => expect(accept(m({ when: "after-turn" }), at(0, { turn: { index: 1, meters: 5000, arrive: false } })).phase.kind).toBe("showing"));
  test("review 3: MAX_LIFE_S counts from acceptance; until events end a waiting Moment too", () => {
    const w = accept(m({ when: "after-turn", chip: "Fuel low", until: { event: "stop.added" } }), at(0, close)).phase;
    expect(w.kind).toBe("waiting");
    expect(event(w, "stop.added")).toEqual({ phase: { kind: "none" }, effects: [{ kind: "dismissed", id: "a", by: "until" }] });
    expect(tick(w, at(MAX_LIFE_S * 1000 - 1, close)).phase.kind).toBe("waiting");
    expect(tick(w, at(MAX_LIFE_S * 1000, close)).effects).toEqual([{ kind: "dismissed", id: "a", by: "until" }]);
    // Shown late, it still ends MAX_LIFE_S after acceptance, not after showing.
    const late = tick(accept(m({ until: { event: "x" } }), at(0, {}, false)).phase, at(500_000)).phase;
    expect(late.kind === "showing" && late.endsAt).toBe(MAX_LIFE_S * 1000);
  });
  test("review 4: hidden behind a sheet, nothing starts: no speech, no timer, until it can be seen", () => {
    const h = accept(m({ until: { seconds: 5 } }), at(0, {}, false));
    expect(h.phase.kind).toBe("waiting");
    expect(h.effects).toEqual([]);
    const s = tick(h.phase, at(30_000));
    expect(s.phase.kind === "showing" && s.phase.endsAt).toBe(35_000);
    expect(s.effects).toEqual([{ kind: "speak", text: "Hello." }]);
  });
  test("until seconds, until an event, and dismissals report how it ended", () => {
    const s = accept(m({ until: { seconds: 5 } }), at(0)).phase;
    expect(tick(s, at(4999)).phase.kind).toBe("showing");
    expect(tick(s, at(5000)).effects).toEqual([{ kind: "dismissed", id: "a", by: "until" }]);
    const e = accept(m({ until: { event: "stop.added" } }), at(0)).phase;
    expect(event(e, "arrived").phase.kind).toBe("showing");
    expect(event(e, "stop.added").effects).toEqual([{ kind: "dismissed", id: "a", by: "until" }]);
    expect(dismiss(e, "voice").effects).toEqual([{ kind: "dismissed", id: "a", by: "voice" }]);
  });
  test("events Vela sees", () => {
    const a = { nav: "guiding", turn: 1, via: 1, nextVia: "A", fuel: 7, car: "connect" };
    expect(events(a, { ...a, turn: 2 })).toEqual(["turn.passed"]);
    expect(events(a, { ...a, via: 2 })).toEqual(["stop.added"]);
    expect(events(a, { ...a, via: 0, nextVia: undefined })).toEqual(["stop.reached"]);
    expect(events(a, { ...a, nav: "arrived" })).toEqual(["arrived"]);
    expect(events(a, { ...a, fuel: 80, car: "connected" })).toEqual(["refuelled", "car.connected"]);
  });
  test("the voice opens Details by label", () => {
    expect(asksFor("Show car", "Car")).toBe(true);
    expect(asksFor("open the car", "Car")).toBe(true);
    expect(asksFor("show me the stations", "Car")).toBe(false);
  });
});

describe("on the app mount, over the stand-in SurfaceLink", () => {
  async function app(id: string, opts: { moments?: boolean } = {}) {
    const sc = momentScene(id);
    if (!sc) throw new Error(id);
    const f = fakes();
    const setup = setUp(sc, f, false);
    // Co-driver mode, so event Moments speak; tests of Sounds only switch back.
    f.settings.value = { ...f.settings.value, soundMode: { kind: "co-driver", coDriver: f.settings.value.coDriver } };
    if (opts.moments === false) f.settings.value = { ...f.settings.value, moments: false };
    const root = document.createElement("div");
    document.body.append(root);
    const clock = { t: NOW };
    const unmount = mount(root, f, { now: () => clock.t, ...(setup.initial ? { initial: setup.initial } : {}), ...(setup.memory ? { memory: setup.memory } : {}) });
    await settle();
    const frame = root.querySelector(".app") as HTMLElement;
    return { f, sc, frame, clock, unmount, show: async () => {
        f.moments.show(sc.show(false));
        // The gate loads lazily: wait for Vela's reply (or, with Moments off, a while).
        for (let i = 0; i < 200 && f.moments.sent.length === 0 && f.settings.value.moments; i++) await settle();
        await settle();
      },
    };
  }

  test("an accepted Moment is reported with no problems and drawn; the X dismisses it by tap", async () => {
    const a = await app("arrived");
    await a.show();
    expect(a.f.moments.sent[0]).toEqual(["problems", "m-arrived", []]);
    expect(a.frame.classList.contains("m-free")).toBe(true);
    expect(a.f.coDriver.calls).toContainEqual(["speak", momentScene("arrived")?.show(false).say]);
    (a.frame.querySelector('[data-action="moment-close"]') as HTMLElement).click();
    await settle();
    expect(a.f.moments.sent).toContainEqual(["dismissed", "m-arrived", "tap"]);
    expect(a.frame.classList.contains("m-free")).toBe(false);
    a.unmount();
  });
  test("a refused Moment reports its problems and Vela's screen stays", async () => {
    const a = await app("refused");
    await a.show();
    const [kind, id, problems] = a.f.moments.sent[0] ?? [];
    expect([kind, id]).toEqual(["problems", "m-refused"]);
    expect((problems as unknown as readonly { code: string }[]).length).toBeGreaterThan(0);
    expect(a.frame.classList.contains("m-free")).toBe(false);
    a.unmount();
  });
  test("after-turn: the chip shows while the turn is close, the Moment once it is behind", async () => {
    const a = await app("fuel");
    await a.show();
    expect(a.frame.classList.contains("m-free")).toBe(false);
    expect(a.frame.querySelector(".top .chip")?.textContent).toBe("Fuel low");
    expect(a.f.coDriver.calls.some((c) => c[0] === "speak")).toBe(false);
    passTurn(a.f);
    await settle();
    expect(a.frame.classList.contains("m-free")).toBe(true);
    expect(a.frame.querySelector(".top .chip")).toBeNull();
    expect(a.f.coDriver.calls.some((c) => c[0] === "speak")).toBe(true);
    a.unmount();
  });
  test("\"never mind\" dismisses by voice", async () => {
    const a = await app("engine");
    await a.show();
    expect(a.frame.classList.contains("m-free")).toBe(true);
    // A Talk answer was spoken already: no speech again.
    expect(a.f.coDriver.calls.some((c) => c[0] === "speak")).toBe(false);
    a.f.coDriver.set({ kind: "thinking", said: "Never mind" });
    await settle();
    expect(a.f.moments.sent).toContainEqual(["dismissed", "m-engine", "voice"]);
    a.unmount();
  });
  test("a tap on Details opens it in place", async () => {
    const a = await app("arrived");
    await a.show();
    (a.frame.querySelector('[data-action="moment-details"]') as HTMLElement).click();
    await settle();
    expect(a.frame.querySelector(".m-details-body")?.textContent).toContain("Fuel");
    a.unmount();
  });
  test("with Moments off, a stray moment.show gets no reply and nothing changes", async () => {
    const a = await app("arrived", { moments: false });
    const before = a.frame.innerHTML;
    await a.show();
    expect(a.f.moments.sent).toEqual([]);
    expect(a.frame.innerHTML).toBe(before);
    a.unmount();
  });
  test("the Settings switch flips the setting; the car rows show the readings", async () => {
    const a = await app("arrived");
    a.f.car.set({ kind: "connected" }, carReadings(true));
    (a.frame.querySelector('[data-action="settings-open"]') as HTMLElement).click();
    await settle();
    (a.frame.querySelector('[data-action="moments-toggle"]') as HTMLElement).click();
    await settle();
    expect(a.f.settings.value.moments).toBe(false);
    const text = a.frame.querySelector(".sheet")?.textContent ?? "";
    for (const t of ["Connected", "100%", "1,240 km", "\u221218 °C", "118 °C", "11.2 V", "P0420", "On"]) expect(text).toContain(t);
    a.unmount();
  });
  const waitGate = async () => {
    for (let i = 0; i < 100; i++) await settle();
  };
  test("review 1: switching Moments off while a Moment is checked drops it: no reply, no screen, no speech", async () => {
    const a = await app("arrived");
    a.f.moments.show(a.sc.show(false));
    a.f.settings.set({ moments: false });
    await waitGate();
    expect(a.f.moments.sent).toEqual([]);
    expect(a.frame.classList.contains("m-free")).toBe(false);
    expect(a.f.coDriver.calls.some((c) => c[0] === "speak")).toBe(false);
    a.unmount();
  });
  test("review 4: behind a sheet the Moment waits, unspoken and untimed, then shows when the sheet closes", async () => {
    const a = await app("arrived");
    (a.frame.querySelector('[data-action="settings-open"]') as HTMLElement).click();
    await settle();
    await a.show();
    expect(a.f.moments.sent[0]).toEqual(["problems", "m-arrived", []]);
    expect(a.frame.classList.contains("m-free")).toBe(false);
    expect(a.f.coDriver.calls.some((c) => c[0] === "speak")).toBe(false);
    a.clock.t += 120_000;
    (a.frame.querySelector('[data-action="sheet-close"]') as HTMLElement).click();
    await settle();
    await settle();
    expect(a.frame.classList.contains("m-free")).toBe(true);
    expect(a.f.coDriver.calls).toContainEqual(["speak", a.sc.show(false).say]);
    a.unmount();
  });
  test("review 4: switched to Sounds only after acceptance, the Moment shows without speech", async () => {
    const a = await app("fuel");
    await a.show();
    expect(a.frame.querySelector(".top .chip")?.textContent).toBe("Fuel low");
    a.f.settings.set({ soundMode: { kind: "sounds" } });
    passTurn(a.f);
    await settle();
    expect(a.frame.classList.contains("m-free")).toBe(true);
    expect(a.f.coDriver.calls.some((c) => c[0] === "speak")).toBe(false);
    a.unmount();
  });
  test("review 5: the Connect car chip shows mid-drive when the link needs a tap, once per drive", async () => {
    const a = await app("engine");
    a.f.car.set({ kind: "unavailable" }, {});
    await settle();
    expect(a.frame.querySelector('.top [data-action="car-connect"]')).toBeNull();
    a.f.car.set({ kind: "connect" });
    await settle();
    expect(a.frame.querySelector('.top [data-action="car-connect"]')?.textContent).toBe("Connect car");
    (a.frame.querySelector('.top [data-action="car-connect"]') as HTMLElement).click();
    await settle();
    expect(a.f.car.calls).toEqual([["connect"]]);
    a.f.car.set({ kind: "connected" });
    a.f.car.set({ kind: "connect" });
    await settle();
    expect(a.frame.querySelector('.top [data-action="car-connect"]')).toBeNull();
    a.unmount();
  });
  test("reconnecting is calm: no chip, the Car row in Settings says Reconnecting; a needed tap brings the chip", async () => {
    const a = await app("engine");
    a.f.car.set({ kind: "reconnecting", attempt: 2, retryAt: NOW + 5_000 }, {});
    await settle();
    expect(a.frame.querySelector('.top [data-action="car-connect"]')).toBeNull();
    (a.frame.querySelector('[data-action="settings-open"]') as HTMLElement).click();
    await settle();
    expect(a.frame.querySelector(".talk-car")?.textContent).toContain("Reconnecting");
    expect(a.frame.querySelector(".talk-car [data-action]")).toBeNull();
    expect(a.frame.querySelectorAll(".talk-reading").length).toBe(0);
    (a.frame.querySelector('[data-action="sheet-close"]') as HTMLElement).click();
    a.f.car.set({ kind: "connect", reason: "permission" });
    await settle();
    expect(a.frame.querySelector('.top [data-action="car-connect"]')?.textContent).toBe("Connect car");
    a.unmount();
  });
  test("a chip-only Moment (NoChange with a chip, now) keeps its chip on Vela's own screen while it shows", async () => {
    const a = await app("engine");
    a.f.moments.show({ type: "moment.show", id: "m-rain", program: "root = NoChange()", say: "Rain ahead in about ten minutes.", chip: "Rain ahead", when: "now", until: { seconds: 60 }, cause: { event: "e-weather" } });
    for (let i = 0; i < 200 && a.f.moments.sent.length === 0; i++) await settle();
    await settle();
    expect(a.f.moments.sent[0]).toEqual(["problems", "m-rain", []]);
    expect(a.frame.classList.contains("m-free")).toBe(false);
    expect(a.frame.querySelector(".top .chip")?.textContent).toBe("Rain ahead");
    expect(a.frame.querySelector('.top [data-action="moment-close"]')).not.toBeNull();
    // Vela's own screen stays whole under the top row.
    expect(a.frame.querySelector(".answer")).not.toBeNull();
    (a.frame.querySelector('[data-action="moment-close"]') as HTMLElement).click();
    await settle();
    expect(a.f.moments.sent).toContainEqual(["dismissed", "m-rain", "tap"]);
    expect(a.frame.querySelector(".top .chip")).toBeNull();
    a.unmount();
  });
  test("the Connect car chip shows once per drive", async () => {
    const f = fakes();
    scenario("noroute")?.setup(f, fixtures(false), false);
    f.car.set({ kind: "connect" });
    const root = document.createElement("div");
    document.body.append(root);
    const unmount = mount(root, f, { now: () => NOW });
    await settle();
    const x = fixtures(false);
    const { guidance } = await import("../dev/fixtures");
    f.nav.set({ kind: "guiding", guidance: guidance(x.short.route) });
    await settle();
    expect(root.querySelector('[data-action="car-connect"]')?.textContent).toBe("Connect car");
    (root.querySelector('[data-action="car-connect"]') as HTMLElement).click();
    await settle();
    expect(f.car.calls).toEqual([["connect"]]);
    expect(root.querySelector('.top [data-action="car-connect"]')).toBeNull();
    // Off the route and on again within the same drive state: once per drive.
    f.nav.set({ kind: "rerouting", guidance: guidance(x.short.route) });
    await settle();
    expect(root.querySelector('.top [data-action="car-connect"]')).toBeNull();
    unmount();
  });
});

describe("the weather-ahead scene", () => {
  test.each([[false], [true]])("passes the static gate (worst case: %s), and the marked stretch is a bright span", (stress) => {
    const s = sceneData("weather", stress);
    expect(checkProgram({ program: s.show.program, show: s.show, data: s.data })).toEqual([]);
    const root = read(s.show.program).root;
    if (!root) throw new Error("no root");
    const app = document.createElement("main");
    app.append(...drawTree(root, s.data, { keyboard: 0 }).els);
    const spans = [...app.querySelectorAll<HTMLElement>(".m-seq-span")];
    expect(spans.length).toBe(stress ? 5 : 3);
    expect(spans.filter((x) => x.classList.contains("marked")).length).toBe(stress ? 4 : 1);
    expect(app.querySelectorAll(".m-seq-item.plain").length).toBe(stress ? 1 : 2);
  });
});
