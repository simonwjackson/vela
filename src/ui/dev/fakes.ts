/**
 * Dev and test fakes of every contract interface the app mount uses. They hold a state you set,
 * notify subscribers, and record calls, so the dev page can show any state and tests can check
 * which contract API a tap called. Not in the production bundle.
 */
import { coDriverInfo } from "../../codriver/names";
import type {
  AppDeps,
  CarLink,
  CarReadings,
  CarState,
  MomentDismissBy,
  MomentShow,
  Moments,
  UiProblem,
  AppStatus,
  CoDriver,
  CoDriverInfo,
  DownloadStatus,
  Downloads,
  Item,
  Listening,
  ListenCommand,
  NavEngine,
  NavState,
  NowPlaying,
  Permission,
  Place,
  Readouts,
  Settings,
  SettingsStore,
  Shelf,
  SourceId,
  TalkState,
  TripsReporter,
  UpdateCheck,
  WakeState,
  WakeWord,
  Weather,
  WeatherStretch,
} from "../app/contract";

type Listener<T extends unknown[]> = (...args: T) => void;

class Subs<T extends unknown[]> {
  private fns = new Set<Listener<T>>();
  add(fn: Listener<T>): () => void {
    this.fns.add(fn);
    return () => this.fns.delete(fn);
  }
  emit(...args: T): void {
    for (const fn of [...this.fns]) fn(...args);
  }
}

export type Call = [string, ...unknown[]];

export class FakeNav implements NavEngine {
  state: NavState = { kind: "idle" };
  readouts: Readouts = { clock: "1:25 PM", daylight: false, fixAgeMs: 500 };
  saved: Place[] = [];
  recent: Place[] = [];
  results: Place[] | Error = [];
  calls: Call[] = [];
  /** What startPreview moves to (the dev page sets a guiding state). */
  onStart?: () => NavState;
  private subs = new Subs<[NavState, Readouts]>();

  set(state: NavState, readouts: Partial<Readouts> = {}): void {
    this.state = state;
    this.readouts = { ...this.readouts, ...readouts };
    this.subs.emit(this.state, this.readouts);
  }
  async start(destination: Place): Promise<void> {
    this.calls.push(["start", destination]);
  }
  async preview(destination: Place): Promise<void> {
    this.calls.push(["preview", destination]);
  }
  startPreview(): void {
    this.calls.push(["startPreview"]);
    if (this.onStart) this.set(this.onStart());
  }
  cancelPreview(): void {
    this.calls.push(["cancelPreview"]);
    if (this.state.kind === "preview") this.set({ kind: "idle" });
  }
  async addStop(place: Place): Promise<void> {
    this.calls.push(["addStop", place]);
  }
  async removeStop(index: number): Promise<void> {
    this.calls.push(["removeStop", index]);
  }
  end(): void {
    this.calls.push(["end"]);
    this.set({ kind: "idle" });
  }
  savedPlaces(): readonly Place[] {
    return this.saved;
  }
  savePlace(name: string, place: Place): void {
    this.calls.push(["savePlace", name, place]);
    this.saved = [...this.saved, { ...place, name }];
  }
  recentDestinations(): readonly Place[] {
    return this.recent;
  }
  async search(query: string): Promise<readonly Place[]> {
    this.calls.push(["search", query]);
    if (this.results instanceof Error) throw this.results;
    return this.results;
  }
  subscribe(listener: (state: NavState, readouts: Readouts) => void): () => void {
    return this.subs.add(listener);
  }
  onTurnSound(): () => void {
    return () => undefined;
  }
}

export class FakeListening implements Listening {
  nowPlaying: NowPlaying | undefined;
  shelf: Shelf = { music: undefined, podcasts: undefined, books: undefined };
  library: Partial<Record<SourceId, Item[]>> = {};
  searchResults: Item[] | undefined;
  calls: Call[] = [];
  private subs = new Subs<[{ nowPlaying: NowPlaying | undefined; shelf: Shelf }]>();

