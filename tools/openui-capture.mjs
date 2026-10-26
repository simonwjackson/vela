#!/usr/bin/env -S nix shell nixpkgs#nodejs_22 nixpkgs#chromium nixpkgs#imagemagick nixpkgs#dejavu_fonts --command node
// The OpenUI spike's captures, at the four Fold postures. Dev-only; writes outside src/.
//
//   tools/openui-capture.mjs [--out DIR] [--mockups DIR] [--only compare|novel] [--daylight] [--stress]
//
//   compare: each approved state as  mockup | the app (dev.html) | the program (openui.html),
//            one row per posture. --mockups is the Signal mockup's renders folder
//            (<name>-normal-<posture>.png at 2x); without it the column is left out.
//   novel:   each novel program (and the mutation's before and after), the four postures in a row,
//            plus the gate's verdict on each.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { POSTURES, browser, devServer, repo } from "./lib/browser.mjs";

const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const out = opt("out", join(repo, "captures"));
const mockups = opt("mockups");
const only = opt("only");
const daylight = argv.includes("--daylight");
const stress = argv.includes("--stress");
const variant = [stress ? "stress" : "normal", daylight ? "daylight" : ""].filter(Boolean).join("-");
const extra = `${stress ? "&stress=1" : ""}${daylight ? "&daylight=1" : ""}`;
mkdirSync(join(out, "tiles"), { recursive: true });

const magick = (...args) => execFileSync("magick", args, { stdio: ["ignore", "ignore", "inherit"] });
const diff = (a, b, dst) => {
  // Pixels that differ by more than 2% (antialiasing aside), and the red-on-grey difference image.
  try {
    execFileSync("magick", ["compare", "-fuzz", "2%", "-metric", "AE", a, b, dst], { stdio: ["ignore", "ignore", "pipe"] });
    return 0;
  } catch (e) {
    return Number.parseFloat(String(e.stderr)) || -1;
  }
};
const label = (src, text, dst) => magick(src, "-background", "#1b1c1f", "-fill", "#c3c7ce", "-font", "DejaVu-Sans", "-pointsize", "15", `label:${text}`, "+swap", "-gravity", "west", "-append", dst);

const server = await devServer();
const page = await browser();
const report = [];
try {
  if (only !== "novel") {
    for (const id of ["near", "far", "noroute", "speaking", "stops"]) {
      const rows = [];
      for (const p of POSTURES) {
        const cells = [];
        if (mockups) {
          const m = join(mockups, `${id}-${variant === "normal" ? "normal" : variant}-${p.id}.png`);
          if (existsSync(m)) {
            const t = join(out, "tiles", `${id}-${p.id}-mockup.png`);
            magick(m, "-resize", `${p.w}x${p.h}!`, t);
            label(t, ` mockup  ${id} ${p.id}`, t);
            cells.push(t);
          }
        }
        const raw = (k) => join(out, "tiles", `${id}-${p.id}-${k}-raw.png`);
        const app = join(out, "tiles", `${id}-${p.id}-app.png`);
        await page.open(`${server.origin}/dev.html?state=${id}${extra}`, p.w, p.h);
        await page.shot(raw("app"));
        label(raw("app"), ` app (dev.html)  ${id} ${p.id}`, app);
        cells.push(app);
        const oui = join(out, "tiles", `${id}-${p.id}-openui.png`);
        await page.open(`${server.origin}/openui.html?program=${id}&bare=1&still=1${extra}`, p.w, p.h);
        await page.shot(raw("openui"));
        label(raw("openui"), ` program (openui.html)  ${id} ${p.id}`, oui);
        cells.push(oui);
        const px = diff(raw("app"), raw("openui"), join(out, "tiles", `${id}-${p.id}-diff.png`));
        console.log(`${id} ${p.id}: ${px} px differ between dev.html and openui.html (${((px / (p.w * p.h)) * 100).toFixed(2)}%)`);
        const row = join(out, "tiles", `${id}-${p.id}-row.png`);
        magick(...cells, "-background", "#000", "-splice", "12x0", "+append", row);
        rows.push(row);
      }
      const sheet = join(out, `compare-${id}-${variant}.png`);
      magick(...rows, "-background", "#000", "-splice", "0x12", "-append", sheet);
      report.push(sheet);
    }
  }
  if (only !== "compare") {
    await page.open(`${server.origin}/openui.html?api=1`);
    const ids = await page.evaluate("fetch('/src/ui/openui/programs.ts').then(() => true)");
    void ids;
    for (const id of ["novel-a", "novel-b", "novel-c", "novel-d", "novel-a-after"]) {
      if (!existsSync(join(repo, "src/ui/openui/programs", `${id}.oui`))) continue;
      const tiles = [];
      for (const p of POSTURES) {
        const t = join(out, "tiles", `${id}-${p.id}.png`);
        await page.open(`${server.origin}/openui.html?program=${id}&bare=1&still=1${extra}`, p.w, p.h);
        await page.shot(t);
        label(t, ` ${id} ${p.id} ${p.w}×${p.h}`, t);
        tiles.push(t);
      }
      const sheet = join(out, `${id}-${variant}.png`);
      magick(...tiles, "-background", "#000", "-splice", "12x0", "-gravity", "north", "+append", sheet);
      report.push(sheet);
    }
  }
  // The gate's verdict on every program, from the page's own gate.
  await page.open(`${server.origin}/openui.html?api=1`);
  const verdicts = await page.evaluate(`(async () => {
    const { PROGRAMS } = await import("/src/ui/openui/programs.ts");
    const out = [];
    for (const p of PROGRAMS) { const r = await window.oui.gate(p.program, p.scene, ${stress}); out.push({ id: p.id, ok: r.ok, problems: r.problems }); }
    return out;
  })()`);
  writeFileSync(join(out, `gate-${variant}.json`), `${JSON.stringify(verdicts, null, 2)}\n`);
  for (const v of verdicts) console.log(`${v.ok ? "pass" : "FAIL"} ${v.id}${v.ok ? "" : `\n  ${v.problems.map((p) => `[${p.code}] ${p.message}`).join("\n  ")}`}`);
  if (page.logs.length) console.log("page errors:", page.logs.join("\n"));
} finally {
  page.close();
  await server.close();
}
console.log(report.join("\n"));
