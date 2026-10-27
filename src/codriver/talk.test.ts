import type { TalkState } from "../contract";
import { SwitchableNetwork } from "../nav/fixtures";
import { createSettingsStore } from "../settings/store";
import { ScriptedMic } from "./mic";
import { pcm16ToBase64 } from "./pcm";
import { ScriptedSpeech } from "./speaker";
import { createTalk } from "./talk";
import { InMemorySocketServer } from "./testing/in-memory-socket";

const settle = () => new Promise((r) => setTimeout(r, 0));

function setup(fetcher?: typeof fetch) {
  const server = new InMemorySocketServer();
  const mic = new ScriptedMic();
  const speech = new ScriptedSpeech();
  const network = new SwitchableNetwork();
  const settings = createSettingsStore(undefined);
  const holds = { taken: 0, released: 0 };
  const surface = {
    replaced: false,
    restarts: 0,
    restart() {
      this.replaced = false;
      this.restarts += 1;
    },
    subscribe: () => () => undefined,
  };
  const permissions: string[] = [];
  const talk = createTalk({
    ...(fetcher ? { fetcher } : {}),
    origin: "https://voice.test",
    model: "assistant",
    channel: "vela-install-1",
    connect: server.connect,
    settings,
    mic,
    speech,
    listening: {
      send: async () => undefined, search: async () => [],
      holdForTalk: () => {
        holds.taken += 1;
        return () => {
          holds.released += 1;
        };
      },
    },
    surface,
    network,
    onMicPermission: (s) => permissions.push(s),
  });
  const states: TalkState[] = [];
  talk.subscribe((s) => states.push(s));
  talk.start();
  return { server, mic, speech, network, settings, holds, surface, talk, states, permissions };
}

/*
 * Server events in voice-gateway's exact shapes (src/realtime.rs on rust-port): `emit` adds
 * `event_id`; deltas come from `audio_event` with a top-level `response_id`; `response.created`
 * and `response.done` name the response only as `response.id`.
 */
let eventCounter = 0;
const eventId = () => `event-${++eventCounter}`;

function audioEvent(type: string, responseId: string, itemId: string, extra: Record<string, unknown>) {
  return { event_id: eventId(), type, response_id: responseId, item_id: itemId, output_index: 0, content_index: 0, ...extra };
}

/** A 100 ms answer chunk from the gateway. */
function audioDelta(responseId: string, itemId = "item-1") {
  return audioEvent("response.output_audio.delta", responseId, itemId, { delta: pcm16ToBase64(new Int16Array(2400).fill(1000)) });
}

function transcriptDelta(responseId: string, text: string, itemId = "item-1") {
  return audioEvent("response.output_audio_transcript.delta", responseId, itemId, { delta: text });
}

/** `finish`: response.done, exactly as the gateway sends it (no top-level response_id). */
function done(responseId: string, status: "completed" | "cancelled", itemId = "item-1", transcript = "") {
  return {
    event_id: eventId(),
    type: "response.done",
    response: {
      id: responseId,
      status,
      output: [
        {
          id: itemId,
          type: "message",
          status: status === "completed" ? "completed" : "incomplete",
          role: "assistant",
          content: [{ type: "audio", transcript }],
        },
      ],
    },
  };
}

function answer(socket: ReturnType<typeof setup>["server"]["latest"], responseId: string, itemId = "item-1") {
  socket.push({
    event_id: eventId(),
    type: "response.created",
    response: { id: responseId, status: "in_progress", output: [{ id: itemId, type: "message", role: "assistant" }] },
  });
}

