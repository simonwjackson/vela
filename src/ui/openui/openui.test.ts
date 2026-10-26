import { afterEach, describe, expect, test } from "vitest";
import { MAX_BYTES, checkProgram } from "./gate";
import { type Live, createLive } from "./live";
import { patch, read } from "./program";
import { APPROVED_PROGRAMS } from "./programs";
import { createHost, draw } from "./render";
import { sceneById } from "./scenes";

const lives: Live[] = [];
const liveOf = (scene: string): Live => {
  const s = sceneById(scene);
  if (!s) throw new Error(scene);
  const l = createLive(s, { still: true });
  lives.push(l);
  return l;
};
afterEach(() => {
  for (const l of lives.splice(0)) l.dispose();
  document.body.replaceChildren();
});

const near = APPROVED_PROGRAMS.find((p) => p.id === "near")?.program ?? "";
const codes = (program: string, scene = "near"): string[] => checkProgram(program, liveOf(scene)).map((p) => p.code);
/** near with one statement replaced. */
const nearWith = (statements: string): string => patch(near, statements);

describe("the approved states as programs", () => {
  test.each(APPROVED_PROGRAMS.map((p) => [p.id, p.program]))("%s passes the static gate", (id, program) => {
    expect(checkProgram(program, liveOf(id))).toEqual([]);
  });

  test.each(APPROVED_PROGRAMS.map((p) => [p.id, p.program]))("%s draws only known parts, and Talk once", (id, program) => {
    const host = createHost(document.body);
    const root = read(program).root;
    if (!root) throw new Error("no root");
    draw(host, root, liveOf(id));
    expect(host.frame.querySelectorAll("[data-oui-unknown]").length).toBe(0);
    expect(host.frame.querySelectorAll("[data-talk]").length).toBe(1);
  });
});

describe("the gate refuses what Signal does not allow", () => {
  test("two Heroes", () => expect(codes(nearWith('card = Card([facts])\nfacts = Facts([f])\nf = Fact("Left", "trip.left")\nanswer = Stack([Hero("nav.next"), Hero("trip.left")])'))).toContain("one-hero"));
  test("no answer in primary", () => expect(codes(nearWith('answer = Card([Text("Hello")])'))).toEqual(expect.arrayContaining(["one-answer", "card-slot"])));
  test("a key that does not exist", () => expect(codes(nearWith('answer = Hero("fuel.level")'))).toContain("type-mismatch"));
  test("a key with no data now", () => expect(codes(nearWith('answer = Hero("car.range", "to empty")'))).toContain("no-data"));
  test("a component in the wrong slot", () => expect(codes(nearWith("trip = Listening()"))).toContain("wrong-component"));
  test("three cards in the card slot", () =>
    expect(codes(nearWith('card = Stack([Listening(), Card([Text("One")]), Card([Text("Two")])])'))).toContain("too-many-cards"));
  test("an action step Vela does not have", () =>
    expect(codes(nearWith('card = CoDriver("Open the map?", Actions([Button("Open", @OpenUrl("https://example.com"))]))'))).toContain("action"));
  test("two primary Buttons on one surface", () =>
    expect(codes(nearWith('card = CoDriver("Stop here?", Actions([Button("Add stop", @AddStop("dest"), "primary"), Button("Skip", @ToCoDriver("Skip"), "primary")]))'))).toContain("one-primary"));
  test("all caps, middle dots and exclamation marks", () => {
    expect(codes(nearWith('card = Card([Text("RAIN AHEAD")])'))).toContain("copy");
    expect(codes(nearWith('card = Card([Text("Rain · 2 km")])'))).toContain("copy");
    expect(codes(nearWith('card = Card([Text("Rain ahead!")])'))).toContain("copy");
  });
  test("a typed live value", () => expect(codes(nearWith('card = Card([Text("You arrive at 2:17 PM.")])'))).toContain("typed-value"));
  test("$variables, and the byte limit", () => {
    expect(codes(`$x = "a"\n${near}`)).toContain("no-state");
    expect(codes(`${near}\n${"x = Text(\"a\")\n".repeat(Math.ceil(MAX_BYTES / 14))}`)).toEqual(["too-large"]);
  });
  test("a Fact that repeats the answer, and a line the Hero ignores", () => {
    expect(codes(nearWith('answer = Stack([Hero("nav.next"), Facts([Fact("Turn", "next.road")])])'))).toContain("repeats");
    expect(codes(nearWith('answer = Hero("nav.next", "to Northgate")'))).toContain("ignored");
  });
  test("the stage on a route", () => expect(codes(nearWith("answer = NowPlaying()"))).toContain("stage-on-route"));
});

describe("the renderer", () => {
  test("a patch replaces one statement, keeps the rest, and the frame patches in place", () => {
    const live = liveOf("near");
    const host = createHost(document.body);
    draw(host, read(near).root as NonNullable<ReturnType<typeof read>["root"]>, live);
    const answer = host.frame.querySelector(".answer");
    const next = patch(near, 'card = CoDriver("Rain from 2:05 PM. I will keep it quiet.")');
    expect(next).toContain('answer = Hero("nav.next")');
    expect(next).not.toContain("Listening()");
    draw(host, read(next).root as NonNullable<ReturnType<typeof read>["root"]>, live);
    expect(host.frame.querySelector(".codriver-text")?.textContent).toBe("Rain from 2:05 PM. I will keep it quiet.");
    expect(host.frame.querySelector(".answer")).toBe(answer);
  });

  test("bound values follow the live data; the program does not change", () => {
    const live = liveOf("near");
    const host = createHost(document.body);
    const root = read(near).root as NonNullable<ReturnType<typeof read>["root"]>;
    draw(host, root, live);
    expect(host.frame.querySelector(".answer .big")?.textContent).toBe("400m");
    for (let i = 0; i < 10; i++) live.tick();
    draw(host, root, live);
    expect(host.frame.querySelector(".answer .big")?.textContent).toBe("250m");
  });

  test("Talk is added when the program has no base", () => {
    const host = createHost(document.body);
    draw(host, read('root = Screen(stage)\nstage = Stage(Quiet("Parked"))').root as NonNullable<ReturnType<typeof read>["root"]>, liveOf("near"));
    expect(host.frame.querySelectorAll(".talk-base [data-talk]").length).toBe(1);
  });
});
