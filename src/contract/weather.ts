/** Forecast intervals along the remaining route, measured from the car in kilometres. */
export type WeatherKind = "clear" | "rain" | "snow" | "fog" | "storm";
export interface WeatherStretch {
  readonly fromKm: number;
  readonly toKm: number;
  readonly kind: WeatherKind;
  readonly label: string;
  /** True for the interval containing the car; the following interval is next. */
  readonly current: boolean;
}
export interface Weather {
  /** Fetch time of the retained forecast, including offline/failed-refresh data. */
  readonly fetchedAt?: number | undefined;
  /** Empty when no current route forecast is known. Adjacent equal conditions are merged. */
  readonly stretches: readonly WeatherStretch[];
  subscribe(fn: () => void): () => void;
}
