/** Real Talk + Listening + Source adapters, with an in-memory gateway and Services. No network. */
import type { AssistantCard, Item, SourceId } from "../contract";
import { createListeningFixture, settle } from "../audio/testing/listening-fixture";
import { SwitchableNetwork } from "../nav/fixtures";
import { createSettingsStore } from "../settings/store";
import { deviceIdFrom } from "../sources/device-id";
import { ScriptedMic } from "./mic";
import { pcm16ToBase64 } from "./pcm";
import { ScriptedSpeech } from "./speaker";
import { ANSWER_TIMEOUT_MS, createTalk } from "./talk";
import { InMemorySocketServer } from "./testing/in-memory-socket";

async function setup(source: SourceId = "podcasts") {
  const fixture = createListeningFixture();
  const mic = new ScriptedMic(); const speech = new ScriptedSpeech(); const server = new InMemorySocketServer();
  const talk = createTalk({
    origin: "https://voice.test", model: "assistant", channel: deviceIdFrom(fixture.storage, "vela.installId", "vela"), connect: server.connect,
    settings: createSettingsStore(undefined), mic, speech, listening: fixture.listening,
    surface: { replaced: false, restart() {}, subscribe: () => () => undefined }, network: new SwitchableNetwork(),
  });
  talk.start(); server.latest.accept();
  const item: Item | undefined = source === "music" ? (await fixture.listening.search("music", "Gull"))[0] : source === "podcasts" ?
    { source, id: "e-4", title: "Gears of Glass", by: "The Quiet Engine" } : { source, id: "b-lantern", title: "The Lantern Keeper", by: "A. Invented" };
  if (!item) throw new Error("missing test item");
  await fixture.listening.send({ type: "playItem", item }); await settle(); fixture.elements[source].advance(20);
  return { ...fixture, mic, speech, server, talk, dispose() { talk.dispose(); fixture.listening.dispose(); } };
}

afterEach(() => vi.useRealTimers());

test.each(["music", "podcasts", "books"] as const)("Talk pauses %s from press until the last answer sample; a paused item stays paused", async (source) => {
  const h = await setup(source); const socket = h.server.latest;
  h.talk.press(); expect(h.elements[source].paused).toBe(true); await settle();
  h.mic.frames(2, 0.1); h.talk.release(); expect(h.elements[source].paused).toBe(true);
  socket.push({ type: "response.created", response: { id: "r1" } });
  socket.push({ type: "response.output_audio.delta", response_id: "r1", delta: pcm16ToBase64(new Int16Array(2400)) });
  socket.push({ type: "response.done", response: { id: "r1" } });
  h.speech.advance(99); await settle(); expect(h.elements[source].paused).toBe(true);
  h.speech.advance(1); await settle(); expect(h.elements[source].paused).toBe(false);
  expect(h.listening.nowPlaying?.positionSec).toBe(source === "music" ? 20 : 18);
  await h.listening.send({ type: "pause" }); h.talk.press(); h.talk.cancel(); await settle(); expect(h.elements[source].paused).toBe(true);
  h.dispose();
});

test.each(["press", "wake"] as const)("%s pauses media immediately, and cancel resumes it", async (method) => {
  const h = await setup(); h.talk[method](); expect(h.elements.podcasts.paused).toBe(true);
  h.talk.cancel(); await settle(); expect(h.elements.podcasts.paused).toBe(false); expect(h.listening.nowPlaying?.positionSec).toBe(18); h.dispose();
});

test.each([false, true])("no answer releases the hold even if response.created arrived: %s", async (created) => {
  vi.useFakeTimers();
  const h = await setup(); h.talk.press(); await settle(); h.mic.frames(2, 0.1); h.talk.release();
  if (created) h.server.latest.push({ type: "response.created", response: { id: "r1" } });
  await vi.advanceTimersByTimeAsync(ANSWER_TIMEOUT_MS); await settle();
  expect(h.talk.state.kind).toBe("idle"); expect(h.elements.podcasts.paused).toBe(false); h.dispose();
});

test("a barge-in transfers the hold without a brief resume and a driver pause cancels resume", async () => {
  const h = await setup("music"); h.talk.press(); await settle(); h.mic.frames(2, 0.1); h.talk.release();
  const socket = h.server.latest;
  socket.push({ type: "response.created", response: { id: "r1" } });
  socket.push({ type: "response.output_audio.delta", response_id: "r1", delta: pcm16ToBase64(new Int16Array(2400)) });
  const play = vi.spyOn(h.elements.music, "play"); h.talk.press(); await settle(); expect(play).not.toHaveBeenCalled();
  await h.listening.send({ type: "pause" }); h.talk.cancel(); await settle(); expect(h.elements.music.paused).toBe(true); h.dispose();
});

test("Realtime passthroughs act on Listening, stream cards, ignore enrichment, and keep a stable channel on reconnect", async () => {
  vi.useFakeTimers(); const h = await setup(); const socket = h.server.latest;
  const url = new URL(socket.url);
  expect(url.searchParams.get("model")).toBe("assistant"); expect(url.searchParams.get("surface")).toBe("talk");
  expect(url.searchParams.get("channel")).toBe(deviceIdFrom(h.storage, "vela.installId", "vela")); expect(url.searchParams.get("channel")).toMatch(/^vela-[a-z0-9-]+$/);
  const cards: AssistantCard[] = []; const off = h.talk.onCard?.((card) => cards.push(card));
  const card: AssistantCard = { kind: "Reflex", title: "Playback", text: "Asking your device to pause." };
  socket.push({ type: "assistant.card", card }); socket.push({ type: "assistant.enrichment", enrichment: { version: 1, text: "Display only", spoken: false } });
  socket.push({ type: "assistant.action", action: { version: 1, id: "pause-1", kind: "media", command: "pause" } }); await settle();
  expect(h.elements.podcasts.paused).toBe(true); expect(cards).toEqual([card]); expect(h.speech.queuedMs).toBe(0);
  await h.listening.send({ type: "play" }); await settle(); socket.drop(1006); await vi.advanceTimersByTimeAsync(1000); h.server.latest.accept();
  expect(h.server.latest.url).toBe(socket.url);
  h.server.latest.push({ type: "assistant.action", action: { version: 1, id: "pause-1", kind: "media", command: "pause" } }); await settle(); expect(h.elements.podcasts.paused).toBe(false);
  h.server.latest.push({ type: "assistant.action", action: { version: 1, id: "v1", kind: "media", command: "volume", volume: 50 } }); await settle(); expect(h.elements.podcasts.volume).toBe(0.5);
  off?.(); h.server.latest.push({ type: "assistant.card", card }); expect(cards).toHaveLength(1);
  h.server.latest.push(null); h.dispose();
});
