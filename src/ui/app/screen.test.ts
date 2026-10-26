import { fakes } from "../dev/fakes";
import { NOW, fixtures, guidance } from "../dev/fixtures";
import { SCENARIOS } from "../dev/scenarios";
import type { Guidance, NavState, TalkState } from "./contract";
import { CO_DRIVER_FALLBACK_NAME, coDriverInfo } from "../../codriver/names";
import { inputOf } from "./input";
import {
  FAR_M,
  GPS_LOST_MS,
  NOW_M,
  OVER_LIMIT_MS,
  STATE_IDS,
  type ScreenInput,
  TOAST_MS,
  THEN_M,
  bootScreen,
  coDriverName,
  coDriverRowName,
  overLimit,
  routeError,
  screen,
  viaTicks,
} from "./screen";

/** The mapping's input for a dev scenario: the same fakes the dev page mounts. */
function scenarioInput(id: string, stress: boolean, h = 553): ScreenInput {
  const sc = SCENARIOS.find((s) => s.id === id);
  if (!sc) throw new Error(`no scenario ${id}`);
  const f = fakes();
  const x = fixtures(stress);
  const setup = sc.setup(f, x, stress) ?? {};
  return inputOf(f, {
    now: NOW,
    online: setup.online ?? true,
    ui: { typing: false, library: {}, ...setup.initial },
    memory: { ...setup.memory },
    frame: { h, keyboard: setup.keyboard ? Math.round(h * 0.5) : 0 },
  });
}

describe("which Signal state shows", () => {
  test("the dev scenarios cover every state id", () => {
    expect(SCENARIOS.map((s) => s.id).sort()).toEqual([...STATE_IDS].sort());
    expect(STATE_IDS).toHaveLength(68);
  });

  for (const sc of SCENARIOS.filter((s) => s.id !== "boot-error")) {
    for (const stress of [false, true]) {
      test(`${sc.id}${stress ? " (worst case)" : ""} maps to ${sc.expect ?? sc.id}`, () => {
        expect(screen(scenarioInput(sc.id, stress)).id).toBe(sc.expect ?? sc.id);
      });
    }
  }

  test("boot error: the answer only, no Talk", () => {
    const s = bootScreen("The config has no route server address.");
    expect(s.id).toBe("boot-error");
    expect(s.base.kind).toBe("none");
    expect(s.top).toBeUndefined();
  });
});

