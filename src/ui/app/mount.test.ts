import { type Fakes, fakes } from "../dev/fakes";
import { NOW, fixtures, guidance } from "../dev/fixtures";
import { SCENARIOS } from "../dev/scenarios";
import type { AppDeps } from "./contract";
import { type MountOptions, mount, mountBootError } from "./mount";
import { TOAST_MS } from "./screen";

const settle = () => new Promise((r) => setTimeout(r, 5));

interface Harness {
  f: Fakes & AppDeps;
  root: HTMLElement;
  unmount: () => void;
  $: (sel: string) => HTMLElement;
  $$: (sel: string) => HTMLElement[];
  tap: (sel: string) => Promise<void>;
  type: (sel: string, text: string) => Promise<void>;
  clock: { t: number };
}

async function open(state: string, opts: MountOptions = {}, stress = false): Promise<Harness> {
  const f = fakes();
  const sc = SCENARIOS.find((s) => s.id === state);
  const setup = sc?.setup(f, fixtures(stress), stress) ?? {};
  const root = document.createElement("div");
  document.body.append(root);
  const clock = { t: NOW };
  const unmount = mount(root, f, {
    now: () => clock.t,
    searchDelayMs: 0,
    ...(setup.initial ? { initial: setup.initial } : {}),
    ...(setup.memory ? { memory: setup.memory } : {}),
    online: { get: () => setup.online ?? true, subscribe: () => () => undefined },
    ...opts,
  });
  await settle();
  const $ = (sel: string) => {
    const el = root.querySelector<HTMLElement>(sel);
    if (!el) throw new Error(`nothing matches ${sel} in ${root.querySelector(".app")?.getAttribute("data-state")}`);
    return el;
  };
  return {
    f,
    root,
    unmount,
    $,
    $$: (sel) => [...root.querySelectorAll<HTMLElement>(sel)],
    clock,
    tap: async (sel) => {
      $(sel).click();
      await settle();
    },
    type: async (sel, text) => {
      const input = $(sel) as HTMLInputElement;
      input.focus();
      input.value = text;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await settle();
      await settle();
    },
  };
}

const stateOf = (h: Harness) => h.$(".app").dataset.state;

afterEach(() => {
  document.body.replaceChildren();
});

test("draws the drive frame, and a GPS fix patches it in place", async () => {
  const h = await open("near");
  expect(stateOf(h)).toBe("near");
  expect(h.$(".answer .big").textContent).toBe("400m");
  expect(h.$(".road").textContent).toBe("Larch Avenue");
  expect(h.$(".trip .eta").textContent).toBe("Arrive 2:17 PM");
  const card = h.$(".listen");
  const x = fixtures(false);
  h.f.nav.set({ kind: "guiding", guidance: guidance({ ...x.short.route, next: { ...x.short.route.next, meters: 60 } }) });
  await settle();
  expect(h.$(".answer .big").textContent).toBe("Now");
  expect(h.$(".listen")).toBe(card); // the listening card did not change
  h.unmount();
  expect(h.root.childElementCount).toBe(0);
});

test("Plan: search, results, save a place, preview, Start", async () => {
  const h = await open("noroute");
  await h.tap('[data-action="where-open"]');
  expect(stateOf(h)).toBe("saved");
  await h.type('[data-field="where"]', "Northgate");
  expect(h.f.nav.calls).toContainEqual(["search", "Northgate"]);
  expect(h.$$(".sheet .plan-place")).toHaveLength(5);
  (h.$('[data-field="where"]') as HTMLInputElement).blur();
  await new Promise((r) => setTimeout(r, 150));
  expect(stateOf(h)).toBe("results");

  await h.tap('[data-action="place-save"][data-arg="results:1"]');
  expect(stateOf(h)).toBe("save-place");
  await h.type('[data-field="save-name"]', "Library");
  await h.tap('[data-action="save-confirm"]');
  expect(h.f.nav.calls).toContainEqual(["savePlace", "Library", expect.objectContaining({ name: "Northgate Library" })]);
  expect(h.$(".chip.toast").textContent).toBe("Saved as Library");
  expect(stateOf(h)).toBe("plan-save-place-done");

  await h.tap('[data-action="place-pick"][data-arg="results:0"]');
  expect(h.f.nav.calls).toContainEqual(["preview", expect.objectContaining({ name: "Northgate" })]);
  const x = fixtures(false);
  h.f.nav.set({ kind: "preview", route: guidance(x.short.route).route });
  await settle();
  expect(stateOf(h)).toBe("preview");
  expect(h.$(".plan-time").textContent).toBe("52min");
  await h.tap('[data-action="preview-start"]');
  expect(h.f.nav.calls).toContainEqual(["startPreview"]);
  expect(stateOf(h)).toBe("near");
  expect(h.root.querySelector(".sheet")).toBeNull();
});

