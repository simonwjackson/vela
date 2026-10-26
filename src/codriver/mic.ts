/**
 * One microphone stream, shared by Talk and the wake word.
 *
 * The phone opens the microphone once, at 16 kHz mono, with echo cancellation, noise suppression
 * and auto gain off (the wake-word field test's settings). An AudioWorklet cuts it into 100 ms
 * frames. Each user `acquire`s it and releases it; the stream closes when the last one releases.
 * Nothing leaves the phone from here: Talk sends frames only while a turn is open.
 */

export interface MicFrame {
  /** 100 ms of 16 kHz mono samples. Shared between listeners: copy before transferring. */
  readonly samples: Float32Array;
  readonly rms: number;
}

export type MicFailure = { readonly kind: "denied" } | { readonly kind: "unavailable"; readonly message: string };

export class MicError extends Error {
  constructor(readonly failure: MicFailure) {
    super(failure.kind === "denied" ? "Vela may not use the microphone" : failure.message);
  }
}

export interface MicSource {
  /** Open the microphone (or join it). Rejects with MicError. Call the result to release. */
  acquire(): Promise<() => void>;
  subscribe(fn: (frame: MicFrame) => void): () => void;
}

export const FRAME_MS = 100;
export const CAPTURE_WORKLET_URL = "/wake/capture-worklet.js";

/** The browser microphone: getUserMedia plus the capture worklet at 16 kHz. */
export function browserMic(): MicSource {
  const listeners = new Set<(frame: MicFrame) => void>();
  let users = 0;
  let opening: Promise<{ stream: MediaStream; context: AudioContext }> | undefined;

  async function open(): Promise<{ stream: MediaStream; context: AudioContext }> {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 1 } },
      });
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") throw new MicError({ kind: "denied" });
      throw new MicError({ kind: "unavailable", message: `No microphone: ${error instanceof Error ? error.message : String(error)}` });
    }
    const context = new AudioContext({ sampleRate: 16_000 });
    try {
      await context.audioWorklet.addModule(CAPTURE_WORKLET_URL);
      const source = context.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(context, "capture", {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 1,
        channelCountMode: "explicit",
      });
      node.port.onmessage = (event: MessageEvent<MicFrame>) => {
        for (const fn of [...listeners]) fn(event.data);
      };
      source.connect(node);
      if (context.state !== "running") await context.resume();
    } catch (error) {
      for (const track of stream.getTracks()) track.stop();
      void context.close();
      throw new MicError({ kind: "unavailable", message: `The microphone could not start: ${String(error)}` });
    }
    return { stream, context };
  }

  function close(): void {
    const pending = opening;
    opening = undefined;
    void pending?.then(({ stream, context }) => {
      for (const track of stream.getTracks()) track.stop();
      void context.close();
    }, () => undefined);
  }

  return {
    async acquire() {
      users += 1;
      opening ??= open();
      try {
        await opening;
      } catch (error) {
        users -= 1;
        opening = undefined;
        throw error;
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        users -= 1;
        if (users === 0) close();
      };
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

/** A microphone a test drives: frames are pushed by hand; `deny` makes acquire fail. */
export class ScriptedMic implements MicSource {
  users = 0;
  behavior: "ok" | "deny" = "ok";
  private readonly listeners = new Set<(frame: MicFrame) => void>();

  async acquire(): Promise<() => void> {
    if (this.behavior === "deny") throw new MicError({ kind: "denied" });
    this.users += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.users -= 1;
    };
  }

  subscribe(fn: (frame: MicFrame) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** Push 100 ms frames at a level (RMS, 0..1). */
  frames(count: number, rms: number): void {
    for (let i = 0; i < count; i++) {
      const samples = new Float32Array(1600).fill(rms);
      for (const fn of [...this.listeners]) fn({ samples, rms });
    }
  }
}
