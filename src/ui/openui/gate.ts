/**
 * The quality gate: one function the co-driver path calls before a composed screen shows.
 *
 *   1. the language   lang-core's parse errors, plus what it does not check: which component a
 *                     slot takes, which action steps exist, no Query/Mutation/$state
 *   2. Signal's rules exactly one answer and one Hero, cards per slot, one primary per surface,
 *                     copy rules from the brief, bound keys that have data, typed live values
 *   3. the render     the program drawn at the four Fold postures, then the app's own measured
 *                     adaptations (fit) and an overflow probe: overlap, clipped text, Talk
 *                     reachable and 56 px, every target 56 px
 *
 * Problems come back as UiProblems the model can act on (the assistant's pattern).
 */
import type { ASTNode, ElementNode } from "@openuidev/lang-core";
import { z } from "zod";
import type { $ZodType } from "zod/v4/core";
import { overflows } from "../view/fit";
import { type Live, type Scene, contextData, createLive, figureOf, mediaOf, placeOf, textOf } from "./live";
import { isElement, read } from "./program";
import { createHost, draw } from "./render";
import { ACTIONS, COMPONENTS, type HeroKey, type MediaKey, type PlaceKey, ROOT, type ValueKey } from "./vocabulary";

/** A screen program is small: a whole screen in a few hundred bytes; this is room for 4 times that. */
export const MAX_BYTES = 3 * 1024;
/** Cards in the card slot (a Split or Stack of two); more is a fourth part. */
export const MAX_CARDS = 2;
export const MAX_BUTTONS = 3;
export const MAX_ROWS = 4;
export const MAX_FACTS = 4;
export const MAX_CHILDREN = 3;
/** Copy lengths, in characters: cut words before type shrinks (brief). Guesses until tried in the car. */
export const MAX_LEN: Readonly<Record<string, number>> = {
  "Button.label": 22,
  "Chip.text": 32,
  "Quiet.text": 48,
  "Quiet.sub": 90,
  "Hero.line": 28,
  "Card.title": 40,
  "Text.text": 120,
  "CoDriver.text": 120,
  "Notice.title": 48,
  "Notice.sub": 90,
  "ListRow.title": 40,
  "ListRow.sub": 60,
  "Fact.label": 16,
};

export const POSTURES = [
  { id: "ul", label: "unfolded landscape", w: 932, h: 553 },
  { id: "up", label: "unfolded portrait", w: 704, h: 783 },
  { id: "fl", label: "folded landscape", w: 711, h: 374 },
  { id: "fp", label: "folded portrait", w: 475, h: 638 },
] as const;
export type PostureId = (typeof POSTURES)[number]["id"];

export interface UiProblem {
  /** 1-based line of the statement at fault. */
  line?: number;
  code: string;
  message: string;
  /** Render problems: the postures where it happens. */
  postures?: PostureId[];
}

const ANSWERS = new Set(["Hero", "Quiet", "NowPlaying"]);
const CARDS = new Set(["Listening", "WhereTo", "CoDriver", "Card", "Sheet"]);
/** Bound parts that exist once on a screen. */
const SINGLE = new Set(["NowPlaying", "Listening", "WhereTo", "CoDriver", "TripRow", "Shelf", "Sheet"]);
const STEPS = new Set<string>(ACTIONS.map((a) => a.name));
const SURFACES = new Set(["Card", "CoDriver", "Quiet"]);

// ---- 1 + 2: the program ------------------------------------------------------------------------

