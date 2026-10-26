/**
 * The NavEngine: fetches a whole Route once, caches it, and guides from GPS alone.
 * Re-routes when the car leaves the Route and there is signal; otherwise keeps guiding
 * from the cached Route with `offline: true` (ADR 0002).
 *
 * A Route can be previewed before it starts (`preview` → `startPreview`). Stops on the way are
 * added after the other stops and before the Destination; removing one re-routes.
 */
import type {
  DaylightMode,
  Fix,
  Guidance,
  LatLng,
  NavEngine,
  NavState,
  Place,
  Readouts,
  Route,
  Settings,
  Stop,
  TurnSoundEvent,
  VelaConfig,
} from "../contract";
import { decodePolyline } from "./geo";
import { computeGuidance, passedViaCount } from "./guidance";
import { ON_ROUTE, type OffRouteState, leaveThresholdM, nextOffRoute } from "./offRoute";
import { PlaceBook, isPlace } from "./places";
import type { FixSource } from "./position";
import { type PlaceSearch, photonSearch } from "./search";
import { type KeyValueStore, deviceStore, readJson } from "./storage";
import { isDaylight } from "./sun";
import { RouteTrack, type Snap } from "./track";
import { TurnSoundScheduler } from "./turnSounds";
import { type PlannedRoute, RouteError, type Router, speedLimitAt, valhallaRouter } from "./valhalla";

/** Whether the phone believes it has signal, and a way to hear when that changes. */
export interface Network {
  online(): boolean;
  subscribe(listener: () => void): () => void;
}

export interface NavEngineDeps {
  readonly config: VelaConfig;
  readonly fixes: FixSource;
  readonly store?: KeyValueStore;
  readonly router?: Router;
  readonly search?: PlaceSearch;
  readonly fetcher?: typeof fetch;
  readonly network?: Network;
  readonly now?: () => number;
  readonly formatClock?: (epochMs: number) => string;
  /** How long start() waits for a first GPS fix. */
  readonly firstFixTimeoutMs?: number;
  /** The Daylight contrast setting. Without it, "auto". */
  readonly settings?: DaylightSetting;
}

/** The part of the SettingsStore the engine reads. */
export interface DaylightSetting {
  readonly value: Pick<Settings, "daylight">;
  subscribe(fn: (s: Pick<Settings, "daylight">) => void): () => void;
}

export interface DisposableNavEngine extends NavEngine {
  dispose(): void;
}

const ROUTE_KEY = "vela.nav.route";
const LAST_POSITION_KEY = "vela.nav.lastPosition";
/** A cached Route older than this is not resumed after a reload. */
const ROUTE_CACHE_MAX_AGE_MS = 24 * 3_600_000;
/** While off-route with signal, ask for a new Route at most this often. */
export const REROUTE_RETRY_MS = 10_000;
const LAST_POSITION_EVERY_MS = 60_000;
/** Speed readout goes blank when the last fix is older than this. */
const SPEED_STALE_MS = 10_000;
/** Readouts (clock, fix age) refresh this often without a fix. */
const READOUTS_EVERY_MS = 1_000;
/** The snap window looks this far behind the last position. */
const SNAP_BEHIND_M = 200;

export function browserNetwork(): Network {
  return {
    online: () => globalThis.navigator?.onLine ?? true,
    subscribe(listener) {
      globalThis.addEventListener?.("online", listener);
      globalThis.addEventListener?.("offline", listener);
      return () => {
        globalThis.removeEventListener?.("online", listener);
        globalThis.removeEventListener?.("offline", listener);
      };
    },
  };
}

const defaultClock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

