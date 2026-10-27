// Dev-only: compare two folders of PNG captures pixel for pixel (byte-equal PNGs can differ in
// their compressed form). Prints "same", "DIFF <n> px" or "size" per file name in both folders.
//
//   node src/ui/dev/pixdiff.mjs <dir-a> <dir-b>
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";

/** Decode an 8-bit RGB or RGBA, non-interlaced PNG (what Chromium's screenshots are). */
export function decode(buf) {
  let pos = 8;
  let w = 0;
  let h = 0;
  let type = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const kind = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (kind === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      type = data[9];
    } else if (kind === "IDAT") idat.push(data);
    pos += 12 + len;
  }
  const bpp = type === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0;
      let v = src[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + x] = v & 255;
    }
  }
  return { w, h, bpp, px: out };
}

if (process.argv[1]?.endsWith("pixdiff.mjs")) {
  const [a, b] = process.argv.slice(2);
  for (const name of readdirSync(a).filter((n) => n.endsWith(".png")).sort()) {
    let y;
    try {
      y = decode(readFileSync(join(b, name)));
    } catch {
      continue;
    }
    const x = decode(readFileSync(join(a, name)));
    if (x.w !== y.w || x.h !== y.h || x.bpp !== y.bpp) {
      console.log(`size ${name}`);
      continue;
    }
    let n = 0;
    for (let i = 0; i < x.px.length; i += x.bpp) if (x.px.compare(y.px, i, i + x.bpp, i, i + x.bpp) !== 0) n++;
    console.log(n ? `DIFF ${n} px ${name}` : `same ${name}`);
  }
}
