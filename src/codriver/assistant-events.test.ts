import type { AssistantCard, Item, ListenCommand } from "../contract";
import { createAssistantEvents, isAssistantCard, isAssistantMediaAction } from "./assistant-events";

const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const episode: Item = { source: "podcasts", id: "episode-1", title: "Invented Engines", by: "Test Radio" };
const weather: AssistantCard = {
  kind: "Weather", place: "Test town", units: "metric", range: "week",
  attribution: "Weather data by Open-Meteo.com, CC BY 4.0",
  now: { glyph: "rain", temperature: 12, feelsLike: 10, wind: 5, humidity: 80, summary: "light rain" },
  hours: [{ hour: "14", glyph: "rain", temperature: 14, precipitation: 90 }],
  days: [{ date: "2026-01-01", weekday: "Thu", glyph: "rain", high: 15, low: 5, precipitation: 90 }],
};

test("documented media actions execute once in wire order, including while a search waits", async () => {
  const commands: ListenCommand[] = []; const queries: string[] = [];
  let finish: ((items: readonly Item[]) => void) | undefined;
  const events = createAssistantEvents({
    send: async (command) => { commands.push(command); },
    search: async (source, query) => { expect(source).toBe("podcasts"); queries.push(query); return new Promise((done) => { finish = done; }); },
  }, () => { throw new Error("no cards expected"); });
  const actions = [
    { version: 1, id: "play-1", kind: "media", command: "play" },
    { version: 1, id: "pause-1", kind: "media", command: "pause" },
    { version: 1, id: "skip-1", kind: "media", command: "skip" },
    { version: 1, id: "volume-1", kind: "media", command: "volume", volume: 42 },
    { version: 1, id: "podcast-1", kind: "media", command: "podcast", query: "Invented Engines" },
    { version: 1, id: "pause-2", kind: "media", command: "pause" },
  ];
  for (const action of actions) { events.receive({ type: "assistant.action", action }); events.receive({ type: "assistant.action", action }); }
  await settle();
  expect(commands).toEqual([{ type: "play" }, { type: "pause" }, { type: "forward" }, { type: "volume", volume: 42 }]);
  expect(queries).toEqual(["Invented Engines"]);
  finish?.([episode]); await settle();
  expect(commands.slice(-2)).toEqual([{ type: "playItem", item: episode }, { type: "pause" }]);
  events.dispose();
});

test.each([
  null, [], {}, { version: 2, id: "x", kind: "media", command: "play" },
  { version: 1, id: "x", kind: "other", command: "play" },
  { version: 1, id: "", kind: "media", command: "play" },
  { version: 1, id: "x", kind: "media", command: "delete" },
  ...[-1, 101, Number.POSITIVE_INFINITY, Number.NaN, "50"].map((volume) => ({ version: 1, id: "x", kind: "media", command: "volume", volume })),
  ...["", " ", 42].map((query) => ({ version: 1, id: "x", kind: "media", command: "podcast", query })),
])("rejects unknown or invalid actions: %j", async (action) => {
  expect(isAssistantMediaAction(action)).toBe(false);
  const send = vi.fn(async () => undefined); const search = vi.fn(async () => []);
  const events = createAssistantEvents({ send, search }, () => undefined);
  events.receive({ type: "assistant.action", action }); await settle();
  expect(send).not.toHaveBeenCalled(); expect(search).not.toHaveBeenCalled(); events.dispose();
});

test("Weather and Reflex cards pass as typed display data; enrichment is ignored", () => {
  const cards: AssistantCard[] = [];
  const events = createAssistantEvents({ send: async () => undefined, search: async () => [] }, (card) => cards.push(card));
  const reflex: AssistantCard = { kind: "Reflex", title: "Saved", text: "Add this note?", data: { ids: ["title-1"], enabled: true }, askId: "ask-1" };
  events.receive({ type: "assistant.card", card: reflex }); events.receive({ type: "assistant.card", card: weather });
  events.receive({ type: "assistant.enrichment" });
  expect(cards).toEqual([reflex, weather]);
  for (const card of [null, [], { kind: "Reflex", title: 42, text: "x" }, { ...weather, units: "unknown" }, { ...weather, now: {} }, { ...weather, hours: [{}] }, { ...weather, days: [{}] }, { ...reflex, data: () => undefined }]) {
    expect(isAssistantCard(card)).toBe(false); events.receive({ type: "assistant.card", card });
  }
  expect(cards).toHaveLength(2); events.dispose();
});

test("failed execution is contained, is not repeated, and does not block later actions", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  try {
    const commands: ListenCommand[] = [];
    const events = createAssistantEvents({ search: async () => [], send: async (command) => { commands.push(command); if (command.type === "play") throw new Error("unavailable"); } }, () => undefined);
    for (const command of ["play", "podcast", "pause", "play"]) events.receive({ type: "assistant.action", action: { version: 1, id: command, kind: "media", command, query: "Missing Podcast" } });
    await settle(); expect(commands).toEqual([{ type: "play" }, { type: "pause" }]); expect(warn).toHaveBeenCalledTimes(2); events.dispose();
  } finally { warn.mockRestore(); }
});

test("dispose prevents an in-flight search or queued commands from playing", async () => {
  let finish: ((items: readonly Item[]) => void) | undefined;
  const send = vi.fn(async () => undefined);
  const events = createAssistantEvents({ send, search: () => new Promise((done) => { finish = done; }) }, () => undefined);
  events.receive({ type: "assistant.action", action: { version: 1, id: "search", kind: "media", command: "podcast", query: "Engines" } });
  events.receive({ type: "assistant.action", action: { version: 1, id: "play", kind: "media", command: "play" } });
  await settle(); events.dispose(); finish?.([episode]); await settle(); expect(send).not.toHaveBeenCalled();
});
