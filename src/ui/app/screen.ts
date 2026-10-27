/**
 * The view mapping: engine state (plus what the screen remembers) → which Signal state shows,
 * and with what data. Pure: no DOM, no clocks, no engines. `render.ts` draws the result.
 *
 * The frame is always four parts (brief): T top row, A answer, C card slot, B base row; a sheet
 * replaces C and grows from it.
 */
import { cleanTitle, distance, distanceParts, duration, km, left, minutesOf, placeName, shortRoad, arrival, clockTime, count } from "../core/format";
import { type GlyphName, maneuverIcon, glyph } from "../core/icons";
import type {
  CarReadings,
  CarState,
  CoDriverInfo,
  DownloadStatus,
  Guidance,
  Item,
  NavState,
  NowPlaying,
  Permission,
  Place,
  Readouts,
  Route,
  Settings,
  Shelf,
  SourceId,
  TalkState,
  Transport,
  WakeState,
} from "./contract";
import { FULL_SHEET_BELOW, KEYBOARD_MIN } from "../core/plan";
import { CO_DRIVER_FALLBACK_NAME, coDriverName } from "../../codriver/names";

// ---- Thresholds (guesses until tried in the car) --------------------------------------------
/** Under this the hero says "Now". */
export const NOW_M = 100;
/** Over this the answer becomes the time left (`far`). */
export const FAR_M = 2_000;
/** A Stop this close behind the next one shows as `then`. */
export const THEN_M = 300;
/** A fix older than this is "GPS lost". */
export const GPS_LOST_MS = 10_000;
/** Over the limit by more than this … */
export const OVER_LIMIT_KMH = 5;
/** … for this long shows the speed readouts. */
export const OVER_LIMIT_MS = 3_000;
/** Toasts last this long. */
export const TOAST_MS = 4_000;
/** The wake-word model's size, for the setup row. */
export const WAKE_MODEL_MB = 18;
/** A press shorter than this is a tap: it stops the Co-driver and sends nothing. */
export const TAP_MS = 300;
/** The "Connect car" chip shows this long, once per drive. */
export const CAR_CHIP_MS = 30_000;

export const STATE_IDS = [
  // drive
  "near", "now", "far", "roundabout", "then", "via", "arriving", "arrived", "reroute", "offroute-nosignal", "offline", "gps", "gps-lost", "speeding", "limit-unknown",
  // plan
  "noroute", "plan-noroute-0", "plan-noroute-1", "search", "results", "no-results", "search-offline", "routing", "route-unreachable", "plan-route-noroad", "preview", "add-stop", "plan-add-stop-results", "stops", "plan-stops-edit", "saved", "plan-saved-0", "recent", "save-place", "plan-save-place-done", "end-route",
  // listen
  "listen", "library-music", "library-books", "library-search", "card-podcast", "card-book", "paused", "buffering", "listen-offline", "downloads", "source-error", "music-pairing", "nothing", "noroute-nothing", "turn-sound",
  // talk and system
  "talk-idle", "wake", "talk", "thinking", "speaking", "co-driver", "talk-offline", "talk-unreachable", "mic-denied", "location-denied", "sound-blocked", "first-run", "settings", "sound-mode", "trips", "update", "boot-error",
] as const;
export type StateId = (typeof STATE_IDS)[number];

// ---- UI state the screen keeps (sheets, drafts, toasts) -------------------------------------
export type Fetch<T> = { status: "loading" } | { status: "ready"; items: readonly T[] } | { status: "error"; message: string };

export type SheetState =
  | {
      kind: "where";
      query: string;
      results?: Fetch<Place> | undefined;
      /** The row opened to name it (a result or a Recent destination). */
      saving?: { list: "results" | "recent"; index: number; name: string } | undefined;
      /** The result row just saved. */
      savedIndex?: number | undefined;
      scrollTo?: "recent" | undefined;
    }
  | { kind: "route"; edit: boolean; confirmEnd: boolean }
  | { kind: "add-stop"; query: string; results?: Fetch<Place> | undefined }
  | { kind: "library"; source: SourceId; search?: { query: string; results?: Fetch<Item> | undefined } | undefined; scrollTo?: "downloads" | undefined }
  | { kind: "settings" }
  | { kind: "co-driver" }
  | { kind: "sound-mode" }
  | { kind: "trips" };

export interface UiState {
  sheet?: SheetState | undefined;
  /** A text field has focus (the keyboard may be open). */
  typing: boolean;
  toast?: { text: string; icon: GlyphName } | undefined;
  /** Per-Source library lists, fetched when the library opens. */
  library: Partial<Record<SourceId, Fetch<Item>>>;
  /** The driver's update check in Settings: running, or found nothing (shown for TOAST_MS). */
  update?: "checking" | "current" | undefined;
}

/** What the screen remembers across engine states. */
export interface Memory {
  /** The last guidance, so `arrived` can show the trip it ends. */
  lastGuidance?: Guidance | undefined;
  /** When `arrived` was first seen. */
  arrivedAt?: number | undefined;
  /** Since when the speed has been over the limit. */
  overSince?: number | undefined;
  /** When the driver last pressed Talk (a fault card shows for TOAST_MS after it). */
  talkPressedAt?: number | undefined;
  /** The Destination of the last routing attempt, for "No road route to …" and Try again. */
  lastDestination?: Place | undefined;
  /** The "Connect car" chip shows until then (set once per drive, when it starts). */
  carChipUntil?: number | undefined;
}

export interface ScreenInput {
  now: number;
  nav: NavState;
  readouts: Readouts;
  saved: readonly Place[];
  recent: readonly Place[];
  nowPlaying?: NowPlaying | undefined;
  shelf: Shelf;
  downloads?: DownloadStatus | undefined;
  talk: TalkState;
  coDriver: CoDriverInfo;
  coDrivers: readonly CoDriverInfo[];
  wake: WakeState;
  settings: Settings;
  app: { updateReady: boolean; soundBlocked: boolean; permissions: { location: Permission; mic: Permission }; firstRun: boolean };
  trips: { queued: number; lastError?: string | undefined };
  online: boolean;
  ui: UiState;
  memory: Memory;
  /** The frame's height and the keyboard's inset over it, in CSS px. */
  frame: { h: number; keyboard: number };
  version?: string | undefined;
  /** Set when Vela cannot start (no config). */
  boot?: string | undefined;
  /** The car's OBD link and its readings (ADR 0012). */
  car?: { state: CarState; readings: CarReadings } | undefined;
}

