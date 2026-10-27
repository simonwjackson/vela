import type { SpeechOutput } from "./speaker";
/** voice-gateway server.rs: 24 kHz mono signed little-endian PCM16. */
export function createMomentSpeech(options: {
  origin: string; voice: () => string; online: () => boolean;
  speech: SpeechOutput; hold: () => () => void; fetcher?: typeof fetch;
}) {
  let controller: AbortController | undefined;
  let release: (() => void) | undefined;
  let active = false;
  const stop = () => {
    controller?.abort(); controller = undefined;
    if (active) options.speech.stop();
    active = false;
    release?.(); release = undefined;
  };
  const off = options.speech.onDrained(() => { if (active) stop(); });
  return {
    speak(text: string): void {
      stop();
      if (!options.online() || !text.trim() || text.length > 32768) return;
      const request = new AbortController(); controller = request;
      void (async () => {
        try {
          const response = await (options.fetcher ?? fetch)(`${options.origin}/v1/audio/speech`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ input: text, voice: options.voice(), response_format: "pcm" }),
            signal: AbortSignal.any([request.signal, AbortSignal.timeout(30000)]),
          });
          if (!response.ok) return;
          const bytes = await response.arrayBuffer();
          if (request.signal.aborted || controller !== request || !options.online() || bytes.byteLength === 0 || bytes.byteLength % 2 !== 0) return;
          const view = new DataView(bytes); const pcm = new Int16Array(bytes.byteLength / 2);
          for (let i = 0; i < pcm.length; i++) pcm[i] = view.getInt16(i * 2, true);
          active = true; release = options.hold(); options.speech.play(pcm);
        } catch { if (controller === request) stop(); }
      })();
    },
    stop,
    dispose() { stop(); off(); },
  };
}
