/** Navigation: Route, Stops, progress and Turn sounds. Words follow CONTEXT.md. */

export interface LatLng {
  readonly lat: number;
  readonly lng: number;
}

export interface Place extends LatLng {
  readonly name: string;
  readonly address?: string;
}

export type Maneuver =
  | "straight" | "slight-right" | "right" | "sharp-right" | "uturn"
  | "slight-left" | "left" | "sharp-left" | "keep-left" | "keep-right"
  | "merge" | "ramp-left" | "ramp-right" | "exit-left" | "exit-right"
  | "roundabout" | "arrive";

/** A point on the Route where the driver acts; the Destination is the last Stop. */
export interface Stop {
  readonly index: number;
  readonly maneuver: Maneuver;
  /** Road or place the driver turns onto, as the router names it. */
  readonly street: string;
  /** Short instruction, e.g. "Keep right onto US-36 W". */
  readonly instruction: string;
  readonly at: LatLng;
  /** Distance from Route start to this Stop, in metres. */
  readonly routeMeters: number;
  /** Informational Stops (state lines, time zones) need no action. */
  readonly info?: boolean;
  /** Roundabouts: which exit to take, counted from the entry (Valhalla's `roundabout_exit_count`). */
  readonly exit?: number;
}

export interface Route {
  readonly destination: Place;
  /** Stops on the way (fuel, food), in the order this Route visits them, before the Destination. */
  readonly via: readonly Place[];
  readonly stops: readonly Stop[];
  /** Encoded polyline (precision 6) of the whole Route, cached for offline guidance. */
  readonly shape: string;
  readonly totalMeters: number;
  readonly totalSec: number;
  readonly fetchedAt: number;
}

/** Everything a driving view needs, recomputed on every GPS fix. */
export interface Guidance {
  readonly route: Route;
  readonly nextStop: Stop;
  /** The Stop after the next one, for "then …". */
  readonly thenStop?: Stop;
  readonly metersToNext: number;
  readonly secToNext: number;
  /** 0..1 of the whole Route. */
  readonly progress: number;
  /** 0..1 of the current leg, from the previous Stop to the next one. */
  readonly legProgress: number;
  readonly metersLeft: number;
  readonly secLeft: number;
  /** Arrival time, epoch milliseconds. */
  readonly arriveAt: number;
  readonly offRoute: boolean;
  /** True while there is no signal; guidance continues from the cached Route. */
  readonly offline: boolean;
  /** The next stop on the way not yet reached; absent when only the Destination is left. */
  readonly nextVia?: {
    readonly place: Place;
    readonly metersTo: number;
    readonly secTo: number;
    /** Epoch milliseconds. */
    readonly arriveAt: number;
  };
}

export type NavState =
  | { readonly kind: "idle" }
  | { readonly kind: "routing"; readonly destination: Place }
  /** A Route fetched and shown before it starts: time, distance and Start. */
  | { readonly kind: "preview"; readonly route: Route }
  | { readonly kind: "guiding"; readonly guidance: Guidance }
  | { readonly kind: "rerouting"; readonly guidance: Guidance }
  | { readonly kind: "arrived"; readonly destination: Place }
  | { readonly kind: "error"; readonly message: string };

/** The four earcons. The audio side plays them; nav decides when. */
export type TurnSound = "approach" | "turn-now" | "off-route" | "arrived";

export interface TurnSoundEvent {
  readonly sound: TurnSound;
  /** When the sound should be heard, epoch ms; emitted `turnSoundLeadMs` earlier. */
  readonly heardAt: number;
  readonly stop?: Stop;
}

/** Readouts that are not part of a Route. */
export interface Readouts {
  /** Local clock, "1:25 PM". */
  readonly clock: string;
  readonly speedKmh?: number;
  /** From OpenStreetMap; often unknown on rural roads. */
  readonly speedLimitKmh?: number;
  /** Daylight contrast, resolved from the setting: "auto" means between sunrise and sunset here. */
  readonly daylight: boolean;
  /** Age of the last GPS fix in milliseconds; absent before the first fix. */
  readonly fixAgeMs?: number;
}

export interface NavEngine {
  readonly state: NavState;
  readonly readouts: Readouts;
  /** Route to the Destination and start guiding at once (the Co-driver's tools use this). */
  start(destination: Place): Promise<void>;
  /** Route to the Destination and show it as `preview`, without starting. */
  preview(destination: Place): Promise<void>;
  /** Start guiding the previewed Route. Does nothing outside `preview`. */
  startPreview(): void;
  /** Drop the previewed Route and go back to idle. Does nothing outside `preview`. */
  cancelPreview(): void;
  /**
   * Add a stop on the way (fuel, food) after the other stops, before the Destination, and re-route.
   * In `preview` the preview is re-routed; with no Route it starts one to the place.
   * Rejects (and keeps the current Route) when the router cannot answer.
   */
  addStop(place: Place): Promise<void>;
  /** Remove `Route.via[index]` and re-route. Rejects (and keeps the current Route) on failure. */
  removeStop(index: number): Promise<void>;
  end(): void;
  savedPlaces(): readonly Place[];
  savePlace(name: string, place: Place): void;
  recentDestinations(): readonly Place[];
  search(query: string, near?: LatLng): Promise<readonly Place[]>;
  subscribe(listener: (state: NavState, readouts: Readouts) => void): () => void;
  onTurnSound(listener: (event: TurnSoundEvent) => void): () => void;
}

/** One position fix, the input to both guidance and Trips. */
export interface Fix extends LatLng {
  readonly at: number;
  readonly accuracyM: number;
  readonly speedMps?: number;
  readonly headingDeg?: number;
}

/**
 * Trips: every drive while Vela is open and the car is moving, reported to Traccar.
 * Fixes recorded without signal are queued and sent later with their original timestamps.
 */
export interface TripsReporter {
  record(fix: Fix): void;
  /** Positions waiting to be sent. */
  readonly queued: number;
  flush(): Promise<void>;
  /** Called with the new `queued` count each time it changes. Read `queued` for the current one. */
  subscribe(fn: (queued: number) => void): () => void;
}