/** Static checks: the language and Signal's rules. With `live`, also the bound data. */
export function checkProgram(program: string, live?: Live): UiProblem[] {
  const bytes = new TextEncoder().encode(program).byteLength;
  if (bytes > MAX_BYTES) return [{ code: "too-large", message: `The program is ${bytes} bytes; the limit is ${MAX_BYTES}. A screen has three parts: say less.` }];
  const lines = statementLines(program);
  const at = (id: string | undefined): { line?: number } => {
    const l = id === undefined ? undefined : lines.get(id);
    return l === undefined ? {} : { line: l };
  };
  const out: UiProblem[] = [];
  const { result, root } = read(program);
  for (const e of result.meta.errors) if (e.severity !== "warning") out.push({ ...at(e.statementId), code: e.code, message: e.message });
  if (result.meta.incomplete) out.push({ code: "incomplete", message: "The program ends inside a string, call or list. Close every quote and bracket." });
  if (!result.root) out.push({ code: "no-root", message: `No root. The first line must be root = ${ROOT}(Stage(...)).` });
  else if (result.root.typeName !== ROOT) out.push({ ...at("root"), code: "root", message: `The root is ${result.root.typeName}. It must be ${ROOT}: root = ${ROOT}(stage).` });
  for (const n of new Set(result.meta.unresolved)) out.push({ code: "dangling-ref", message: `${n} is used but never defined. Define it, or remove the reference.` });
  for (const n of result.meta.orphaned) out.push({ ...at(n), code: "unused", message: `${n} is defined but no part uses it, so it does not show. Use it or remove it.` });
  for (const q of result.queryStatements) out.push({ ...at(q.statementId), code: "no-query", message: "Query() is not available: a screen binds live data by key." });
  for (const m of result.mutationStatements) out.push({ ...at(m.statementId), code: "no-mutation", message: "Mutation() is not available: use an action step on a Button." });
  for (const n of Object.keys(result.stateDeclarations)) out.push({ ...at(n), code: "no-state", message: `${n}: $variables are not available. Live values are bound by key, for example Fact("Arrive", "trip.eta").` });
  if (!result.root) return out;

  // Slots and steps, on the parsed tree (steps are still AST there).
  walk(result.root, undefined, (el, id) => {
    for (const p of slotProblems(el)) out.push({ ...at(id), ...p });
    for (const v of Object.values(el.props)) {
      for (const node of astNodes(v)) {
        if (node.k === "Comp" && !STEPS.has(node.name)) {
          out.push({ ...at(id), code: "action", message: `@${node.name} is not available. A Button's action is one of ${[...STEPS].map((s) => `@${s}`).join(", ")}.` });
        }
      }
    }
  });
  if (root) out.push(...signalRules(root, at, live));
  return dedupe(out);
}

