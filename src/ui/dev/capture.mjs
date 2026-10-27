// Dev-only capture tool: a Vite dev server for a checkout and one headless Chromium tab, driven
// over the DevTools protocol with Node's own WebSocket. Not part of the app or its tests.
//
//   node src/ui/dev/capture.mjs <out-dir> <checkout> <path>@<size>[=name] ...
//
// <size> is <w>x<h>, a posture id from core/postures.ts (um, ul, up, fl, fp), or "all" for every
// posture; a posture id is added to the file name ("noroute@all=noroute" writes noroute-um.png …).
//
// Each page must set body[data-ready="1"] when it has drawn (dev.html and dev-moments.html do).
// CHROME sets the browser binary; the default looks on PATH, then in the Playwright cache.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer as netServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { POSTURES } from "../core/postures.ts";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((ok, fail) => {
    const s = netServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
    s.on("error", fail);
  });
}

function chromeBin() {
  if (process.env.CHROME) return process.env.CHROME;
  try {
    return execFileSync("sh", ["-c", "command -v chromium || command -v chromium-browser || command -v google-chrome"], { encoding: "utf8" }).trim();
  } catch {
    const cache = join(homedir(), ".cache", "ms-playwright");
    const dirs = existsSync(cache) ? readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort() : [];
    for (const d of dirs.reverse()) {
      const bin = join(cache, d, "chrome-linux64", "chrome");
      if (existsSync(bin)) return bin;
    }
    throw new Error("No Chromium: set CHROME");
  }
}

export async function devServer(root) {
  const { createServer } = await import(join(root, "node_modules", "vite", "dist", "node", "index.js"));
  const server = await createServer({ root, configFile: join(root, "vite.config.ts"), logLevel: "error", server: { host: "127.0.0.1", port: await freePort(), strictPort: true } });
  await server.listen();
  const { port } = server.httpServer.address();
  return { origin: `http://127.0.0.1:${port}`, close: () => server.close() };
}

export async function browser() {
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), "vela-capture-"));
  const proc = spawn(chromeBin(), ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1", "about:blank"], { stdio: "ignore" });
  let targets;
  for (let i = 0; i < 200 && !targets; i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    } catch {
      await sleep(100);
    }
  }
  const page = targets.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0;
  const pending = new Map();
  const logs = [];
  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { ok, fail } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? fail(new Error(JSON.stringify(msg.error))) : ok(msg.result);
    } else if (msg.method === "Runtime.exceptionThrown") logs.push(msg.params.exceptionDetails?.exception?.description ?? "exception");
    else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") logs.push(msg.params.args.map((a) => a.value ?? a.description).join(" "));
  });
  const send = (method, params = {}) =>
    new Promise((ok, fail) => {
      const n = ++id;
      pending.set(n, { ok, fail });
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  await send("Page.enable");
  await send("Runtime.enable");
  return {
    logs,
    evaluate,
    async open(url, w, h) {
      await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
      // Reduced motion: the Light's cross-fade and swaps settle fast, so captures repeat exactly.
      await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
      await send("Page.navigate", { url });
      await sleep(200);
      const end = Date.now() + 20_000;
      for (;;) {
        try {
          if (await evaluate("document.body && document.body.dataset.ready === '1'")) break;
        } catch {}
        if (Date.now() > end) throw new Error(`timed out on ${url}: ${logs.join(" | ")}`);
        await sleep(100);
      }
      await sleep(Number(process.env.SETTLE_MS ?? 1000));
    },
    async shot(path) {
      const r = await send("Page.captureScreenshot", { format: "png" });
      writeFileSync(path, Buffer.from(r.data, "base64"));
    },
    close() {
      ws.close();
      proc.kill();
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {}
    },
  };
}

/** One shot spec as [path, w, h, name] frames: a size, a posture id, or every posture. */
export function expand(spec) {
  const m = /^(.*)@([^=]+)(?:=(.+))?$/.exec(spec);
  if (!m) throw new Error(`bad shot ${spec}`);
  const [, path, size, given] = m;
  const name = given ?? path.replace(/[^a-z0-9]+/gi, "_");
  const wh = /^(\d+)x(\d+)$/.exec(size);
  if (wh) return [[path, Number(wh[1]), Number(wh[2]), name]];
  const list = size === "all" ? POSTURES : POSTURES.filter((p) => p.id === size);
  if (!list.length) throw new Error(`bad size ${size}: use <w>x<h>, all, or one of ${POSTURES.map((p) => p.id).join(", ")}`);
  return list.map((p) => [path, p.w, p.h, size === "all" ? `${name}-${p.id}` : name]);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const [out, checkout, ...shots] = process.argv.slice(2);
  if (!out || !checkout || !shots.length) {
    console.error("usage: capture.mjs <out-dir> <checkout> <path>@<w>x<h>|<posture>|all[=name] ...");
    process.exit(2);
  }
  mkdirSync(out, { recursive: true });
  const server = await devServer(resolve(checkout));
  const b = await browser();
  try {
    for (const [path, w, h, name] of shots.flatMap(expand)) {
      const file = join(out, `${name}.png`);
      await b.open(`${server.origin}${path}`, w, h);
      await b.shot(file);
      console.log(file);
    }
    if (b.logs.length) console.error(`page errors: ${b.logs.join(" | ")}`);
  } finally {
    b.close();
    await server.close();
  }
}
