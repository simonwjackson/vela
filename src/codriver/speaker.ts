/**
 * Co-driver speech output: 24 kHz PCM16 chunks played back to back through Web Audio.
 * It reports how much has been heard, so a barge-in can truncate the answer to what the
 * driver actually heard.
 */
import { GATEWAY_RATE, gatewayMs, pcm16ToFloat } from "./pcm";

export interface SpeechOutput {
  /** Queue a chunk after what is already queued. */
  play(pcm: Int16Array): void;
  /** Stop at once and drop the queue. Returns the milliseconds heard since the last stop. */
  stop(): number;
  /** Milliseconds heard since the last stop. */
  readonly playedMs: number;
  /** Milliseconds queued since the last stop, heard or not. */
  readonly queuedMs: number;
  /** Called once each time everything queued has been heard. */
  onDrained(fn: () => void): () => void;
}

export function webAudioSpeech(context: () => AudioContext): SpeechOutput {
  const drained = new Set<() => void>();
  let sources: AudioBufferSourceNode[] = [];
  /** [start, end] of every chunk scheduled since the last stop, in context seconds. */
  let spans: [number, number][] = [];
  let endAt = 0;
  let queuedMs = 0;

  const ctx = () => context();
  // Only time actually played counts: a gap between chunks (the stream fell behind) is silence.
  const heardMs = () => {
    const now = ctx().currentTime;
    return spans.reduce((sum, [start, end]) => sum + Math.max(0, Math.min(now, end) - start), 0) * 1000;
  };

  return {
    play(pcm) {
      if (pcm.length === 0) return;
      const ac = ctx();
      const buffer = ac.createBuffer(1, pcm.length, GATEWAY_RATE);
      buffer.copyToChannel(pcm16ToFloat(pcm) as Float32Array<ArrayBuffer>, 0);
      const node = ac.createBufferSource();
      node.buffer = buffer;
      node.connect(ac.destination);
      const at = Math.max(ac.currentTime + 0.02, endAt);
      node.start(at);
      endAt = at + buffer.duration;
      spans.push([at, endAt]);
      queuedMs += gatewayMs(pcm.length);
      sources.push(node);
      node.onended = () => {
        sources = sources.filter((s) => s !== node);
        if (sources.length === 0) for (const fn of [...drained]) fn();
      };
    },
    stop() {
      const heard = heardMs();
      for (const node of sources) {
        node.onended = null;
        try {
          node.stop();
        } catch {
          // Not started yet.
        }
      }
      sources = [];
      spans = [];
      endAt = 0;
      queuedMs = 0;
      return heard;
    },
    get playedMs() {
      return heardMs();
    },
    get queuedMs() {
      return queuedMs;
    },
    onDrained(fn) {
      drained.add(fn);
      return () => {
        drained.delete(fn);
      };
    },
  };
}

/** Speech output on a clock the test moves with `advance`. */
export class ScriptedSpeech implements SpeechOutput {
  queuedMs = 0;
  playedMs = 0;
  readonly chunks: Int16Array[] = [];
  private readonly drained = new Set<() => void>();

  play(pcm: Int16Array): void {
    this.chunks.push(pcm);
    this.queuedMs += gatewayMs(pcm.length);
  }

  stop(): number {
    const heard = this.playedMs;
    this.playedMs = 0;
    this.queuedMs = 0;
    return heard;
  }

  advance(ms: number): void {
    const before = this.playedMs;
    this.playedMs = Math.min(this.queuedMs, this.playedMs + ms);
    if (before < this.queuedMs && this.playedMs >= this.queuedMs) for (const fn of [...this.drained]) fn();
  }

  onDrained(fn: () => void): () => void {
    this.drained.add(fn);
    return () => {
      this.drained.delete(fn);
    };
  }
}