function signalRules(root: ElementNode, at: (id: string | undefined) => { line?: number }, live: Live | undefined): UiProblem[] {
  const out: UiProblem[] = [];
  const stage = isElement(root.props.stage) ? root.props.stage : undefined;
  if (!stage) return out;
  const zones: [string, unknown][] = [["primary", stage.props.primary], ["secondary", stage.props.secondary], ["base", stage.props.base]];
  const counts = new Map<string, number>();
  let warns = isElement(root.props.chip) && root.props.chip.props.tone === "warn" ? 1 : 0;
  const ctxValues = live ? Object.entries(contextData(live)).filter((e): e is [string, string] => typeof e[1] === "string" && /\d/.test(e[1])) : [];

  for (const [zone, v] of zones) {
    if (!isElement(v)) continue;
    let answers = 0;
    let cards = 0;
    walk(v, undefined, (el, id) => {
      const name = el.typeName;
      counts.set(name, (counts.get(name) ?? 0) + 1);
      const where = at(id);
      if (ANSWERS.has(name) || (name === "Shelf" && zone === "primary")) answers++;
      if (CARDS.has(name) || (name === "Shelf" && zone === "secondary")) cards++;
      if (ANSWERS.has(name) && zone !== "primary") out.push({ ...where, code: "answer-slot", message: `${name} is an answer: put it in Stage's primary slot, not ${zone}.` });
      if (CARDS.has(name) && zone !== "secondary") out.push({ ...where, code: "card-slot", message: `${name} is a card: put it in Stage's secondary slot, not ${zone}.` });
      if (name === "Quiet" && el.props.tone === "warn") warns++;
      // One primary per surface.
      if (SURFACES.has(name)) {
        let primaries = 0;
        walk(el, undefined, (b) => {
          if (b.typeName === "Button" && b.props.kind === "primary") primaries++;
        });
        if (primaries > 1) out.push({ ...where, code: "one-primary", message: `${name} has ${primaries} primary Buttons. A surface has at most one; make the others secondary or quiet.` });
      }
      const many = (k: string, n: number, max: number, what: string) => {
        if (n > max) out.push({ ...where, code: "too-many", message: `${name} has ${n} ${what}; at most ${max}. ${k}` });
      };
      if (name === "Actions") many("Ask by voice for the rest.", len(el.props.buttons), MAX_BUTTONS, "buttons");
      if (name === "List") many("The rest belong in a sheet.", len(el.props.rows), MAX_ROWS, "rows");
      if (name === "Facts") many("Keep the ones the driver needs now.", len(el.props.items), MAX_FACTS, "facts");
      if (name === "Card" || name === "Stack") many("Split it, or say less.", len(el.props.children), MAX_CHILDREN, "parts");
      // Copy (brief: sentence case, no all caps, no middle dots; cut words before type shrinks).
      for (const [prop, val] of Object.entries(el.props)) {
        if (typeof val !== "string") continue;
        const max = MAX_LEN[`${name}.${prop}`];
        if (max !== undefined && val.length > max) out.push({ ...where, code: "too-long", message: `${name} ${prop} is ${val.length} characters; at most ${max}. Cut words.` });
        if (prop === "value" || prop === "place" || prop === "item" || prop === "kind" || prop === "tone" || prop === "glyph") continue;
        if (/[·•]/.test(val)) out.push({ ...where, code: "copy", message: `${name} ${prop}: no middle dots in copy. Write a sentence, or use Facts.` });
        if (/\b[A-Z]{4,}\b/.test(val)) out.push({ ...where, code: "copy", message: `${name} ${prop}: no all caps. Use sentence case.` });
        if (/!/.test(val)) out.push({ ...where, code: "copy", message: `${name} ${prop}: no exclamation marks. Signal is calm.` });
        // Live data is bound, never typed.
        for (const [key, shown] of ctxValues) {
          if (val.includes(shown)) out.push({ ...where, code: "typed-value", message: `${name} ${prop} types "${shown}", which ${key} shows live. Bind it (Fact or Hero with "${key}") and keep the words.` });
        }
      }
      if (live) out.push(...dataProblems(el, live).map((m) => ({ ...where, code: "no-data", message: m })));
    });
    if (zone === "primary" && answers !== 1) {
      out.push({ ...at(v.statementId), code: "one-answer", message: `Stage primary holds ${answers} answers. It holds exactly one: a Hero, Quiet, NowPlaying or Shelf (with a Notice or Facts beside it in a Stack if needed).` });
    }
    if (zone === "secondary" && cards > MAX_CARDS) out.push({ ...at(v.statementId), code: "too-many-cards", message: `The card slot holds ${cards} cards; at most ${MAX_CARDS}. Merge them into one Card.` });
  }
  if ((counts.get("Hero") ?? 0) > 1) out.push({ code: "one-hero", message: `The screen has ${counts.get("Hero")} Heroes. It has exactly one memorable figure; show the others as Facts.` });
  for (const n of SINGLE) if ((counts.get(n) ?? 0) > 1) out.push({ code: "once", message: `${n} shows ${counts.get(n)} times. It is bound to one thing: use it once.` });
  // Nothing repeats the answer or the trip row (brief: "No chip repeats the answer").
  const heroes: string[] = [];
  const facts: string[] = [];
  walk(stage, undefined, (el) => {
    if (el.typeName === "Hero") heroes.push(String(el.props.value));
    if (el.typeName === "Fact") facts.push(String(el.props.value));
    if (el.typeName === "Hero" && (el.props.value === "nav.next" || el.props.value === "trip.left") && el.props.line !== undefined) {
      out.push({ ...at(el.statementId), code: "ignored", message: `Hero("${el.props.value}") writes its own line (the road or the next turn); "${el.props.line}" would not show. Leave line out.` });
    }
  });
  const turnShown = heroes.some((k) => k === "nav.next" || k === "trip.left");
  for (const f of facts) {
    if (turnShown && (f === "nav.next" || f === "next.road" || f === "next.distance")) out.push({ code: "repeats", message: `Fact "${f}" repeats the next turn the Hero already shows. Remove it.` });
    if ((counts.get("TripRow") ?? 0) > 0 && (f === "trip.left" || f === "trip.eta") && !heroes.includes(f)) out.push({ code: "repeats", message: `Fact "${f}" repeats the trip row. Remove it.` });
    if (heroes.includes(f)) out.push({ code: "repeats", message: `Fact "${f}" repeats the Hero. Remove it.` });
  }
  if (warns > 1) out.push({ code: "warn", message: "More than one part has tone warn. Warn is for one less reliable answer at a time." });
  if (live) {
    const st = live.f.nav.state.kind;
    const onRoute = st === "guiding" || st === "rerouting";
    if (onRoute && (counts.get("NowPlaying") ?? 0) > 0) out.push({ code: "stage-on-route", message: "NowPlaying (the stage) is only for a screen with no route. On a route, use Listening as the card." });
    if (!onRoute && st !== "arrived" && (counts.get("TripRow") ?? 0) > 0) out.push({ code: "no-route", message: "TripRow needs a route, and there is none. Use Shelf as base, or no base." });
  }
  return out;
}

