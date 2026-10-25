/**
 * Off-route detection with hysteresis. Pure: feed it each fix's distance from the Route.
 * Going off needs several far fixes in a row; coming back needs a couple of close ones,
 * so one noisy fix never flips the state.
 */

export interface OffRouteState {
  readonly offRoute: boolean;
  /** Consecutive fixes that argue for the other state. */
  readonly streak: number;
}

export const ON_ROUTE: OffRouteState = { offRoute: false, streak: 0 };

/** Fixes worse than this are ignored for the decision. */
export const MAX_DECISION_ACCURACY_M = 75;
const FIXES_TO_LEAVE = 3;
const FIXES_TO_REJOIN = 2;

export function leaveThresholdM(accuracyM: number): number {
  return 50 + Math.min(accuracyM, 50);
}

export function rejoinThresholdM(accuracyM: number): number {
  return 25 + Math.min(accuracyM, 25);
}

export function nextOffRoute(state: OffRouteState, offsetM: number, accuracyM: number): OffRouteState {
  if (accuracyM > MAX_DECISION_ACCURACY_M) return state;
  if (!state.offRoute) {
    if (offsetM <= leaveThresholdM(accuracyM)) return ON_ROUTE;
    const streak = state.streak + 1;
    return streak >= FIXES_TO_LEAVE ? { offRoute: true, streak: 0 } : { offRoute: false, streak };
  }
  if (offsetM > rejoinThresholdM(accuracyM)) return { offRoute: true, streak: 0 };
  const streak = state.streak + 1;
  return streak >= FIXES_TO_REJOIN ? ON_ROUTE : { offRoute: true, streak };
}
