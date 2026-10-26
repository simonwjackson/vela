/**
 * Audio formats between the phone and voice-gateway. The gateway speaks `pcm16`: 24 kHz, mono,
 * signed 16-bit little-endian, base64 in JSON. The microphone runs at 16 kHz (shared with the
 * wake word), so Talk upsamples 3:2 before sending.
 */

export const GATEWAY_RATE = 24_000;
export const MIC_RATE = 16_000;

/** 16 kHz float samples to 24 kHz PCM16, by linear interpolation. */
export function micToGateway(samples: Float32Array): Int16Array {
  const n = samples.length;
  const out = new Int16Array(Math.floor((n * 3) / 2));
  for (let j = 0; j < out.length; j++) {
    const pos = (j * 2) / 3;
    const i = Math.floor(pos);
    const a = samples[i] ?? 0;
    const b = samples[Math.min(n - 1, i + 1)] ?? a;
    const v = a + (b - a) * (pos - i);
    out[j] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
  }
  return out;
}

export function pcm16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < pcm.length; i++) view.setInt16(i * 2, pcm[i] as number, true);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function base64ToPcm16(text: string): Int16Array {
  const binary = atob(text);
  const out = new Int16Array(Math.floor(binary.length / 2));
  for (let i = 0; i < out.length; i++) {
    const lo = binary.charCodeAt(i * 2);
    const hi = binary.charCodeAt(i * 2 + 1);
    out[i] = ((hi << 8) | lo) << 16 >> 16;
  }
  return out;
}

export function pcm16ToFloat(pcm: Int16Array): Float32Array {
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = (pcm[i] as number) / 32768;
  return out;
}

/** Milliseconds of 24 kHz audio in `samples`. */
export function gatewayMs(samples: number): number {
  return (samples / GATEWAY_RATE) * 1000;
}