/** A bound part whose key has no data now draws an empty state: refuse it. */
function dataProblems(el: ElementNode, live: Live): string[] {
  const p = el.props;
  const miss = (k: string) => `${el.typeName} binds "${k}", and there is no such data now. Use a key from the context's data.`;
  switch (el.typeName) {
    case "Hero":
      return p.value !== "nav.next" && !figureOf(p.value as HeroKey, live) ? [miss(String(p.value))] : [];
    case "Fact":
      return textOf(p.value as ValueKey, live) === undefined ? [miss(String(p.value))] : [];
    case "PlaceRow":
      return placeOf(p.place as PlaceKey, live) ? [] : [miss(String(p.place))];
    case "MediaRow":
      return mediaOf(p.item as MediaKey, live) ? [] : [miss(String(p.item))];
    case "Listening":
    case "NowPlaying":
      return live.f.listening.nowPlaying ? [] : [`${el.typeName} binds playback, and nothing plays. Use Shelf.`];
    default:
      return [];
  }
}

// ---- 3: the render -----------------------------------------------------------------------------

export interface GateOptions {
  stress?: boolean;
  /** Draw at the four postures and probe (needs a DOM with layout: a browser). Default: true when there is one. */
  render?: boolean;
}

export interface GateResult {
  ok: boolean;
  problems: UiProblem[];
}

/**
 * The gate. The co-driver path calls this with the program the model wrote and the scene it was
 * written for; `ok` means it may show.
 */
export async function gate(program: string, scene: Scene, opts: GateOptions = {}): Promise<GateResult> {
  const live = createLive(scene, { still: true, stress: opts.stress ?? false });
  try {
    const problems = checkProgram(program, live);
    const canRender = opts.render ?? (typeof document !== "undefined" && typeof document.fonts !== "undefined");
    const fatal = problems.some((p) => !["copy", "too-long", "typed-value", "unused", "warn", "one-primary", "ignored", "repeats"].includes(p.code));
    if (canRender && !fatal) problems.push(...(await renderProbe(program, live)));
    return { ok: problems.length === 0, problems };
  } finally {
    live.dispose();
  }
}

