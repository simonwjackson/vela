/**
 * Every Signal state, as fake engine state. `dev.html?state=<id>` mounts the real app on these
 * fakes; the app's own mapping then decides what shows, and the page reports the state it mapped
 * (`expect` is that id: a few states draw the same frame as another and map to it).
 */
import type { DownloadStatus, NavState, Readouts } from "../app/contract";
import type { DownloadItem } from "../../sw/downloads";
import type { Memory, StateId, UiState } from "../app/screen";
import type { Fakes } from "./fakes";
import { type Fixtures, type RouteFix, NOW, fixtures, guidance, playing } from "./fixtures";

export interface Setup {
  initial?: Partial<UiState>;
  memory?: Partial<Memory>;
  keyboard?: boolean;
  online?: boolean;
  boot?: string;
}

export interface Scenario {
  id: StateId;
  label: string;
  area: "drive" | "plan" | "listen" | "talk";
  /** The id the app's mapping gives (defaults to `id`). */
  expect?: StateId;
  // biome-ignore lint/suspicious/noConfusingVoidType: most setups only set fakes and return nothing
  setup(f: Fakes, x: Fixtures, stress: boolean): Setup | void;
}

/** Run a setup step, then return the UI state it needs. */
const after = (_done: undefined, setup: Setup): Setup => setup;

const guiding = (r: RouteFix, extra = {}): NavState => ({ kind: "guiding", guidance: guidance(r, extra) });

function downloadItems(x: Fixtures, saved: number[], total = 12): DownloadItem[] {
  return Array.from({ length: total }, (_, i) => {
    const it = x.library.podcasts[i];
    return { source: "podcasts", label: it?.title ?? `Episode ${i + 1}`, url: `https://ossicle.test/audio/${it?.id ?? i}`, state: saved.includes(i) ? "saved" : "waiting" };
  });
}

function restDownloads(x: Fixtures, stress: boolean): DownloadStatus {
  return stress
    ? { phase: { kind: "blocked", network: { kind: "blocked", reason: "metered" } }, items: downloadItems(x, [0]), problems: {}, manualWifi: false }
    : { phase: { kind: "done", saved: 12, failed: 0, at: NOW }, items: downloadItems(x, Array.from({ length: 12 }, (_, i) => i)), problems: {}, manualWifi: false };
}

/** Everything a calm screen has: places, the Shelf, the clock, the co-driver, downloads at rest. */
function base(f: Fakes, x: Fixtures, stress: boolean, readouts: Partial<Readouts> = {}): undefined {
  f.nav.saved = [...x.places.saved];
  f.nav.recent = [...x.places.recent];
  f.nav.results = [...x.plan.results];
  f.nav.readouts = { clock: x.clock, daylight: false, fixAgeMs: 800, speedKmh: x.speed.now, speedLimitKmh: x.speed.limit, ...readouts };
  f.listening.shelf = { ...x.shelf };
  f.listening.library = { podcasts: x.library.podcasts, music: x.library.music, books: x.library.books };
  f.coDriver.current = x.codriver.current;
  f.coDriver.all = x.codriver.list;
  f.settings.value = { ...f.settings.value, coDriver: x.codriver.current.id };
  f.trips.queued = x.trips.queued;
  f.trips.status = x.trips.error ? { lastError: x.trips.error } : {};
  f.downloads.status = restDownloads(x, stress);
  f.nav.onStart = () => guiding(x.short.route);
}

/** D: on a route, the turn ahead, the listening card, the trip row. */
function D(f: Fakes, x: Fixtures, stress: boolean, r: RouteFix = x.short.route, extra = {}): undefined {
  base(f, x, stress);
  f.nav.state = guiding(r, extra);
  f.listening.nowPlaying = x.short.media;
}

/** N: no route, something playing. */
function N(f: Fakes, x: Fixtures, stress: boolean): undefined {
  base(f, x, stress);
  f.nav.state = { kind: "idle" };
  f.listening.nowPlaying = x.short.media;
}

const where = (query: string, more: Partial<Extract<NonNullable<UiState["sheet"]>, { kind: "where" }>> = {}): Partial<UiState> => ({
  sheet: { kind: "where", query, ...more },
});
const ready = <T>(items: readonly T[]) => ({ status: "ready" as const, items });
/** A route with the plan area's stops on the way (1, or 7 in stress). */
const planRoute = (x: Fixtures, stress: boolean, withVia = true): RouteFix => {
  const via = withVia ? x.plan.via : [];
  const first = via[0];
  return {
    ...x.short.route,
    via,
    ...(first ? { nextVia: { place: first.place, min: stress ? 36 : 16, arriveAt: stress ? new Date(2026, 9, 26, 14, 1).getTime() : new Date(2026, 9, 26, 13, 41).getTime() } } : {}),
  };
};

