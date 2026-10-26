# Wake word files

Vela's "Hey Vela" wake word runs on the phone (ADR 0009). These files are served as they are
from `/wake/`. The page loads none of them until the driver turns the wake word on; then the
service worker keeps them for offline use.

| Path | What | Licence |
|---|---|---|
| `kws-worker.js` | The Web Worker that runs the engine (Vela's) | MIT, as Vela |
| `capture-worklet.js` | The microphone in 100 ms frames at 16 kHz (Vela's) | MIT, as Vela |
| `keywords.txt` | BPE tokens for HEY VELA in the two spellings the model hears (VE LA, VE LL A), made with the model's `bpe.model`; the same list as `WAKE_KEYWORDS` in `src/wake/wake-word.ts` | MIT, as Vela |
| `sherpa/sherpa-onnx-wasm-kws-main.{js,wasm}`, `sherpa/sherpa-onnx-kws.js` | sherpa-onnx keyword spotting, built for WebAssembly | Apache-2.0, `sherpa/LICENSE` |
| `sherpa/SOURCE.txt`, `sherpa/sherpa-onnx-wake-patch.diff` | The upstream commit, the build and Vela's patch (adds the score to each result, exports `FS`, no preloaded model) | Apache-2.0 |
| `model/*.int8.onnx`, `model/tokens.txt`, `model/bpe.model` | `sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01`, int8 | Apache-2.0, `model/README.md` |

Model source: https://github.com/k2-fsa/sherpa-onnx/releases/tag/kws-models (also on ModelScope as
`pkufool/sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01`).

The engine settings (boost 2.0, threshold 0.25, the "Vella" spelling variant) come from the
field test's offline evaluation; see `src/wake/wake-word.ts`.

To rebuild the wasm, check out the upstream commit in `sherpa/SOURCE.txt`, apply the patch, and run
`build-wasm-simd-kws.sh` with emscripten.
