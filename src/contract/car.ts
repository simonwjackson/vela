/** Units are explicit; absent readings are unknown, never zero. */
export interface CarReadings {
  readonly at: number; readonly fuelPercent?: number; readonly rangeKm?: number;
  readonly ambientC?: number; readonly coolantC?: number; readonly voltage?: number;
  readonly speedKmh?: number; readonly mafGramsSec?: number; readonly fuelLitresHour?: number;
  readonly mil?: boolean; readonly dtcs?: readonly string[];
}
export type CarConnectReason = "no-device" | "permission" | "unavailable-api" | "cancelled";
export type CarState =
  | { kind: "unavailable" }
  /** A user gesture is required. Only this state calls for the Connect car chip. */
  | { kind: "connect"; reason?: CarConnectReason }
  | { kind: "connecting" }
  /** Automatic recovery; retryAt is absent while the page is hidden. */
  | { kind: "reconnecting"; attempt: number; retryAt?: number }
  | { kind: "connected" };
export interface CarLink {
  readonly state: CarState; readonly readings: CarReadings;
  connect(): Promise<void>;
  subscribe(fn: () => void): () => void;
}
