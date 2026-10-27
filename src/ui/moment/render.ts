/**
 * A Moment's evaluated tree → the frame's children, built from Vela's real parts (app/render.ts,
 * view/parts.ts). The mount morphs them in, runs fit(), then reflow() for a free composition.
 *
 * Two forms:
 *   Screen([Frame(…)])   Vela's own screen for this moment, whole: renderScreen(), the very code the
 *                        app draws without a Moment (ADR 0011, step 1). Frame's slots name its parts.
 *   Screen(blocks)        a free composition: the top row, the blocks in one column (the body), and
 *                        the base: a TripRow or Shelf as the last block, or Talk alone.
 * The system adds the top row and Talk (bottom trailing) to every screen, and a ✕ while a Moment
 * shows. NoChange draws Vela's own screen too.
 */
import type { SourceId } from "../app/contract";
import { renderAnswer, renderBase, renderCard, renderListenCard, renderScreen, renderSheet, renderStage, renderTop } from "../app/render";
import { type CardView, type NowView, type Screen, type ShelfEntry, type TalkView, type TopView, coDriverName, nowView, shelfEntries, whereCard } from "../app/screen";
import { h, svg } from "../core/dom";
import { distance, distanceParts, shortRoad } from "../core/format";
import { type GlyphName, glyph, maneuverIcon } from "../core/icons";
import { art, bar, btn, g, iconBtn, note, row, talkBtn, timeLeft } from "../view/parts";
import { type Figure, type MomentData, barOf, figureOf, guidanceOf, mediaOf, nameOf, sequenceOf, textOf } from "./data";
import type { BarKey, FactKey, HeroKey, NameKey, SequenceKey, ValueKey } from "./keys";
import { type Part, isPart, isStep, parts } from "./tree";

/** What the system adds around a program: the chip (waiting for the turn) and the ✕. */
export interface Chrome {
  /** A chip of at most 3 words in the top row (status chips the app raises win over it). */
  chip?: string | undefined;
  /** The ✕ that dismisses the Moment, leading the top row (a 56 px target). */
  close?: boolean | undefined;
}

export interface Drawn {
  els: HTMLElement[];
  /** A free composition (reflow applies), not Vela's own screen. */
  free: boolean;
}

type Tier = "lead" | "secondary" | "tertiary" | "caption";

interface Ctx {
  d: MomentData;
  s: Screen;
  np: NowView | undefined;
  entries: ShelfEntry[];
  talk: TalkView;
  onRoute: boolean;
  /** Inside the Lead: a Value is the large figure, a Label or Name is road size. */
  lead: boolean;
  /** The program shows the next turn in a part of its own (Hero, next.distance). */
  turnShown: boolean;
}

const keyOf = (el: Part, fallback: string): string => `m-${el.statementId ?? fallback}`;

/** The tree Vela draws when no Moment shows: its own screen, whole. */
export const DEFAULT_TREE: Part = {
  type: "element",
  typeName: "Screen",
  props: { blocks: [{ type: "element", typeName: "Frame", props: {} }] },
};

/** True when a tree draws Vela's own screen (NoChange, or a Screen holding only a Frame). */
export function isOwnScreen(root: Part): boolean {
  if (root.typeName === "NoChange") return true;
  const blocks = parts(root.props.blocks);
  return blocks.length === 1 && blocks[0]?.typeName === "Frame";
}