async function renderProbe(program: string, live: Live): Promise<UiProblem[]> {
  const { root } = read(program);
  if (!root) return [];
  await document.fonts.ready;
  const box = document.createElement("div");
  box.setAttribute("aria-hidden", "true");
  box.style.cssText = "position:fixed;left:-20000px;top:0;pointer-events:none";
  document.body.append(box);
  const found = new Map<string, { code: string; message: string; postures: PostureId[] }>();
  try {
    for (const p of POSTURES) {
      const cell = document.createElement("div");
      cell.style.cssText = `width:${p.w}px;height:${p.h}px;position:relative`;
      box.append(cell);
      const host = createHost(cell);
      draw(host, root, live);
      await images(cell);
      draw(host, root, live);
      for (const [code, message] of probe(host.frame)) {
        const k = `${code}|${message}`;
        const f = found.get(k) ?? { code, message, postures: [] };
        f.postures.push(p.id);
        found.set(k, f);
      }
    }
  } finally {
    box.remove();
  }
  return [...found.values()].map((f) => ({ code: f.code, message: `${f.message} (at ${f.postures.map(postureText).join(", ")})`, postures: f.postures }));
}

const postureText = (id: PostureId): string => {
  const p = POSTURES.find((x) => x.id === id);
  return p ? `${p.label} ${p.w}×${p.h}` : id;
};

async function images(el: Element): Promise<void> {
  await Promise.all(
    [...el.querySelectorAll("img")].map((img) =>
      img.complete
        ? undefined
        : new Promise((r) => {
            img.addEventListener("load", r, { once: true });
            img.addEventListener("error", r, { once: true });
          }),
    ),
  );
}

const nameOf = (el: Element): string => {
  const sec = el.closest(".app > *") ?? el;
  const label = sec.getAttribute("aria-label");
  return label ? `the ${label} part` : `.${(sec.getAttribute("class") ?? sec.tagName).split(/\s+/)[0]}`;
};

/**
 * The measured checks on a drawn frame, after fit(). Ported from the Signal mockup's render.mjs
 * text probe, scoped to one frame.
 */
