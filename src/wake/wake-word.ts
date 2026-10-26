/**
 * The "Hey Vela" wake word (ADR 0009): sherpa-onnx keyword spotting in a Web Worker, on the
 * phone. No audio leaves the phone for it; Talk sends audio only after a wake.
 *
 * - The setting (`Settings.wakeWord`) is the one source of truth; `enable` changes the setting.
 * - The engine and model (about 18 MB in public/wake) load the first time the setting is on,
 *   reporting `loading { progress }`; the service worker then keeps them offline.
 * - It shares the microphone with Talk (one stream). Each 100 ms frame goes to the worker as a
 *   copy, and its level into a short history that seeds Talk's end of turn.
 * - A detection at or above WAKE_THRESHOLD calls `onWake`, at most once per WAKE_COOLDOWN_MS.
 */
import type { SettingsStore, WakeState, WakeWord } from "../contract";
import { LevelHistory } from "../codriver/end-of-turn";
import { MicError, type MicFrame, type MicSource } from "../codriver/mic";

export const KWS_WORKER_URL = "/wake/kws-worker.js";
/** Field test: 0.25 kept the podcast false wakes at 0 to 1.6 per hour with boost 2. */
export const WAKE_THRESHOLD = 0.25;
export const WAKE_BOOST = 2.0;
/** The engine reports candidates down to this score; Vela applies WAKE_THRESHOLD itself. */
const ENGINE_FLOOR = 0.05;
export const WAKE_COOLDOWN_MS = 2_000;

/**
 * Tokens from the model's bpe.model (public/wake/keywords.txt). The model often hears "Vela"
 * as "Vella" (VE LL A), so both spellings count. "Vela" alone is left out: it is the likelier
 * false wake.
 */
export const WAKE_KEYWORDS = [
  { name: "HEY_VELA", tokens: "▁HE Y ▁ VE LA" },
  { name: "HEY_VELA", tokens: "▁HE Y ▁ VE LL A" },
] as const;

export type KwsMessage =
  | { readonly type: "progress"; readonly loaded: number; readonly total: number }
  | { readonly type: "ready"; readonly loadMs?: number }
  | { readonly type: "kw"; readonly keyword: string; readonly score: number | null }
  | { readonly type: "error"; readonly message: string };

/** The part of a Worker used here. Tests use a scripted one. */
export interface KwsWorker {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: { readonly data: KwsMessage }) => void) | null;
  onerror: ((event: { readonly message?: string }) => void) | null;
  terminate(): void;
}

export interface WakeWordOptions {
  readonly settings: SettingsStore;
  readonly mic: MicSource;
  /** "Hey Vela" was heard. `before`: recent microphone levels, oldest first. */
  readonly onWake: (before: readonly number[]) => void;
  readonly createWorker?: () => KwsWorker;
  readonly now?: () => number;
  readonly onMicPermission?: (state: "granted" | "denied") => void;
}

export interface VelaWakeWord extends WakeWord {
  dispose(): void;
}

export function createWakeWord(options: WakeWordOptions): VelaWakeWord {
  const { settings, mic } = options;
  const now = options.now ?? Date.now;
  const createWorker = options.createWorker ?? (() => new Worker(KWS_WORKER_URL) as unknown as KwsWorker);
  const listeners = new Set<(s: WakeState) => void>();
  const history = new LevelHistory();

  let state: WakeState = { kind: "off" };
  let worker: KwsWorker | undefined;
  let engineReady = false;
  let releaseMic: (() => void) | undefined;
  let running = 0; // bumped by every start and stop
  let lastWakeAt = Number.NEGATIVE_INFINITY;

  function setState(next: WakeState): void {
    if (JSON.stringify(next) === JSON.stringify(state)) return;
    state = next;
    for (const fn of [...listeners]) fn(next);
  }

  function settle(): void {
    if (engineReady && releaseMic) setState({ kind: "listening" });
  }

  function stop(next: WakeState): void {
    running += 1;
    worker?.terminate();
    worker = undefined;
    engineReady = false;
    releaseMic?.();
    releaseMic = undefined;
    setState(next);
  }

  function fail(reason: string): void {
    stop({ kind: "unavailable", reason });
  }

  function start(): void {
    const run = ++running;
    setState({ kind: "loading", progress: 0 });
    let next: KwsWorker;
    try {
      next = createWorker();
    } catch (error) {
      fail(`The wake word could not start: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    worker = next;
    next.onmessage = (event) => {
      if (run !== running) return;
      const m = event.data;
      if (m.type === "progress") {
        if (!engineReady) setState({ kind: "loading", progress: m.total > 0 ? Math.min(1, m.loaded / m.total) : 0 });
      } else if (m.type === "ready") {
        engineReady = true;
        settle();
      } else if (m.type === "kw") {
        onDetection(m.score);
      } else if (m.type === "error") {
        fail(m.message);
      }
    };
    next.onerror = (event) => {
      if (run === running) fail(event.message ?? "The wake word stopped");
    };
    next.postMessage({ type: "init", keywords: WAKE_KEYWORDS, boost: WAKE_BOOST, floor: ENGINE_FLOOR });
    mic.acquire().then(
      (release) => {
        options.onMicPermission?.("granted");
        if (run !== running) {
          release();
          return;
        }
        releaseMic = release;
        settle();
      },
      (error: unknown) => {
        if (run !== running) return;
        const denied = error instanceof MicError && error.failure.kind === "denied";
        if (denied) options.onMicPermission?.("denied");
        fail(error instanceof Error ? error.message : String(error));
      },
    );
  }

  function onDetection(score: number | null): void {
    if (state.kind !== "listening") return;
    if (score !== null && score < WAKE_THRESHOLD) return;
    const t = now();
    if (t - lastWakeAt < WAKE_COOLDOWN_MS) return;
    lastWakeAt = t;
    options.onWake(history.snapshot());
  }

  function onFrame(frame: MicFrame): void {
    if (!releaseMic) return;
    history.push(frame.rms);
    if (!engineReady || !worker) return;
    const copy = frame.samples.slice();
    worker.postMessage({ type: "audio", samples: copy }, [copy.buffer]);
  }

  function apply(on: boolean): void {
    const active = state.kind === "loading" || state.kind === "listening";
    if (on && !active) start();
    else if (!on && state.kind !== "off") stop({ kind: "off" });
  }

  const offFrames = mic.subscribe(onFrame);
  const offSettings = settings.subscribe((value) => apply(value.wakeWord));
  apply(settings.value.wakeWord);

  return {
    get state() {
      return state;
    },
    enable(on) {
      if (settings.value.wakeWord !== on) settings.set({ wakeWord: on });
      // Turning it on again after a failure retries.
      else if (on && state.kind === "unavailable") start();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    dispose() {
      offFrames();
      offSettings();
      stop({ kind: "off" });
      listeners.clear();
    },
  };
}