// ---- The screen model ---------------------------------------------------------------------------
export interface NowView {
  source: SourceId;
  id: string;
  title: string;
  by: string;
  /** "by, from" for the stage. */
  byLong: string;
  art?: string | undefined;
  fraction: number;
  transport: Transport;
  error?: string | undefined;
  /** Music skips tracks; Podcasts and Books skip 15 / 30 s. */
  skip: "track" | "seconds";
}

export interface ShelfEntry {
  source: SourceId;
  label: string;
  icon: GlyphName;
  title?: string | undefined;
  art?: string | undefined;
}

export type Action = { action: string; arg?: string | undefined };

export type ChipView =
  | { kind: "status"; icon: GlyphName; text: string; warn: boolean }
  | ({ kind: "button"; icon: GlyphName; text: string; warn: boolean; toast: boolean } & Action);

export interface TopView {
  chip?: ChipView | undefined;
  speed?: { now: string; limit: string } | undefined;
  clock: string;
  settings: boolean;
}

export type AnswerView =
  | {
      kind: "turn";
      icon: string;
      big: { num: string; unit: string } | { word: string };
      road: string;
      thenTurn?: { icon: string; road: string } | undefined;
      stale: boolean;
      label: string;
    }
  | { kind: "time"; min: number; next: { icon: string; road: string; dist: string } }
  | {
      kind: "quiet";
      icon?: GlyphName | undefined;
      text: string;
      sub?: string | undefined;
      warn: boolean;
      shimmer: boolean;
      /** A sentence holding a name: 2 lines, then an ellipsis. */
      named: boolean;
      button?: ({ label: string; icon?: GlyphName | undefined } & Action) | undefined;
      label: string;
    }
  | { kind: "arrived"; place: string }
  | { kind: "stage"; now: NowView }
  | { kind: "shelf"; entries: readonly ShelfEntry[] }
  | { kind: "boot"; message: string };

export interface SetupRow {
  icon: GlyphName;
  title: string;
  sub: string;
  end: { kind: "allow"; action: string } | { kind: "ok" } | { kind: "none" } | { kind: "progress"; fraction: number };
}

export type CardView =
  | { kind: "listen"; now: NowView; retry: string }
  | { kind: "shelf"; entries: readonly ShelfEntry[] }
  | { kind: "where"; rows: readonly { icon: GlyphName; title: string; list: "saved" | "recent"; index: number }[] }
  | {
      kind: "codriver";
      label: string;
      mark: GlyphName;
      text: string;
      sub?: string | undefined;
      said: boolean;
      /** Live transcript: keep the newest words in 3 lines. */
      keep: boolean;
      /** A spoken answer, paged; the share said so far. */
      paged?: number | undefined;
      shimmer: boolean;
      button?: ({ label: string } & Action) | undefined;
      /** The answer card keeps the space of its (left out) buttons. */
      reserve: boolean;
    }
  | { kind: "setup"; title: string; rows: readonly SetupRow[] };

export interface TalkView {
  active: boolean;
  denied: boolean;
  /** At rest, Talk cannot work: the button's glyph says why (no card takes C). */
  fault?: "offline" | "unreachable" | undefined;
}

export type BaseView =
  | {
      kind: "trip";
      left: { min: number } | { text: string };
      fraction: number;
      ticks: readonly number[];
      eta: { lead: string; time: string; via?: string | undefined };
      dim: boolean;
      talk: TalkView;
    }
  | { kind: "waiting"; talk: TalkView }
  | { kind: "shelf-row"; entries: readonly ShelfEntry[]; playing?: SourceId | undefined; talk: TalkView }
  | { kind: "talk-only"; talk: TalkView }
  | { kind: "none" };

export interface PlaceRow {
  icon: GlyphName;
  name: string;
  address?: string | undefined;
  meta?: string | undefined;
  action?: "Save" | "Add" | undefined;
  saved: boolean;
  dim: boolean;
  list: "saved" | "recent" | "results";
  index: number;
}

export interface LibRow {
  index: number;
  title: string;
  sub: string;
  art?: string | undefined;
  source: SourceId;
  meta: string;
  current: boolean;
  dim: boolean;
  downloaded: boolean;
}

export type DownloadsView =
  | { kind: "wait"; waiting: number; manualWifi: boolean }
  | { kind: "running"; done: number; total: number }
  | { kind: "saved"; saved: number }
  | { kind: "checking" };

export type SheetView =
  | {
      kind: "where";
      query: string;
      typing: boolean;
      full: boolean;
      body: "places" | "results" | "none" | "offline" | "loading";
      saved: readonly PlaceRow[];
      recent: readonly PlaceRow[];
      results: readonly PlaceRow[];
      saving?: { list: "results" | "recent"; index: number; name: string } | undefined;
      scrollTo?: "recent" | undefined;
    }
  | { kind: "preview"; title: string; address?: string | undefined; min: number; km: string; arrive: string }
  | {
      kind: "route";
      title: string;
      stops: readonly { name: string; address?: string | undefined; at: string; index: number }[];
      dest: { name: string; at: string };
      edit: boolean;
      confirm?: string | undefined;
    }
  | {
      kind: "add-stop";
      query: string;
      typing: boolean;
      full: boolean;
      compact?: { icon: string; dist: string; road: string } | undefined;
      body: "kinds" | "results" | "none" | "offline" | "loading";
      results: readonly PlaceRow[];
    }
  | {
      kind: "library";
      source: SourceId;
      searching: boolean;
      query: string;
      offline: boolean;
      placeholder: string;
      head?: string | undefined;
      rows: readonly LibRow[];
      body: "rows" | "loading" | "empty" | "error";
      error?: string | undefined;
      downloads?: DownloadsView | undefined;
      scrollTo?: "downloads" | undefined;
    }
  | {
      kind: "settings";
      coDriver: string;
      soundMode: string;
      wake: boolean;
      wakeSub: string;
      daylight: "auto" | "on" | "off";
      downloads: string;
      wifiOnly: boolean;
      trips: string;
      moments: boolean;
      car: CarView;
      version?: string | undefined;
      /** The version row's action: check, checking, an update to restart into, or up to date. */
      update: SettingsUpdate;
    }
  | { kind: "co-driver"; rows: readonly { id: string; title: string; sub?: string | undefined; icon: GlyphName; current: boolean }[] }
  | { kind: "sound-mode"; mode: "sounds" | "co-driver"; note: string }
  | { kind: "trips"; queued: number; waiting: string; error?: string | undefined };

