/**
 * openui.html: pick a program (the 5 approved states and the novel screens), a posture, stress
 * and Daylight; see the program beside its render and the gate's verdict. Dev-only.
 *
 *   ?program=<id>&posture=ul|up|fl|fp|fill&stress=1&daylight=1
 *   &bare=1    the frame alone, filling the window (the capture tool)
 *   &still=1   no ticking (captures match dev.html at t = 0)
 *   &api=1     window.oui for tools/openui-compose.mjs: the prompts, the context and the gate
 */
import type { ElementNode } from "@openuidev/lang-core";
import { type PostureId, POSTURES, gate, problemsText } from "./gate";
import { type Live, createLive } from "./live";
import { patch, read } from "./program";
import { PATCH_A, PROGRAMS, programById } from "./programs";
import { contextMessage, editPrompt, systemPrompt } from "./prompt";
import { type Host, type Step, createHost, draw } from "./render";
import { sceneById } from "./scenes";

const q = new URLSearchParams(location.search);
const flag = (k: string) => q.has(k) && q.get(k) !== "0";
const root = document.getElementById("app") as HTMLElement;

if (flag("api")) {
  // The compose tool's door: everything it needs, computed by this module's own code.
  (window as unknown as { oui: unknown }).oui = {
    systemPrompt,
    editPrompt,
    context: (scene: string) => {
      const live = createLive(need(scene), { still: true });
      try {
        return contextMessage(live);
      } finally {
        live.dispose();
      }
    },
    gate: async (program: string, scene: string) => {
      const r = await gate(program, need(scene));
      return { ...r, text: problemsText(r.problems) };
    },
    patch,
  };
  document.body.dataset.ready = "1";
} else run();

function need(id: string) {
  const s = sceneById(id);
  if (!s) throw new Error(`No scene ${id}`);
  return s;
}

