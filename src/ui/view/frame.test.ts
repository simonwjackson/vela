/**
 * Nothing renders outside the frame. The driver's first report from the Fold (2026-10-27) showed a
 * card peeking in at the right edge; it was not Vela's (likely an OS picture-in-picture or pop-up
 * window), but the frame must hold either way. Two halves: the root clips (CSS), and every part the
 * app draws lives inside that root (mount). The layout half, in a real browser at every posture,
 * is `node src/ui/dev/frame-check.mjs .`.
 */
import { mount } from "../app/mount";
import { fakes } from "../dev/fakes";
import { fixtures } from "../dev/fixtures";
import { SCENARIOS } from "../dev/scenarios";

// The tests run in Node (Vitest runs from the project root); the project has no Node types, and
// Vitest does not load CSS, so the stylesheet is read as text.
const fsModule = "node:fs";
const fs = (await import(/* @vite-ignore */ fsModule)) as { readFileSync(path: string, encoding: "utf8"): string };
const cwd = (globalThis as unknown as { process: { cwd(): string } }).process.cwd();
const system = fs.readFileSync(`${cwd}/src/ui/styles/system.css`, "utf8");

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(css: string, selector: string): Record<string, string> {
  const body = css.replace(/\/\*[\s\S]*?\*\//g, "").split("}").find((r) => r.split("{")[0]?.trim() === selector);
  if (!body) throw new Error(`no rule ${selector}`);
  const decls = body.slice(body.indexOf("{") + 1).split(";");
  return Object.fromEntries(decls.map((d) => d.split(":").map((x) => x.trim())).filter((d) => d.length === 2 && d[0]).map(([k, v]) => [k as string, v as string]));
}

describe("the frame is the edge of the screen", () => {
  test("the root clips everything it holds, fixed and transformed parts too", () => {
    const vela = rule(system, ".vela");
    expect(vela.overflow).toBe("hidden");
    expect(vela.contain).toBe("paint");
    expect(rule(system, "html, body").overflow).toBe("hidden");
  });

  test("every state draws inside the root, and nothing outside it", async () => {
    for (const sc of SCENARIOS.filter((s) => s.id !== "boot-error")) {
      for (const stress of [false, true]) {
        const f = fakes();
        const setup = sc.setup(f, fixtures(stress), stress) ?? {};
        const root = document.createElement("div");
        document.body.append(root);
        const before = document.body.children.length;
        const unmount = mount(root, f, { ...(setup.initial ? { initial: setup.initial } : {}), ...(setup.memory ? { memory: setup.memory } : {}) });
        await new Promise((r) => setTimeout(r, 0));
        expect([...root.children].map((c) => c.className), sc.id).toEqual(["vela"]);
        expect(root.querySelector(".vela > .app"), sc.id).not.toBeNull();
        expect(document.body.children.length, `${sc.id} added to body`).toBe(before);
        unmount();
        root.remove();
      }
    }
  });
});
