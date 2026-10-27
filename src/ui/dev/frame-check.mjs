// Dev-only check: nothing paints outside the frame. Opens every dev.html state (plain and worst
// case) and every dev-moments scene at every posture in core/postures.ts, and lists each visible
// element whose box crosses the screen edge. The root clips at the frame (.vela: overflow hidden,
// contain paint), so this looks through that clip on purpose: it finds the source, not the symptom.
// Clips inside the frame (a scrolling list, a card) count; a 56 px hit area around a drawn glyph
// in the top row does not.
//
//   node src/ui/dev/frame-check.mjs <checkout> [posture ...]     exit 1 when anything crosses
import { resolve } from "node:path";
import { POSTURES } from "../core/postures.ts";
import { browser, devServer } from "./capture.mjs";

/** Runs in the page: the elements whose visible part crosses the viewport edge. */
export const PROBE = `(() => {
  const W = innerWidth, H = innerHeight, out = [];
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    let [x0, y0, x1, y1] = [r.left, r.top, r.right, r.bottom];
    for (let p = el.parentElement; p && !p.matches(".vela, body, html"); p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.overflowX === "visible" && cs.overflowY === "visible" && !cs.contain.includes("paint")) continue;
      const q = p.getBoundingClientRect();
      x0 = Math.max(x0, q.left); y0 = Math.max(y0, q.top); x1 = Math.min(x1, q.right); y1 = Math.min(y1, q.bottom);
    }
    return [x0, y0, x1, y1];
  };
  for (const el of document.querySelectorAll(".vela *")) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || el.matches(".top .icon-btn, .top .icon-btn *, .m-close, .m-close *")) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.opacity === "0") continue;
    const [x0, y0, x1, y1] = visible(el);
    if (x1 - x0 < 1 || y1 - y0 < 1) continue;
    if (x0 < -1 || y0 < -1 || x1 > W + 1 || y1 > H + 1) {
      const name = (el.getAttribute("class") || el.tagName.toLowerCase()).split(/\\s+/)[0];
      out.push(name + " at " + [r.left, r.top, r.width, r.height].map(Math.round).join(","));
    }
  }
  return out;
})()`;

const SCENES = ["fuel", "arrived", "stops", "weather", "engine"];
const PHASES = ["waiting", "screen", "details", "settings"];

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const [checkout, ...ids] = process.argv.slice(2);
  if (!checkout) {
    console.error("usage: frame-check.mjs <checkout> [posture ...]");
    process.exit(2);
  }
  const postures = ids.length ? POSTURES.filter((p) => ids.includes(p.id)) : POSTURES;
  process.env.SETTLE_MS ??= "250";
  const server = await devServer(resolve(checkout));
  const b = await browser();
  let bad = 0;
  try {
    await b.open(`${server.origin}/dev.html`, 1000, 755);
    const states = await b.evaluate(`[...document.querySelectorAll("ol a")].map((a) => new URL(a.href).searchParams.get("state"))`);
    const paths = [
      ...states.flatMap((s) => [`/dev.html?state=${s}`, `/dev.html?state=${s}&stress=1`]),
      ...SCENES.flatMap((s) => PHASES.map((p) => `/dev-moments.html?bare=1&scene=${s}&phase=${p}`)),
    ];
    for (const p of postures) {
      for (const path of paths) {
        // One retry: a page that times out (a dev-server reload mid-run) is opened again.
        await b.open(`${server.origin}${path}`, p.w, p.h).catch(() => b.open(`${server.origin}${path}`, p.w, p.h));
        const found = await b.evaluate(PROBE);
        if (!found.length) continue;
        bad++;
        console.log(`${p.id} ${path}: ${found.slice(0, 4).join("; ")}`);
      }
    }
    console.log(bad ? `${bad} frames paint outside the screen` : `nothing paints outside the frame (${paths.length} pages × ${postures.length} postures)`);
  } finally {
    b.close();
    await server.close();
  }
  process.exit(bad ? 1 : 0);
}