function run(): void {
  const state = {
    program: q.get("program") ?? "near",
    posture: (q.get("posture") ?? "ul") as PostureId | "fill",
    stress: flag("stress"),
    daylight: flag("daylight"),
  };
  const bare = flag("bare");
  const still = flag("still");
  document.body.classList.add(bare ? "oui-bare" : "oui-dev");

  // ---- The chrome (not in bare mode) ----
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    e.append(...kids);
    return e;
  };
  const stageBox = el("div", { class: "oui-stage" });
  const frameBox = el("div", { class: "oui-framebox" });
  stageBox.append(frameBox);
  const code = el("pre", { class: "oui-code", "aria-label": "Program" });
  const verdict = el("div", { class: "oui-verdict", role: "status" });
  const lastAction = el("div", { class: "oui-action", role: "status" });
  const patchBox = el("div", { class: "oui-patch" });

  if (bare) root.append(frameBox);
  else {
    const select = el("select", { "aria-label": "Program" });
    for (const p of PROGRAMS) select.append(el("option", { value: p.id }, `${p.kind === "approved" ? "" : "Novel: "}${p.label}`));
    select.value = state.program;
    const posture = el("select", { "aria-label": "Posture" });
    for (const p of POSTURES) posture.append(el("option", { value: p.id }, `${p.id} ${p.w}×${p.h}`));
    posture.append(el("option", { value: "fill" }, "Fill this window"));
    posture.value = state.posture;
    const check = (label: string, on: boolean, set: (v: boolean) => void) => {
      const box = el("input", { type: "checkbox" });
      box.checked = on;
      box.addEventListener("change", () => set(box.checked));
      return el("label", {}, box, ` ${label}`);
    };
    select.addEventListener("change", () => update({ program: select.value }));
    posture.addEventListener("change", () => update({ posture: posture.value as PostureId | "fill" }));
    const bar = el(
      "header",
      { class: "oui-bar" },
      el("label", {}, "Program ", select),
      el("label", {}, "Posture ", posture),
      check("Stress", state.stress, (v) => update({ stress: v })),
      check("Daylight", state.daylight, (v) => update({ daylight: v })),
    );
    const side = el("aside", { class: "oui-side" }, verdict, code, patchBox, lastAction);
    root.append(bar, el("div", { class: "oui-main" }, stageBox, side));
  }

  let host: Host | undefined;
  let live: Live | undefined;
  let tree: ElementNode | null = null;
  let source = "";
  let off: (() => void) | undefined;

  function update(patchState: Partial<typeof state>): void {
    Object.assign(state, patchState);
    const url = new URL(location.href);
    url.searchParams.set("program", state.program);
    url.searchParams.set("posture", state.posture);
    for (const k of ["stress", "daylight"] as const) {
      if (state[k]) url.searchParams.set(k, "1");
      else url.searchParams.delete(k);
    }
    history.replaceState(null, "", url);
    load();
  }

  function size(): void {
    const p = POSTURES.find((x) => x.id === state.posture);
    const fill = bare || !p;
    frameBox.style.width = fill ? "100%" : `${p.w}px`;
    frameBox.style.height = fill ? "100%" : `${p.h}px`;
    // A posture larger than the window is drawn at its real size, then scaled to fit.
    const avail = stageBox.clientWidth;
    const scale = !fill && avail && p ? Math.min(1, avail / p.w) : 1;
    frameBox.style.transform = scale < 1 ? `scale(${scale})` : "";
    stageBox.style.height = !fill && p ? `${Math.ceil(p.h * scale)}px` : "";
  }

  function load(): void {
    const entry = programById(state.program) ?? PROGRAMS[0];
    const scene = entry ? sceneById(entry.scene) : undefined;
    if (!entry || !scene) return;
    off?.();
    live?.dispose();
    live = createLive(scene, { stress: state.stress, daylight: state.daylight, still });
    set(entry.program);
    off = live.subscribe(redraw);
    patchBox.replaceChildren();
    if (entry.id === "novel-a" && PATCH_A) {
      const b = el("button", { type: "button" }, "Apply the patch (mergeStatements)");
      const patchText = PATCH_A;
      b.addEventListener("click", () => {
        set(patch(source, patchText));
        b.disabled = true;
      });
      patchBox.append(el("p", {}, "The mutation: these statements replace their namesakes; the DOM is patched in place."), el("pre", { class: "oui-code" }, PATCH_A.trim()), b);
    }
  }

  function set(program: string): void {
    source = program;
    tree = read(program).root;
    code.textContent = program.trim();
    redraw();
    void verdictFor(program);
  }

  async function verdictFor(program: string): Promise<void> {
    if (bare) return;
    const entry = programById(state.program);
    const scene = entry ? sceneById(entry.scene) : undefined;
    if (!scene) return;
    verdict.textContent = "Gate: checking…";
    const r = await gate(program, scene, { stress: state.stress });
    if (program !== source) return;
    verdict.textContent = r.ok ? "Gate: passed at all four postures." : problemsText(r.problems);
    verdict.toggleAttribute("data-bad", !r.ok);
  }

  function redraw(): void {
    if (!live || !tree) return;
    if (!host) {
      host = createHost(frameBox);
      host.frame.addEventListener("click", onClick);
      new ResizeObserver(() => redraw()).observe(host.shell);
    }
    size();
    draw(host, tree, live);
  }

  function onClick(e: Event): void {
    const t = (e.target as Element).closest("[data-action], [data-talk]");
    if (!t || !live) return;
    if (t.hasAttribute("data-talk")) {
      say("Talk: the co-driver listens (stub)");
      return;
    }
    const action = t.getAttribute("data-action") ?? "";
    const arg = t.getAttribute("data-arg");
    if (action !== "oui") {
      if (action === "key-toggle") void live.f.listening.send({ type: "toggle" });
      if (action === "key-back") void live.f.listening.send({ type: "back" });
      if (action === "key-forward") void live.f.listening.send({ type: "forward" });
      say(`App action: ${action}${arg ? ` ${arg}` : ""}`);
      return;
    }
    const step = JSON.parse(arg ?? "{}") as Step;
    say(`${step.type}(${Object.values(step).slice(1).map((v) => JSON.stringify(v)).join(", ")})${perform(step, live)}`);
  }

  function say(text: string): void {
    lastAction.textContent = `Last tap: ${text}`;
  }

  load();
  addEventListener("resize", () => size());
  void ready();
}

/** The stub actions, onto the fakes' contract. Returns what it called. */
function perform(step: Step, live: Live): string {
  const extras = live.extras;
  const place = (k: unknown) => (k === "dest" ? undefined : extras.suggest?.[Number(String(k).split(".")[1])]?.place);
  switch (step.type) {
    case "AddStop": {
      const p = place(step.place);
      if (p) void live.f.nav.addStop(p);
      return p ? ` → nav.addStop(${p.name})` : "";
    }
    case "StartRoute": {
      const p = place(step.place);
      if (p) void live.f.nav.start(p);
      return p ? ` → nav.start(${p.name})` : "";
    }
    case "Play": {
      const it = step.item === "media.now" ? live.f.listening.nowPlaying?.item : extras.next;
      if (it) void live.f.listening.send({ type: "playItem", item: it });
      return it ? ` → listening.send(playItem ${it.title})` : "";
    }
    case "ToCoDriver":
      return " → co-driver (stub: the spike has no link)";
    case "OpenSheet":
      return " → the app's sheet (stub)";
    default:
      return "";
  }
}

async function ready(): Promise<void> {
  await document.fonts.ready;
  await Promise.all([...document.images].map((img) => (img.complete ? undefined : new Promise((r) => { img.onload = img.onerror = r; }))));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  document.body.dataset.ready = "1";
}