export type SettingsUpdate = "check" | "checking" | "ready" | "current";

/** The car rows in Settings: the link, and the readings while connected. */
export interface CarView {
  state: CarState["kind"];
  /** Connected: fuel, Range, outside, coolant, battery; undefined is "No reading". */
  rows: readonly { icon: GlyphName; title: string; value?: string | undefined }[];
  /** The check-engine light and the stored fault codes, while connected. */
  engine?: { on: boolean | undefined; codes: readonly string[] } | undefined;
}

export interface Screen {
  id: StateId;
  /** The frame's look: row or col flow is decided by plan(w, h), not here. */
  top?: TopView | undefined;
  answer: AnswerView;
  card?: CardView | undefined;
  base: BaseView;
  sheet?: SheetView | undefined;
  /** The keyboard is open: lay out above it; `full` when the visual viewport is under 300. */
  keyboard: { open: boolean; full: boolean };
  /** What gives the Light: the media whose cover tints the screen, or null for the accent. */
  light: { source: SourceId; art?: string | undefined } | null;
  daylight: boolean;
}

// ---- Small pure helpers ---------------------------------------------------------------------------
export const SOURCES: readonly { id: SourceId; label: string; icon: GlyphName; search: string }[] = [
  { id: "music", label: "Music", icon: "music", search: "Search music" },
  { id: "podcasts", label: "Podcasts", icon: "podcast", search: "Search podcasts" },
  { id: "books", label: "Books", icon: "book", search: "Search books" },
];

/** The picker's glyph and description per kind. The descriptions are placeholders (backlog). */
const CODRIVER_LOOK: Readonly<Record<string, { icon: GlyphName; desc: string }>> = {
  navigator: { icon: "compass", desc: "Reads each Stop, keeps chat short" },
  companion: { icon: "bubble", desc: "Talks more, notices the road with you" },
  guide: { icon: "pin", desc: "Tells you about the places you pass" },
};

/** Sentences and labels: the display name, or CO_DRIVER_FALLBACK_NAME ("Your co-driver"). */
export { coDriverName };

/** A list row may show the id when there is no display name, so every row has a name. */
export function coDriverRowName(info: CoDriverInfo): string {
  return info.displayName ?? info.id;
}

export function nowView(np: NowPlaying): NowView {
  const { item } = np;
  const by = item.by;
  return {
    source: item.source,
    id: item.id,
    title: cleanTitle(item.title, by),
    by,
    byLong: item.from && item.from !== by ? `${by}, ${item.from}` : by,
    art: item.artUrl,
    fraction: item.durationSec ? Math.min(1, Math.max(0, np.positionSec / item.durationSec)) : 0,
    transport: np.transport,
    error: np.error,
    skip: item.source === "music" ? "track" : "seconds",
  };
}

export function shelfEntries(shelf: Shelf, nowPlaying?: NowPlaying): ShelfEntry[] {
  return SOURCES.map(({ id, label, icon }) => {
    // The Shelf entry for the playing Source is the item now playing, so the two always agree.
    const it = nowPlaying?.item.source === id ? nowPlaying.item : shelf[id];
    return { source: id, label, icon, title: it ? cleanTitle(it.title, it.by) : undefined, art: it?.artUrl };
  });
}

/** Speed more than the limit + 5 km/h (the 3 s hold is kept by the mount in Memory.overSince). */
export function overLimit(r: Readouts): boolean {
  return r.speedKmh !== undefined && r.speedLimitKmh !== undefined && r.speedKmh > r.speedLimitKmh + OVER_LIMIT_KMH;
}

/** Where each stop on the way sits along the Route (0..1), from the Stop that arrives at it. */
export function viaTicks(route: Route): number[] {
  if (!route.via.length || route.totalMeters <= 0) return [];
  const arrivals = route.stops.filter((s) => s.maneuver === "arrive");
  const out: number[] = [];
  for (const place of route.via) {
    let best: { d: number; m: number } | undefined;
    for (const s of arrivals) {
      const d = Math.hypot(s.at.lat - place.lat, (s.at.lng - place.lng) * Math.cos((place.lat * Math.PI) / 180));
      if (!best || d < best.d) best = { d, m: s.routeMeters };
    }
    // About 500 m in degrees: a stop that far from every arrival is not on this Route's legs.
    if (best && best.d < 0.005) out.push(Math.min(1, Math.max(0, best.m / route.totalMeters)));
  }
  return out;
}

/** The road the car is on: the street of the Stop before the next one. */
export function currentRoad(g: Guidance): string | undefined {
  const i = g.route.stops.findIndex((s) => s.index === g.nextStop.index);
  const prev = i > 0 ? g.route.stops[i - 1] : undefined;
  const road = shortRoad(prev?.street || prev?.instruction);
  return road || undefined;
}

const stopRoad = (s: { street: string; instruction: string }): string => shortRoad(s.street || s.instruction);

/** A Route error, read as one of the two plan states. */
export function routeError(message: string): "plan-route-noroad" | "route-unreachable" {
  return /could not find a route|no road|no route|no path/i.test(message) && !/no signal/i.test(message) ? "plan-route-noroad" : "route-unreachable";
}

const placeIcon = (p: Place): GlyphName => (/^home$/i.test(p.name) ? "home" : /^work$/i.test(p.name) ? "work" : "pin");

