// Collects mic samples (the AudioContext runs at 16 kHz) into 100 ms chunks.
// Posts {samples: Float32Array, rms, peak} to the main thread.
class Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 1600;
    this.buf = new Float32Array(this.size);
    this.n = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i];
      if (this.n === this.size) {
        let sum = 0, peak = 0;
        for (let j = 0; j < this.size; j++) {
          const v = this.buf[j];
          sum += v * v;
          const a = v < 0 ? -v : v;
          if (a > peak) peak = a;
        }
        const out = this.buf;
        this.port.postMessage({ samples: out, rms: Math.sqrt(sum / this.size), peak }, [out.buffer]);
        this.buf = new Float32Array(this.size);
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor('capture', Capture);