  set(nowPlaying: NowPlaying | undefined, shelf: Shelf = this.shelf): void {
    this.nowPlaying = nowPlaying;
    this.shelf = shelf;
    this.subs.emit({ nowPlaying, shelf });
  }
  async send(command: ListenCommand): Promise<void> {
    this.calls.push(["send", command]);
    const np = this.nowPlaying;
    if (np && command.type === "toggle") this.set({ ...np, transport: np.transport === "playing" ? "paused" : "playing" });
  }
  async search(source: SourceId, query: string): Promise<readonly Item[]> {
    this.calls.push(["search", source, query]);
    if (query && this.searchResults) return this.searchResults;
    return this.library[source] ?? [];
  }
  async yieldForTurnSound(): Promise<void> {}
  holdForTalk(): () => void {
    return () => undefined;
  }
  subscribe(listener: (state: { nowPlaying: NowPlaying | undefined; shelf: Shelf }) => void): () => void {
    return this.subs.add(listener);
  }
}

export class FakeDownloads implements Downloads {
  status: DownloadStatus = { phase: { kind: "idle" }, items: [], problems: {}, manualWifi: false };
  calls: Call[] = [];
  private subs = new Subs<[DownloadStatus]>();
  set(status: Partial<DownloadStatus>): void {
    this.status = { ...this.status, ...status };
    this.subs.emit(this.status);
  }
  async run(): Promise<void> {
    this.calls.push(["run"]);
  }
  setManualWifi(allowed: boolean): void {
    this.calls.push(["setManualWifi", allowed]);
    this.set({ manualWifi: allowed });
  }
  subscribe(listener: (status: DownloadStatus) => void): () => void {
    return this.subs.add(listener);
  }
}

export class FakeCoDriver implements CoDriver {
  state: TalkState = { kind: "idle" };
  current: CoDriverInfo = coDriverInfo("navigator");
  all: CoDriverInfo[] = [coDriverInfo("navigator")];
  calls: Call[] = [];
  private subs = new Subs<[TalkState]>();
  set(state: TalkState): void {
    this.state = state;
    this.subs.emit(state);
  }
  list(): readonly CoDriverInfo[] {
    return this.all;
  }
  press(): void {
    this.calls.push(["press"]);
    this.set({ kind: "listening", transcript: "" });
  }
  release(): void {
    this.calls.push(["release"]);
    this.set({ kind: "thinking", said: this.state.kind === "listening" ? this.state.transcript : "" });
  }
  cancel(): void {
    this.calls.push(["cancel"]);
    this.set({ kind: "idle" });
  }
  speak(text: string): void {
    this.calls.push(["speak", text]);
  }
  choose(id: string): void {
    this.calls.push(["choose", id]);
    this.current = this.all.find((c) => c.id === id) ?? { id };
    this.subs.emit(this.state);
  }
  subscribe(fn: (state: TalkState) => void): () => void {
    return this.subs.add(fn);
  }
}

export class FakeWake implements WakeWord {
  state: WakeState = { kind: "listening" };
  calls: Call[] = [];
  private subs = new Subs<[WakeState]>();
  set(state: WakeState): void {
    this.state = state;
    this.subs.emit(state);
  }
  enable(on: boolean): void {
    this.calls.push(["enable", on]);
  }
  subscribe(fn: (s: WakeState) => void): () => void {
    return this.subs.add(fn);
  }
}

export class FakeSettings implements SettingsStore {
  value: Settings = { moments: true, daylight: "auto", soundMode: { kind: "sounds" }, wakeWord: true, coDriver: "navigator", downloadsOnWifiOnly: true };
  calls: Call[] = [];
  private subs = new Subs<[Settings]>();
  set(patch: Partial<Settings>): void {
    this.calls.push(["set", patch]);
    this.value = { ...this.value, ...patch };
    this.subs.emit(this.value);
  }
  subscribe(fn: (s: Settings) => void): () => void {
    return this.subs.add(fn);
  }
}

