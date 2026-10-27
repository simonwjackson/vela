import { ScriptedMic } from "../codriver/mic";
import { ScriptedSpeech } from "../codriver/speaker";
import { createTalk } from "../codriver/talk";
import { InMemorySocketServer } from "../codriver/testing/in-memory-socket";
import type { WakeState } from "../contract";
import { SwitchableNetwork } from "../nav/fixtures";
import { createSettingsStore } from "../settings/store";
import { type KwsMessage, type KwsWorker, createWakeWord } from "./wake-word";

/** A keyword-spotting worker the test scripts: it records what it is sent and answers by hand. */
class ScriptedKwsWorker implements KwsWorker {
  onmessage: ((event: { readonly data: KwsMessage }) => void) | null = null;
  onerror: ((event: { readonly message?: string }) => void) | null = null;
  readonly posted: { type: string; samples?: Float32Array }[] = [];
  terminated = false;
  postMessage(message: unknown): void {
    this.posted.push(message as { type: string });
  }
  terminate(): void {
    this.terminated = true;
  }
  emit(data: KwsMessage): void {
    this.onmessage?.({ data });
  }
}

const ROAD = 0.01;
const VOICE = 0.1;
const settle = () => new Promise((r) => setTimeout(r, 0));

function setup() {
  const settings = createSettingsStore(undefined);
  const mic = new ScriptedMic();
  const workers: ScriptedKwsWorker[] = [];
  const server = new InMemorySocketServer();
  let t = 0;
  const talk = createTalk({
    origin: "https://voice.test",
    model: "assistant",
    channel: "vela-install-1",
    connect: server.connect,
    settings,
    mic,
    speech: new ScriptedSpeech(),
    listening: { holdForTalk: () => () => undefined, send: async () => undefined, search: async () => [] },
    surface: { replaced: false, restart: () => undefined, subscribe: () => () => undefined },
    network: new SwitchableNetwork(),
  });
  talk.start();
  server.latest.accept();
  const wake = createWakeWord({
    settings,
    mic,
    onWake: (before) => talk.wake(before),
    createWorker: () => {
      const w = new ScriptedKwsWorker();
      workers.push(w);
      return w;
    },
    now: () => t,
  });
  const states: WakeState[] = [];
  wake.subscribe((s) => states.push(s));
  return {
    settings,
    mic,
    workers,
    server,
    talk,
    wake,
    states,
    later(ms: number) {
      t += ms;
    },
    get worker() {
      const w = workers[workers.length - 1];
      if (!w) throw new Error("no worker");
      return w;
    },
  };
}

test("lazy-loaded the first time the setting is on, with progress, then listening", async () => {
  const h = setup();
  expect(h.workers).toHaveLength(0);
  h.wake.enable(true);
  expect(h.settings.value.wakeWord).toBe(true);
  expect(h.worker.posted[0]).toMatchObject({ type: "init", boost: 2 });
  h.worker.emit({ type: "progress", loaded: 9, total: 18 });
  expect(h.wake.state).toEqual({ kind: "loading", progress: 0.5 });
  h.worker.emit({ type: "ready" });
  await settle();
  expect(h.wake.state).toEqual({ kind: "listening" });
  // Frames go to the worker as copies; Talk sends nothing before a wake.
  h.mic.frames(3, ROAD);
  expect(h.worker.posted.filter((m) => m.type === "audio")).toHaveLength(3);
  expect(h.server.latest.types()).toEqual(["session.update"]);

  h.wake.enable(false);
  expect(h.wake.state).toEqual({ kind: "off" });
  expect(h.worker.terminated).toBe(true);
  expect(h.mic.users).toBe(0);
});

test("'Hey Vela' opens a Talk turn that ends after 1.2 s of silence on the phone", async () => {
  const h = setup();
  h.settings.set({ wakeWord: true });
  h.worker.emit({ type: "ready" });
  await settle();
  h.mic.frames(30, ROAD);

  h.worker.emit({ type: "kw", keyword: "HEY_VELA", score: 0.42 });
  expect(h.talk.state).toEqual({ kind: "wake" });
  await settle();
  h.mic.frames(10, VOICE); // "take me home"
  expect(h.talk.state.kind).toBe("listening");
  h.mic.frames(11, ROAD);
  expect(h.server.latest.types()).not.toContain("input_audio_buffer.commit");
  h.mic.frames(1, ROAD); // 1.2 s of silence
  const types = h.server.latest.types();
  expect(types.slice(0, 2)).toEqual(["session.update", "input_audio_buffer.clear"]);
  expect(types.filter((t) => t === "input_audio_buffer.append")).toHaveLength(22);
  expect(types.slice(-2)).toEqual(["input_audio_buffer.commit", "response.create"]);
  expect(h.talk.state.kind).toBe("thinking");
  // Talk let go of the microphone; the wake word keeps it.
  expect(h.mic.users).toBe(1);
});

test("a wake with nothing said ends quietly; weak and repeated detections are ignored", async () => {
  const h = setup();
  h.settings.set({ wakeWord: true });
  h.worker.emit({ type: "ready" });
  await settle();
  h.worker.emit({ type: "kw", keyword: "HEY_VELA", score: 0.1 });
  expect(h.talk.state.kind).toBe("idle");

  h.worker.emit({ type: "kw", keyword: "HEY_VELA", score: 0.5 });
  await settle();
  h.mic.frames(50, ROAD);
  expect(h.talk.state.kind).toBe("idle");
  expect(h.server.latest.types().at(-1)).toBe("input_audio_buffer.clear");

  h.later(500);
  h.worker.emit({ type: "kw", keyword: "HEY_VELA", score: 0.5 });
  expect(h.talk.state.kind).toBe("idle"); // within the cooldown
  h.later(2_000);
  h.worker.emit({ type: "kw", keyword: "HEY_VELA", score: 0.5 });
  expect(h.talk.state.kind).toBe("wake");
});

test("a refused microphone or a worker error makes the wake word unavailable", async () => {
  const h = setup();
  h.mic.behavior = "deny";
  h.settings.set({ wakeWord: true });
  await settle();
  expect(h.wake.state).toEqual({ kind: "unavailable", reason: "Vela may not use the microphone" });
  h.mic.behavior = "ok";
  h.wake.enable(true); // try again
  h.worker.emit({ type: "error", message: "out of memory" });
  expect(h.wake.state).toEqual({ kind: "unavailable", reason: "out of memory" });
  expect(h.worker.terminated).toBe(true);
});
