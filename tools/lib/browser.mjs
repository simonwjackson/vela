// The OpenUI spike's tools: a Vite dev server for this checkout and one headless Chromium page,
// driven over the DevTools protocol (Node's own WebSocket). Dev-only.
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer as netServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Vite on a free local port, serving this checkout (dev.html and openui.html). */
export async function devServer() {
  const { createServer } = await import("vite");
  const server = await createServer({ root: repo, logLevel: "error", server: { host: "127.0.0.1", port: await freePort(), strictPort: true } });
  await server.listen();
  const { port } = server.httpServer.address();
  return { origin: `http://127.0.0.1:${port}`, close: () => server.close() };
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = netServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });
}

/** One headless Chromium tab. */
export async function browser() {
  const bin = execFileSync("sh", ["-c", "command -v chromium || command -v chromium-browser || command -v google-chrome"], { encoding: "utf8" }).trim();
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), "vela-oui-"));
  const proc = spawn(bin, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1", "about:blank"], { stdio: "ignore" });
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
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    } else if (msg.method === "Runtime.exceptionThrown") logs.push(msg.params.exceptionDetails?.exception?.description ?? "exception");
    else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") logs.push(msg.params.args.map((a) => a.value ?? a.description).join(" "));
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, { resolve, reject });
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const waitFor = async (expression, ms = 20000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      try {
        if (await evaluate(expression)) return;
      } catch {}
      await sleep(100);
    }
    throw new Error(`timed out waiting for ${expression}; page errors: ${logs.join(" | ")}`);
  };
  await send("Page.enable");
  await send("Runtime.enable");
  return {
    logs,
    evaluate,
    waitFor,
    async open(url, w = 932, h = 553) {
      await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
      await send("Page.navigate", { url });
      await sleep(200);
      await waitFor("document.body && document.body.dataset.ready === '1'");
      await sleep(300);
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

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const POSTURES = [
  { id: "ul", w: 932, h: 553 },
  { id: "up", w: 704, h: 783 },
  { id: "fl", w: 711, h: 374 },
  { id: "fp", w: 475, h: 638 },
];
