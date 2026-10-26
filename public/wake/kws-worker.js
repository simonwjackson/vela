// Vela's wake word: sherpa-onnx keyword spotting (wasm) in a Web Worker. Everything stays on
// the phone (ADR 0009). Adapted from the wake-word field test; see README.md here.
//
// In:  {type:'init', keywords: [{name, tokens}], boost, floor}
//      {type:'audio', samples: Float32Array}   16 kHz mono, any length
// Out: {type:'progress', loaded, total}         bytes of the engine and model fetched so far
//      {type:'ready', loadMs}
//      {type:'kw', keyword, score}              score: mean token probability, 0..1
//      {type:'error', message}
'use strict';

const BASE = new URL('./', self.location.href).href;
const ENGINE = 'sherpa/';
const FILES = [
  // [name, path, approximate bytes for progress when the server sends no length]
  ['wasm', 'sherpa/sherpa-onnx-wasm-kws-main.wasm', 12755384],
  ['encoder', 'model/encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx', 4807159],
  ['decoder', 'model/decoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx', 277985],
  ['joiner', 'model/joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx', 163380],
  ['tokens', 'model/tokens.txt', 5006],
];

let kws = null;
let stream = null;
let ready = false;

function post(message) {
  self.postMessage(message);
}

async function fetchAll() {
  const total = FILES.reduce((sum, f) => sum + f[2], 0);
  let loaded = 0;
  const out = {};
  for (const [name, path] of FILES) {
    const response = await fetch(BASE + path);
    if (!response.ok) throw new Error(`The wake word could not load ${path}: HTTP ${response.status}`);
    const reader = response.body.getReader();
    const parts = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      size += value.length;
      loaded += value.length;
      post({ type: 'progress', loaded: Math.min(loaded, total), total });
    }
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const part of parts) {
      bytes.set(part, at);
      at += part.length;
    }
    out[name] = bytes;
  }
  return out;
}

function startEngine(wasmBinary) {
  return new Promise((resolve, reject) => {
    self.Module = {
      wasmBinary,
      locateFile: (p) => BASE + ENGINE + p,
      print: () => {},
      printErr: (t) => console.warn('[sherpa]', t),
      onRuntimeInitialized: resolve,
      onAbort: (what) => reject(new Error(`The wake-word engine stopped: ${what}`)),
    };
    importScripts(BASE + ENGINE + 'sherpa-onnx-kws.js', BASE + ENGINE + 'sherpa-onnx-wasm-kws-main.js');
  });
}

async function init(m) {
  const t0 = performance.now();
  const files = await fetchAll();
  await startEngine(files.wasm);
  const FS = self.Module.FS;
  try {
    FS.mkdir('/m');
  } catch (_) {
    // Exists.
  }
  FS.writeFile('/m/encoder.onnx', files.encoder);
  FS.writeFile('/m/decoder.onnx', files.decoder);
  FS.writeFile('/m/joiner.onnx', files.joiner);
  FS.writeFile('/m/tokens.txt', files.tokens);
  kws = createKws(self.Module, {
    featConfig: { samplingRate: 16000, featureDim: 80 },
    modelConfig: {
      transducer: { encoder: '/m/encoder.onnx', decoder: '/m/decoder.onnx', joiner: '/m/joiner.onnx' },
      tokens: '/m/tokens.txt',
      provider: 'cpu',
      modelType: '',
      numThreads: 1,
      debug: 0,
      modelingUnit: 'bpe',
      bpeVocab: '',
    },
    maxActivePaths: 4,
    numTrailingBlanks: 1,
    keywordsScore: m.boost,
    keywordsThreshold: m.floor,
    keywords: m.keywords.map((k) => `${k.tokens} :${m.boost} #${m.floor} @${k.name}`).join('\n'),
  });
  if (!kws.handle) throw new Error('The wake-word engine refused its keywords or model');
  stream = kws.createStream();
  ready = true;
  post({ type: 'ready', loadMs: Math.round(performance.now() - t0) });
}

function audio(samples) {
  stream.acceptWaveform(16000, samples);
  while (kws.isReady(stream)) {
    kws.decode(stream);
    const r = kws.getResult(stream);
    if (r.keyword && r.keyword.length > 0) {
      post({ type: 'kw', keyword: r.keyword, score: typeof r.score === 'number' ? r.score : null });
      kws.reset(stream);
    }
  }
}

self.onmessage = (event) => {
  const m = event.data;
  try {
    if (m.type === 'init') init(m).catch((e) => post({ type: 'error', message: String((e && e.message) || e) }));
    else if (m.type === 'audio' && ready) audio(m.samples);
  } catch (e) {
    post({ type: 'error', message: String((e && e.message) || e) });
  }
};
