import { createMomentSpeech } from "./moment-speech";
import { ScriptedSpeech } from "./speaker";
import { settle } from "../audio/testing/listening-fixture";

test("speaks gateway PCM in the current voice and releases the listening hold", async () => {
  const speech = new ScriptedSpeech(); let held = 0; let body: unknown;
  const speaker = createMomentSpeech({ origin: "https://voice.test", voice: () => "guide", online: () => true, speech,
    hold: () => { held++; return () => { held--; }; },
    fetcher: (async (url, init) => { expect(url).toBe("https://voice.test/v1/audio/speech"); body = JSON.parse(String(init?.body)); return new Response(new Uint8Array([1, 0, 255, 255])); }) as typeof fetch,
  });
  speaker.speak("Rain ahead"); await settle();
  expect(body).toEqual({ input: "Rain ahead", voice: "guide", response_format: "pcm" });
  expect(Array.from(speech.chunks[0] ?? [])).toEqual([1, -1]); expect(held).toBe(1);
  speech.advance(100); expect(held).toBe(0); speaker.dispose();
});
test("offline, refusal and cancellation are silent", async () => {
  const speech = new ScriptedSpeech(); let online = false; let calls = 0;
  const speaker = createMomentSpeech({ origin: "https://voice.test", voice: () => "guide", online: () => online, speech,
    hold: () => { throw new Error("must not hold"); },
    fetcher: (async () => { calls++; return new Response(null, { status: 503 }); }) as typeof fetch,
  });
  speaker.speak("Rain"); expect(calls).toBe(0); online = true;
  speaker.speak("Rain"); await settle(); expect(calls).toBe(1); expect(speech.chunks).toHaveLength(0);
  speaker.speak("Rain"); speaker.stop(); await settle(); expect(speech.chunks).toHaveLength(0); speaker.dispose();
});
