/** Lifecycle events the running Vela surface can detect. */
export const UNTIL_EVENTS = ["turn.passed", "arrived", "stop.added", "stop.reached", "route.ended", "refuelled", "car.connected"] as const;
export type UntilEvent = (typeof UNTIL_EVENTS)[number];
export const MAX_LIFE_S = 600;

/** Shared calm budgets; capabilities and both validators consume these numbers. */
export const MOMENT_RULES = {
  leads: 1, leadLabelWords: 4, supportingItems: 2, outsideWords: 12,
  maxLifeSeconds: MAX_LIFE_S, untilEvents: UNTIL_EVENTS,
  turnMeters: 1000, chipWords: 3, retries: 2, contextBytes: 1024,
} as const;
export type MomentRules = typeof MOMENT_RULES;
export const MOMENT_RULES_TEXT = `One Lead with its own label of at most 4 words; at most 2 supporting items; at most 12 words outside Lead and base row (a bound value and unit count as 1). Every fact once. Every place distance has its name beside it. No whole phrase of say repeated on screen. While guiding a turn under 1 km leads; otherwise use after-turn and a chip of at most 3 words. The render must fit without clipping. Until events Vela can detect: ${UNTIL_EVENTS.join(", ")}. Use one of those events or until.seconds. Every Moment has a maximum life of ${MAX_LIFE_S} seconds, including unknown until events.`;
export const MOMENT_POSTURES = [
  { id: "ul", w: 932, h: 553 }, { id: "up", w: 704, h: 783 },
  { id: "fl", w: 711, h: 374 }, { id: "fp", w: 475, h: 638 },
] as const;
export interface UiProblem { line?: number; code: string; message: string; postures?: ("ul" | "up" | "fl" | "fp")[] }
export interface MomentCapabilities {
  enabled: boolean; version: number; schema: Readonly<Record<string, unknown>>;
  rules: { numbers: MomentRules; text: string }; examples: readonly string[];
  postures: typeof MOMENT_POSTURES;
}
export interface MomentShow {
  readonly type: "moment.show"; readonly id: string; readonly program: string; readonly say: string;
  readonly when: "now" | "after-turn"; readonly until: { event: string } | { seconds: number };
  readonly chip?: string; readonly silent?: boolean; readonly cause: { talk: true } | { event: string };
}
export type MomentDismissBy = "tap" | "voice" | "until";
/** UI owns presentation/lifecycle. Engine owns the received message and transport. */
export interface Moments {
  readonly current: MomentShow | undefined;
  subscribe(fn: (moment: MomentShow | undefined) => void): () => void;
  problems(id: string, problems: readonly UiProblem[]): void;
  dismiss(id: string, by: MomentDismissBy): void;
}
export type EventKind = "arrived" | "weather-ahead" | "stop-near" | "range-short" | "setting-off" | "long-leg";
export interface EventReport { readonly type: "event.report"; readonly id: string; readonly kind: EventKind; readonly context: Readonly<Record<string, unknown>> }