test("Plan: no results, and search without signal", async () => {
  const h = await open("noroute");
  h.f.nav.results = [];
  await h.tap('[data-action="where-open"]');
  await h.type('[data-field="where"]', "Northgte");
  expect(h.$(".plan-note").textContent).toContain("No places found");
  h.f.nav.results = new Error("No signal");
  await h.type('[data-field="where"]', "Northgate");
  expect(stateOf(h)).toBe("search-offline");
  expect(h.$(".plan-note").textContent).toContain("Search needs signal");
});

test("Plan: add a stop, remove a stop, end the route", async () => {
  const h = await open("near");
  await h.tap('.trip[data-action="route-open"]');
  expect(stateOf(h)).toBe("stops");
  await h.tap('[data-action="add-stop-open"]');
  expect(stateOf(h)).toBe("add-stop");
  h.f.nav.results = fixtures(false).plan.stopResults;
  await h.tap('[data-action="stop-kind"][data-arg="Fuel"]');
  await settle();
  expect(h.f.nav.calls).toContainEqual(["search", "Fuel"]);
  await h.tap('.btn[data-action="stop-add"][data-arg="results:0"]');
  expect(h.f.nav.calls).toContainEqual(["addStop", expect.objectContaining({ name: "Harbour Fuel" })]);
  expect(stateOf(h)).toBe("stops");

  const x = fixtures(false);
  h.f.nav.set({ kind: "guiding", guidance: guidance({ ...x.short.route, via: x.plan.via }) });
  await settle();
  await h.tap('[data-action="route-edit"]');
  expect(stateOf(h)).toBe("plan-stops-edit");
  await h.tap('[data-action="stop-remove"][data-arg="0"]');
  expect(h.f.nav.calls).toContainEqual(["removeStop", 0]);
  await h.tap('[data-action="route-edit"]');
  await h.tap('[data-action="end-ask"]');
  expect(stateOf(h)).toBe("end-route");
  await h.tap('[data-action="end-keep"]');
  expect(stateOf(h)).toBe("stops");
  await h.tap('[data-action="end-ask"]');
  await h.tap('[data-action="end-confirm"]');
  expect(h.f.nav.calls).toContainEqual(["end"]);
  expect(h.root.querySelector(".sheet")).toBeNull();
});

test("Library: per-Source lists, search, play, and the 15/30 keys", async () => {
  const h = await open("card-podcast");
  expect(h.$$(".listen .keys button").map((b) => b.getAttribute("aria-label"))).toEqual(["Back 15 seconds", "Pause", "Forward 30 seconds"]);
  await h.tap('.listen .keys [data-action="key-back"]');
  await h.tap('.listen .keys [data-action="key-forward"]');
  await h.tap('.listen .keys [data-action="key-toggle"]');
  expect(h.f.listening.calls.filter((c) => c[0] === "send").map((c) => (c[1] as { type: string }).type)).toEqual(["back", "forward", "toggle"]);
  expect(h.$(".listen .play").getAttribute("aria-label")).toBe("Play");

  await h.tap(".listen .title");
  expect(stateOf(h)).toBe("listen");
  expect(h.f.listening.calls).toContainEqual(["search", "podcasts", ""]);
  expect(h.$$(".sheet .row[data-action='lib-play']")).toHaveLength(4);
  await h.tap('.sheet [data-action="lib-play"][data-arg="2"]');
  expect(h.f.listening.calls).toContainEqual(["send", { type: "playItem", item: expect.objectContaining({ id: "p-bridge" }) }]);

  await h.tap('.seg [data-arg="music"]');
  expect(stateOf(h)).toBe("library-music");
  h.f.listening.searchResults = fixtures(false).library.music.slice(1, 2);
  await h.type('[data-field="library"]', "copper");
  await settle();
  expect(stateOf(h)).toBe("library-search");
  expect(h.f.listening.calls).toContainEqual(["search", "music", "copper"]);
  expect(h.$$(".sheet .row[data-action='lib-play']")).toHaveLength(1);
  await h.tap('[data-action="lib-search-back"]');
  expect(stateOf(h)).toBe("library-music");
});

test("Music skips tracks, and an error offers Try again", async () => {
  const h = await open("source-error");
  expect(h.$(".listen .by").textContent).toBe("Can't reach Ossicle");
  await h.tap('[data-action="key-retry"]');
  expect(h.f.listening.calls).toContainEqual(["send", { type: "play" }]);
  const p = await open("paused");
  expect(p.$$(".listen .keys button").map((b) => b.getAttribute("aria-label"))).toEqual(["Previous", "Play", "Next"]);
});