/** Build the frame's children for a tree. Pure DOM building; measuring comes after. */
export function drawTree(root: Part, d: MomentData, opts: { keyboard: number } & Chrome): Drawn {
  const s = d.screen;
  if (isOwnScreen(root)) {
    const els = renderScreen(s, { keyboard: opts.keyboard });
    if ((opts.chip || opts.close) && els[0]?.matches(".top")) els[0] = top(s.top, opts);
    return { els, free: false };
  }
  const blocks = parts(root.props.blocks);
  const np = d.input.nowPlaying;
  const ctx: Ctx = {
    d,
    s,
    np: np ? nowView(np) : undefined,
    entries: shelfEntries(d.input.shelf, np),
    talk: s.base.kind === "none" ? { active: false, denied: false } : s.base.talk,
    onRoute: s.base.kind === "trip" && s.answer.kind !== "arrived",
    lead: false,
    turnShown: showsTurn(root),
  };
  const els = [top(s.top, opts), ...freeParts(blocks, ctx)];
  // The invariant: Talk at the trailing end of the base row, on every screen.
  if (!els.some((e) => e.querySelector("[data-talk]"))) {
    els.push(h("section", { class: "talk-base", "aria-label": "Talk", "data-key": "talk-base" }, talkBtn(ctx.talk)));
  }
  return { els, free: true };
}

// ---- Top row -----------------------------------------------------------------------------------

function top(t: TopView | undefined, c: Chrome): HTMLElement {
  const base: TopView = t ?? { clock: "", settings: true };
  // A status the app raises (GPS lost, no signal) beats the Moment's chip, as status beats toast.
  const view: TopView = c.chip && base.chip?.kind !== "status" ? { ...base, chip: { kind: "status", icon: "bubble", text: c.chip, warn: false } } : base;
  const el = renderTop(view);
  if (c.close) el.querySelector(".chip-slot")?.prepend(iconBtn("close", "Close this Moment", { action: "moment-close" }, "m-close"));
  return el;
}

// ---- A free composition ----------------------------------------------------------------------------

function freeParts(blocks: Part[], ctx: Ctx): HTMLElement[] {
  // The last block is the base when it is a base row. The base never yields (Talk lives there).
  const lastBlock = blocks[blocks.length - 1];
  const last = lastBlock?.typeName === "Optional" && isPart(lastBlock.props.child) ? lastBlock.props.child : lastBlock;
  const baseBlock = last && (last.typeName === "TripRow" || last.typeName === "Shelf") ? last : undefined;
  const baseEl = baseBlock ? baseOf(baseBlock, ctx, true) : null;
  let bodyBlocks = baseEl ? blocks.slice(0, -1) : blocks;
  // Open Details take the supporting items' place: the Lead stays, the requested detail shows.
  if (bodyBlocks.some((b) => b.typeName === "Details" && b.props.open === true)) {
    bodyBlocks = bodyBlocks.flatMap((b): Part[] => {
      if (b.typeName === "Lead" || b.typeName === "Details") return [b];
      if (b.typeName === "Split") return [b.props.first, b.props.second].filter((x): x is Part => isPart(x) && x.typeName === "Lead");
      return [];
    });
  }
  const body = h("div", { class: "m-body", "data-key": "m-body" }, ...bodyBlocks.map((b) => block(b, ctx)));
  return [body, ...(baseEl ? [baseEl] : [])];
}

