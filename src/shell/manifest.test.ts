/**
 * The web app manifest and the icons it and index.html point at: what Chrome needs to offer
 * install, and the files tools/render-icons.sh writes.
 */
import { shellRequestKind } from "../sw/worker-fetch";

// The tests run in Node; the project has no Node types, so the file system is typed here.
interface Bytes {
  subarray(start: number, end: number): Bytes;
  toString(encoding: "ascii" | "utf8"): string;
  readUInt8(at: number): number;
  readUInt32BE(at: number): number;
}
const fsModule = "node:fs";
const fs = (await import(/* @vite-ignore */ fsModule)) as { readFileSync(path: string): Bytes; existsSync(path: string): boolean };
const text = (path: string): string => fs.readFileSync(path).toString("utf8");

// Vitest runs from the project root.
const root = `${(globalThis as unknown as { process: { cwd(): string } }).process.cwd()}/`;
const pub = (path: string): string => `${root}public/${path.replace(/^\//, "")}`;

interface Icon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

const manifest = JSON.parse(text(pub("manifest.webmanifest"))) as Record<string, unknown> & { icons: Icon[] };
const html = text(`${root}index.html`);

/** Width, height and colour type from a PNG's IHDR. */
function png(path: string): { w: number; h: number; alpha: boolean } {
  const b = fs.readFileSync(path);
  expect(b.subarray(1, 4).toString("ascii")).toBe("PNG");
  const colourType = b.readUInt8(25);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), alpha: colourType === 4 || colourType === 6 };
}

test("the manifest has what install needs, and the Signal ground", () => {
  expect(manifest).toMatchObject({
    id: "/",
    name: "Vela",
    short_name: "Vela",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#08090a",
    theme_color: "#08090a",
  });
  expect(typeof manifest.description).toBe("string");
  // Fullscreen first for the car; standalone where a browser does not honour it.
  expect(manifest.display_override).toEqual(["fullscreen", "standalone"]);
});

test("every icon exists at its declared size; there is a 192, a 512 and a maskable 512", () => {
  for (const icon of manifest.icons) {
    expect(icon.type).toBe("image/png");
    const size = png(pub(icon.src));
    expect(`${size.w}x${size.h}`).toBe(icon.sizes);
  }
  const has = (sizes: string, purpose: string) => manifest.icons.some((i) => i.sizes === sizes && (i.purpose ?? "any").split(" ").includes(purpose));
  expect(has("192x192", "any")).toBe(true);
  expect(has("512x512", "any")).toBe(true);
  expect(has("512x512", "maskable")).toBe(true);
  // A maskable icon is full bleed: no transparent corners for a launcher mask to show.
  const maskable = manifest.icons.find((i) => i.purpose === "maskable");
  expect(maskable && png(pub(maskable.src)).alpha).toBe(false);
});

test("index.html links the manifest, the favicons and the apple-touch-icon, and the files exist", () => {
  const links = [...html.matchAll(/<link rel="(manifest|icon|apple-touch-icon)" href="([^"]+)"/g)].map((m) => ({ rel: m[1], href: m[2] ?? "" }));
  expect(links.map((l) => l.rel).sort()).toEqual(["apple-touch-icon", "icon", "icon", "manifest"]);
  for (const l of links) expect(fs.existsSync(pub(l.href)), l.href).toBe(true);
  expect(png(pub("apple-touch-icon.png"))).toEqual({ w: 180, h: 180, alpha: false });
  expect(text(pub("icon.svg"))).toContain("<svg");
  expect(text(pub("favicon.svg"))).toContain("<svg");
});

test("the service worker never serves the manifest or an icon: the host's copy always wins", () => {
  const paths = ["/manifest.webmanifest", "/icon.svg", "/favicon.svg", "/favicon.ico", "/apple-touch-icon.png", ...manifest.icons.map((i) => i.src)];
  for (const path of paths) {
    expect(shellRequestKind({ url: `https://vela.test${path}`, method: "GET", mode: "no-cors" }, "https://vela.test"), path).toBeUndefined();
  }
});