export function probe(app: HTMLElement): [code: string, message: string][] {
  const out: [string, string][] = [];
  const fr = app.getBoundingClientRect();
  const sections = [...app.children] as HTMLElement[];

  if (overflows(app)) {
    // How tall each composed part is, so the model can size its answer: "the card is 290 px".
    for (const sec of sections.filter((c) => c.matches(".card, .codriver, .listen, .where-card, .oui-c, .oui-a, .answer"))) {
      const r = sec.getBoundingClientRect();
      if (r.height > fr.height * 0.45) out.push(["tall", `${nameOf(sec)} is ${Math.round(r.height)} px tall on a ${Math.round(fr.height)} px screen`]);
    }
    const flow = sections.filter((c) => getComputedStyle(c).position !== "absolute" && !c.matches(".sheet"));
    let named = false;
    for (let i = 0; i < flow.length; i++)
      for (let j = i + 1; j < flow.length; j++) {
        const a = (flow[i] as HTMLElement).getBoundingClientRect();
        const b = (flow[j] as HTMLElement).getBoundingClientRect();
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) {
          const px = Math.round(Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
          out.push(["overlap", `${nameOf(flow[i] as HTMLElement)} and ${nameOf(flow[j] as HTMLElement)} overlap by ${px} px: the screen is ${Math.round(fr.height)} px tall and holds less. Drop a part or use a shorter one`]);
          named = true;
        }
      }
    if (!named) out.push(["overflow", "The parts are taller than the screen. Drop a part or use a shorter one"]);
  }

  // Text that leaves its section or the frame, or is clipped without an ellipsis.
  const walker = document.createTreeWalker(app, NodeFilter.SHOW_TEXT);
  const seen = new Set<Element>();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.textContent?.trim() ?? "";
    const el = n.parentElement;
    if (!text || !el || el.closest("svg")) continue;
    const r = document.createRange();
    r.selectNodeContents(n);
    const rects = [...r.getClientRects()].filter((x) => x.width > 0);
    if (!rects.length) continue;
    let clip: HTMLElement | null = el;
    while (clip && clip !== app) {
      const cs = getComputedStyle(clip);
      if (cs.overflowX !== "visible" || cs.overflowY !== "visible") break;
      clip = clip.parentElement;
    }
    const inClip = clip && clip !== app ? clip : null;
    const scrolls = inClip ? /auto|scroll/.test(getComputedStyle(inClip).overflowY) : false;
    const cs = inClip ? getComputedStyle(inClip) : null;
    const cut = !!cs && !scrolls && (cs.textOverflow === "ellipsis" || cs.webkitLineClamp !== "none");
    const sec = el.closest(".app > *");
    const sr = sec?.getBoundingClientRect();
    const short = text.slice(0, 32);
    // The nearest scroll region: rows scrolled out of its view are reachable, not overflowing.
    let sc: HTMLElement | null = el;
    while (sc && sc !== app && !/auto|scroll/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement;
    const scr = sc && sc !== app ? sc.getBoundingClientRect() : null;
    for (const x of cut && inClip ? [inClip.getBoundingClientRect()] : rects) {
      if (scr && (x.bottom > scr.bottom + 1 || x.top < scr.top - 1)) continue;
      if (x.left < fr.left - 0.5 || x.right > fr.right + 0.5 || x.top < fr.top - 0.5 || x.bottom > fr.bottom + 0.5) {
        out.push(["offscreen", `"${short}" leaves the screen`]);
        break;
      }
      const slack = Number.parseFloat(getComputedStyle(el).fontSize) * 0.25;
      if (sr && (x.left < sr.left - 0.5 || x.right > sr.right + 0.5 || x.top < sr.top - slack || x.bottom > sr.bottom + slack)) {
        out.push(["overflow", `"${short}" leaves ${nameOf(el)}`]);
        break;
      }
    }
    if (inClip && cs && !seen.has(inClip)) {
      seen.add(inClip);
      if ((inClip.scrollWidth > inClip.clientWidth + 1 || inClip.scrollHeight > inClip.clientHeight + 1) && !cut && !scrolls) {
        out.push(["clipped", `"${short}" is cut off without an ellipsis in ${nameOf(el)}. Use fewer words`]);
      }
    }
  }

  // Talk: exactly one, inside the frame, drawn 56, nothing over it.
  const talks = [...app.querySelectorAll<HTMLElement>("[data-talk]")];
  if (talks.length !== 1) out.push(["talk", `Talk shows ${talks.length} times; it shows once`]);
  for (const t of talks) {
    const r = t.getBoundingClientRect();
    if (r.width < 55.5 || r.height < 55.5) out.push(["talk", "Talk is smaller than 56 px"]);
    if (r.left < fr.left - 0.5 || r.right > fr.right + 0.5 || r.top < fr.top - 0.5 || r.bottom > fr.bottom + 0.5) out.push(["talk", "Talk is off the screen"]);
    const mine = t.closest(".app > *");
    for (const s of sections) {
      if (s === mine || s.contains(t) || s.matches(".top")) continue;
      const b = s.getBoundingClientRect();
      if (r.left < b.right - 1 && b.left < r.right - 1 && r.top < b.bottom - 1 && b.top < r.bottom - 1) out.push(["talk", `${nameOf(s)} covers Talk`]);
    }
  }
  // Targets: 56 px (the top row's settings and the chip draw smaller and extend their hit with ::after).
  for (const b of app.querySelectorAll<HTMLElement>("button.btn, .keys button, .row[data-action], .icon-btn:not(.top .icon-btn)")) {
    const r = b.getBoundingClientRect();
    if (r.width === 0) continue;
    if (r.height < 55.5 || r.width < 55.5) out.push(["target", `A target in ${nameOf(b)} is ${Math.round(r.width)}×${Math.round(r.height)}; every target is at least 56×56`]);
  }
  // The hero never wraps or ellipsizes; after fit's one step-down it must fit.
  for (const big of app.querySelectorAll<HTMLElement>(".answer .big")) {
    const box = big.closest(".answer");
    if (box && big.getBoundingClientRect().right > box.getBoundingClientRect().right + 0.5) out.push(["hero", "The Hero's figure is wider than the answer even after its step-down. Give the answer more room"]);
  }
  return [...new Map(out.map((x) => [x.join("|"), x])).values()];
}