function block(el: Part, ctx: Ctx): HTMLElement {
  const { d } = ctx;
  const p = el.props;
  const key = keyOf(el, el.typeName.toLowerCase());
  switch (el.typeName) {
    case "Lead":
      return h("section", { class: "m-lead", "data-key": key }, ...(isPart(p.child) ? [block(p.child, { ...ctx, lead: true })] : []));
    case "Optional":
      return h("div", { class: "m-optional", "data-yields": "", "data-key": key }, ...(isPart(p.child) ? [block(p.child, ctx)] : []));
    case "Stack":
      return h("div", { class: "m-stack", "data-key": key }, ...parts(p.children).map((c) => block(c, ctx)));
    case "Row":
      return h("div", { class: "m-row", "data-key": key }, ...parts(p.children).map((c) => block(c, ctx)));
    case "Columns":
      return h("div", { class: "m-columns", "data-key": key }, ...parts(p.children).map((c) => h("div", { class: "m-col" }, block(c, ctx))));
    case "Split":
      return h("div", { class: "m-split", "data-key": key }, h("div", { class: "m-split-in" }, ...[p.first, p.second].filter(isPart).map((c) => block(c, ctx))));
    case "Card":
      return h("section", { class: "card m-card", "data-key": key }, ...parts(p.children).map((c) => block(c, { ...ctx, lead: false })));
    case "Details": {
      const open = p.open === true;
      const label = String(p.label ?? "More");
      return h(
        "section",
        { class: "m-details", "aria-label": label, "data-open": open ? "" : undefined, "data-key": key },
        open
          ? h("div", { class: "m-details-body" }, ...parts(p.children).map((c) => block(c, { ...ctx, lead: false })))
          : btn({ label, icon: "plus", kind: "quiet", action: "moment-details", arg: el.statementId ?? "", aria: `Show ${label}` }),
      );
    }
    case "Value":
      return value(p.key as ValueKey, tierOf(p.tier, ctx, "value"), d, key);
    case "Name":
      return words(nameOf(p.key as NameKey, d) ?? "", tierOf(p.tier, ctx, "words"), false, key);
    case "Label":
      return words(String(p.text ?? ""), tierOf(p.tier, ctx, "words"), p.muted === true, key);
    case "Glyph": {
      const gd = p.name === "next.turn" ? guidanceOf(d) : undefined;
      const markup = p.name === "next.turn" ? (gd ? maneuverIcon(gd.nextStop.maneuver, gd.nextStop.exit) : glyph.compass) : glyph[glyphName(p.name)];
      return h("i", { class: "m-glyph", "aria-hidden": "true" }, svg(markup));
    }
    case "Bar": {
      const b = barOf(p.key as BarKey, d);
      return bar(b?.fraction ?? 0, { cls: "m-progress" });
    }
    case "Sequence":
      return sequence(p.key as SequenceKey, d, key);
    case "Art": {
      const it = mediaOf(d);
      return art(it?.artUrl, it?.source ?? "podcasts", ctx.lead ? "art m-art-lead" : "art");
    }
    case "Divider":
      return h("div", { class: "m-divider", role: "separator" });
    case "Text":
      return h("p", { class: `m-text${p.muted ? " muted" : ""}` }, String(p.text ?? ""));
    case "Fact":
      return fact(el, d);
    case "Facts":
      return h("div", { class: "plan-facts m-facts" }, ...parts(p.items).map((f) => fact(f, d)));
    case "Notice":
      return note(glyphName(p.glyph ?? "bubble"), String(p.title ?? ""), p.sub ? String(p.sub) : undefined);
    case "List":
      return h("div", { class: "list m-list" }, ...parts(p.rows).map(listRow));
    case "ListRow":
      return listRow(el);
    case "Actions":
      return h("div", { class: "btn-row" }, ...buttons(el));
    case "Hero":
      return hero(p.value as HeroKey, ctx);
    case "Quiet":
      return h(
        "section",
        { class: "answer", "aria-label": String(p.text ?? ""), "data-key": key },
        h("div", { class: `quiet plan-quiet${p.tone === "warn" ? " warn" : ""}` }, p.glyph ? g(glyphName(p.glyph)) : null, h("span", null, String(p.text ?? ""))),
        p.sub ? h("div", { class: "quiet-sub" }, String(p.sub)) : null,
        isPart(p.actions) ? h("div", { class: "answer-actions" }, ...buttons(p.actions)) : null,
      );
    case "NowPlaying":
      return ctx.np ? renderStage(ctx.np) : renderAnswer({ kind: "shelf", entries: ctx.entries }, false);
    case "Shelf":
      return ctx.lead ? renderAnswer({ kind: "shelf", entries: ctx.entries }, false) : renderCard({ kind: "shelf", entries: ctx.entries });
    case "Listening": {
      const np = ctx.np;
      return np ? renderListenCard(np, np.transport === "error" && /pair/i.test(np.error ?? "") ? "Check again" : "Try again") : renderCard({ kind: "shelf", entries: ctx.entries });
    }
    case "WhereTo":
      return renderCard(whereCard(d.input));
    case "CoDriver":
      return coDriver(el, ctx);
    case "TripRow":
      return baseOf(el, ctx, false) ?? h("div", { "data-key": key });
    case "Sheet":
      return ctx.s.sheet ? renderSheet(ctx.s.sheet, { talk: ctx.talk, onRoute: ctx.onRoute }) : h("div", { "data-key": key });
    default:
      return h("div", { "data-m-unknown": el.typeName });
  }
}

