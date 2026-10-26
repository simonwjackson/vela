/**
 * A Signal program → the frame's DOM, built from Vela's real parts (app/render.ts, view/parts.ts)
 * and laid out by the real plan(w, h), morph() and fit(). Dev-only spike.
 *
 *   Screen ─ top row (always: clock, settings, chip slot)
 *     Stage ─ primary   → the answer area      (Hero, Quiet, NowPlaying, Shelf, or a Stack/Split)
 *           ─ secondary → the card slot         (Listening, WhereTo, CoDriver, Card, Shelf, Sheet …)
 *           ─ base      → the base row          (TripRow or Shelf)
 *   Talk is the one part the system adds: at the trailing end of the base row, on every screen.
 *
 * Bound parts read the live data (live.ts) on every draw; the program carries only keys.
 */
import type { ElementNode } from "@openuidev/lang-core";
import "../styles/index.css";
import "./openui.css";
import type { SourceId } from "../app/contract";
import { renderAnswer, renderBase, renderCard, renderListenCard, renderSheet, renderStage, renderTop } from "../app/render";
import { type CardView, type NowView, type Screen, type ShelfEntry, type TalkView, type TopView, coDriverName, nowView, shelfEntries, whereCard } from "../app/screen";
import { type Child, h } from "../core/dom";
import { cleanTitle, distance, duration, placeName, shortRoad } from "../core/format";
import { type GlyphName, maneuverIcon } from "../core/icons";
import { morphChildren } from "../core/morph";
import { plan, planVars } from "../core/plan";
import { fit } from "../view/fit";
import { coverColor, lightFor } from "../view/light";
import { btn, g, note, row, talkBtn, timeLeft } from "../view/parts";
import { type Live, figureOf, mediaOf, placeOf, textOf } from "./live";
import { isElement } from "./program";
import { GLYPHS, type HeroKey, type MediaKey, type PlaceKey, type ValueKey } from "./vocabulary";

// Every glyph the vocabulary names is a real Signal glyph.
const _glyphs: readonly GlyphName[] = GLYPHS;
void _glyphs;

/** One frame: the `.vela` shell and its `.app` grid, as app/mount.ts builds them. */
export interface Host {
  shell: HTMLElement;
  frame: HTMLElement;
  lightKey: string;
}

export function createHost(root: HTMLElement): Host {
  const shell = h("div", { class: "vela" });
  const frame = h("main", { class: "app", "aria-label": "Vela" });
  shell.append(frame);
  root.append(shell);
  return { shell, frame, lightKey: "" };
}

/** An action step from a program, as data-arg carries it. */
export interface Step {
  type: string;
  [k: string]: unknown;
}

interface Ctx {
  live: Live;
  s: Screen;
  np: NowView | undefined;
  entries: ShelfEntry[];
  talk: TalkView;
  onRoute: boolean;
}

type Slot = "a" | "c";

/** Draw a program's evaluated tree into the host, patching the live DOM in place. */
export function draw(host: Host, root: ElementNode, live: Live): void {
  const { shell, frame } = host;
  const p = plan(shell.clientWidth || 932, shell.clientHeight || 553);
  for (const [k, v] of Object.entries(planVars(p))) frame.style.setProperty(k, v);
  frame.dataset.flow = p.flow;

  const stage = isElement(root.props.stage) ? root.props.stage : undefined;
  const secondary = stage && isElement(stage.props.secondary) ? stage.props.secondary : undefined;
  const s = live.screen(secondary?.typeName === "Sheet" ? "route" : undefined);
  const np = live.f.listening.nowPlaying;
  const ctx: Ctx = {
    live,
    s,
    np: np ? nowView(np) : undefined,
    entries: shelfEntries(live.f.listening.shelf, np),
    talk: s.base.kind === "none" ? { active: false, denied: false } : s.base.talk,
    onRoute: s.base.kind === "trip" && s.answer.kind !== "arrived",
  };

  const parts: Child[] = [renderTop(topOf(s.top, isElement(root.props.chip) ? root.props.chip : undefined))];
  let sheet: HTMLElement | null = null;
  if (stage) {
    const primary = isElement(stage.props.primary) ? stage.props.primary : undefined;
    const base = isElement(stage.props.base) ? stage.props.base : undefined;
    if (primary) parts.push(slotted(primary, "a", ctx));
    if (secondary?.typeName === "Sheet") {
      sheet = s.sheet ? renderSheet(s.sheet, { talk: ctx.talk, onRoute: ctx.onRoute }) : null;
    } else if (secondary) parts.push(slotted(secondary, "c", ctx));
    parts.push(base ? baseOf(base, ctx) : null);
  }
  // The invariant: Talk at the trailing end of the base row, on every screen.
  const els = parts.filter((x): x is HTMLElement => x instanceof HTMLElement);
  if (!els.some((e) => e.querySelector("[data-talk]"))) {
    els.push(h("section", { class: "talk-base", "aria-label": "Talk", "data-key": "talk-base" }, talkBtn(ctx.talk)));
  }
  if (sheet) els.push(sheet);
  frame.toggleAttribute("data-solo", !secondary);
  shell.toggleAttribute("data-daylight", s.daylight);
  morphChildren(frame, h("main", null, ...els));
  fit(frame);
  setLight(host, s);
}