export function createNavEngine(deps: NavEngineDeps): DisposableNavEngine {
  const now = deps.now ?? Date.now;
  const store = deps.store ?? deviceStore();
  const fetcher = deps.fetcher;
  const router =
    deps.router ?? valhallaRouter({ origin: deps.config.origins.valhalla, now, ...(fetcher ? { fetcher } : {}) });
  const search = deps.search ?? photonSearch(deps.config.photonUrl, fetcher);
  const network = deps.network ?? browserNetwork();
  const formatClock = deps.formatClock ?? ((ms: number) => defaultClock.format(ms));
  const places = new PlaceBook(store);

  const stateListeners = new Set<(state: NavState, readouts: Readouts) => void>();
  const soundListeners = new Set<(event: TurnSoundEvent) => void>();

  let state: NavState = { kind: "idle" };
  /** The Route shown in `preview`, not yet adopted. */
  let previewed: PlannedRoute | undefined;
  let readouts: Readouts = { clock: formatClock(now()), daylight: false };
  let planned: PlannedRoute | undefined;
  let track: RouteTrack | undefined;
  let along = 0;
  /** After a reload the car may be anywhere on the Route, so the first snap searches all of it. */
  let snapWholeRoute = false;
  let offState: OffRouteState = ON_ROUTE;
  let networkFailed = false;
  let rerouting = false;
  let lastRerouteAt = Number.NEGATIVE_INFINITY;
  /** Bumped by start() and end(), so a late router answer for an old request is dropped. */
  let generation = 0;
  let lastPositionSavedAt = Number.NEGATIVE_INFINITY;

  const sounds = new TurnSoundScheduler({
    leadMs: deps.config.turnSoundLeadMs,
    now,
    emit(event) {
      for (const listener of [...soundListeners]) listener(event);
      const last = planned?.route.stops[planned.route.stops.length - 1];
      if (event.sound === "arrived" && planned && event.stop?.index === last?.index) arrive();
    },
  });

  const unsubscribeFixes = deps.fixes.subscribe(onFix);
  const unsubscribeNetwork = network.subscribe(onNetworkChange);
  const unsubscribeSettings = deps.settings?.subscribe(() => refreshReadouts()) ?? (() => undefined);
  const clockTimer = setInterval(refreshReadouts, READOUTS_EVERY_MS);
  resumeCachedRoute();
  refreshReadouts();

  function offline(): boolean {
    return networkFailed || !network.online();
  }

  function notify(): void {
    for (const listener of [...stateListeners]) listener(state, readouts);
  }

  function setState(next: NavState): void {
    state = next;
    notify();
  }

  function guidance(): Guidance | undefined {
    if (!planned) return undefined;
    return computeGuidance({ planned, along, now: now(), offRoute: offState.offRoute, offline: offline() });
  }

  function publishGuidance(): void {
    const g = guidance();
    if (!g) return;
    state = rerouting ? { kind: "rerouting", guidance: g } : { kind: "guiding", guidance: g };
  }

  function adopt(next: PlannedRoute, snapToFix: boolean): void {
    planned = next;
    track = new RouteTrack(decodePolyline(next.route.shape, 6));
    offState = ON_ROUTE;
    networkFailed = false;
    sounds.reset();
    const fix = deps.fixes.latest();
    along = fix && snapToFix ? track.snap(fix, 0, 2_000).along : 0;
    snapWholeRoute = false;
    store.set(ROUTE_KEY, JSON.stringify(next));
    if (next.speedLimits.length === 0) fillSpeedLimits(next);
  }

  /** Speed limits arrive after the Route; they fill in only if that Route is still the current one. */
  function fillSpeedLimits(target: PlannedRoute): void {
    const gen = generation;
    void router.speedLimits(target.route.shape).then((limits) => {
      if (gen !== generation || planned !== target || limits.length === 0) return;
      planned = { ...target, speedLimits: limits };
      store.set(ROUTE_KEY, JSON.stringify(planned));
      refreshReadouts();
    });
  }

  function resumeCachedRoute(): void {
    const cached = withRouteVia(readJson(store, ROUTE_KEY, isPlannedRoute));
    if (!cached || now() - cached.route.fetchedAt > ROUTE_CACHE_MAX_AGE_MS) {
      store.remove(ROUTE_KEY);
      return;
    }
    adopt(cached, false);
    snapWholeRoute = true;
    publishGuidance();
  }

  function clearRoute(): void {
    planned = undefined;
    previewed = undefined;
    track = undefined;
    along = 0;
    offState = ON_ROUTE;
    rerouting = false;
    sounds.reset();
    store.remove(ROUTE_KEY);
  }

  function arrive(): void {
    if (!planned) return;
    const destination = planned.route.destination;
    clearRoute();
    setState({ kind: "arrived", destination });
  }

  function lastPosition(): LatLng | undefined {
    const fix = deps.fixes.latest();
    if (fix) return fix;
    return readJson(store, LAST_POSITION_KEY, isLatLng);
  }

  function refreshReadouts(): void {
    const t = now();
    const fix = deps.fixes.latest();
    const position = lastPosition();
    const speed = fix && t - fix.at < SPEED_STALE_MS ? fix.speedMps : undefined;
    const limit = planned && !offState.offRoute ? speedLimitAt(planned.speedLimits, along) : undefined;
    const fixAgeMs = fix ? Math.max(0, Math.floor((t - fix.at) / 1000) * 1000) : undefined;
    const next: Readouts = {
      clock: formatClock(t),
      ...(speed !== undefined ? { speedKmh: speed * 3.6 } : {}),
      ...(limit !== undefined ? { speedLimitKmh: limit } : {}),
      daylight: resolveDaylight(deps.settings?.value.daylight ?? "auto", t, position),
      ...(fixAgeMs !== undefined ? { fixAgeMs } : {}),
    };
    const changed =
      next.clock !== readouts.clock ||
      next.speedKmh !== readouts.speedKmh ||
      next.speedLimitKmh !== readouts.speedLimitKmh ||
      next.daylight !== readouts.daylight ||
      next.fixAgeMs !== readouts.fixAgeMs;
    readouts = next;
    if (changed) notify();
  }

  function snapFix(fix: Fix): Snap | undefined {
    if (!track) return undefined;
    if (snapWholeRoute) {
      snapWholeRoute = false;
      return track.snap(fix);
    }
    const ahead = Math.max(2_000, (fix.speedMps ?? 0) * 60);
    const local = track.snap(fix, along - SNAP_BEHIND_M, along + ahead);
    if (local.offset <= leaveThresholdM(fix.accuracyM)) return local;
    // Lost locally (a GPS gap, a tunnel, a detour that rejoined): look along the whole Route.
    const whole = track.snap(fix);
    return whole.offset <= leaveThresholdM(fix.accuracyM) ? whole : local;
  }

  function onFix(fix: Fix): void {
    const t = now();
    if (t - lastPositionSavedAt > LAST_POSITION_EVERY_MS) {
      lastPositionSavedAt = t;
      store.set(LAST_POSITION_KEY, JSON.stringify({ lat: fix.lat, lng: fix.lng }));
    }
    if (planned && (state.kind === "guiding" || state.kind === "rerouting")) {
      const snap = snapFix(fix);
      if (snap) {
        const wasOff = offState.offRoute;
        offState = nextOffRoute(offState, snap.offset, fix.accuracyM);
        // Off the Route, the nearest point on it is still the best progress estimate.
        along = snap.along;
        if (offState.offRoute && !wasOff) sounds.now("off-route");
        if (offState.offRoute && !rerouting && t - lastRerouteAt >= REROUTE_RETRY_MS) void reroute();
      }
      publishGuidance();
      const g = state.kind === "guiding" || state.kind === "rerouting" ? state.guidance : undefined;
      if (g && !g.offRoute) {
        sounds.update({
          nextStop: g.nextStop,
          isArrival: g.nextStop.maneuver === "arrive",
          metersToNext: g.metersToNext,
          speedMps: fix.speedMps ?? 0,
        });
      }
    }
    refreshReadouts();
    notify();
  }

  function onNetworkChange(): void {
    if (network.online()) networkFailed = false;
    if (planned && offState.offRoute && !rerouting && network.online()) void reroute();
    else if (planned) {
      publishGuidance();
      notify();
    }
  }

  /** Places not yet reached: stops on the way whose arrival Stop is still ahead, then the Destination. */
  function remainingVia(p: PlannedRoute): Place[] {
    return p.via.slice(passedViaCount(p.route, along));
  }

  function fromFix(fix: Fix): LatLng & { headingDeg?: number } {
    return { lat: fix.lat, lng: fix.lng, ...(fix.headingDeg !== undefined ? { headingDeg: fix.headingDeg } : {}) };
  }

  async function reroute(via?: readonly Place[]): Promise<void> {
    const current = planned;
    const fix = deps.fixes.latest();
    if (!current || !fix) return;
    lastRerouteAt = now();
    if (!network.online()) {
      publishGuidance();
      notify();
      return;
    }
    const gen = generation;
    rerouting = true;
    publishGuidance();
    notify();
    try {
      const next = await router.route({ from: fromFix(fix), via: via ?? remainingVia(current) });
      if (gen !== generation) return;
      rerouting = false;
      adopt(next, true);
    } catch (error) {
      if (gen !== generation) return;
      rerouting = false;
      if (error instanceof RouteError && error.failure.kind === "network") networkFailed = true;
      if (via) {
        publishGuidance();
        notify();
        throw error;
      }
    }
    publishGuidance();
    notify();
  }

  async function waitForFix(): Promise<Fix> {
    const latest = deps.fixes.latest();
    if (latest) return latest;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error("No GPS position yet. Check that location is allowed for Vela."));
      }, deps.firstFixTimeoutMs ?? 20_000);
      const unsubscribe = deps.fixes.subscribe((fix) => {
        clearTimeout(timer);
        unsubscribe();
        resolve(fix);
      });
    });
  }

  /** Route to a Destination from the current fix, through `routing`. Undefined after an error or a newer request. */
  async function plan(destination: Place): Promise<PlannedRoute | undefined> {
    const gen = ++generation;
    clearRoute();
    places.addRecent(destination);
    setState({ kind: "routing", destination });
    try {
      const fix = await waitForFix();
      if (gen !== generation) return undefined;
      const next = await router.route({ from: fromFix(fix), via: [destination] });
      return gen === generation ? next : undefined;
    } catch (error) {
      if (gen !== generation) return undefined;
      const message =
        error instanceof RouteError && error.failure.kind === "network"
          ? "No signal. A Route needs signal to start; guidance then works without it."
          : error instanceof Error
            ? error.message
            : String(error);
      setState({ kind: "error", message });
      return undefined;
    }
  }

  function startGuiding(next: PlannedRoute): void {
    previewed = undefined;
    adopt(next, true);
    publishGuidance();
    notify();
  }

  /** Re-route the previewed Route through `via`. Rejects and keeps the preview on failure. */
  async function replan(via: readonly Place[]): Promise<void> {
    const fix = deps.fixes.latest();
    if (!fix) throw new Error("No GPS position yet. Check that location is allowed for Vela.");
    const gen = generation;
    const next = await router.route({ from: fromFix(fix), via });
    if (gen !== generation || state.kind !== "preview") return;
    previewed = next;
    setState({ kind: "preview", route: next.route });
  }

  const engine: DisposableNavEngine = {
    get state() {
      return state;
    },
    get readouts() {
      return readouts;
    },

    async start(destination) {
      const next = await plan(destination);
      if (next) startGuiding(next);
    },

    async preview(destination) {
      const next = await plan(destination);
      if (!next) return;
      previewed = next;
      setState({ kind: "preview", route: next.route });
    },

    startPreview() {
      if (state.kind !== "preview" || !previewed) return;
      startGuiding(previewed);
    },

    cancelPreview() {
      if (state.kind !== "preview") return;
      generation++;
      clearRoute();
      setState({ kind: "idle" });
    },

    async addStop(place) {
      if (state.kind === "preview" && previewed) {
        const via = previewed.via;
        return replan([...via.slice(0, -1), place, via[via.length - 1] as Place]);
      }
      if (!planned) return engine.start(place);
      const via = remainingVia(planned);
      const destination = via[via.length - 1] as Place;
      await reroute([...via.slice(0, -1), place, destination]);
    },

    async removeStop(index) {
      const current = state.kind === "preview" ? previewed : planned;
      if (!current || !Number.isInteger(index) || index < 0 || index >= current.route.via.length) {
        throw new RangeError(`There is no stop on the way at ${index}`);
      }
      if (state.kind === "preview") return replan(current.via.filter((_, i) => i !== index));
      const passed = passedViaCount(current.route, along);
      if (index < passed) throw new RangeError("That stop on the way is already behind you");
      await reroute(remainingVia(current).filter((_, i) => i !== index - passed));
    },

    end() {
      generation++;
      clearRoute();
      setState({ kind: "idle" });
      refreshReadouts();
    },

    savedPlaces: () => places.saved(),
    savePlace: (name, place) => places.save(name, place),
    recentDestinations: () => places.recent(),

    search(query, near) {
      const position = near ?? lastPosition();
      return search(query, position);
    },

    subscribe(listener) {
      stateListeners.add(listener);
      listener(state, readouts);
      return () => stateListeners.delete(listener);
    },

    onTurnSound(listener) {
      soundListeners.add(listener);
      return () => soundListeners.delete(listener);
    },

    dispose() {
      generation++;
      sounds.reset();
      clearInterval(clockTimer);
      unsubscribeSettings();
      unsubscribeFixes();
      unsubscribeNetwork();
      stateListeners.clear();
      soundListeners.clear();
    },
  };
  return engine;
}

