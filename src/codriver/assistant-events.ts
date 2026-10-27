import type { AssistantCard, AssistantJson, AssistantMediaAction, Listening, WeatherGlyph } from "../contract";

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const optionalText = (value: unknown) => value === undefined || typeof value === "string";
const glyph = (value: unknown): value is WeatherGlyph => ["clear", "partly", "cloudy", "fog", "drizzle", "rain", "snow", "storm"].some((g) => value === g);
const json = (value: unknown): value is AssistantJson => value === null || typeof value === "string" || typeof value === "boolean" || finite(value) ||
  (Array.isArray(value) ? value.every(json) : record(value) && Object.values(value).every(json));

/** Validate before executing; unknown versions and commands fail closed. */
export function isAssistantMediaAction(value: unknown): value is AssistantMediaAction {
  if (!record(value) || value.version !== 1 || value.kind !== "media" || typeof value.id !== "string" || !value.id.trim()) return false;
  switch (value.command) {
    case "play": case "pause": case "skip": return true;
    case "volume": return finite(value.volume) && value.volume >= 0 && value.volume <= 100;
    case "podcast": return typeof value.query === "string" && value.query.trim().length > 0;
    default: return false;
  }
}

/** Cards are data only. Neither these fields nor enrichment ever enter the speech queue. */
export function isAssistantCard(value: unknown): value is AssistantCard {
  if (!record(value)) return false;
  if (value.kind === "Reflex") return typeof value.title === "string" && typeof value.text === "string" && optionalText(value.askId) && (value.data === undefined || json(value.data));
  if (value.kind !== "Weather" || typeof value.place !== "string" || !optionalText(value.attribution) ||
    (value.units !== "imperial" && value.units !== "metric") || (value.range !== "today" && value.range !== "week")) return false;
  const now = value.now;
  return record(now) && glyph(now.glyph) && finite(now.temperature) && finite(now.feelsLike) && finite(now.wind) && finite(now.humidity) && typeof now.summary === "string" &&
    Array.isArray(value.hours) && value.hours.every((hour: unknown) => record(hour) && typeof hour.hour === "string" && glyph(hour.glyph) && finite(hour.temperature) && finite(hour.precipitation)) &&
    Array.isArray(value.days) && value.days.every((day: unknown) => record(day) && typeof day.date === "string" && typeof day.weekday === "string" && glyph(day.glyph) && finite(day.high) && finite(day.low) && finite(day.precipitation));
}

/** One ordered execution lane, with ids retained across Realtime reconnects for this client. */
export function createAssistantEvents(listening: Pick<Listening, "send" | "search">, card: (card: AssistantCard) => void) {
  const seen = new Set<string>();
  let disposed = false;
  let queue = Promise.resolve();
  async function execute(action: AssistantMediaAction): Promise<void> {
    if (disposed) return;
    switch (action.command) {
      case "play": case "pause": return listening.send({ type: action.command });
      case "skip": return listening.send({ type: "forward" });
      case "volume": return listening.send({ type: "volume", volume: action.volume });
      case "podcast": {
        const [item] = await listening.search("podcasts", action.query);
        if (disposed) return;
        if (!item) throw new Error("No matching Podcast found");
        return listening.send({ type: "playItem", item });
      }
    }
  }
  return {
    receive(event: { readonly type?: string; readonly action?: unknown; readonly card?: unknown }): void {
      if (disposed) return;
      if (event.type === "assistant.card" && isAssistantCard(event.card)) card(event.card);
      if (event.type !== "assistant.action" || !isAssistantMediaAction(event.action) || seen.has(event.action.id)) return;
      const action = event.action;
      seen.add(action.id);
      queue = queue.then(() => execute(action)).catch(() => { console.warn("Vela could not execute the assistant's media action"); });
    },
    dispose() { disposed = true; seen.clear(); },
  };
}
