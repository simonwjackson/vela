/**
 * Talk: the CoDriver the UI drives, over voice-gateway's Realtime WebSocket (ADR 0007).
 *
 * The socket is `wss://<origins.voice>/v1/realtime?model=<talkModel>&channel=vela-<install id>&surface=talk` (VelaConfig; the gateway's
 * name for the personal assistant); it opens at start, reconnects
 * with backoff, and sends `session.update { voice: <Co-driver id>, turn_detection: null }` on
 * every open and every change of Co-driver. A Co-driver session is push to talk:
 *
 * - press: `input_audio_buffer.clear` (this also stops the Co-driver at once). After a
 *   barge-in, `conversation.item.truncate` with what the driver heard. Then the microphone
 *   opens and `input_audio_buffer.append` carries 24 kHz PCM16.
 * - release: `input_audio_buffer.commit`, then `response.create`. A turn with no audio sent is
 *   cleared instead, since the gateway refuses an empty commit.
 * - "Hey Vela" (`wake`): the same turn, opened by the wake word and closed on the phone after
 *   END_OF_TURN_SILENCE_MS of silence (end-of-turn.ts).
 * - From opening Talk through the end of the answer, Listening pauses all Sources. Holds
 *   nest with Co-driver speech. Music resumes in place; Podcasts and Books resume 2 s back.
 *
 * Events for an older response are ignored, so a cancelled answer never ends the next turn.
 * The gateway names the response in two shapes (voice-gateway src/realtime.rs): audio and
 * transcript deltas carry a top-level `response_id`; `response.created` and `response.done`
 * carry `response.id`. A reply that fails sends `error`, then `response.done` "cancelled". A turn that gets no answer within ANSWER_TIMEOUT_MS ends.
 *
 * At rest the state shows the link: `idle` when Talk can be used, `offline` without signal,
 * `unreachable` when the gateway does not answer or another Vela took the SurfaceLink (a press
 * then changes nothing; only `choose` with the current id, "Use here", takes it back), and
 * `mic-denied` after the microphone was refused (until a later press gets it).
 */
import type { AssistantCard, CoDriver, CoDriverId, CoDriverInfo, Listening, SettingsStore, TalkState } from "../contract";
import { createAssistantEvents } from "./assistant-events";
import type { Network } from "../nav/engine";
import { type EndOfTurn, createEndOfTurn } from "./end-of-turn";
import { FRAME_MS, MicError, type MicFrame, type MicSource } from "./mic";
import { DEFAULT_CO_DRIVERS, coDriverInfo } from "./names";
import { base64ToPcm16, micToGateway, pcm16ToBase64 } from "./pcm";
import {
  type LinkStatus,
  type ReconnectingSocket,
  type Timers,
  type WebSocketFactory,
  browserTimers,
  createReconnectingSocket,
  socketUrl,
} from "./socket";
import { createMomentSpeech } from "./moment-speech";
import type { SpeechOutput } from "./speaker";
import type { SurfaceLink } from "./surface-link";

const PROGRESS_EVERY_MS = 200;
/** How long `thinking` waits for the first sign of an answer. */
export const ANSWER_TIMEOUT_MS = 20_000;

export interface TalkOptions {
  /** voice-gateway's origin, `origins.voice`. */
  readonly fetcher?: typeof fetch;
  readonly origin: string;
  /** `VelaConfig.talkModel`: the gateway's model name for the personal assistant. */
  readonly model: string;
  /** Stable per-install channel, `vela-<random id>`. Not an identity or a secret. */
  readonly channel: string;
  readonly connect: WebSocketFactory;
  readonly settings: SettingsStore;
  readonly mic: MicSource;
  readonly speech: SpeechOutput;
  readonly listening: Pick<Listening, "holdForTalk" | "send" | "search">;
  readonly surface: Pick<SurfaceLink, "replaced" | "restart" | "subscribe">;
  readonly network: Network;
  readonly timers?: Timers;
  /** Told when asking for the microphone showed whether it is allowed. */
  readonly onMicPermission?: (state: "granted" | "denied") => void;
  readonly initialBackoffMs?: number;
  readonly maxBackoffMs?: number;
}