/** The Light, as app/mount.ts sets it: the cover's colour at .10, or the accent at .05. */
function setLight(host: Host, s: Screen): void {
  const l = s.light;
  const key = l ? `${l.source}|${l.art ?? ""}` : "";
  if (key === host.lightKey) return;
  host.lightKey = key;
  const st = host.shell.style;
  if (!l) {
    st.setProperty("--light", "var(--accent)");
    st.setProperty("--light-alpha", "5%");
    return;
  }
  st.setProperty("--light", lightFor(undefined, l.source));
  st.setProperty("--light-alpha", "10%");
  if (l.art) void coverColor(l.art).then((c) => host.lightKey === key && st.setProperty("--light", lightFor(c, l.source)));
}

function topOf(top: TopView | undefined, chip: ElementNode | undefined): TopView {
  const t: TopView = top ?? { clock: "", settings: true };
  // A status the app raises (GPS lost, no signal) beats the program's chip, as status beats toast.
  if (!chip || t.chip?.kind === "status") return t;
  const warn = chip.props.tone === "warn";
  const icon = (chip.props.glyph as GlyphName | undefined) ?? (warn ? "alert" : "bubble");
  return { ...t, chip: { kind: "status", icon, text: String(chip.props.text ?? ""), warn } };
}

const keyOf = (el: ElementNode, fallback: string): string => `oui-${el.statementId ?? fallback}`;

/** A part in a Stage slot. Parts that are not a slot's own part get the slot's grid area. */
function slotted(el: ElementNode, slot: Slot, ctx: Ctx): HTMLElement {
  const out = block(el, slot, ctx);
  const own = slot === "a" ? out.matches(".answer, .stage, .shelf.large") : out.matches(".card, .listen, .where-card, .codriver");
  if (!own) out.classList.add(slot === "a" ? "oui-a" : "oui-c");
  return out;
}