/** Moment glyph names are core glyph names, except the bound "next.turn". */
const glyphName = (v: unknown): GlyphName => (typeof v === "string" && v in glyph ? (v as GlyphName) : "bubble");

function tierOf(t: unknown, ctx: Ctx, kind: "value" | "words"): Tier {
  if (t === "secondary" || t === "tertiary" || t === "caption") return t;
  if (ctx.lead) return kind === "value" ? "lead" : "secondary";
  return kind === "value" ? "secondary" : "tertiary";
}

function figureEls(fig: Figure): (Node | string)[] {
  if ("min" in fig) return timeLeft(fig.min);
  return [fig.num, fig.unit ? h("span", { class: "unit" }, fig.unit) : ""];
}

function value(k: ValueKey, tier: Tier, d: MomentData, key: string): HTMLElement {
  const fig = figureOf(k, d);
  const kids = fig ? figureEls(fig) : ["…"];
  if (tier === "lead") return h("div", { class: "big num m-big", "data-bound": "", "data-key": key }, ...kids);
  return h("div", { class: `m-value t-${tier} num`, "data-bound": "", "data-key": key }, ...kids);
}

function words(text: string, tier: Tier, muted: boolean, key: string): HTMLElement {
  return h("div", { class: `m-label t-${tier === "lead" ? "secondary" : tier}${muted ? " muted" : ""}`, "data-key": key }, text);
}

function fact(f: Part, d: MomentData): HTMLElement {
  return h("span", { class: "m-fact" }, `${String(f.props.label ?? "")} `, h("b", { class: "num", "data-bound": "" }, textOf(f.props.value as FactKey, d) ?? "…"));
}

function sequence(k: SequenceKey, d: MomentData, key: string): HTMLElement {
  const items = sequenceOf(k, d) ?? [];
  const pct = (x: number) => `${(Math.max(0, Math.min(1, x)) * 100).toFixed(2)}%`;
  return h(
    "div",
    { class: "m-seq", "data-key": key, role: "list", "aria-label": k === "route.stops" ? "Stops ahead" : "Weather ahead" },
    // Points (stops) are ticks; stretches (weather) are spans, a marked one a bright segment on the line.
    h(
      "div",
      { class: "m-seq-track", "aria-hidden": "true" },
      ...items.map((i) =>
        i.to !== undefined
          ? h("i", { class: `m-seq-span${i.marked ? " marked" : ""}`, style: `left:${pct(i.at)};width:${pct(i.to - i.at)}` })
          : h("b", { class: "m-seq-tick", style: `left:${pct(i.at)}` }),
      ),
    ),
    h(
      "div",
      { class: "m-seq-labels" },
      ...items.map((i) =>
        h(
          "div",
          { class: `m-seq-item${i.to !== undefined && !i.marked ? " plain" : ""}`, role: "listitem", "data-at": String(i.at), "data-to": i.to === undefined ? undefined : String(i.to), "aria-current": i.current ? "true" : undefined },
          h("b", null, i.label),
          i.sub ? h("span", { class: "num" }, i.sub) : null,
        ),
      ),
      h("div", { class: "m-seq-more", hidden: true }),
    ),
  );
}

function hero(k: HeroKey, ctx: Ctx): HTMLElement {
  const { s, d } = ctx;
  const quiet = () => renderAnswer({ kind: "quiet", icon: "pin", text: "No route", warn: false, shimmer: false, named: false, label: "No route" }, false);
  if (k === "nav.next") {
    const a = s.answer;
    if (a.kind === "turn" || a.kind === "time" || a.kind === "quiet" || a.kind === "arrived") return renderAnswer(a, ctx.onRoute);
    return quiet();
  }
  const gd = guidanceOf(d);
  if (!gd) return quiet();
  const n = gd.nextStop;
  const road = n.maneuver === "arrive" ? gd.route.destination.name : shortRoad(n.street || n.instruction);
  const fig = figureOf("trip.left", d);
  return renderAnswer({ kind: "time", min: fig && "min" in fig ? fig.min : 1, next: { icon: maneuverIcon(n.maneuver, n.exit), road, dist: distance(gd.metersToNext) } }, ctx.onRoute);
}