function downloadsView(d: DownloadStatus | undefined, online: boolean): DownloadsView | undefined {
  if (!d) return undefined;
  const saved = d.items.filter((i) => i.state === "saved").length;
  const ph = d.phase;
  if (!online) return { kind: "saved", saved };
  switch (ph.kind) {
    case "blocked":
      return { kind: "wait", waiting: d.items.filter((i) => i.state !== "saved").length || Math.max(0, d.items.length - saved), manualWifi: d.manualWifi };
    case "downloading":
      return { kind: "running", done: ph.done, total: ph.total };
    case "done":
      return { kind: "saved", saved: ph.saved };
    case "planning":
      return { kind: "checking" };
    case "idle":
      return saved ? { kind: "saved", saved } : undefined;
  }
}

export function downloadsText(v: DownloadsView | undefined): string {
  if (!v) return "Not downloaded yet";
  switch (v.kind) {
    case "wait":
      return "Downloads wait for Wi-Fi";
    case "running":
      return `Downloading ${v.done} of ${v.total}`;
    case "saved":
      return `${count(v.saved)} saved for offline`;
    case "checking":
      return "Checking for downloads";
  }
}

function isDownloaded(item: Item, d: DownloadStatus | undefined): boolean {
  return !!d?.items.some(
    (x) => x.state === "saved" && x.source === item.source && (x.label === item.title || x.label.startsWith(`${item.title},`) || x.url.includes(item.id)),
  );
}

// ---- The mapping ----------------------------------------------------------------------------------
type Frame = Omit<Screen, "id" | "keyboard" | "daylight"> & { keyboard?: Screen["keyboard"] };

/** Vela cannot start (no config): the answer only. No Talk (no assistant origin), no settings. */
export function bootScreen(message: string): Screen {
  return { id: "boot-error", answer: { kind: "boot", message }, base: { kind: "none" }, keyboard: { open: false, full: false }, light: null, daylight: false };
}

export function screen(input: ScreenInput): Screen {
  const daylight = input.readouts.daylight;
  if (input.boot !== undefined) return { ...bootScreen(input.boot), daylight };
  const f = frame(input);
  const keyboard = f.keyboard ?? { open: false, full: false };
  const s: Screen = { ...f, keyboard, daylight, id: "near" };
  s.id = stateOf(s, input);
  return s;
}

function talkView(input: ScreenInput): TalkView {
  const k = input.talk.kind;
  return {
    active: k === "wake" || k === "listening",
    denied: k === "mic-denied" || input.app.permissions.mic === "denied",
    fault: k === "offline" || k === "unreachable" ? k : undefined,
  };
}

/** A live turn: the co-driver card takes C over any sheet. */
export const liveTurn = (t: TalkState): boolean => t.kind === "wake" || t.kind === "listening" || t.kind === "thinking" || t.kind === "speaking";

/**
 * Talk's fault states (no signal, unreachable, mic denied) are the engine's rest state, so they show
 * as a card only for TOAST_MS after the driver presses Talk, and never over an open sheet. At rest
 * the Talk button's glyph says it.
 */
function talkCard(input: ScreenInput): CardView | undefined {
  if (input.talk.kind === "idle") return undefined;
  if (liveTurn(input.talk)) return codriverCard(input);
  const pressed = input.memory.talkPressedAt;
  const recent = pressed !== undefined && input.now - pressed < TOAST_MS;
  return recent && !input.ui.sheet && input.nav.kind !== "preview" ? codriverCard(input) : undefined;
}

function guidanceOf(nav: NavState): Guidance | undefined {
  return nav.kind === "guiding" || nav.kind === "rerouting" ? nav.guidance : undefined;
}

function frame(input: ScreenInput): Frame {
  const { nav, nowPlaying } = input;
  const np = nowPlaying ? nowView(nowPlaying) : undefined;
  const entries = shelfEntries(input.shelf, nowPlaying);
  const talk = talkView(input);
  const light = np ? { source: np.source, art: np.art } : null;
  const top = topView(input);

  // First run: T · A quiet "Welcome to Vela" · C setup · B Talk alone. Nothing plays yet.
  if (input.app.firstRun) {
    return {
      top,
      answer: { kind: "quiet", text: "Welcome to Vela", warn: false, shimmer: false, named: false, label: "Welcome to Vela" },
      card: talkCard(input) ?? setupCard(input),
      base: { kind: "talk-only", talk },
      light: null,
    };
  }

  const g = guidanceOf(nav);
  const card = talkCard(input);
  const kb = keyboardOf(input);

  // Location refused: no position, so no route. A quiet · C listening · B Shelf row.
  if (input.app.permissions.location === "denied" && !g) {
    return {
      top,
      answer: { kind: "quiet", icon: "locationOff", text: "Vela needs your location", sub: "Allow location for this site in Chrome for directions.", warn: false, shimmer: false, named: false, label: "Vela needs your location" },
      card: card ?? (np ? { kind: "listen", now: np, retry: retryLabel(np) } : { kind: "shelf", entries }),
      base: { kind: "shelf-row", entries, playing: np?.source, talk },
      sheet: card ? undefined : sheetView(input, kb),
      keyboard: kb,
      light,
    };
  }

  if (g || nav.kind === "arrived" || nav.kind === "routing") {
    // D: the drive frame. The listening card does not change in any drive state.
    const listenCard: CardView = np ? { kind: "listen", now: np, retry: retryLabel(np) } : { kind: "shelf", entries };
    return {
      top,
      answer: driveAnswer(input),
      card: card ?? listenCard,
      base: driveBase(input, talk),
      sheet: card ? undefined : sheetView(input, kb),
      keyboard: kb,
      light,
    };
  }

  // N: no route (idle, preview, error). A stage · C Where to card · B Shelf row + Talk.
  let answer: AnswerView;
  if (nav.kind === "error") {
    const kind = routeError(nav.message);
    const to = input.memory.lastDestination?.name;
    answer =
      kind === "plan-route-noroad"
        ? { kind: "quiet", icon: "alert", text: to ? `No road route to ${to}` : "No road route", warn: false, shimmer: false, named: true, label: "No road route" }
        : {
            kind: "quiet",
            icon: "alert",
            text: /no signal|network|reach/i.test(nav.message) ? "Can't reach the route server" : nav.message,
            warn: false,
            shimmer: false,
            named: true,
            label: "Can't reach the route server",
            button: input.memory.lastDestination ? { label: "Try again", icon: "retry", action: "route-retry" } : undefined,
          };
  } else answer = np ? { kind: "stage", now: np } : { kind: "shelf", entries };

  return {
    top,
    answer,
    card: card ?? whereCard(input),
    base: answer.kind === "shelf" ? { kind: "talk-only", talk } : { kind: "shelf-row", entries, playing: np?.source, talk },
    sheet: card ? undefined : sheetView(input, kb),
    keyboard: kb,
    // The Light stays the cover's while the stage is replaced by an error (it still plays).
    light,
  };
}

