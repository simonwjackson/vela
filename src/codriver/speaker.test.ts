import { webAudioSpeech } from "./speaker";

/** The part of an AudioContext webAudioSpeech uses, on a clock the test sets. */
class ClockedAudioContext {
  currentTime = 0;
  readonly destination = {};
  createBuffer(_channels: number, length: number, rate: number) {
    return { duration: length / rate, copyToChannel: () => undefined };
  }
  createBufferSource() {
    return { buffer: null, onended: null, connect: () => undefined, start: () => undefined, stop: () => undefined };
  }
}

test("heard time counts only audio played, not the gaps while the stream fell behind", () => {
  const ac = new ClockedAudioContext();
  const speech = webAudioSpeech(() => ac as unknown as AudioContext);
  speech.play(new Int16Array(2400)); // 100 ms, scheduled at 0.02 s
  ac.currentTime = 0.48; // the stream stalled; the first chunk ended at 0.12 s
  speech.play(new Int16Array(2400)); // scheduled at 0.50 s
  ac.currentTime = 0.53;
  expect(speech.playedMs).toBeCloseTo(130, 5);
  expect(speech.queuedMs).toBeCloseTo(200, 5);
  expect(speech.stop()).toBeCloseTo(130, 5);
  expect(speech.playedMs).toBe(0);
});