export interface CoDriverClient extends CoDriver {
  /** "Hey Vela" was heard. `before`: the microphone levels before it, for the end of the turn. */
  wake(before?: readonly number[]): void;
  start(): void;
  dispose(): void;
}

type Turn = "none" | "wake" | "listening" | "thinking" | "speaking";

interface ServerEvent {
  readonly type?: string;
  readonly action?: unknown;
  readonly card?: unknown;
  readonly transcript?: string;
  readonly delta?: string;
  readonly response_id?: string;
  readonly item_id?: string;
  readonly response?: { readonly id?: string; readonly output?: readonly { readonly id?: string }[] };
  readonly error?: { readonly message?: string };
}

export function createTalk(options: TalkOptions): CoDriverClient {
  const { settings, mic, speech, listening, surface, network } = options;
  const timers = options.timers ?? browserTimers;
  const listeners = new Set<(state: TalkState) => void>();
  const cardListeners = new Set<(card: AssistantCard) => void>();
  const assistantEvents = createAssistantEvents(listening, (card) => { for (const fn of [...cardListeners]) fn(card); });

  let link: LinkStatus = { kind: "connecting" };
  let failedOnce = false;
  let micDenied = false;
  let turn: Turn = "none";
  /** Bumped on every new turn and every end, so late async work for an old turn is dropped. */
  let turnId = 0;
  let transcript = "";
  let said = "";
  let answer = "";
  let responseId: string | undefined;
  let itemId: string | undefined;
  let responseDone = false;
  let framesSent = 0;
  let releaseMic: (() => void) | undefined;
  let releaseHold: (() => void) | undefined;
  let endOfTurn: EndOfTurn | undefined;
  let progressTimer: unknown;
  let answerTimer: unknown;
  let coDriver = settings.value.coDriver;
  let last = "";
  let state: TalkState = { kind: "idle" };

  const momentSpeech = createMomentSpeech({
    origin: options.origin, voice: () => coDriver, online: () => network.online(),
    speech, hold: () => listening.holdForTalk(), ...(options.fetcher ? { fetcher: options.fetcher } : {}),
  });

  const socket: ReconnectingSocket = createReconnectingSocket({
    url: () => `${socketUrl(options.origin, "/v1/realtime")}?${new URLSearchParams({ model: options.model, channel: options.channel, surface: "talk" })}`,
    connect: options.connect,
    onOpen: () => sendSession(),
    onMessage,
    onStatus(next) {
      link = next;
      if (next.kind === "retrying" || next.kind === "stopped") failedOnce = true;
      if (next.kind === "open") failedOnce = false;
      if (next.kind !== "open" && turn !== "none") endTurn();
      emit();
    },
    ...(options.timers ? { timers: options.timers } : {}),
    ...(options.initialBackoffMs !== undefined ? { initialBackoffMs: options.initialBackoffMs } : {}),
    ...(options.maxBackoffMs !== undefined ? { maxBackoffMs: options.maxBackoffMs } : {}),
  });

  function send(message: unknown): boolean {
    return socket.send(message);
  }

  function sendSession(): void {
    send({ type: "session.update", session: { voice: coDriver, turn_detection: null } });
  }

  function restState(): TalkState {
    if (micDenied) return { kind: "mic-denied" };
    if (surface.replaced) return { kind: "unreachable", reason: "replaced" };
    if (link.kind === "open") return { kind: "idle" };
    if (!network.online()) return { kind: "offline" };
    if (link.kind === "connecting" && !failedOnce) return { kind: "idle" };
    return { kind: "unreachable", reason: "error" };
  }

  function compute(): TalkState {
    switch (turn) {
      case "none":
        return restState();
      case "wake":
        return { kind: "wake" };
      case "listening":
        return { kind: "listening", transcript };
      case "thinking":
        return { kind: "thinking", said };
      case "speaking": {
        const progress = speech.queuedMs > 0 ? Math.min(1, speech.playedMs / speech.queuedMs) : 0;
        return { kind: "speaking", text: answer, progress };
      }
    }
  }

  function emit(): void {
    const next = compute();
    const key = JSON.stringify(next);
    if (key === last) return;
    last = key;
    state = next;
    for (const fn of [...listeners]) fn(next);
  }

  function stopProgress(): void {
    if (progressTimer !== undefined) timers.clearTimeout(progressTimer);
    progressTimer = undefined;
  }

  function tickProgress(): void {
    stopProgress();
    if (turn !== "speaking") return;
    emit();
    progressTimer = timers.setTimeout(tickProgress, PROGRESS_EVERY_MS);
  }

  function stopAnswerTimer(): void {
    if (answerTimer !== undefined) timers.clearTimeout(answerTimer);
    answerTimer = undefined;
  }

  /** End the current turn locally: stop the microphone, the speech and the hold. */
  function endTurn(): void {
    turnId += 1;
    turn = "none";
    transcript = said = answer = "";
    responseId = itemId = undefined;
    responseDone = false;
    framesSent = 0;
    endOfTurn = undefined;
    stopProgress();
    stopAnswerTimer();
    speech.stop();
    releaseMic?.();
    releaseMic = undefined;
    releaseHold?.();
    releaseHold = undefined;
  }

  /** Stop a speaking answer and tell the gateway what was heard. */
  function bargeIn(): void {
    const heardMs = speech.stop();
    const item = itemId;
    send({ type: "input_audio_buffer.clear" });
    if (item) send({ type: "conversation.item.truncate", item_id: item, content_index: 0, audio_end_ms: Math.round(heardMs) });
  }

  /** Open a turn: clear (stops the Co-driver), truncate after a barge-in, then the microphone. */
  function openTurn(from: "press" | "wake", before: readonly number[] = []): void {
    // Take the next hold first: barge-in must not briefly resume media between turns.
    const nextHold = listening.holdForTalk("listening");
    momentSpeech.stop();
    if (turn === "speaking") bargeIn();
    else send({ type: "input_audio_buffer.clear" });
    endTurn();
    releaseHold = nextHold;
    const id = turnId;
    turn = from === "wake" ? "wake" : "listening";
    endOfTurn = from === "wake" ? createEndOfTurn(before) : undefined;
    emit();
    mic.acquire().then(
      (release) => {
        options.onMicPermission?.("granted");
        if (micDenied) {
          micDenied = false;
          emit();
        }
        if (id !== turnId) release();
        else releaseMic = release;
      },
      (error: unknown) => {
        if (error instanceof MicError && error.failure.kind === "denied") {
          micDenied = true;
          options.onMicPermission?.("denied");
        } else {
          console.warn("Vela could not open the microphone", error);
        }
        if (id === turnId) endTurn();
        emit();
      },
    );
  }

  function onFrame(frame: MicFrame): void {
    if (!releaseMic || (turn !== "listening" && turn !== "wake")) return;
    if (turn === "wake") {
      turn = "listening";
      emit();
    }
    if (send({ type: "input_audio_buffer.append", audio: pcm16ToBase64(micToGateway(frame.samples)) })) framesSent += 1;
    const verdict = endOfTurn?.push(frame.rms, FRAME_MS);
    if (verdict === "said") closeTurn();
    else if (verdict === "nothing-said") abandon();
  }

  /** The driver finished speaking: commit and ask for the answer. */
  function closeTurn(): void {
    if (turn !== "listening" && turn !== "wake") return;
    releaseMic?.();
    releaseMic = undefined;
    endOfTurn = undefined;
    if (framesSent === 0) {
      send({ type: "input_audio_buffer.clear" });
      endTurn();
      emit();
      return;
    }
    send({ type: "input_audio_buffer.commit" });
    send({ type: "response.create" });
    turn = "thinking";
    const id = turnId;
    answerTimer = timers.setTimeout(() => {
      answerTimer = undefined;
      if (id !== turnId || speech.queuedMs > 0 || responseDone) return;
      console.warn("voice-gateway did not answer in time");
      abandon();
    }, ANSWER_TIMEOUT_MS);
    emit();
  }

  function abandon(): void {
    if (turn === "none") return;
    if (turn === "speaking") bargeIn();
    else if (turn === "thinking") send({ type: "response.cancel" });
    else send({ type: "input_audio_buffer.clear" });
    endTurn();
    emit();
  }

  function finishAnswer(): void {
    endTurn();
    emit();
  }

  /** Is this event about the answer of the current turn? */
  function current(event: ServerEvent): boolean {
    const id = event.response_id ?? event.response?.id;
    return (turn === "thinking" || turn === "speaking") && id !== undefined && id === responseId;
  }

  function onMessage(data: unknown): void {
    let event: ServerEvent;
    try {
      event = JSON.parse(String(data)) as ServerEvent;
    } catch {
      return;
    }
    if (!event || typeof event !== "object") return;
    assistantEvents.receive(event);
    switch (event.type) {
      case "conversation.item.input_audio_transcription.completed":
        if (turn !== "thinking") return;
        said = event.transcript ?? "";
        // Nothing understood: the gateway gives no answer to an empty turn.
        if (said.trim() === "") finishAnswer();
        else emit();
        return;
      case "response.created":
        if (turn !== "thinking" || responseId !== undefined) return;
        responseId = event.response?.id;
        itemId = event.response?.output?.[0]?.id;
        return;
      case "response.output_audio_transcript.delta":
        if (!current(event)) return;
        answer += event.delta ?? "";
        turn = "speaking";
        emit();
        return;
      case "response.output_audio.delta": {
        if (!current(event) || !event.delta) return;
        speech.play(base64ToPcm16(event.delta));
        releaseHold ??= listening.holdForTalk();
        if (turn !== "speaking") {
          turn = "speaking";
          tickProgress();
        } else if (progressTimer === undefined) tickProgress();
        return;
      }
      case "response.done":
        if (!current(event)) return;
        responseDone = true;
        if (speech.playedMs >= speech.queuedMs) finishAnswer();
        return;
      case "error":
        console.warn("voice-gateway reported an error", event.error?.message);
        if (turn === "thinking") finishAnswer();
        return;
    }
  }

  const offFrames = mic.subscribe(onFrame);
  const offDrained = speech.onDrained(() => {
    if (turn === "speaking" && responseDone) finishAnswer();
  });
  const offSurface = surface.subscribe(() => emit());
  const offNetwork = network.subscribe(() => {
    if (network.online() && link.kind === "retrying") socket.restart();
    emit();
  });
  const offSettings = settings.subscribe((value) => {
    if (value.coDriver === coDriver) return;
    coDriver = value.coDriver;
    sendSession();
    // One Co-driver per SurfaceLink: reconnect to change it.
    surface.restart();
  });

  return {
    get state() {
      return state;
    },
    get current(): CoDriverInfo {
      return coDriverInfo(coDriver);
    },
    list() {
      return DEFAULT_CO_DRIVERS.some((c) => c.id === coDriver) ? DEFAULT_CO_DRIVERS : [...DEFAULT_CO_DRIVERS, coDriverInfo(coDriver)];
    },
    speak(text) { if (turn === "none") momentSpeech.speak(text); },
    press() {
      // Another Vela took the link: show that (the UI offers "Use here"); never take it back silently.
      if (surface.replaced) {
        momentSpeech.stop();
        emit();
        return;
      }
      if (link.kind !== "open") {
        momentSpeech.stop();
        if (link.kind === "retrying") socket.restart();
        emit();
        return;
      }
      if (turn === "listening" || turn === "wake") return;
      openTurn("press");
    },
    release() {
      closeTurn();
    },
    cancel() {
      momentSpeech.stop();
      abandon();
    },
    choose(id: CoDriverId) {
      // The current id: "Use here" takes a replaced link back; otherwise nothing changes, so an
      // open link (and any tool.call in flight) stays. A new id reconnects through the settings
      // subscription.
      if (id !== coDriver) settings.set({ coDriver: id });
      else if (surface.replaced) {
        surface.restart();
        emit();
      }
    },
    wake(before = []) {
      if (turn !== "none" || compute().kind !== "idle" || link.kind !== "open") return;
      openTurn("wake", before);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    onCard(fn) {
      cardListeners.add(fn);
      return () => { cardListeners.delete(fn); };
    },
    start() {
      socket.start();
      emit();
    },
    dispose() {
      assistantEvents.dispose();
      cardListeners.clear();
      momentSpeech.dispose();
      endTurn();
      offFrames();
      offDrained();
      offSurface();
      offNetwork();
      offSettings();
      socket.close();
      listeners.clear();
    },
  };
}