export const SCENARIOS: readonly Scenario[] = [
  // ---- Drive -------------------------------------------------------------------------------------
  { id: "near", label: "Turn ahead", area: "drive", setup: (f, x, s) => D(f, x, s) },
  { id: "now", label: "Turn now", area: "drive", setup: (f, x, s) => D(f, x, s, { ...x.short.route, next: { ...x.short.route.next, meters: 60 } }) },
  {
    id: "far",
    label: "Long leg",
    area: "drive",
    setup: (f, x, s) => {
      D(f, x, s, x.long.route);
      f.listening.nowPlaying = x.long.media;
    },
  },
  { id: "roundabout", label: "Roundabout", area: "drive", setup: (f, x, s) => D(f, x, s, { ...x.short.route, next: x.roundabout }) },
  { id: "then", label: "Two turns close", area: "drive", setup: (f, x, s) => D(f, x, s, { ...x.short.route, thenStop: x.thenTurn }) },
  {
    id: "via",
    label: "Stop on the way next",
    area: "drive",
    setup: (f, x, s) =>
      D(f, x, s, { ...x.short.route, via: x.via.ticks.map((t, i) => ({ place: i === 0 ? x.via.place : { name: `Stop ${i + 1}`, lat: 0.5 + i * 0.01, lng: -0.6 - i * 0.01 }, at: t })), nextVia: x.via }),
  },
  {
    id: "arriving",
    label: "Arriving",
    area: "drive",
    setup: (f, x, s) =>
      D(f, x, s, { ...x.short.route, leftMin: x.arriving.leftMin, progress: x.arriving.progress, next: { maneuver: "arrive", meters: x.arriving.meters, street: x.short.route.to.name } }),
  },
  {
    id: "arrived",
    label: "Arrived",
    area: "drive",
    setup: (f, x, s) => {
      D(f, x, s);
      const g = guidance(x.short.route);
      f.nav.state = { kind: "arrived", destination: x.short.route.to };
      return { memory: { lastGuidance: g, arrivedAt: x.short.route.arriveAt } };
    },
  },
  {
    id: "reroute",
    label: "Finding a new route",
    area: "drive",
    setup: (f, x, s) => {
      D(f, x, s);
      f.nav.state = { kind: "rerouting", guidance: guidance(x.short.route, { offRoute: true }) };
    },
  },
  { id: "offroute-nosignal", label: "Off route, no signal", area: "drive", setup: (f, x, s) => D(f, x, s, x.short.route, { offRoute: true, offline: true }) },
  { id: "offline", label: "No signal", area: "drive", setup: (f, x, s) => D(f, x, s, x.short.route, { offline: true }) },
  {
    id: "gps",
    label: "Waiting for GPS",
    area: "drive",
    setup: (f, x, s) => {
      D(f, x, s);
      const { fixAgeMs: _drop, ...rest } = f.nav.readouts;
      f.nav.readouts = rest;
    },
  },
  {
    id: "gps-lost",
    label: "GPS lost",
    area: "drive",
    setup: (f, x, s) => {
      D(f, x, s);
      f.nav.readouts = { ...f.nav.readouts, fixAgeMs: 30_000 };
    },
  },
  {
    id: "speeding",
    label: "Over the limit",
    area: "drive",
    setup: (f, x, s) => {
      D(f, x, s, x.short.route, s ? { offline: true } : {});
      f.nav.readouts = { ...f.nav.readouts, speedKmh: x.overSpeed.now, speedLimitKmh: x.overSpeed.limit };
      return { memory: { overSince: NOW - 4_000 } };
    },
  },
  {
    id: "limit-unknown",
    label: "Limit unknown",
    area: "drive",
    setup: (f, x, s) => {
      D(f, x, s);
      const { speedLimitKmh: _drop, ...rest } = f.nav.readouts;
      f.nav.readouts = rest;
    },
  },

  // ---- Plan --------------------------------------------------------------------------------------
  { id: "noroute", label: "No route", area: "plan", setup: (f, x, s) => N(f, x, s) },
  {
    id: "plan-noroute-0",
    label: "No route, no places",
    area: "plan",
    setup: (f, x, s) => {
      N(f, x, s);
      f.nav.saved = [];
      f.nav.recent = [];
    },
  },
  {
    id: "plan-noroute-1",
    label: "No route, 1 Saved place",
    area: "plan",
    setup: (f, x, s) => {
      N(f, x, s);
      f.nav.saved = x.places.saved.slice(0, 1);
      f.nav.recent = [];
    },
  },
  {
    id: "search",
    label: "Typing a destination",
    area: "plan",
    setup: (f, x, s) => {
      N(f, x, s);
      return { initial: { ...where(x.plan.typing, { results: ready(x.plan.results) }), typing: true }, keyboard: true };
    },
  },
  { id: "results", label: "Results", area: "plan", setup: (f, x, s) => after(N(f, x, s), { initial: where(x.plan.query, { results: ready(x.plan.results) }) }) },
  { id: "no-results", label: "No results", area: "plan", setup: (f, x, s) => after(N(f, x, s), { initial: where(x.plan.missQuery, { results: ready([]) }) }) },
  {
    id: "search-offline",
    label: "Search needs signal",
    area: "plan",
    setup: (f, x, s) => after(N(f, x, s), { initial: where(x.plan.typing, { results: { status: "error", message: "No signal" } }) }),
  },
  {
    id: "routing",
    label: "Finding a route",
    area: "plan",
    setup: (f, x, s) => {
      D(f, x, s);
      f.nav.state = { kind: "routing", destination: x.short.route.to };
    },
  },
  {
    id: "route-unreachable",
    label: "Route server unreachable",
    area: "plan",
    setup: (f, x, s) => {
      N(f, x, s);
      f.nav.state = { kind: "error", message: "No signal. A Route needs signal to start; guidance then works without it." };
      return { memory: { lastDestination: x.short.route.to } };
    },
  },
  {
    id: "plan-route-noroad",
    label: "No road route",
    area: "plan",
    setup: (f, x, s) => {
      N(f, x, s);
      f.nav.state = { kind: "error", message: "The router could not find a route: No path could be found for input" };
      return { memory: { lastDestination: x.short.route.to } };
    },
  },
  {
    id: "preview",
    label: "Route preview",
    area: "plan",
    setup: (f, x, s) => {
      N(f, x, s);
      const dest = x.plan.results.find((p) => p.name === x.short.route.to.name) ?? x.plan.results[s ? 1 : 0] ?? x.short.route.to;
      f.nav.state = { kind: "preview", route: guidance({ ...x.short.route, to: dest }).route };
      return { initial: where(x.plan.query, { results: ready(x.plan.results) }) };
    },
  },
  {
    id: "add-stop",
    label: "Add a stop",
    area: "plan",
    setup: (f, x, s) => after(D(f, x, s, planRoute(x, s)), { initial: { sheet: { kind: "add-stop", query: "" } } }),
  },
  {
    id: "plan-add-stop-results",
    label: "Add a stop, typed",
    area: "plan",
    setup: (f, x, s) => {
      D(f, x, s, planRoute(x, s));
      return { initial: { sheet: { kind: "add-stop", query: x.plan.stopQuery, results: ready(x.plan.stopResults) }, typing: true }, keyboard: true };
    },
  },
  { id: "stops", label: "Route", area: "plan", setup: (f, x, s) => after(D(f, x, s, planRoute(x, s)), { initial: { sheet: { kind: "route", edit: false, confirmEnd: false } } }) },
  {
    id: "plan-stops-edit",
    label: "Route, editing stops",
    area: "plan",
    setup: (f, x, s) => after(D(f, x, s, planRoute(x, s)), { initial: { sheet: { kind: "route", edit: true, confirmEnd: false } } }),
  },
  { id: "saved", label: "Saved places", area: "plan", setup: (f, x, s) => after(N(f, x, s), { initial: where("") }) },
  {
    id: "plan-saved-0",
    label: "Saved places, none",
    area: "plan",
    setup: (f, x, s) => {
      N(f, x, s);
      f.nav.saved = [];
      f.nav.recent = [];
      return { initial: where("") };
    },
  },
  { id: "recent", label: "Recent destinations", area: "plan", setup: (f, x, s) => after(N(f, x, s), { initial: where("", { scrollTo: "recent" }) }) },
  {
    id: "save-place",
    label: "Save a place",
    area: "plan",
    setup: (f, x, s) => {
      N(f, x, s);
      const r = x.plan.results[1];
      return { initial: where(x.plan.query, { results: ready(x.plan.results), saving: { list: "results", index: 1, name: r?.name ?? "" } }) };
    },
  },
  {
    id: "plan-save-place-done",
    label: "Save a place, saved",
    area: "plan",
    setup: (f, x, s) => {
      N(f, x, s);
      return { initial: { ...where(x.plan.query, { results: ready(x.plan.results), savedIndex: 1 }), toast: { text: `Saved as ${x.plan.saveName}`, icon: "check" } } };
    },
  },
  {
    id: "end-route",
    label: "End route",
    area: "plan",
    setup: (f, x, s) => after(D(f, x, s, planRoute(x, s, s)), { initial: { sheet: { kind: "route", edit: false, confirmEnd: true } } }),
  },

  // ---- Listen ------------------------------------------------------------------------------------
  {
    id: "listen",
    label: "Library: Up next",
    area: "listen",
    setup: (f, x, s) => {
      D(f, x, s);
      f.listening.nowPlaying = x.long.media;
      return { initial: { sheet: { kind: "library", source: "podcasts" }, library: { podcasts: ready(x.library.podcasts) } } };
    },
  },
  {
    id: "library-music",
    label: "Library: Music",
    area: "listen",
    setup: (f, x, s) => {
      D(f, x, s);
      f.listening.nowPlaying = x.music;
      return { initial: { sheet: { kind: "library", source: "music" }, library: { music: ready(x.library.music) } } };
    },
  },
  {
    id: "library-books",
    label: "Library: Books",
    area: "listen",
    setup: (f, x, s) => {
      D(f, x, s);
      f.listening.nowPlaying = x.book;
      return { initial: { sheet: { kind: "library", source: "books" }, library: { books: ready(x.library.books) } } };
    },
  },
  {
    id: "library-search",
    label: "Search a Source",
    area: "listen",
    setup: (f, x, s) => {
      D(f, x, s);
      f.listening.nowPlaying = x.long.media;
      return { initial: { sheet: { kind: "library", source: "podcasts", search: { query: x.libSearch.query, results: ready(x.libSearch.results) } } } };
    },
  },
  {
    id: "card-podcast",
    label: "Now playing: Podcast",
    area: "listen",
    expect: "near",
    setup: (f, x, s) => {
      D(f, x, s);
      f.listening.nowPlaying = x.long.media;
    },
  },
  {
    id: "card-book",
    label: "Now playing: Book",
    area: "listen",
    expect: "near",
    setup: (f, x, s) => {
      D(f, x, s);
      f.listening.nowPlaying = x.book;
    },
  },
  {
    id: "paused",
    label: "Paused",
    area: "listen",
    setup: (f, x, s) => {
      D(f, x, s);
      f.listening.nowPlaying = { ...x.short.media, transport: "paused" };
    },
  },
  {
    id: "buffering",
    label: "Loading",
    area: "listen",
    setup: (f, x, s) => {
      D(f, x, s);
      f.listening.nowPlaying = { ...(s ? x.long.media : x.book), transport: "loading" };
    },
  },
  {
    id: "listen-offline",
    label: "No signal: downloaded only",
    area: "listen",
    setup: (f, x, s) => {
      D(f, x, s, x.short.route, { offline: true });
      f.listening.nowPlaying = x.long.media;
      f.downloads.status = { ...f.downloads.status, items: downloadItems(x, x.offlineDownloaded) };
      return { online: false, initial: { sheet: { kind: "library", source: "podcasts" }, library: { podcasts: ready(x.library.podcasts) } } };
    },
  },
  {
    id: "downloads",
    label: "Downloads",
    area: "listen",
    setup: (f, x, s) => {
      D(f, x, s);
      f.listening.nowPlaying = x.long.media;
      if (!s) f.downloads.status = { phase: { kind: "downloading", done: 3, total: 12 }, items: downloadItems(x, [0, 1, 2]), problems: {}, manualWifi: false };
      return { initial: { sheet: { kind: "library", source: "podcasts", scrollTo: "downloads" }, library: { podcasts: ready(x.library.podcasts) } } };
    },
  },
  {
    id: "source-error",
    label: "Source unreachable",
    area: "listen",
    setup: (f, x, s) => {
      D(f, x, s);
      const np = x.error.source === "books" ? x.book : x.long.media;
      f.listening.nowPlaying = { ...np, transport: "error", error: x.error.text };
    },
  },
  {
    id: "music-pairing",
    label: "Music needs pairing",
    area: "listen",
    setup: (f, x, s) => {
      D(f, x, s);
      f.listening.nowPlaying = { ...x.music, transport: "error", error: "Music needs pairing in Pyxis" };
    },
  },
  {
    id: "nothing",
    label: "Nothing playing (route)",
    area: "listen",
    setup: (f, x, s) => {
      D(f, x, s);
      f.listening.nowPlaying = undefined;
      if (s) f.listening.shelf = { ...x.shelf, books: undefined };
    },
  },
  {
    id: "noroute-nothing",
    label: "Nothing playing (no route)",
    area: "listen",
    setup: (f, x, s) => {
      N(f, x, s);
      f.listening.nowPlaying = undefined;
      f.nav.saved = x.places.saved;
      if (s) f.listening.shelf = { music: undefined, podcasts: x.shelf.podcasts, books: undefined };
    },
  },
  {
    id: "turn-sound",
    label: "Turn sound",
    area: "listen",
    expect: "near",
    setup: (f, x, s) => {
      D(f, x, s);
      f.listening.nowPlaying = playing(x.long.media.item, x.long.media.positionSec - 2);
    },
  },

  // ---- Talk and system ---------------------------------------------------------------------------
  { id: "talk-idle", label: "Talk at rest", area: "talk", expect: "near", setup: (f, x, s) => D(f, x, s) },
  { id: "wake", label: '"Hey Vela" heard', area: "talk", setup: (f, x, s) => {
      D(f, x, s);
      f.coDriver.state = { kind: "wake" };
    } },
  { id: "talk", label: "Listening", area: "talk", setup: (f, x, s) => {
      D(f, x, s);
      f.coDriver.state = { kind: "listening", transcript: x.codriver.heard };
    } },
  { id: "thinking", label: "Thinking", area: "talk", setup: (f, x, s) => {
      D(f, x, s);
      f.coDriver.state = { kind: "thinking", said: x.codriver.heard };
    } },
  {
    id: "speaking",
    label: "Co-driver answers",
    area: "talk",
    setup: (f, x, s) => {
      D(f, x, s);
      f.coDriver.state = { kind: "speaking", text: x.codriver.answer, progress: x.codriver.at };
    },
  },
  { id: "co-driver", label: "Choose a co-driver", area: "talk", setup: (f, x, s) => after(D(f, x, s), { initial: { sheet: { kind: "co-driver" } } }) },
  { id: "talk-offline", label: "Talk, no signal", area: "talk", setup: (f, x, s) => {
      D(f, x, s);
      f.coDriver.state = { kind: "offline" };
      return { memory: { talkPressedAt: NOW } }; // the driver just pressed Talk
    } },
  {
    id: "talk-unreachable",
    label: "Co-driver unreachable",
    area: "talk",
    setup: (f, x, s) => {
      D(f, x, s);
      f.coDriver.state = { kind: "unreachable", reason: s ? "replaced" : "error" };
      return { memory: { talkPressedAt: NOW } };
    },
  },
  {
    id: "mic-denied",
    label: "Microphone denied",
    area: "talk",
    setup: (f, x, s) => {
      D(f, x, s);
      f.coDriver.state = { kind: "mic-denied" };
      f.app.permissions = { location: "granted", mic: "denied" };
      return { memory: { talkPressedAt: NOW } };
    },
  },
  {
    id: "location-denied",
    label: "Location denied",
    area: "talk",
    setup: (f, x, s) => {
      N(f, x, s);
      f.app.permissions = { location: "denied", mic: "granted" };
    },
  },
  { id: "sound-blocked", label: "Sounds blocked", area: "talk", setup: (f, x, s) => {
      D(f, x, s);
      f.app.soundBlocked = true;
    } },
  {
    id: "first-run",
    label: "First run",
    area: "talk",
    setup: (f, x, s) => {
      base(f, x, s);
      f.nav.state = { kind: "idle" };
      f.listening.nowPlaying = undefined;
      f.app.firstRun = true;
      f.app.permissions = { location: x.setup.location, mic: x.setup.mic };
      f.wake.state = { kind: "loading", progress: x.wakeProgress };
    },
  },
  {
    id: "settings",
    label: "Settings",
    area: "talk",
    setup: (f, x, s) => {
      D(f, x, s);
      if (s) f.downloads.status = { phase: { kind: "downloading", done: 3, total: 12 }, items: [], problems: {}, manualWifi: false };
      return { initial: { sheet: { kind: "settings" } } };
    },
  },
  {
    id: "sound-mode",
    label: "Sound mode",
    area: "talk",
    setup: (f, x, s) => {
      D(f, x, s);
      if (s) f.settings.value = { ...f.settings.value, soundMode: { kind: "co-driver", coDriver: x.codriver.current.id } };
      return { initial: { sheet: { kind: "sound-mode" } } };
    },
  },
  { id: "trips", label: "Trips", area: "talk", setup: (f, x, s) => after(D(f, x, s), { initial: { sheet: { kind: "trips" } } }) },
  { id: "update", label: "Update ready", area: "talk", setup: (f, x, s) => {
      N(f, x, s);
      f.app.updateReady = true;
    } },
  { id: "boot-error", label: "Vela can't start", area: "talk", setup: (_f, x) => ({ boot: x.boot }) },
];

export function scenario(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}

export { fixtures };