function block(el: ElementNode, slot: Slot, ctx: Ctx): HTMLElement {
  const { live, np } = ctx;
  const props = el.props;
  switch (el.typeName) {
    case "Hero":
      return hero(props.value as HeroKey, props.line as string | undefined, el, ctx);
    case "Quiet":
      return h(
        "section",
        { class: "answer", "aria-label": String(props.text ?? ""), "data-key": keyOf(el, "quiet") },
        h("div", { class: `quiet plan-quiet${props.tone === "warn" ? " warn" : ""}` }, props.glyph ? g(props.glyph as GlyphName) : null, h("span", null, String(props.text ?? ""))),
        props.sub ? h("div", { class: "quiet-sub" }, String(props.sub)) : null,
        isElement(props.actions) ? h("div", { class: "answer-actions" }, ...buttons(props.actions)) : null,
      );
    case "NowPlaying":
      return np ? renderStage(np) : renderAnswer({ kind: "shelf", entries: ctx.entries }, false);
    case "Shelf":
      return slot === "a" ? renderAnswer({ kind: "shelf", entries: ctx.entries }, false) : renderCard({ kind: "shelf", entries: ctx.entries });
    case "Listening":
      return np ? renderListenCard(np, np.transport === "error" && /pair/i.test(np.error ?? "") ? "Check again" : "Try again") : renderCard({ kind: "shelf", entries: ctx.entries });
    case "WhereTo":
      return renderCard(whereCard(live.input()));
    case "CoDriver":
      return coDriver(el, ctx);
    case "Card":
      return h(
        "section",
        { class: "card oui-card", "aria-label": props.title ? String(props.title) : undefined, "data-key": keyOf(el, "card") },
        props.title ? h("div", { class: "oui-card-title" }, String(props.title)) : null,
        ...kids(props.children, ctx),
      );
    case "Stack":
      return h("div", { class: "oui-stack", "data-key": keyOf(el, "stack") }, ...arr(props.children).map((c) => block(c, slot, ctx)));
    case "Split":
      return h(
        "div",
        { class: "oui-split", "data-key": keyOf(el, "split") },
        h("div", { class: "oui-split-in" }, ...[props.first, props.second].filter(isElement).map((c) => block(c, slot, ctx))),
      );
    default:
      return inner(el, ctx) ?? h("div", { "data-oui-unknown": el.typeName });
  }
}

function hero(key: HeroKey, line: string | undefined, el: ElementNode, ctx: Ctx): HTMLElement {
  const { s, live } = ctx;
  if (key === "nav.next") {
    const a = s.answer;
    if (a.kind === "turn" || a.kind === "time" || a.kind === "quiet" || a.kind === "arrived") return renderAnswer(a, ctx.onRoute);
    return renderAnswer({ kind: "quiet", icon: "pin", text: "No route", warn: false, shimmer: false, named: false, label: "No route" }, false);
  }
  const st = live.f.nav.state;
  if (key === "trip.left" && (st.kind === "guiding" || st.kind === "rerouting")) {
    const gd = st.guidance;
    const n = gd.nextStop;
    const road = n.maneuver === "arrive" ? gd.route.destination.name : shortRoad(n.street || n.instruction);
    const fig = figureOf("trip.left", live);
    return renderAnswer({ kind: "time", min: fig && "min" in fig ? fig.min : 1, next: { icon: maneuverIcon(n.maneuver, n.exit), road, dist: distance(gd.metersToNext) } }, ctx.onRoute);
  }
  const fig = figureOf(key, live);
  // No such data now (the gate refuses this): a quiet line, never a "–" placeholder (brief).
  if (!fig) return renderAnswer({ kind: "quiet", text: line ?? "Not known yet", warn: false, shimmer: false, named: false, label: line ?? key }, false);
  const big = "min" in fig
      ? h("div", { class: "big num" }, ...timeLeft(fig.min))
      : h("div", { class: "big num" }, fig.num, fig.unit ? h("span", { class: "unit" }, fig.unit) : null);
  return h(
    "section",
    { class: "answer", "aria-label": `${textOf(key, live) ?? ""} ${line ?? ""}`.trim(), "data-key": keyOf(el, `hero-${key}`) },
    h("div", { class: "hero" }, big),
    line ? h("div", { class: "road" }, line) : null,
  );
}

function coDriver(el: ElementNode, ctx: Ctx): HTMLElement {
  const text = el.props.text as string | undefined;
  const live = ctx.s.card?.kind === "codriver" ? ctx.s.card : undefined;
  const name = coDriverName(ctx.live.f.coDriver.current);
  const view: CardView =
    text === undefined && live
      ? live
      : { kind: "codriver", label: name, mark: "bubble", text: text ?? "Say Hey Vela, or hold Talk.", said: text === undefined, keep: false, shimmer: false, reserve: false };
  const card = renderCard(view);
  if (isElement(el.props.actions)) card.append(h("div", { class: "btn-row" }, ...buttons(el.props.actions)));
  return card;
}