function retryLabel(np: NowView): string {
  return np.transport === "error" && /pair/i.test(np.error ?? "") ? "Check again" : "Try again";
}

function keyboardOf(input: ScreenInput): Screen["keyboard"] {
  const open = input.ui.typing && input.frame.keyboard >= KEYBOARD_MIN;
  return { open, full: open && input.frame.h - input.frame.keyboard < FULL_SHEET_BELOW };
}

function topView(input: ScreenInput): TopView {
  const { readouts, nav, app, ui, memory, now } = input;
  const g = guidanceOf(nav);
  let chip: ChipView | undefined;
  // Status beats toast: gps-lost > offline > sound-blocked > toast (> update).
  const lost = g && readouts.fixAgeMs !== undefined && readouts.fixAgeMs > GPS_LOST_MS;
  if (lost) chip = { kind: "status", icon: "locationOff", text: "GPS lost", warn: true };
  else if (g && (g.offline || !input.online) && !g.offRoute && nav.kind !== "rerouting") {
    chip = { kind: "status", icon: "nosignal", text: "No signal, using saved route", warn: true };
  } else if (app.soundBlocked) chip = { kind: "button", icon: "soundOff", text: "Tap to turn on sounds", warn: true, toast: false, action: "sounds-on" };
  else if (ui.toast) chip = { kind: "button", icon: ui.toast.icon, text: ui.toast.text, warn: false, toast: true, action: "toast-dismiss" };
  else if (memory.carChipUntil !== undefined && now < memory.carChipUntil && input.car?.state.kind === "connect") {
    chip = { kind: "button", icon: "car", text: "Connect car", warn: false, toast: true, action: "car-connect" };
  }
  // The update never interrupts guidance: it shows with no route, or once the driver has arrived.
  else if (app.updateReady && (nav.kind === "idle" || nav.kind === "error" || nav.kind === "arrived")) {
    chip = { kind: "button", icon: "retry", text: "Update ready, tap to restart", warn: false, toast: true, action: "update" };
  }
  const speeding = memory.overSince !== undefined && now - memory.overSince >= OVER_LIMIT_MS && overLimit(readouts);
  return {
    chip,
    speed: speeding ? { now: `${Math.round(readouts.speedKmh ?? 0)} km/h`, limit: `Limit ${Math.round(readouts.speedLimitKmh ?? 0)}` } : undefined,
    clock: readouts.clock,
    settings: true,
  };
}

function turnAnswer(g: Guidance, stale: boolean): AnswerView {
  const next = g.nextStop;
  const arriving = next.maneuver === "arrive";
  const icon = maneuverIcon(next.maneuver, next.exit);
  const road = arriving ? g.route.destination.name : stopRoad(next);
  if (g.metersToNext > FAR_M && !stale) {
    return { kind: "time", min: minutesOf(g.secLeft), next: { icon, road, dist: distance(g.metersToNext) } };
  }
  const thenTurn =
    !arriving && g.thenStop && g.thenStop.routeMeters - next.routeMeters <= THEN_M
      ? { icon: maneuverIcon(g.thenStop.maneuver, g.thenStop.exit), road: g.thenStop.maneuver === "arrive" ? g.route.destination.name : stopRoad(g.thenStop) }
      : undefined;
  return {
    kind: "turn",
    icon,
    big: g.metersToNext < NOW_M ? { word: "Now" } : distanceParts(g.metersToNext),
    road,
    thenTurn,
    stale,
    label: stale ? "Last known turn" : "Next turn",
  };
}

function driveAnswer(input: ScreenInput): AnswerView {
  const { nav, readouts } = input;
  if (nav.kind === "routing") {
    return { kind: "quiet", icon: "pin", text: `Finding a route to ${nav.destination.name}`, warn: false, shimmer: true, named: true, label: "Finding a route" };
  }
  if (nav.kind === "arrived") return { kind: "arrived", place: nav.destination.name };
  const g = guidanceOf(nav) as Guidance;
  if (nav.kind === "rerouting") return { kind: "quiet", icon: "reroute", text: "Finding a new route", warn: false, shimmer: true, named: false, label: "Finding a new route" };
  if (g.offRoute && (g.offline || !input.online)) {
    return { kind: "quiet", icon: "nosignal", text: "Off route", sub: "New route when signal returns", warn: true, shimmer: false, named: false, label: "Off route" };
  }
  if (readouts.fixAgeMs === undefined) {
    return { kind: "quiet", icon: "locate", text: "Finding your position", warn: false, shimmer: true, named: false, label: "Finding your position" };
  }
  return turnAnswer(g, readouts.fixAgeMs > GPS_LOST_MS);
}