test("the Talk socket sequence: session, press, release, answer, barge-in", async () => {
  const h = setup();
  const socket = h.server.latest;
  expect(socket.url).toBe("wss://voice.test/v1/realtime?model=assistant&channel=vela-install-1&surface=talk");
  socket.accept();
  expect(socket.sent).toEqual([{ type: "session.update", session: { voice: "navigator", turn_detection: null } }]);
  expect(h.talk.state).toEqual({ kind: "idle" });

  // Press: clear first (stops the Co-driver), then the microphone.
  h.talk.press();
  expect(socket.types().at(-1)).toBe("input_audio_buffer.clear");
  expect(h.talk.state).toEqual({ kind: "listening", transcript: "" });
  await settle();
  expect(h.mic.users).toBe(1);
  h.mic.frames(3, 0.1);
  const appends = socket.sent.filter((m) => m.type === "input_audio_buffer.append");
  expect(appends).toHaveLength(3);
  // 100 ms at 16 kHz becomes 100 ms at 24 kHz: 2400 samples, 4800 bytes.
  expect(atob(String(appends[0]?.audio)).length).toBe(4800);

  // Release: commit, then response.create.
  h.talk.release();
  expect(socket.types().slice(-2)).toEqual(["input_audio_buffer.commit", "response.create"]);
  expect(h.mic.users).toBe(0);
  expect(h.talk.state).toEqual({ kind: "thinking", said: "" });
  socket.push({ type: "conversation.item.input_audio_transcription.completed", item_id: "u1", content_index: 0, transcript: "Take me home" });
  expect(h.talk.state).toEqual({ kind: "thinking", said: "Take me home" });

  answer(socket, "resp-1");
  socket.push(transcriptDelta("resp-1", "Heading home. "));
  socket.push(audioDelta("resp-1"));
  socket.push(audioDelta("resp-1"));
  expect(h.talk.state).toMatchObject({ kind: "speaking", text: "Heading home. ", progress: 0 });
  expect(h.holds).toEqual({ taken: 1, released: 0 });
  h.speech.advance(150);

  // Barge-in: clear, truncate to what was heard, then the microphone again.
  const before = socket.sent.length;
  h.talk.press();
  expect(socket.sent.slice(before)).toEqual([
    { type: "input_audio_buffer.clear" },
    { type: "conversation.item.truncate", item_id: "item-1", content_index: 0, audio_end_ms: 150 },
  ]);
  expect(h.holds.released).toBe(1);
  expect(h.talk.state.kind).toBe("listening");

  // The cancelled answer's late events never touch the new turn.
  socket.push(done("resp-1", "cancelled"));
  socket.push(audioDelta("resp-1"));
  expect(h.talk.state.kind).toBe("listening");
  await settle();
  h.mic.frames(2, 0.1);
  h.talk.release();
  answer(socket, "resp-2", "item-2");
  socket.push(audioDelta("resp-2", "item-2"));
  socket.push(done("resp-2", "completed", "item-2"));
  expect(h.talk.state.kind).toBe("speaking");
  h.speech.advance(100);
  expect(h.talk.state).toEqual({ kind: "idle" });
  expect(h.holds).toEqual({ taken: 2, released: 2 });
  h.talk.dispose();
});

test("a tap too short to send audio clears instead of committing", async () => {
  const h = setup();
  h.server.latest.accept();
  h.talk.press();
  h.talk.release();
  await settle();
  expect(h.server.latest.types()).toEqual(["session.update", "input_audio_buffer.clear", "input_audio_buffer.clear"]);
  expect(h.talk.state).toEqual({ kind: "idle" });
  expect(h.mic.users).toBe(0);
  h.talk.dispose();
});

test("cancel while thinking cancels the response", async () => {
  const h = setup();
  h.server.latest.accept();
  h.talk.press();
  await settle();
  h.mic.frames(1, 0.1);
  h.talk.release();
  h.talk.cancel();
  expect(h.server.latest.types().at(-1)).toBe("response.cancel");
  expect(h.talk.state).toEqual({ kind: "idle" });
  h.talk.dispose();
});

test("choosing a Co-driver updates the session and reconnects the SurfaceLink", () => {
  const h = setup();
  h.server.latest.accept();
  h.talk.choose("guide");
  expect(h.server.latest.sent.at(-1)).toEqual({ type: "session.update", session: { voice: "guide", turn_detection: null } });
  expect(h.surface.restarts).toBe(1);
  expect(h.talk.current).toEqual({ id: "guide", kind: "guide", displayName: "Guide" });
  h.talk.choose("road-buddy");
  expect(h.talk.current).toEqual({ id: "road-buddy" });
  expect(h.talk.list().map((c) => c.id)).toEqual(["navigator", "companion", "guide", "road-buddy"]);
  h.talk.dispose();
});

test("at rest the state shows the link: offline, unreachable, replaced, mic-denied", async () => {
  vi.useFakeTimers();
  try {
    const h = setup();
    expect(h.talk.state).toEqual({ kind: "idle" }); // the first connection is under way
    h.network.set(false);
    h.server.latest.drop(1006);
    expect(h.talk.state).toEqual({ kind: "offline" });
    h.network.set(true);
    expect(h.server.connections).toHaveLength(2); // signal back: retry now
    h.server.latest.drop(1006);
    expect(h.talk.state).toEqual({ kind: "unreachable", reason: "error" });
    vi.advanceTimersByTime(2_000);
    h.server.latest.accept();
    expect(h.talk.state).toEqual({ kind: "idle" });

    h.surface.replaced = true;
    h.talk.cancel(); // any change recomputes
    h.network.set(true);
    expect(h.talk.state).toEqual({ kind: "unreachable", reason: "replaced" });
    h.talk.choose("navigator"); // "Use here"
    expect(h.surface.restarts).toBe(1);

    h.mic.behavior = "deny";
    h.talk.press();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.talk.state).toEqual({ kind: "mic-denied" });
    expect(h.permissions.at(-1)).toBe("denied");
    h.mic.behavior = "ok";
    h.talk.press();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.talk.state.kind).toBe("listening");
    h.talk.dispose();
  } finally {
    vi.useRealTimers();
  }
});

test("a turn with no answer gives up after ANSWER_TIMEOUT_MS", async () => {
  vi.useFakeTimers();
  try {
    const h = setup();
    h.server.latest.accept();
    h.talk.press();
    await vi.advanceTimersByTimeAsync(0);
    h.mic.frames(2, 0.1);
    h.talk.release();
    await vi.advanceTimersByTimeAsync(19_999);
    expect(h.talk.state.kind).toBe("thinking");
    await vi.advanceTimersByTimeAsync(1);
    expect(h.talk.state).toEqual({ kind: "idle" });
    expect(h.server.latest.types().at(-1)).toBe("response.cancel");
    h.talk.dispose();
  } finally {
    vi.useRealTimers();
  }
});