function baseOf(el: ElementNode, ctx: Ctx): HTMLElement | null {
  const { s } = ctx;
  if (el.typeName === "TripRow") return s.base.kind === "trip" || s.base.kind === "waiting" ? renderBase(s.base) : null;
  if (el.typeName === "Shelf") return renderBase({ kind: "shelf-row", entries: ctx.entries, playing: ctx.np?.source as SourceId | undefined, talk: ctx.talk });
  return null;
}

// ---- Inside cards ------------------------------------------------------------------------------

const arr = (v: unknown): ElementNode[] => (Array.isArray(v) ? v.filter(isElement) : []);
const kids = (v: unknown, ctx: Ctx): HTMLElement[] => arr(v).map((c) => inner(c, ctx)).filter((x): x is HTMLElement => x !== null);

/** The step as data: `{ type: "AddStop", place: "suggest.0" }`. */
function stepOf(v: unknown): Step | undefined {
  return isElement(v) ? { type: v.typeName, ...v.props } : undefined;
}
const actAttrs = (v: unknown): { action?: string; arg?: string } => {
  const st = stepOf(v);
  return st ? { action: "oui", arg: JSON.stringify(st) } : {};
};

function buttons(actions: ElementNode): HTMLElement[] {
  return arr(actions.props.buttons).map((b) => {
    const kind = b.props.kind === "primary" || b.props.kind === "quiet" ? b.props.kind : "secondary";
    return btn({ label: String(b.props.label ?? ""), kind, action: "oui", arg: JSON.stringify(stepOf(b.props.action) ?? {}) });
  });
}

function inner(el: ElementNode, ctx: Ctx): HTMLElement | null {
  const { live } = ctx;
  const p = el.props;
  switch (el.typeName) {
    case "Text":
      return h("p", { class: `oui-text${p.tone === "muted" ? " muted" : ""}` }, String(p.text ?? ""));
    case "Facts":
      return h(
        "div",
        { class: "plan-facts oui-facts" },
        ...arr(p.items).map((f) => h("span", null, `${String(f.props.label ?? "")} `, h("b", { class: "num" }, textOf(f.props.value as ValueKey, live) ?? "…"))),
      );
    case "Notice":
      return note((p.glyph as GlyphName | undefined) ?? "bubble", String(p.title ?? ""), p.sub ? String(p.sub) : undefined);
    case "List":
      return h("div", { class: "list oui-list" }, ...arr(p.rows).map((r) => listRow(r, ctx)));
    case "Actions":
      return h("div", { class: "btn-row" }, ...buttons(el));
    case "Row":
      return h("div", { class: "oui-row" }, ...kids(p.children, ctx));
    case "Hero":
    case "Quiet":
    case "Listening":
    case "WhereTo":
    case "CoDriver":
    case "Card":
    case "Shelf":
    case "NowPlaying":
    case "Stack":
    case "Split":
      return block(el, "c", ctx);
    default:
      return null;
  }
}

function listRow(el: ElementNode, ctx: Ctx): HTMLElement {
  const { live } = ctx;
  const p = el.props;
  if (el.typeName === "PlaceRow") {
    const bp = placeOf(p.place as PlaceKey, live);
    const name = bp ? placeName(bp.place.name) : "Place not found";
    const sub = [bp?.detourMin !== undefined ? `${bp.detourMin} min detour` : undefined, bp?.place.address].filter(Boolean).join(", ");
    return row({ icon: bp?.icon ?? "pin", title: name, sub: sub || undefined, meta: bp?.meters !== undefined ? distance(bp.meters) : undefined, label: name, ...actAttrs(p.action) });
  }
  if (el.typeName === "MediaRow") {
    const it = mediaOf(p.item as MediaKey, live);
    if (!it) return row({ icon: "music", title: "Nothing to play", dim: true });
    const title = cleanTitle(it.title, it.by);
    return row({ lead: { art: it.artUrl, source: it.source }, title, sub: it.by, meta: it.durationSec ? duration(Math.round(it.durationSec / 60)) : undefined, label: `${title}, ${it.by}`, ...actAttrs(p.action) });
  }
  return row({ icon: p.glyph as GlyphName | undefined, title: String(p.title ?? ""), sub: p.sub ? String(p.sub) : undefined, end: p.action ? "chevron" : undefined, ...actAttrs(p.action) });
}