function driveBase(input: ScreenInput, talk: TalkView): BaseView {
  const { nav, readouts, now } = input;
  if (nav.kind === "routing") return { kind: "waiting", talk };
  if (nav.kind === "arrived") {
    const last = input.memory.lastGuidance;
    const at = clockTime(input.memory.arrivedAt ?? now);
    if (!last) return { kind: "trip", left: { text: placeName(nav.destination.name) }, fraction: 1, ticks: [], eta: { lead: "Arrived", time: at }, dim: false, talk };
    const r = last.route;
    return {
      kind: "trip",
      left: { text: `${km(r.totalMeters)} in ${duration(minutesOf(r.totalSec))}` },
      fraction: 1,
      ticks: viaTicks(r),
      eta: { lead: "Arrived", time: at },
      dim: false,
      talk,
    };
  }
  const g = guidanceOf(nav) as Guidance;
  const ticks = viaTicks(g.route);
  if (readouts.fixAgeMs === undefined && nav.kind === "guiding") {
    return { kind: "trip", left: { text: placeName(g.route.destination.name) }, fraction: 0, ticks, eta: { lead: "", time: km(g.metersLeft) }, dim: true, talk };
  }
  const waiting = nav.kind === "rerouting" || (g.offRoute && (g.offline || !input.online));
  if (waiting) return { kind: "trip", left: { min: minutesOf(g.secLeft) }, fraction: g.progress, ticks, eta: { lead: "Arrive", time: "…" }, dim: true, talk };
  if (g.nextVia) {
    return {
      kind: "trip",
      left: { min: minutesOf(g.nextVia.secTo) },
      fraction: g.progress,
      ticks,
      eta: { lead: "", via: placeName(g.nextVia.place.name), time: arrival(g.nextVia.arriveAt, now) },
      dim: false,
      talk,
    };
  }
  const far = g.metersToNext > FAR_M && !((readouts.fixAgeMs ?? 0) > GPS_LOST_MS);
  const road = far ? currentRoad(g) : undefined;
  return {
    kind: "trip",
    left: road ? { text: `On ${road}` } : { min: minutesOf(g.secLeft) },
    fraction: g.progress,
    ticks,
    eta: { lead: "Arrive", time: arrival(g.arriveAt, now) },
    dim: false,
    talk,
  };
}

export function whereCard(input: ScreenInput): CardView {
  // The field and up to 3 places: Saved places first, then one Recent destination.
  const rows = [
    ...input.saved.map((p, index) => ({ icon: placeIcon(p), title: p.name, list: "saved" as const, index })),
    ...input.recent.slice(0, 1).map((p, index) => ({ icon: "recent" as const, title: p.name, list: "recent" as const, index })),
  ].slice(0, 3);
  return { kind: "where", rows };
}

function codriverCard(input: ScreenInput): CardView | undefined {
  const t = input.talk;
  const name = coDriverName(input.coDriver);
  const base = { said: false, keep: false, shimmer: false, reserve: false, mark: "mic" as GlyphName };
  switch (t.kind) {
    case "idle":
      return undefined;
    case "wake":
      return { kind: "codriver", ...base, label: "Listening", text: "Hey Vela", said: true };
    case "listening":
      return { kind: "codriver", ...base, label: "Listening", text: t.transcript || "…", keep: true };
    case "thinking":
      return { kind: "codriver", ...base, label: "Thinking", text: t.said, said: true, keep: true, shimmer: true };
    case "speaking":
      return { kind: "codriver", ...base, label: name, text: t.text, paged: Math.min(1, Math.max(0, t.progress)), reserve: true };
    case "offline":
      return { kind: "codriver", ...base, label: "Talk", mark: "nosignal", text: "No signal", sub: "Directions continue from the saved route." };
    case "unreachable":
      return t.reason === "replaced"
        ? { kind: "codriver", ...base, label: "Talk", mark: "screens", text: `${name} is open on another screen`, button: { label: "Use here", action: "use-here" } }
        : {
            kind: "codriver",
            ...base,
            label: "Talk",
            mark: "unlinked",
            text: name === CO_DRIVER_FALLBACK_NAME ? "Can't reach your co-driver" : `Can't reach ${name}`,
            sub: "Directions continue.",
          };
    case "mic-denied":
      return { kind: "codriver", ...base, label: "Talk", mark: "micOff", text: "Vela can't hear you", sub: "Allow the microphone for this site in Chrome to talk." };
  }
}

function permissionRow(icon: GlyphName, title: string, sub: string, p: Permission, action: string): SetupRow {
  if (p === "granted") return { icon, title, sub, end: { kind: "ok" } };
  if (p === "denied") return { icon, title, sub: "Allow it for this site in Chrome", end: { kind: "none" } };
  return { icon, title, sub, end: { kind: "allow", action } };
}

function setupCard(input: ScreenInput): CardView {
  const { permissions } = input.app;
  const w = input.wake;
  const wake: SetupRow =
    w.kind === "loading"
      ? { icon: "download", title: "Hey Vela", sub: `Downloading ${WAKE_MODEL_MB} MB`, end: { kind: "progress", fraction: w.progress } }
      : w.kind === "listening"
        ? { icon: "download", title: "Hey Vela", sub: "Heard on this phone", end: { kind: "ok" } }
        : w.kind === "unavailable"
          ? { icon: "download", title: "Hey Vela", sub: w.reason, end: { kind: "none" } }
          : { icon: "download", title: "Hey Vela", sub: `Downloads ${WAKE_MODEL_MB} MB`, end: { kind: "allow", action: "setup-wake" } };
  return {
    kind: "setup",
    title: "Set up Vela",
    rows: [
      permissionRow("locate", "Location", "For directions", permissions.location, "setup-location"),
      permissionRow("mic", "Microphone", "For Talk and Hey Vela", permissions.mic, "setup-mic"),
      wake,
    ],
  };
}

function placeRows(places: readonly Place[], list: PlaceRow["list"], opts: { action?: "Save" | "Add" | undefined; dim?: boolean; icon?: GlyphName; savedIndex?: number | undefined } = {}): PlaceRow[] {
  return places.map((p, index) => ({
    icon: opts.icon ?? placeIcon(p),
    name: p.name,
    address: p.address,
    action: opts.dim || opts.savedIndex === index ? undefined : opts.action,
    saved: opts.savedIndex === index,
    dim: opts.dim ?? false,
    list,
    index,
  }));
}