test("Talk: press and hold speaks; a tap stops the co-driver", async () => {
  const h = await open("speaking");
  const talk = () => h.$(".talk-btn");
  talk().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 }));
  h.clock.t += 120;
  talk().dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }));
  expect(h.f.coDriver.calls).toEqual([["press"], ["cancel"]]);
  await settle();
  talk().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 }));
  await settle();
  expect(stateOf(h)).toBe("talk");
  expect(talk().getAttribute("aria-pressed")).toBe("true");
  h.clock.t += 1500;
  talk().dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }));
  expect(h.f.coDriver.calls.slice(2)).toEqual([["press"], ["release"]]);
  await settle();
  expect(stateOf(h)).toBe("thinking");
});

test("Talk replaces a sheet, and the sheet comes back with its query", async () => {
  const h = await open("noroute");
  await h.tap('[data-action="where-open"]');
  await h.type('[data-field="where"]', "North");
  h.f.coDriver.set({ kind: "listening", transcript: "Take me home" });
  await settle();
  expect(h.root.querySelector(".sheet")).toBeNull();
  expect(h.$(".codriver-text").textContent).toBe("Take me home");
  h.f.coDriver.set({ kind: "idle" });
  await settle();
  expect((h.$('[data-field="where"]') as HTMLInputElement).value).toBe("North");
});

test("Settings: sound mode, co-driver, Hey Vela, Turn sound test, Daylight contrast, Wi-Fi only, Trips", async () => {
  const testTurnSound = vi.fn();
  const h = await open("near", { testTurnSound });
  await h.tap('[data-action="settings-open"]');
  expect(stateOf(h)).toBe("settings");
  await h.tap('[data-action="wake-toggle"]');
  expect(h.f.settings.value.wakeWord).toBe(false);
  expect(h.f.wake.calls).toContainEqual(["enable", false]);
  await h.tap('[data-action="test-sound"]');
  expect(testTurnSound).toHaveBeenCalledOnce();
  await h.tap('[data-action="daylight"][data-arg="on"]');
  expect(h.f.settings.value.daylight).toBe("on");
  await h.tap('[data-action="wifi-only"]');
  expect(h.f.settings.value.downloadsOnWifiOnly).toBe(false);

  await h.tap('[data-action="sound-mode-open"]');
  expect(stateOf(h)).toBe("sound-mode");
  await h.tap('[data-action="sound-mode"][data-arg="co-driver"]');
  expect(h.f.settings.value.soundMode).toEqual({ kind: "co-driver", coDriver: "navigator" });
  await h.tap('[data-action="sheet-back"]');

  await h.tap('[data-action="codriver-open"]');
  expect(stateOf(h)).toBe("co-driver");
  await h.tap('[data-action="codriver-choose"][data-arg="guide"]');
  expect(h.f.coDriver.calls).toContainEqual(["choose", "guide"]);
  await h.tap('[data-action="sheet-back"]');

  h.f.trips.queued = 12;
  await h.tap('[data-action="trips-open"]');
  expect(h.$(".talk-block .meta").textContent).toBe("12 waiting to send");
  await h.tap('[data-action="trips-send"]');
  expect(h.f.trips.calls).toContainEqual(["flush"]);
  await h.tap('[data-action="sheet-close"]');
  expect(h.root.querySelector(".sheet")).toBeNull();
});

test("Downloads: On Wi-Fi now switches the manual Wi-Fi and runs", async () => {
  const h = await open("downloads", {}, true);
  await h.tap('[data-action="wifi-now"]');
  expect(h.f.downloads.calls).toEqual([["setManualWifi", true], ["run"]]);
});

test("Chips: sounds blocked and the update are taps", async () => {
  const s = await open("sound-blocked");
  await s.tap('[data-action="sounds-on"]');
  expect(s.f.app.calls).toContainEqual(["unblockSound"]);
  expect(s.root.querySelector(".chip")).toBeNull();
  const u = await open("update");
  await u.tap('[data-action="update"]');
  expect(u.f.app.calls).toContainEqual(["applyUpdate"]);
});