export class FakeApp implements AppStatus {
  updateReady = false;
  soundBlocked = false;
  permissions: { location: Permission; mic: Permission } = { location: "granted", mic: "granted" };
  firstRun = false;
  /** What the next `checkForUpdate` finds, and how long it takes (the dev page shows "Checking"). */
  checkResult: UpdateCheck = "current";
  checkMs = 0;
  calls: Call[] = [];
  private subs = new Subs<[]>();
  set(patch: Partial<Pick<FakeApp, "updateReady" | "soundBlocked" | "permissions" | "firstRun">>): void {
    Object.assign(this, patch);
    this.subs.emit();
  }
  applyUpdate(): void {
    this.calls.push(["applyUpdate"]);
  }
  checkForUpdate(): Promise<UpdateCheck> {
    this.calls.push(["checkForUpdate"]);
    const result = this.checkResult;
    return new Promise((resolve) =>
      setTimeout(() => {
        // An update that installs takes over, as the real worker does.
        if (result === "updated") this.set({ updateReady: true });
        resolve(result);
      }, this.checkMs),
    );
  }
  restart(): void {
    this.calls.push(["restart"]);
  }
  unblockSound(): void {
    this.calls.push(["unblockSound"]);
    this.set({ soundBlocked: false });
  }
  finishFirstRun(): void {
    this.calls.push(["finishFirstRun"]);
    this.set({ firstRun: false });
  }
  subscribe(fn: () => void): () => void {
    return this.subs.add(fn);
  }
}

export class FakeTrips implements TripsReporter {
  queued = 0;
  status: { lastError?: string } = {};
  calls: Call[] = [];
  private subs = new Subs<[number]>();
  record(): void {}
  async flush(): Promise<void> {
    this.calls.push(["flush"]);
  }
  /** Change the queued count and tell subscribers, as the real reporter does. */
  setQueued(queued: number): void {
    if (queued === this.queued) return;
    this.queued = queued;
    this.subs.emit(queued);
  }
  subscribe(fn: (queued: number) => void): () => void {
    return this.subs.add(fn);
  }
}

/** The SurfaceLink stand-in: `show` and `clear` play the assistant; `sent` records what Vela reported. */
export class FakeMoments implements Moments {
  current: MomentShow | undefined = undefined;
  sent: (["problems", string, readonly UiProblem[]] | ["dismissed", string, MomentDismissBy])[] = [];
  private subs = new Subs<[MomentShow | undefined]>();
  show(m: MomentShow): void {
    this.current = m;
    this.subs.emit(m);
  }
  /** moment.dismiss from the assistant. */
  clear(): void {
    this.current = undefined;
    this.subs.emit(undefined);
  }
  subscribe(fn: (m: MomentShow | undefined) => void): () => void {
    return this.subs.add(fn);
  }
  problems(id: string, problems: readonly UiProblem[]): void {
    this.sent.push(["problems", id, problems]);
  }
  dismiss(id: string, by: MomentDismissBy): void {
    this.sent.push(["dismissed", id, by]);
    if (this.current?.id === id) this.clear();
  }
}

export class FakeCar implements CarLink {
  state: CarState = { kind: "unavailable" };
  readings: CarReadings = { at: 0 };
  calls: Call[] = [];
  private subs = new Subs<[]>();
  set(state: CarState, readings: Partial<CarReadings> = {}): void {
    this.state = state;
    this.readings = { ...this.readings, ...readings };
    this.subs.emit();
  }
  async connect(): Promise<void> {
    this.calls.push(["connect"]);
  }
  subscribe(fn: () => void): () => void {
    return this.subs.add(fn);
  }
}

/** Forecast fixture uses the same observable state contract as the weather engine. */
export class ScriptedWeather implements Weather {
  stretches: readonly WeatherStretch[] = [];
  private subs = new Subs<[]>();
  set(stretches: readonly WeatherStretch[]): void { this.stretches = stretches; this.subs.emit(); }
  subscribe(fn: () => void): () => void { return this.subs.add(fn); }
}

export interface Fakes {
  weather: ScriptedWeather;
  moments: FakeMoments;
  car: FakeCar;
  nav: FakeNav;
  trips: FakeTrips;
  listening: FakeListening;
  downloads: FakeDownloads;
  coDriver: FakeCoDriver;
  wake: FakeWake;
  settings: FakeSettings;
  app: FakeApp;
}

export function fakes(): Fakes & AppDeps {
  return {
    weather: new ScriptedWeather(),
    moments: new FakeMoments(),
    car: new FakeCar(),
    nav: new FakeNav(),
    trips: new FakeTrips(),
    listening: new FakeListening(),
    downloads: new FakeDownloads(),
    coDriver: new FakeCoDriver(),
    wake: new FakeWake(),
    settings: new FakeSettings(),
    app: new FakeApp(),
  };
}