function sheetView(input: ScreenInput, kb: Screen["keyboard"]): SheetView | undefined {
  const { nav, ui, now } = input;
  const g = guidanceOf(nav);
  if (nav.kind === "preview") {
    const r = nav.route;
    return { kind: "preview", title: r.destination.name, address: r.destination.address, min: minutesOf(r.totalSec), km: km(r.totalMeters), arrive: arrival(now + r.totalSec * 1000, now) };
  }
  const sh = ui.sheet;
  if (!sh) return undefined;
  switch (sh.kind) {
    case "where": {
      const typed = sh.query.trim() !== "";
      const res = sh.results;
      const offline = !input.online || res?.status === "error";
      let body: "places" | "results" | "none" | "offline" | "loading" = "places";
      if (typed && offline) body = "offline";
      else if (typed && res?.status === "ready") body = res.items.length ? "results" : "none";
      else if (typed && res) body = "loading";
      const items = res?.status === "ready" ? res.items : [];
      return {
        kind: "where",
        query: sh.query,
        typing: ui.typing,
        full: kb.full,
        body,
        saved: placeRows(input.saved, "saved", { dim: body === "offline" }),
        recent: placeRows(input.recent, "recent", { action: "Save", icon: "recent", dim: body === "offline" }),
        results: placeRows(items, "results", { action: "Save", savedIndex: sh.savedIndex }),
        saving: sh.saving,
        scrollTo: sh.scrollTo,
      };
    }
    case "route": {
      if (!g) return undefined;
      const r = g.route;
      const ticks = viaTicks(r);
      const stops = r.via.map((p, index) => {
        // The next stop on the way has an exact time; the rest are estimated along the Route.
        const exact = g.nextVia && g.nextVia.place.name === p.name && g.nextVia.place.lat === p.lat ? g.nextVia.arriveAt : undefined;
        const frac = ticks[index];
        const travelled = r.totalMeters - g.metersLeft;
        const est =
          frac !== undefined && g.metersLeft > 0 ? now + ((frac * r.totalMeters - travelled) / g.metersLeft) * g.secLeft * 1000 : undefined;
        const at = exact ?? (est !== undefined && est >= now ? est : undefined);
        return { name: p.name, address: p.address, at: at === undefined ? "" : arrival(at, now), index };
      });
      return {
        kind: "route",
        title: r.destination.name,
        stops,
        dest: { name: r.destination.name, at: arrival(g.arriveAt, now) },
        edit: sh.edit && r.via.length > 0,
        confirm: sh.confirmEnd ? `End route to ${r.destination.name}?` : undefined,
      };
    }
    case "add-stop": {
      if (!g) return undefined;
      const typed = sh.query.trim() !== "";
      const res = sh.results;
      let body: "kinds" | "results" | "none" | "offline" | "loading" = "kinds";
      if (typed && (!input.online || res?.status === "error")) body = "offline";
      else if (typed && res?.status === "ready") body = res.items.length ? "results" : "none";
      else if (typed && res) body = "loading";
      const next = g.nextStop;
      return {
        kind: "add-stop",
        query: sh.query,
        typing: ui.typing,
        full: kb.full,
        compact: kb.full ? { icon: maneuverIcon(next.maneuver, next.exit), dist: distance(g.metersToNext), road: next.maneuver === "arrive" ? r0(g) : stopRoad(next) } : undefined,
        body,
        results: placeRows(res?.status === "ready" ? res.items : [], "results", { action: "Add", icon: kindIcon(sh.query) }),
      };
    }
    case "library": {
      const src = SOURCES.find((s) => s.id === sh.source) ?? SOURCES[1];
      const offline = !input.online;
      const np = input.nowPlaying;
      const fetchRows = sh.search ? sh.search.results : ui.library[sh.source];
      const items = fetchRows?.status === "ready" ? fetchRows.items : [];
      const rows: LibRow[] = items.map((it, index) => {
        const current = np?.item.id === it.id && np.item.source === it.source;
        const downloaded = isDownloaded(it, input.downloads);
        return {
          index,
          title: cleanTitle(it.title, it.by),
          sub: offline && !downloaded ? "Needs signal" : it.by,
          art: it.artUrl,
          source: it.source,
          meta: current && np && it.durationSec ? left(np.positionSec, it.durationSec) : it.durationSec ? duration(Math.max(1, Math.round(it.durationSec / 60))) : "",
          current,
          dim: offline && !downloaded,
          downloaded: offline && downloaded,
        };
      });
      const body: "rows" | "loading" | "empty" | "error" =
        !fetchRows || fetchRows.status === "loading" ? "loading" : fetchRows.status === "error" ? "error" : rows.length ? "rows" : "empty";
      return {
        kind: "library",
        source: sh.source,
        searching: !!sh.search,
        query: sh.search?.query ?? "",
        offline,
        head: sh.search ? undefined : sh.source === "podcasts" ? "Up next" : "Recently played",
        rows,
        body,
        error: fetchRows?.status === "error" ? fetchRows.message : undefined,
        downloads: sh.search ? undefined : downloadsView(input.downloads, input.online),
        scrollTo: sh.scrollTo,
        placeholder: src?.search ?? "Search",
      };
    }
    case "settings": {
      const sm = input.settings.soundMode;
      const w = input.wake;
      return {
        kind: "settings",
        coDriver: coDriverRowName(input.coDriver),
        soundMode: sm.kind === "sounds" ? "Sounds only" : "Co-driver",
        wake: input.settings.wakeWord,
        wakeSub:
          w.kind === "loading"
            ? `Downloading ${Math.round(w.progress * 100)}%`
            : w.kind === "unavailable"
              ? w.reason
              : "Heard on this phone",
        daylight: input.settings.daylight,
        downloads: downloadsText(downloadsView(input.downloads, input.online)),
        wifiOnly: input.settings.downloadsOnWifiOnly,
        trips: input.trips.queued ? `${count(input.trips.queued)} waiting to send` : "All sent",
        moments: input.settings.moments,
        car: carView(input.car),
        version: input.version,
        update: input.app.updateReady ? "ready" : (ui.update ?? "check"),
      };
    }
    case "co-driver":
      return {
        kind: "co-driver",
        rows: input.coDrivers.map((c) => {
          const known = CODRIVER_LOOK[c.kind ?? c.id];
          return { id: c.id, title: coDriverRowName(c), sub: known?.desc, icon: known?.icon ?? "bubble", current: c.id === input.coDriver.id };
        }),
      };
    case "sound-mode": {
      const mode = input.settings.soundMode.kind;
      const who = coDriverName(input.coDriver);
      return {
        kind: "sound-mode",
        mode,
        note: mode === "co-driver" ? `${who} reads each Stop aloud and answers when you talk.` : `A Turn sound before each Stop. ${who} still answers when you talk.`,
      };
    }
    case "trips":
      return {
        kind: "trips",
        queued: input.trips.queued,
        waiting: input.trips.queued ? `${count(input.trips.queued)} waiting to send` : "Nothing waiting to send",
        error: input.trips.lastError,
      };
  }
}