/** One full turn up to the answer's first audio: press, speak, release, transcript, created. */
async function untilAnswer(h: ReturnType<typeof setup>, responseId: string) {
  const socket = h.server.latest;
  h.talk.press();
  await settle();
  h.mic.frames(3, 0.1);
  h.talk.release();
  socket.push({ event_id: eventId(), type: "conversation.item.input_audio_transcription.completed", item_id: "u1", content_index: 0, transcript: "Hi" });
  answer(socket, responseId);
  return socket;
}

test("the gateway's real response.done ends the answer: back to idle, hold released", async () => {
  const h = setup();
  h.server.latest.accept();
  const socket = await untilAnswer(h, "r1");
  socket.push(transcriptDelta("r1", "Hello."));
  socket.push(audioDelta("r1"));
  expect(h.talk.state.kind).toBe("speaking");
  h.speech.advance(50);
  socket.push(done("r1", "completed", "item-1", "Hello."));
  expect(h.talk.state.kind).toBe("speaking"); // still playing what arrived
  h.speech.advance(50);
  expect(h.talk.state).toEqual({ kind: "idle" });
  expect(h.holds).toEqual({ taken: 1, released: 1 });

  // All audio already heard when response.done arrives: idle at once.
  const again = await untilAnswer(h, "r2");
  again.push(audioDelta("r2"));
  h.speech.advance(100);
  again.push(done("r2", "completed"));
  expect(h.talk.state).toEqual({ kind: "idle" });
  expect(h.holds).toEqual({ taken: 2, released: 2 });
  h.talk.dispose();
});

test("an answer that fails after response.created never stays in thinking", async () => {
  const h = setup();
  h.server.latest.accept();
  const socket = await untilAnswer(h, "r1");
  expect(h.talk.state.kind).toBe("thinking");
  // run_reply's error path: an error event, then cancel → response.done "cancelled".
  socket.push({ event_id: eventId(), type: "error", error: { type: "invalid_request_error", message: "the reply failed" } });
  socket.push(done("r1", "cancelled"));
  expect(h.talk.state).toEqual({ kind: "idle" });

  // The same failure after the answer began to speak: it ends once the heard part has played.
  const second = await untilAnswer(h, "r2");
  second.push(audioDelta("r2"));
  second.push({ event_id: eventId(), type: "error", error: { type: "invalid_request_error", message: "the reply failed" } });
  second.push(done("r2", "cancelled"));
  expect(h.talk.state.kind).toBe("speaking");
  h.speech.advance(100);
  expect(h.talk.state).toEqual({ kind: "idle" });
  expect(h.holds.taken).toBe(h.holds.released);
  h.talk.dispose();
});

test("an answer that fails with only response.done cancelled also ends", async () => {
  const h = setup();
  h.server.latest.accept();
  const socket = await untilAnswer(h, "r1");
  socket.push(done("r1", "cancelled"));
  expect(h.talk.state).toEqual({ kind: "idle" });
  h.talk.dispose();
});

test("choosing the current Co-driver again takes the SurfaceLink back (\"Use here\")", () => {
  const h = setup();
  h.server.latest.accept();
  h.surface.replaced = true;
  h.network.set(true); // recompute
  expect(h.talk.state).toEqual({ kind: "unreachable", reason: "replaced" });
  h.talk.choose("navigator");
  expect(h.surface.restarts).toBe(1);
  expect(h.talk.state).toEqual({ kind: "idle" });
  // No session.update for an unchanged voice.
  expect(h.server.latest.types()).toEqual(["session.update"]);
  h.talk.dispose();
});

test("a press while another Vela has the link shows it and takes nothing back", async () => {
  const h = setup();
  h.server.latest.accept();
  h.surface.replaced = true;
  h.talk.press();
  await settle();
  expect(h.talk.state).toEqual({ kind: "unreachable", reason: "replaced" });
  expect(h.surface.restarts).toBe(0);
  expect(h.mic.users).toBe(0);
  expect(h.server.latest.types()).toEqual(["session.update"]); // no turn opened
  h.talk.dispose();
});

test("tapping the current Co-driver on an open link keeps the link", () => {
  const h = setup();
  h.server.latest.accept();
  h.talk.choose("navigator");
  expect(h.surface.restarts).toBe(0);
  expect(h.server.latest.types()).toEqual(["session.update"]);
  expect(h.talk.state).toEqual({ kind: "idle" });
  h.talk.dispose();
});


test("Talk press cancels event Moment speech and releases its hold", async () => {
  const h = setup((async () => new Response(new Int16Array(2400).buffer)) as typeof fetch);
  h.server.latest.accept(); h.talk.speak("Rain ahead"); await settle();
  expect(h.holds).toEqual({ taken: 1, released: 0 }); expect(h.speech.queuedMs).toBe(100);
  h.talk.press(); expect(h.holds).toEqual({ taken: 2, released: 1 }); expect(h.speech.queuedMs).toBe(0);
  h.talk.dispose();
});