/** Daylight contrast from the setting; "auto" is between sunrise and sunset at the position. */
export function resolveDaylight(mode: DaylightMode, at: number, position: LatLng | undefined): boolean {
  if (mode === "on") return true;
  if (mode === "off") return false;
  if (position) return isDaylight(at, position);
  // Without any position yet, assume daylight between 07:00 and 19:00 local time.
  const hour = new Date(at).getHours();
  return hour >= 7 && hour < 19;
}

/** Routes cached before `Route.via` existed get it from the planned places. */
function withRouteVia(p: PlannedRoute | undefined): PlannedRoute | undefined {
  if (!p || Array.isArray((p.route as Partial<Route>).via)) return p;
  return { ...p, route: { ...p.route, via: p.via.slice(0, -1) } };
}

function isLatLng(v: unknown): v is LatLng {
  return typeof v === "object" && v !== null && typeof (v as LatLng).lat === "number" && typeof (v as LatLng).lng === "number";
}

function isStop(v: unknown): v is Stop {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.index === "number" &&
    typeof s.maneuver === "string" &&
    typeof s.instruction === "string" &&
    typeof s.routeMeters === "number" &&
    isLatLng(s.at)
  );
}

function isPlannedRoute(v: unknown): v is PlannedRoute {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  const route = p.route as Record<string, unknown> | undefined;
  return (
    typeof route === "object" &&
    route !== null &&
    typeof route.shape === "string" &&
    typeof route.totalMeters === "number" &&
    typeof route.totalSec === "number" &&
    typeof route.fetchedAt === "number" &&
    isPlace(route.destination) &&
    Array.isArray(route.stops) &&
    route.stops.length > 0 &&
    route.stops.every(isStop) &&
    Array.isArray(p.via) &&
    p.via.every(isPlace) &&
    Array.isArray(p.timeline) &&
    Array.isArray(p.speedLimits)
  );
}