describe("the drive answer", () => {
  const x = fixtures(false);
  const at = (meters: number, more: Partial<Guidance> = {}) => {
    const input = scenarioInput("near", false);
    const g = guidance({ ...x.short.route, next: { ...x.short.route.next, meters } }, more);
    return screen({ ...input, nav: { kind: "guiding", guidance: g } });
  };

  test("under 100 m the hero says Now; at 100 m it is a distance", () => {
    expect(at(NOW_M - 1).answer).toMatchObject({ kind: "turn", big: { word: "Now" } });
    expect(at(NOW_M).answer).toMatchObject({ kind: "turn", big: { num: "100", unit: "m" } });
  });

  test("over 2 km the answer becomes the time left, and the trip row names the road", () => {
    expect(at(FAR_M).answer.kind).toBe("turn");
    const far = at(FAR_M + 1);
    expect(far.answer).toMatchObject({ kind: "time", min: 52, next: { road: "Larch Avenue", dist: "2.0 km" } });
    expect(far.base).toMatchObject({ kind: "trip", left: { text: "On Mill Road" } });
    expect(far.id).toBe("far");
  });

  test("a second Stop within 300 m shows as then", () => {
    const input = scenarioInput("near", false);
    const g = guidance({ ...x.short.route, thenStop: { maneuver: "left", street: "Route 9" } });
    const close = screen({ ...input, nav: { kind: "guiding", guidance: g } });
    expect(close.answer).toMatchObject({ thenTurn: { road: "Route 9" } });
    const later = { ...g, thenStop: { ...(g.thenStop as NonNullable<Guidance["thenStop"]>), routeMeters: g.nextStop.routeMeters + THEN_M + 1 } };
    expect(screen({ ...input, nav: { kind: "guiding", guidance: later } }).answer).toMatchObject({ thenTurn: undefined });
  });

  test("the road line is the short form", () => {
    const input = scenarioInput("near", true);
    const g = guidance({ ...fixtures(true).long.route, next: { maneuver: "right", meters: 900, street: "Old Quarry Road toward North Harbour and the East Rim Bypass" } });
    expect(screen({ ...input, nav: { kind: "guiding", guidance: g } }).answer).toMatchObject({ road: "Old Quarry Road" });
  });

  test("GPS: no fix yet waits; an old fix keeps the last answer, stale, with the chip", () => {
    const input = scenarioInput("near", false);
    const { fixAgeMs: _f, ...noFix } = input.readouts;
    expect(screen({ ...input, readouts: noFix }).id).toBe("gps");
    expect(screen({ ...input, readouts: { ...input.readouts, fixAgeMs: GPS_LOST_MS } }).id).not.toBe("gps-lost");
    const lost = screen({ ...input, readouts: { ...input.readouts, fixAgeMs: GPS_LOST_MS + 1 } });
    expect(lost.id).toBe("gps-lost");
    expect(lost.answer).toMatchObject({ kind: "turn", stale: true });
    expect(lost.top?.chip).toMatchObject({ text: "GPS lost", warn: true });
  });

  test("the chip never repeats the answer: off route without signal has no chip", () => {
    const s = screen(scenarioInput("offroute-nosignal", false));
    expect(s.top?.chip).toBeUndefined();
    expect(s.base).toMatchObject({ dim: true, eta: { time: "…" } });
  });

  test("speed readouts show only 3 s over limit + 5", () => {
    const input = scenarioInput("near", false);
    const r = { ...input.readouts, speedKmh: 76, speedLimitKmh: 70 };
    expect(overLimit({ ...r, speedKmh: 75 })).toBe(false);
    expect(overLimit(r)).toBe(true);
    expect(screen({ ...input, readouts: r, memory: { overSince: NOW - OVER_LIMIT_MS + 1 } }).top?.speed).toBeUndefined();
    expect(screen({ ...input, readouts: r, memory: { overSince: NOW - OVER_LIMIT_MS } }).top?.speed).toEqual({ now: "76 km/h", limit: "Limit 70" });
    const { speedLimitKmh: _l, ...noLimit } = r;
    expect(screen({ ...input, readouts: noLimit, memory: { overSince: NOW - 5000 } }).top?.speed).toBeUndefined();
  });

  test("stops on the way: ticks at each stop, and B counts to the next one", () => {
    const s = screen(scenarioInput("via", true));
    expect(s.base).toMatchObject({ kind: "trip", left: { min: 192 }, eta: { via: "Kessler Junction Truck Stop and Travel Plaza Fuel Centre", time: "4:11 PM" } });
    if (s.base.kind !== "trip") throw new Error("trip");
    expect(s.base.ticks.map((t) => Math.round(t * 100))).toEqual([27, 36, 48, 60, 71, 83, 92]);
  });

  test("a stop on the way far from every arrival gets no tick", () => {
    const g = guidance({ ...x.short.route, via: [{ place: { name: "Far", lat: 0.9, lng: -0.9 }, at: 0.5 }] });
    const route = { ...g.route, stops: g.route.stops.filter((s) => s.street !== "Far") };
    expect(viaTicks(route)).toEqual([]);
  });

  test("arrived shows the trip it ends", () => {
    const s = screen(scenarioInput("arrived", true));
    expect(s.base).toMatchObject({ left: { text: "900 km in 11 h 45 min" }, fraction: 1, eta: { lead: "Arrived", time: "1:10 AM" } });
  });

  test("the roundabout glyph carries the exit numeral", () => {
    const s = screen(scenarioInput("roundabout", true));
    expect(s.answer.kind === "turn" && s.answer.icon).toContain(">9</text>");
  });
});

