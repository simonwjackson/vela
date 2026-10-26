# The "Hey Vela" wake word runs on the phone

Talk can start hands-free: the driver says "Hey Vela". A keyword spotter listens all the time, so it runs entirely on the phone: sherpa-onnx keyword spotting (Apache-2.0), compiled to WebAssembly, with its 3.3 M-parameter int8 zipformer model, in a Web Worker. No audio leaves the phone until the wake word is heard; then Talk sends the turn to voice-gateway as if the driver had pressed talk, and the phone ends the turn after 1.2 s of silence. The Web Speech API and cloud wake-word services were rejected: they send audio away while nobody is talking to Vela.

The wake-word spike (2026-10-25) runs on the phone. Its offline evaluation of the int8 model gave a real-time factor of about 0.08, caught all three "hey vela" in a synthetic clip, and, with boost 2.0 and threshold 0.25, made one false wake in 37.5 minutes of podcast speech (1.6 per hour), on "Vela" alone. Vela therefore listens for "Hey Vela" only, in both spellings the model hears ("Vela", "Vella").

## Consequences

- The engine and model are committed in `public/wake/` (about 18 MB) with their licences and source. They load only when the driver turns the wake word on, and the service worker keeps them for offline use.
- The microphone stays open while the wake word is on, so the phone shows that it is recording. Talk and the wake word share that one stream.
- The thresholds (wake score, silence level, 1.2 s end of turn) are estimates until a field test in the car.