describe("Settings: the version row", () => {
  test("shows the build and checks for updates; nothing new shows Up to date for a few seconds", async () => {
    const h = await open("settings", { version: "1a2b3c4" });
    expect(h.$(".talk-version").textContent).toContain("Vela 1a2b3c4");
    vi.useFakeTimers();
    try {
      h.f.app.checkMs = 1_000;
      h.$('[data-action="update-check"]').click();
      await vi.advanceTimersByTimeAsync(0);
      expect(h.$(".talk-version [role=status]").textContent).toBe("Checking for updates");
      expect(h.root.querySelector('[data-action="update-check"]')).toBeNull();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(h.f.app.calls).toEqual([["checkForUpdate"]]);
      expect(h.$(".talk-version [role=status]").textContent).toBe("Up to date");
      await vi.advanceTimersByTimeAsync(TOAST_MS);
      expect(h.$('[data-action="update-check"]').textContent).toBe("Check for updates");
      expect(h.f.app.calls).not.toContainEqual(["restart"]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("a new version: restarts into it", async () => {
    const h = await open("settings");
    h.f.app.checkResult = "updated";
    await h.tap('[data-action="update-check"]');
    await settle();
    expect(h.f.app.calls).toEqual([["checkForUpdate"], ["restart"]]);
  });

  test("a failed check still reloads, so the driver always has a way out", async () => {
    const h = await open("settings");
    h.f.app.checkResult = "failed";
    await h.tap('[data-action="update-check"]');
    await settle();
    expect(h.f.app.calls).toEqual([["checkForUpdate"], ["restart"]]);
  });

  test("an update already waiting: Update ready, restart", async () => {
    const h = await open("settings");
    h.f.app.set({ updateReady: true });
    await settle();
    expect(h.$('[data-action="update-check"]').textContent).toBe("Update ready, restart");
    await h.tap('[data-action="update-check"]');
    expect(h.f.app.calls).toEqual([["applyUpdate"]]);
  });
});

test("Boot error: Try again runs the reset once", async () => {
  const root = document.createElement("div");
  document.body.append(root);
  const retry = vi.fn();
  const unmount = mountBootError(root, "The config has no route server address.", { retry });
  const button = root.querySelector<HTMLElement>('[data-action="boot-retry"]');
  button?.click();
  button?.click();
  expect(retry).toHaveBeenCalledOnce();
  unmount();
  root.remove();
});

test("First run asks for permissions and finishes once both are answered", async () => {
  const requestLocation = vi.fn();
  const h = await open("first-run", { requestLocation });
  await h.tap('[data-action="setup-location"]');
  expect(requestLocation).toHaveBeenCalledOnce();
  h.f.app.set({ permissions: { location: "granted", mic: "granted" } });
  await settle();
  expect(h.f.app.calls).toContainEqual(["finishFirstRun"]);
});

test("a resize or fold re-plans and keeps the open sheet and its draft", async () => {
  const h = await open("noroute");
  await h.tap('[data-action="where-open"]');
  await h.type('[data-field="where"]', "Fern");
  const input = h.$('[data-field="where"]');
  window.dispatchEvent(new Event("resize"));
  await settle();
  expect(h.$('[data-field="where"]')).toBe(input);
  expect((input as HTMLInputElement).value).toBe("Fern");
});

test("every target is a button, or a region with the button role (keyboard reachable)", async () => {
  const h = await open("near");
  for (const el of h.$$("[data-action], [data-talk]")) {
    expect(el.tagName === "BUTTON" || el.getAttribute("role") === "button" || el.matches(".listen, .trip")).toBe(true);
  }
});

test("boot error: Vela can't start, Try again, no Talk", () => {
  const root = document.createElement("div");
  document.body.append(root);
  const unmount = mountBootError(root, "The config has no route server address.");
  expect(root.querySelector(".quiet")?.textContent).toBe("Vela can't start");
  expect(root.querySelector(".talk-btn")).toBeNull();
  unmount();
});

test("Talk offline at rest: search and settings still open; a press shows why, then goes", async () => {
  const h = await open("noroute");
  h.f.coDriver.set({ kind: "offline" });
  await settle();
  expect(h.$(".talk-btn").getAttribute("aria-label")).toBe("Talk, no signal");
  await h.tap('[data-action="where-open"]');
  expect(h.$(".sheet").getAttribute("aria-label")).toBe("Where to");
  await h.tap('[data-action="sheet-close"]');
  await h.tap('[data-action="settings-open"]');
  expect(h.$(".sheet").getAttribute("aria-label")).toBe("Settings");
  await h.tap('[data-action="sheet-close"]');
  expect(h.root.querySelector(".codriver")).toBeNull();
  // A press while offline: the fault card shows (the fake stays offline, as the engine would).
  h.f.coDriver.press = () => undefined;
  h.f.coDriver.cancel = () => undefined;
  h.$(".talk-btn").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 }));
  h.$(".talk-btn").dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }));
  await settle();
  expect(h.$(".codriver-text").textContent).toBe("No signal");
  h.clock.t += 5_000;
  h.f.coDriver.set({ kind: "offline" });
  await settle();
  expect(h.root.querySelector(".codriver")).toBeNull();
});

test("Talk unreachable at rest: the library opens from the card", async () => {
  const h = await open("card-podcast");
  h.f.coDriver.set({ kind: "unreachable", reason: "error" });
  await settle();
  expect(h.$(".talk-btn").getAttribute("aria-label")).toBe("Talk, co-driver unreachable");
  await h.tap(".listen .title");
  expect(h.$(".app").dataset.state).toBe("listen");
});