const r0 = (g: Guidance): string => g.route.destination.name;

function carView(car: ScreenInput["car"]): CarView {
  const state = car?.state.kind ?? "unavailable";
  if (state !== "connected" || !car) return { state, rows: [] };
  const r = car.readings;
  const deg = (c: number | undefined) => (c === undefined ? undefined : `${Math.round(c)} °C`.replace(/^-/, "\u2212"));
  return {
    state,
    rows: [
      { icon: "fuel", title: "Fuel", value: r.fuelPercent === undefined ? undefined : `${Math.round(r.fuelPercent)}%` },
      { icon: "trip", title: "Range", value: r.rangeKm === undefined ? undefined : km(r.rangeKm * 1000) },
      { icon: "thermo", title: "Outside", value: deg(r.ambientC) },
      { icon: "engine", title: "Coolant", value: deg(r.coolantC) },
      { icon: "battery", title: "Battery", value: r.voltage === undefined ? undefined : `${r.voltage.toFixed(1)} V` },
    ],
    engine: { on: r.mil, codes: r.dtcs ?? [] },
  };
}

/** The car tool's stop kinds, as the add-stop sheet offers them. */
export const STOP_KINDS: readonly { id: "fuel" | "food" | "rest"; label: string; query: string }[] = [
  { id: "fuel", label: "Fuel", query: "Fuel" },
  { id: "food", label: "Food", query: "Food" },
  { id: "rest", label: "Rest area", query: "Rest area" },
];

function kindIcon(query: string): GlyphName {
  if (/fuel|gas|petrol|diesel/i.test(query)) return "fuel";
  if (/food|eat|caf|restaurant/i.test(query)) return "food";
  if (/rest/i.test(query)) return "rest";
  return "pin";
}

// ---- Which state shows ------------------------------------------------------------------------
function stateOf(s: Screen, input: ScreenInput): StateId {
  const { nav, ui, readouts } = input;
  if (input.app.firstRun && s.card?.kind === "setup") return "first-run";
  const talkShown = s.card?.kind === "codriver" && !s.sheet;
  switch (talkShown ? input.talk.kind : "idle") {
    case "wake":
      return "wake";
    case "listening":
      return "talk";
    case "thinking":
      return "thinking";
    case "speaking":
      return "speaking";
    case "offline":
      return "talk-offline";
    case "unreachable":
      return "talk-unreachable";
    case "mic-denied":
      return "mic-denied";
    case "idle":
      break;
  }
  const sh = s.sheet;
  if (sh) {
    switch (sh.kind) {
      case "preview":
        return "preview";
      case "where": {
        const state = ui.sheet?.kind === "where" ? ui.sheet : undefined;
        if (state?.saving) return "save-place";
        if (state?.savedIndex !== undefined) return "plan-save-place-done";
        if (sh.body === "offline") return "search-offline";
        if (sh.query.trim() && sh.typing) return "search";
        if (sh.body === "none") return "no-results";
        if (sh.body === "results" || sh.body === "loading") return "results";
        if (sh.scrollTo === "recent") return "recent";
        return sh.saved.length || sh.recent.length ? "saved" : "plan-saved-0";
      }
      case "route":
        return sh.confirm ? "end-route" : sh.edit ? "plan-stops-edit" : "stops";
      case "add-stop":
        return sh.query.trim() ? "plan-add-stop-results" : "add-stop";
      case "library":
        if (sh.offline) return "listen-offline";
        if (sh.searching) return "library-search";
        if (sh.scrollTo === "downloads") return "downloads";
        return sh.source === "music" ? "library-music" : sh.source === "books" ? "library-books" : "listen";
      case "settings":
      case "co-driver":
      case "sound-mode":
      case "trips":
        return sh.kind;
    }
  }
  if (input.app.permissions.location === "denied" && s.answer.kind === "quiet" && s.answer.icon === "locationOff") return "location-denied";
  const chip = s.top?.chip;
  if (chip?.kind === "status" && chip.text === "GPS lost") return "gps-lost";
  if (chip?.kind === "button" && chip.action === "sounds-on") return "sound-blocked";
  if (chip?.kind === "button" && chip.action === "update" && nav.kind !== "arrived") return "update";
  if (nav.kind === "routing") return "routing";
  if (nav.kind === "error") return routeError(nav.message);
  if (nav.kind === "idle" || nav.kind === "preview") {
    if (s.answer.kind === "shelf") return "noroute-nothing";
    if (!input.saved.length && !input.recent.length) return "plan-noroute-0";
    if (input.saved.length === 1 && !input.recent.length) return "plan-noroute-1";
    return "noroute";
  }
  if (nav.kind === "arrived") return "arrived";
  const a = s.answer;
  if (a.kind === "quiet") {
    if (a.icon === "reroute") return "reroute";
    if (a.icon === "nosignal") return "offroute-nosignal";
    if (a.icon === "locate") return "gps";
  }
  if (s.top?.speed) return "speeding";
  if (chip?.kind === "status" && chip.icon === "nosignal") return "offline";
  const c = s.card;
  if (c?.kind === "shelf") return "nothing";
  if (c?.kind === "listen") {
    const t = c.now.transport;
    if (t === "error") return c.retry === "Check again" ? "music-pairing" : "source-error";
    if (t === "loading") return "buffering";
    if (t === "paused") return "paused";
  }
  if (a.kind === "time") return "far";
  if (a.kind === "turn") {
    const g = guidanceOf(nav) as Guidance;
    if (a.big && "word" in a.big) return "now";
    if (g.nextStop.maneuver === "roundabout") return "roundabout";
    if (g.nextStop.maneuver === "arrive") return "arriving";
    if (a.thenTurn) return "then";
    if (g.nextVia) return "via";
  }
  if (readouts.speedLimitKmh === undefined) return "limit-unknown";
  return "near";
}

/** The glyph markup by name, for the renderer. */
export const glyphOf = (name: GlyphName): string => glyph[name];
