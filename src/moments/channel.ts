import type { Moments, MomentShow, SurfaceDown, SurfaceUp } from "../contract";

/** Validate transport shape before it reaches UI; program semantics belong to the UI gate. */
export function isMomentShow(v: unknown): v is MomentShow {
  if (!v || typeof v !== "object") return false;
  const m = v as Record<string, unknown>;
  const until = m.until as Record<string, unknown> | undefined;
  const cause = m.cause as Record<string, unknown> | undefined;
  return m.type === "moment.show" && typeof m.id === "string" && m.id.length > 0 && m.id.length <= 128 &&
    typeof m.program === "string" && new TextEncoder().encode(m.program).length <= 12288 &&
    typeof m.say === "string" && m.say.length <= 1000 && (m.when === "now" || m.when === "after-turn") &&
    !!until && ((typeof until.event === "string" && until.event.length <= 128) ||
      (typeof until.seconds === "number" && Number.isFinite(until.seconds) && until.seconds > 0 && until.seconds <= 86400)) &&
    !!cause && (cause.talk === true || typeof cause.event === "string") &&
    (m.chip === undefined || typeof m.chip === "string") && (m.silent === undefined || typeof m.silent === "boolean");
}
export function createMomentChannel(send: (m: SurfaceUp) => boolean) {
  let current: MomentShow | undefined;
  const listeners = new Set<(m: MomentShow | undefined) => void>();
  const notify = () => { for (const fn of listeners) fn(current); };
  const moments: Moments = {
    get current() { return current; },
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    problems(id, problems) { send({ type: "moment.problems", id, problems }); },
    dismiss(id, by) {
      if (current?.id !== id) return;
      current = undefined;
      send({ type: "moment.dismissed", id, by });
      notify();
    },
  };
  return { moments, receive(message: SurfaceDown) {
    if (message.type === "moment.show") {
      const id = message.id;
      if (!isMomentShow(message)) {
        if (typeof id === "string") moments.problems(id, [{ code: "message", message: "Invalid moment.show payload" }]);
        return;
      }
      current = message;
      notify();
    } else if (message.type === "moment.dismiss" && message.id === current?.id) {
      current = undefined;
      notify();
    }
  } };
}
