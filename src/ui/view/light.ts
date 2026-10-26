/**
 * The Light: the cover's middle colour at .10, or the Source tint when the cover is missing,
 * cannot be read (no CORS), or is too bright to sit behind text. Nothing playing: the accent at .05.
 */
import type { SourceId } from "../app/contract";
import { SOURCE_TINT } from "./parts";

/** Relative luminance over this is too bright (a guess until tried in the car). */
export const TOO_BRIGHT = 0.5;

export function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);
}

const hex = (r: number, g: number, b: number): string => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

/** The light for a colour: the colour itself, or the Source tint when it is too bright. */
export function lightFor(color: string | undefined, source: SourceId): string {
  return color && luminance(color) <= TOO_BRIGHT ? color : SOURCE_TINT[source];
}

const cache = new Map<string, Promise<string | undefined>>();

/** The middle colour of a cover: its average, read through a small canvas. */
export function coverColor(url: string): Promise<string | undefined> {
  let p = cache.get(url);
  if (!p) {
    p = new Promise<string | undefined>((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.decoding = "async";
      img.onload = () => {
        try {
          const size = 12;
          const c = document.createElement("canvas");
          c.width = size;
          c.height = size;
          const ctx = c.getContext("2d", { willReadFrequently: true });
          if (!ctx) return resolve(undefined);
          ctx.drawImage(img, 0, 0, size, size);
          // The whole cover, averaged: its middle colour, steady across covers with a bright motif.
          const d = ctx.getImageData(0, 0, size, size).data;
          let r = 0;
          let g = 0;
          let b = 0;
          let n = 0;
          for (let i = 0; i < d.length; i += 4) {
            r += d[i] ?? 0;
            g += d[i + 1] ?? 0;
            b += d[i + 2] ?? 0;
            n++;
          }
          resolve(n ? hex(r / n, g / n, b / n) : undefined);
        } catch {
          resolve(undefined); // a cover without CORS taints the canvas: use the Source tint
        }
      };
      img.onerror = () => resolve(undefined);
      img.src = url;
    });
    cache.set(url, p);
  }
  return p;
}