function coDriver(el: Part, ctx: Ctx): HTMLElement {
  const text = el.props.text as string | undefined;
  const live = ctx.s.card?.kind === "codriver" ? ctx.s.card : undefined;
  const name = coDriverName(ctx.d.input.coDriver);
  const view: CardView =
    text === undefined && live
      ? live
      : { kind: "codriver", label: name, mark: "bubble", text: text ?? "Say Hey Vela, or hold Talk.", said: text === undefined, keep: false, shimmer: false, reserve: false };
  const card = renderCard(view);
  if (isPart(el.props.actions)) card.append(h("div", { class: "btn-row" }, ...buttons(el.props.actions)));
  return card;
}

/** TripRow or the Shelf row. As the base it keeps Talk; inside the body it does not. */
function baseOf(el: Part, ctx: Ctx, isBase: boolean): HTMLElement | null {
  const { s } = ctx;
  let out: HTMLElement | null = null;
  if (el.typeName === "TripRow") out = s.base.kind === "trip" || s.base.kind === "waiting" ? renderBase(s.base) : null;
  if (el.typeName === "Shelf") out = renderBase({ kind: "shelf-row", entries: ctx.entries, playing: ctx.np?.source as SourceId | undefined, talk: ctx.talk });
  if (out && !isBase) {
    out.querySelector(".talk-btn")?.remove();
    out.classList.add("m-inbody");
  }
  // A Moment that shows the next turn nowhere else: the trip row's leading figure is the turn.
  const gd = guidanceOf(ctx.d);
  if (out && el.typeName === "TripRow" && !ctx.turnShown && gd) {
    const dp = distanceParts(gd.metersToNext);
    const road = shortRoad(gd.nextStop.street || gd.nextStop.instruction);
    out.querySelector(".left")?.replaceWith(
      h(
        "span",
        { class: "left num m-trip-turn", "aria-label": `Next turn: ${distance(gd.metersToNext)}, ${road}` },
        h("i", { class: "m-trip-arrow" }, svg(maneuverIcon(gd.nextStop.maneuver, gd.nextStop.exit))),
        dp.num,
        h("span", { class: "unit" }, dp.unit),
      ),
    );
  }
  return out;
}

/** The program shows the next turn in a part of its own. */
export function showsTurn(root: Part): boolean {
  let yes = false;
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(visit);
    else if (isPart(v)) {
      if (v.typeName === "Hero" || v.typeName === "Frame" || (v.typeName === "Value" && v.props.key === "next.distance")) yes = true;
      for (const x of Object.values(v.props)) visit(x);
    }
  };
  visit(root);
  return yes;
}

// ---- Rows and buttons ------------------------------------------------------------------------------

const stepArg = (v: unknown): { action: string; arg: string } | undefined => (isStep(v) ? { action: "moment-step", arg: JSON.stringify(v) } : undefined);

function buttons(actions: Part): HTMLElement[] {
  return parts(actions.props.buttons).map((b) => {
    const kind = b.props.kind === "primary" || b.props.kind === "quiet" ? b.props.kind : "secondary";
    const a = stepArg(b.props.action);
    return btn({ label: String(b.props.label ?? ""), kind, action: a?.action ?? "moment-step", arg: a?.arg ?? "{}" });
  });
}

function listRow(el: Part): HTMLElement {
  const p = el.props;
  const a = stepArg(p.action);
  return row({ icon: p.glyph === undefined ? undefined : glyphName(p.glyph), title: String(p.title ?? ""), sub: p.sub ? String(p.sub) : undefined, end: a ? "chevron" : undefined, ...(a ?? {}) });
}