/** The problems as one message the model can fix from (fed back once). */
export function problemsText(problems: readonly UiProblem[]): string {
  return [
    "The gate refused the screen. Nothing was shown. Fix each problem and send the whole program again:",
    ...problems.map((p) => `- ${p.line === undefined ? "" : `line ${p.line}: `}[${p.code}] ${p.message}`),
  ].join("\n");
}

// ---- Helpers -----------------------------------------------------------------------------------

const len = (v: unknown): number => (Array.isArray(v) ? v.length : 0);

function dedupe(ps: UiProblem[]): UiProblem[] {
  return [...new Map(ps.map((p) => [`${p.line}|${p.code}|${p.message}`, p])).values()];
}

function statementLines(program: string): Map<string, number> {
  const lines = new Map<string, number>();
  for (const [i, text] of program.split("\n").entries()) {
    const m = /^\s*(\$?[A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(text);
    if (m?.[1] && !lines.has(m[1])) lines.set(m[1], i + 1);
  }
  return lines;
}

/** Every element under `el` (itself included), with the statement it was written in. */
function walk(el: ElementNode, inherited: string | undefined, visit: (el: ElementNode, statementId: string | undefined) => void): void {
  const id = el.statementId ?? inherited;
  visit(el, id);
  const go = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(go);
    else if (isElement(v)) walk(v, id, visit);
  };
  for (const v of Object.values(el.props)) go(v);
}

function astNodes(v: unknown): ASTNode[] {
  const out: ASTNode[] = [];
  const visit = (n: unknown): void => {
    if (Array.isArray(n)) {
      n.forEach(visit);
      return;
    }
    if (typeof n !== "object" || n === null || isElement(n) || !("k" in n)) return;
    const node = n as ASTNode;
    out.push(node);
    if (node.k === "Comp") node.args.forEach(visit);
    else if (node.k === "Arr") node.els.forEach(visit);
  };
  visit(v);
  return out;
}

// Which components each slot takes: lang-core checks types, not slot membership.
const shapeByName = new Map<string, Readonly<Record<string, $ZodType>>>(COMPONENTS.map((c) => [c.name, c.props.shape as Record<string, $ZodType>]));
const nameBySchema = new Map<unknown, string>(COMPONENTS.map((c) => [c.props, c.name]));

function slotNames(schema: $ZodType): Set<string> {
  const names = new Set<string>();
  const visit = (s: $ZodType): void => {
    const n = nameBySchema.get(s);
    if (n !== undefined) names.add(n);
    else if (s instanceof z.ZodOptional) visit(s.unwrap() as $ZodType);
    else if (s instanceof z.ZodArray) visit(s.element as $ZodType);
    else if (s instanceof z.ZodUnion) for (const o of s.options) visit(o as $ZodType);
  };
  visit(schema);
  return names;
}

function slotProblems(el: ElementNode): Omit<UiProblem, "line">[] {
  const shape = shapeByName.get(el.typeName);
  if (!shape) return [];
  const out: Omit<UiProblem, "line">[] = [];
  for (const [key, field] of Object.entries(shape)) {
    const v = el.props[key];
    for (const child of Array.isArray(v) ? v : [v]) {
      if (!isElement(child)) continue;
      const allowed = slotNames(field);
      if (allowed.size && !allowed.has(child.typeName)) {
        out.push({ code: "wrong-component", message: `${el.typeName} ${key} takes ${[...allowed].join(" | ")}, not ${child.typeName}.` });
      }
    }
  }
  return out;
}
