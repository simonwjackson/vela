/**
 * A real MediaElement implementation with no decoder: time moves only when a test calls
 * `advance`. Configure `durationFor` and `playFails` to script the renderer.
 */
import type { MediaElement, MediaEventType } from "../output";

export interface ScriptedMediaOptions {
  /** Duration in seconds for a given src. Default 600. */
  readonly durationFor?: (src: string) => number;
  /** When true, play() rejects like a blocked autoplay. */
  playFails?: boolean;
}

export class ScriptedMediaElement implements MediaElement {
  private source = "";
  private time = 0;
  private length = Number.NaN;
  private stopped = true;
  private readonly listeners = new Map<MediaEventType, Set<() => void>>();
  volume = 1;
  error: { message: string } | null = null;
  /** Every src this element was given, in order. */
  readonly loaded: string[] = [];
  playFails: boolean;

  constructor(private readonly options: ScriptedMediaOptions = {}) {
    this.playFails = options.playFails ?? false;
  }

  get src(): string {
    return this.source;
  }

  set src(value: string) {
    this.source = value;
    this.loaded.push(value);
    this.time = 0;
    this.length = Number.NaN;
    this.stopped = true;
    queueMicrotask(() => {
      if (this.source !== value) return;
      this.length = this.options.durationFor?.(value) ?? 600;
      this.fire("loadedmetadata");
    });
  }

  get currentTime(): number {
    return this.time;
  }

  set currentTime(value: number) {
    const limit = Number.isFinite(this.length) ? this.length : Number.POSITIVE_INFINITY;
    this.time = Math.min(Math.max(0, value), limit);
    this.fire("seeked");
  }

  get duration(): number {
    return this.length;
  }

  get paused(): boolean {
    return this.stopped;
  }

  async play(): Promise<void> {
    if (this.playFails) throw new DOMException("play() was blocked", "NotAllowedError");
    if (this.source === "") throw new DOMException("no source", "NotSupportedError");
    if (!this.stopped) return;
    this.stopped = false;
    this.fire("play");
  }

  pause(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.fire("pause");
  }

  removeAttribute(_name: "src"): void {
    this.source = "";
    this.length = Number.NaN;
    this.time = 0;
    this.stopped = true;
  }

  addEventListener(type: MediaEventType, listener: () => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: MediaEventType, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  /** Move playback forward while playing; ends the media at its duration. */
  advance(seconds: number): void {
    if (this.stopped) return;
    const next = this.time + seconds;
    if (Number.isFinite(this.length) && next >= this.length) {
      this.time = this.length;
      this.fire("timeupdate");
      this.stopped = true;
      this.fire("ended");
      return;
    }
    this.time = next;
    this.fire("timeupdate");
  }

  /** Fail the current media like a decode or network error. */
  fail(message: string): void {
    this.error = { message };
    this.stopped = true;
    this.fire("error");
  }

  private fire(type: MediaEventType): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener();
  }
}