describe("no route", () => {
  test("Where to card: Saved places first, then one Recent destination, at most 3", () => {
    const s = screen(scenarioInput("noroute", true));
    expect(s.card).toMatchObject({ kind: "where", rows: [{ title: "Home" }, { title: "Work" }, { title: "Gran's" }] });
    const one = screen(scenarioInput("plan-noroute-1", false));
    expect(one.card).toMatchObject({ rows: [{ title: "Home", icon: "home" }] });
  });

  test("route errors read as the two plan states", () => {
    expect(routeError("The router could not find a route: No path")).toBe("plan-route-noroad");
    expect(routeError("No signal: Failed to fetch")).toBe("route-unreachable");
    expect(routeError("The router answered HTTP 502 without JSON")).toBe("route-unreachable");
    const s = screen(scenarioInput("route-unreachable", false));
    expect(s.answer).toMatchObject({ kind: "quiet", text: "Can't reach the route server", button: { action: "route-retry" } });
  });

  test("the update chip never interrupts guidance: it shows with no route, and once arrived", () => {
    const input = scenarioInput("update", false);
    expect(screen(input).top?.chip).toMatchObject({ action: "update", text: "Update ready, tap to restart" });
    const ready = (id: string) => {
      const i = scenarioInput(id, false);
      return { ...i, app: { ...i.app, updateReady: true } };
    };
    for (const id of ["near", "now", "reroute", "routing", "gps"]) expect(screen(ready(id)).top?.chip, id).toBeUndefined();
    const arrived = screen(ready("arrived"));
    expect(arrived.top?.chip).toMatchObject({ action: "update" });
    expect(arrived.id).toBe("arrived");
    // A status chip still wins over it.
    expect(screen(ready("sound-blocked")).top?.chip).toMatchObject({ action: "sounds-on" });
  });

  test("Settings: the version row's action follows the update state", () => {
    const input = scenarioInput("settings", false);
    const row = (patch: { updateReady?: boolean; update?: "checking" | "current" }) => {
      const sh = screen({ ...input, version: "1a2b3c4", app: { ...input.app, updateReady: patch.updateReady ?? false }, ui: { ...input.ui, update: patch.update } }).sheet;
      return sh?.kind === "settings" ? { version: sh.version, update: sh.update } : undefined;
    };
    expect(row({})).toEqual({ version: "1a2b3c4", update: "check" });
    expect(row({ update: "checking" })).toEqual({ version: "1a2b3c4", update: "checking" });
    expect(row({ update: "current" })).toEqual({ version: "1a2b3c4", update: "current" });
    expect(row({ updateReady: true, update: "checking" })).toEqual({ version: "1a2b3c4", update: "ready" });
  });

  test("status beats toast: sound-blocked over a toast; gps-lost over sound-blocked", () => {
    const input = scenarioInput("sound-blocked", false);
    const withToast = { ...input, ui: { ...input.ui, toast: { text: "Saved as Home", icon: "check" as const } } };
    expect(screen(withToast).top?.chip).toMatchObject({ action: "sounds-on" });
    expect(screen({ ...withToast, readouts: { ...input.readouts, fixAgeMs: 60_000 } }).top?.chip).toMatchObject({ text: "GPS lost" });
  });
});

describe("sheets", () => {
  test("preview: time, distance, arrival with the day when it is not today", () => {
    const s = screen(scenarioInput("preview", true));
    expect(s.sheet).toMatchObject({ kind: "preview", title: "Saint Augustine Hospital, North Harbour Outpatient Buildings", min: 705, km: "900 km", arrive: "Tue 1:10 AM" });
  });

  test("the keyboard: the sheet takes the visual viewport under 300 px, and Talk docks in it", () => {
    expect(screen(scenarioInput("search", false, 783)).keyboard).toEqual({ open: true, full: false });
    expect(screen(scenarioInput("search", false, 553)).keyboard).toEqual({ open: true, full: true });
  });

  test("the Route sheet lists every stop on the way, then the Destination", () => {
    const s = screen(scenarioInput("plan-stops-edit", true));
    if (s.sheet?.kind !== "route") throw new Error("route sheet");
    expect(s.sheet.stops).toHaveLength(7);
    expect(s.sheet.edit).toBe(true);
    expect(s.sheet.dest.at).toBe("Tue 1:10 AM");
  });

  test("Talk replaces a sheet; the sheet's state stays for after", () => {
    const input = scenarioInput("settings", false);
    const s = screen({ ...input, talk: { kind: "listening", transcript: "Play the news" } });
    expect(s.sheet).toBeUndefined();
    expect(s.card).toMatchObject({ kind: "codriver", label: "Listening", text: "Play the news", keep: true });
    expect(input.ui.sheet).toEqual({ kind: "settings" });
  });

  test("library offline: rows not downloaded are dim and say Needs signal", () => {
    const s = screen(scenarioInput("listen-offline", false));
    if (s.sheet?.kind !== "library") throw new Error("library");
    expect(s.sheet.rows.map((r) => r.dim)).toEqual([false, false, true, true]);
    expect(s.sheet.rows[2]?.sub).toBe("Needs signal");
    expect(s.sheet.rows[0]).toMatchObject({ current: true, meta: "54 min left", downloaded: true });
  });

  test("downloads: waiting for Wi-Fi offers On Wi-Fi now", () => {
    const s = screen(scenarioInput("downloads", true));
    expect(s.sheet).toMatchObject({ kind: "library", downloads: { kind: "wait", waiting: 11 } });
  });
});

describe("the co-driver", () => {
  test("names: sentences and labels say the display name or Your co-driver; rows may show the id", () => {
    expect(coDriverName(coDriverInfo("navigator"))).toBe("Navigator");
    expect(coDriverName({ id: "navigator", displayName: "Nav" })).toBe("Nav");
    expect(coDriverName({ id: "night-shift" })).toBe(CO_DRIVER_FALLBACK_NAME);
    expect(coDriverRowName({ id: "night-shift" })).toBe("night-shift");
    const unknown = { ...scenarioInput("speaking", false), coDriver: { id: "night-shift" } };
    expect(screen(unknown).card).toMatchObject({ label: "Your co-driver" });
    const settings = { ...scenarioInput("settings", false), coDriver: { id: "night-shift" } };
    expect(screen(settings).sheet).toMatchObject({ kind: "settings", coDriver: "night-shift" });
    const sound = { ...scenarioInput("sound-mode", false), coDriver: { id: "night-shift" } };
    expect(screen(sound).sheet).toMatchObject({ note: "A Turn sound before each Stop. Your co-driver still answers when you talk." });
  });

  test("REPLACED offers Use here; an error says Directions continue", () => {
    expect(screen(scenarioInput("talk-unreachable", true)).card).toMatchObject({ text: "Your co-driver is open on another screen", button: { action: "use-here" } });
    expect(screen(scenarioInput("talk-unreachable", false)).card).toMatchObject({ text: "Can't reach Navigator", sub: "Directions continue." });
  });

  test("an answer is paged by how much is said, and keeps its buttons' space", () => {
    const s = screen(scenarioInput("speaking", true));
    expect(s.card).toMatchObject({ kind: "codriver", paged: 0.45, reserve: true });
  });

  test("Talk is the accent while the mic is open; mic denied shows the mic-off glyph", () => {
    const wake = screen(scenarioInput("wake", false));
    expect(wake.base).toMatchObject({ talk: { active: true, denied: false } });
    expect(screen(scenarioInput("mic-denied", false)).base).toMatchObject({ talk: { active: false, denied: true } });
  });
});

describe("the Light", () => {
  test("the cover of what plays; nothing playing or first run is the accent", () => {
    expect(screen(scenarioInput("near", false)).light).toMatchObject({ source: "music" });
    expect(screen(scenarioInput("noroute-nothing", false)).light).toBeNull();
    expect(screen(scenarioInput("first-run", false)).light).toBeNull();
  });
});

test("an idle frame with nothing playing has Talk alone in B", () => {
  const nav: NavState = { kind: "idle" };
  const s = screen({ ...scenarioInput("noroute-nothing", false), nav });
  expect(s.base.kind).toBe("talk-only");
});

describe("Talk that cannot work never blocks a sheet (review round 1, P0)", () => {
  const faults: TalkState[] = [{ kind: "offline" }, { kind: "unreachable", reason: "error" }, { kind: "unreachable", reason: "replaced" }, { kind: "mic-denied" }];
  const atRest = (id: string, talk: TalkState, stress = false): ScreenInput => ({ ...scenarioInput(id, stress), talk, memory: { ...scenarioInput(id, stress).memory, talkPressedAt: undefined } });

  for (const talk of faults) {
    const name = talk.kind === "unreachable" ? `unreachable (${talk.reason})` : talk.kind;
    test(`${name}: search, results, the library and settings open and show their state`, () => {
      for (const id of ["search", "results", "saved", "search-offline", "listen", "listen-offline", "library-music", "settings", "co-driver", "stops"] as const) {
        const s = screen(atRest(id, talk));
        expect(s.sheet, id).toBeDefined();
        expect(s.id).toBe(id);
      }
    });
    test(`${name}: at rest the drive and plan states show, with the fault on the Talk button`, () => {
      for (const id of ["near", "offline", "noroute"] as const) {
        const s = screen(atRest(id, talk));
        expect(s.id).toBe(id);
        expect(s.card?.kind).not.toBe("codriver");
        expect(s.base).toMatchObject({ talk: talk.kind === "mic-denied" ? { denied: true } : { fault: talk.kind } });
      }
    });
  }

  test("a press shows the fault card for TOAST_MS, then the frame returns", () => {
    const base = atRest("near", { kind: "offline" });
    expect(screen({ ...base, memory: { talkPressedAt: NOW } }).id).toBe("talk-offline");
    expect(screen({ ...base, memory: { talkPressedAt: NOW - TOAST_MS + 1 } }).id).toBe("talk-offline");
    expect(screen({ ...base, memory: { talkPressedAt: NOW - TOAST_MS } }).id).toBe("near");
  });

  test("an open sheet wins over a fault card even right after a press", () => {
    const s = screen({ ...atRest("settings", { kind: "unreachable", reason: "error" }), memory: { talkPressedAt: NOW } });
    expect(s.id).toBe("settings");
  });

  test("a live turn still takes C over a sheet", () => {
    for (const talk of [{ kind: "wake" }, { kind: "listening", transcript: "Home" }, { kind: "thinking", said: "Home" }, { kind: "speaking", text: "On it.", progress: 0.2 }] as TalkState[]) {
      const s = screen(atRest("settings", talk));
      expect(s.sheet).toBeUndefined();
      expect(s.card?.kind).toBe("codriver");
    }
  });
});
