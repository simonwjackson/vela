/**
 * The calm rules gate: the one check a Moment passes before it shows. It returns UiProblem[] for
 * `moment.problems` (an empty list means accepted).
 *
 *   1. the language   lang-core's parse errors, plus what it does not check: which component a
 *                     slot takes, which action steps exist, no Query, Mutation or $state
 *   2. the calm rules MOMENT_RULES (the contract's numbers, shared with the assistant): one Lead with
 *                     a short label, at most 2 supporting items, every fact once, place distances
 *                     named, no phrase of say on screen, the turn leads or the Moment waits; plus
 *                     Signal's part rules and bound keys that have data now
 *   3. the render     the program drawn at the four postures after reflow: the blocks fit, nothing
 *                     is clipped, Talk is reachable, every target is 56 px, and the word budget as
 *                     drawn (probe, in a browser only)
 */
import type { ASTNode } from "@openuidev/lang-core";
import schema from "../../contract/moment-schema.json";
import { MOMENT_POSTURES, MOMENT_RULES } from "../../contract/moments";
import type { MomentShow, UiProblem } from "../app/contract";
import { distance } from "../core/format";
import { plan, planVars } from "../core/plan";
import { fit, overflows } from "../view/fit";
import { type MomentData, barOf, boundTexts, figureOf, guidanceOf, mediaOf, nameOf, sequenceOf, textOf } from "./data";
import { ACTION_NAMES, ANSWERS, BASES, type BarKey, type FactKey, NAME_KEYS, type NameKey, ROOT, ROOTS, type SequenceKey, VALUE_KEYS, type ValueKey } from "./keys";
import { read } from "./program";
import { type Part, isPart, parts, walk } from "./tree";
import { countWords, reflow } from "./reflow";
import { drawTree, isOwnScreen, showsTurn } from "./render";

const R = MOMENT_RULES;
type PostureId = (typeof MOMENT_POSTURES)[number]["id"];

/** A Moment program is small: a whole screen in a few hundred bytes; this is room for 4 times that. */
export const MAX_BYTES = 3 * 1024;
export const MAX_SAY = 300;
/** Signal's part limits: cards on a screen, buttons in a row, rows in a list, facts on a line. */
export const MAX_CARDS = 2;
export const MAX_BUTTONS = 3;
export const MAX_ROWS = 4;
export const MAX_FACTS = 4;
export const MAX_BLOCKS = 5;
export const MAX_ROAD_SIZE = 4;
export const MAX_ELEMENTS = 45;
/** The Lead: a glyph, the figure, its label and a bar. */
export const MAX_LEAD_PARTS = 4;
/** Copy lengths, in characters: cut words before type shrinks. Guesses until tried in the car. */
export const MAX_LEN: Readonly<Record<string, number>> = {
  "Button.label": 22,
  "Quiet.text": 48,
  "Quiet.sub": 90,
  "Label.text": 40,
  "Text.text": 120,
  "CoDriver.text": 120,
  "Notice.title": 48,
  "Notice.sub": 90,
  "ListRow.title": 40,
  "ListRow.sub": 60,
  "Fact.label": 16,
  "Details.label": 16,
};

const STEPS = new Set<string>(ACTION_NAMES);
/** Parts drawn as a card surface. */
const CARDS = new Set(["Card", "Listening", "WhereTo", "CoDriver"]);

export interface GateInput {
  program: string;
  /** say, when and chip come from the message. */
  show: Pick<MomentShow, "say" | "when" | "chip">;
  data: MomentData;
}

// ---- 1 + 2: the program --------------------------------------------------------------------------

/** Static checks: the language, the calm rules and Signal's part rules, on the data now. */
export function checkProgram({ program, show, data }: GateInput): UiProblem[] {
  const bytes = new TextEncoder().encode(program).byteLength;
  if (bytes > MAX_BYTES) return [{ code: "too-large", message: `The program is ${bytes} bytes; the limit is ${MAX_BYTES}. A Moment has few parts: say less.` }];
  const lines = statementLines(program);
  const at = (id: string | undefined): { line?: number } => {
    const l = id === undefined ? undefined : lines.get(id);
    return l === undefined ? {} : { line: l };
  };
  const out: UiProblem[] = [];
  const { result, root } = read(program);
  for (const e of result.meta.errors) if (e.severity !== "warning") out.push({ ...at(e.statementId), code: e.code, message: e.message });
  if (result.meta.incomplete) out.push({ code: "incomplete", message: "The program ends inside a string, call or list. Close every quote and bracket." });
  if (!root) out.push({ code: "no-root", message: `No root. The first line must be root = ${ROOT}([...]) or root = NoChange().` });
  else if (!ROOTS.has(root.typeName)) out.push({ ...at("root"), code: "root", message: `The root is ${root.typeName}. It must be ${ROOT}([blocks]) or NoChange().` });
  for (const n of new Set(result.meta.unresolved)) out.push({ code: "dangling-ref", message: `${n} is used but never defined. Define it, or remove the reference.` });
  for (const n of result.meta.orphaned) out.push({ ...at(n), code: "unused", message: `${n} is defined but no part uses it, so it does not show. Use it or remove it.` });
  for (const q of result.queryStatements) out.push({ ...at(q.statementId), code: "no-query", message: "Query() is not available: a Moment binds live data by key." });
  for (const m of result.mutationStatements) out.push({ ...at(m.statementId), code: "no-mutation", message: "Mutation() is not available: use an action step on a Button." });
  for (const n of Object.keys(result.stateDeclarations)) out.push({ ...at(n), code: "no-state", message: `${n}: $variables are not available. Live values are bound by key, for example Fact("Arrive", "trip.eta").` });
  out.push(...messageRules(show));
  if (!root || !result.root || !ROOTS.has(root.typeName)) return dedupe(out);

  // Slots and steps on the parsed tree (steps are still AST there).
  walk(result.root as unknown as Part, (el, id) => {
    for (const p of slotProblems(el)) out.push({ ...at(id), ...p });
    for (const v of Object.values(el.props)) {
      for (const node of astNodes(v)) {
        if (node.k === "Comp" && !STEPS.has(node.name)) {
          out.push({ ...at(id), code: "action", message: `@${node.name} is not available. A Button's action is one of ${[...STEPS].map((s) => `@${s}`).join(", ")}.` });
        }
      }
    }
  });
  if (root.typeName === "Screen" && !isOwnScreen(root)) out.push(...partRules(root, at, data), ...calmRules(root, show, at, data));
  if (root.typeName === "Screen") out.push(...frameRules(root, at));
  return dedupe(out);
}

function messageRules(show: GateInput["show"]): UiProblem[] {
  const out: UiProblem[] = [];
  const say = show.say.trim();
  if (!say) out.push({ code: "say", message: "say is empty: one or two plain sentences the co-driver speaks." });
  if (say.length > MAX_SAY) out.push({ code: "say", message: `say is ${say.length} characters; at most ${MAX_SAY}. One or two sentences.` });
  if (show.chip !== undefined) {
    const n = wordsOf(show.chip, 0).length;
    if (n === 0 || n > R.chipWords) out.push({ code: "chip", message: `The chip "${show.chip}" has ${n} words; it has 1 to ${R.chipWords} ("Fuel low").` });
  }
  return out;
}

function frameRules(root: Part, at: (id: string | undefined) => { line?: number }): UiProblem[] {
  const blocks = parts(root.props.blocks);
  const frames = blocks.filter((b) => b.typeName === "Frame");
  return frames.length && blocks.length > 1
    ? [{ ...at(frames[0]?.statementId), code: "frame-alone", message: "Frame is Vela's whole screen: use it as the only block, or NoChange(), or compose the Moment yourself." }]
    : [];
}

/** What an organism already shows, as keys, from what it draws now (the trip row's form changes). */
function showsOf(el: Part, d: MomentData, tripTurn: boolean): readonly string[] {
  switch (el.typeName) {
    case "TripRow": {
      const base = d.screen.base;
      if (base.kind !== "trip") return ["trip.eta", "bar:trip"];
      const out = ["bar:trip"];
      if (base.eta.via !== undefined) out.push("stop.next", "stop.next.eta");
      else if (base.eta.lead === "Arrived") out.push("trip.driven", "trip.time");
      else out.push("trip.eta");
      if (tripTurn) out.push("next.distance", "next.turn");
      else if ("min" in base.left) out.push(base.eta.via !== undefined ? "stop.next.in" : "trip.left");
      else if (/^On /.test(base.left.text)) out.push("road.now");
      return out;
    }
    case "Hero": {
      const a = d.screen.answer;
      if (el.props.value === "trip.left" || a.kind === "time") return ["trip.left", "next.distance", "next.road", "next.turn"];
      if (a.kind === "arrived") return ["dest"];
      return ["next.distance", "next.road", "next.turn"];
    }
    case "Listening":
    case "NowPlaying":
      return ["media.now", "media.by", "bar:playback", "art"];
    case "Art":
      return ["art"];
    default:
      return [];
  }
}

/** Signal's part rules: where parts go, how many, copy, and bound keys with data now. */
function partRules(root: Part, at: (id: string | undefined) => { line?: number }, d: MomentData): UiProblem[] {
  const out: UiProblem[] = [];
  const blocks = parts(root.props.blocks);
  const counts = new Map<string, number>();
  const shown = new Map<string, number>();
  const show = (k: string) => shown.set(k, (shown.get(k) ?? 0) + 1);
  const typed = typedValues(d);
  const tripTurn = !showsTurn(root);
  let elements = 0;
  let warns = 0;

  if (blocks.length === 0) out.push({ code: "empty", message: "Screen has no blocks." });
  if (blocks.length > MAX_BLOCKS) out.push({ code: "too-many", message: `Screen has ${blocks.length} blocks; at most ${MAX_BLOCKS}. Group them, or say less.` });

  for (const b of blocks) {
    walk(
      b,
      (el, id, path) => {
        const where = at(id);
        const name = el.typeName;
        const inLead = path.includes("Lead");
        elements++;
        counts.set(name, (counts.get(name) ?? 0) + 1);
        if (ANSWERS.has(name) && !inLead) out.push({ ...where, code: "answer-outside-lead", message: `${name} is an answer: put it in the Lead.` });
        if (name === "Lead" && !path.every((p) => p === "Split" || p === "Screen")) {
          out.push({ ...where, code: "lead-place", message: "Lead is a block of the Screen (or one side of a Split), not inside another part." });
        }
        if (name === "Divider") {
          const parent = path[path.length - 1];
          if (!parent || parent === "Screen" || parent === "Split") out.push({ ...where, code: "divider", message: "A Divider separates groups inside a Card, Stack or Columns; never across the screen." });
        }
        if (name === "Quiet" && el.props.tone === "warn") warns++;
        if (name === "Value" || name === "Name") show(String(el.props.key));
        if (name === "Fact") show(String(el.props.value));
        if (name === "Bar") show(`bar:${String(el.props.key)}`);
        if (name === "Glyph" && el.props.name === "next.turn") show("next.turn");
        for (const s of showsOf(el, d, tripTurn)) show(s);
        const many = (n: number, max: number, what: string, fix: string) => {
          if (n > max) out.push({ ...where, code: "too-many", message: `${name} has ${n} ${what}; at most ${max}. ${fix}` });
        };
        if (name === "Actions") many(parts(el.props.buttons).length, MAX_BUTTONS, "buttons", "Ask by voice for the rest.");
        if (name === "List") many(parts(el.props.rows).length, MAX_ROWS, "rows", "The rest belong in a sheet.");
        if (name === "Facts") many(parts(el.props.items).length, MAX_FACTS, "facts", "Keep the ones the driver needs now.");
        if (name === "Card" || name === "Stack") many(parts(el.props.children).length, 4, "parts", "Split it, or say less.");
        if (name === "Row") many(parts(el.props.children).length, 5, "parts", "Say less.");
        if (name === "Columns") {
          const n = parts(el.props.children).length;
          if (n < 2 || n > 4) out.push({ ...where, code: "columns", message: `Columns has ${n} columns; it compares 2 to 4.` });
        }
        if (name === "Card" || name === "CoDriver" || name === "Quiet" || name === "Screen") {
          let primaries = 0;
          walk(el, (x) => {
            if (x.typeName === "Button" && x.props.kind === "primary") primaries++;
          });
          if (primaries > 1 && name !== "Screen") out.push({ ...where, code: "one-primary", message: `${name} has ${primaries} primary Buttons. A surface has at most one.` });
        }
        // Copy: sentence case, no middle dots, calm; cut words before type shrinks.
        for (const [prop, val] of Object.entries(el.props)) {
          if (typeof val !== "string") continue;
          const max = MAX_LEN[`${name}.${prop}`];
          if (max !== undefined && val.length > max) out.push({ ...where, code: "too-long", message: `${name} ${prop} is ${val.length} characters; at most ${max}. Cut words.` });
          if (!["text", "label", "title", "sub"].includes(prop)) continue;
          if (/[·•]/.test(val)) out.push({ ...where, code: "copy", message: `${name} ${prop}: no middle dots in copy.` });
          if (/\b[A-Z]{4,}\b/.test(val)) out.push({ ...where, code: "copy", message: `${name} ${prop}: no all caps. Use sentence case.` });
          if (/!/.test(val)) out.push({ ...where, code: "copy", message: `${name} ${prop}: no exclamation marks. Signal is calm.` });
          for (const [key, text] of typed) {
            if (val.toLowerCase().includes(text.toLowerCase())) out.push({ ...where, code: "typed-value", message: `${name} ${prop} types "${text}", which ${key} shows live. Bind it (Value, Name or Fact with "${key}") and keep only your own words.` });
          }
        }
        out.push(...dataProblems(el, d).map((m) => ({ ...where, code: "no-data", message: m })));
      },
      b.statementId,
      ["Screen"],
    );
  }

  // The Lead holds one large thing.
  for (const lead of leadsOf(blocks)) {
    let big = 0;
    walk(lead, (el) => {
      if (ANSWERS.has(el.typeName) || el.typeName === "Shelf" || el.typeName === "Art") big++;
      if (el.typeName === "Value" && el.props.tier === undefined) big++;
    });
    if (big > 1) out.push({ ...at(lead.statementId), code: "one-figure", message: `The Lead holds ${big} large parts. It has one; give the others a tier (secondary or tertiary) or move them out.` });
  }
  // Calm: few large things outside the Lead.
  let road = 0;
  for (const b of blocks) {
    if (b.typeName === "Lead") continue;
    walk(b, (el, _id, path) => {
      if (path.includes("Lead") || el.typeName === "Lead") return;
      if ((el.typeName === "Value" && (el.props.tier ?? "secondary") === "secondary") || ((el.typeName === "Label" || el.typeName === "Name") && el.props.tier === "secondary")) road++;
    });
  }
  if (road > MAX_ROAD_SIZE) out.push({ code: "calm", message: `${road} parts outside the Lead are at road size; at most ${MAX_ROAD_SIZE}. Use tertiary or caption for the rest.` });
  let cards = 0;
  blocks.forEach((b, i) =>
    walk(b, (el) => {
      if (CARDS.has(el.typeName) || (el.typeName === "Shelf" && b.typeName !== "Lead" && i < blocks.length - 1)) cards++;
    }),
  );
  if (cards > MAX_CARDS) out.push({ code: "too-many-cards", message: `The Moment has ${cards} cards; at most ${MAX_CARDS}. Merge them, or use plain parts: a card is for what the driver touches.` });
  if (elements > MAX_ELEMENTS) out.push({ code: "too-many", message: `The Moment has ${elements} parts; at most ${MAX_ELEMENTS}. Say less.` });
  for (const [k, n] of shown) if (n > 1) out.push({ code: "repeats", message: `"${k.replace(/^bar:/, "Bar ")}" shows ${n} times. Every fact shows once.` });
  for (const n of ["NowPlaying", "Listening", "WhereTo", "CoDriver", "TripRow", "Shelf", "Sheet", "Frame"]) {
    if ((counts.get(n) ?? 0) > 1) out.push({ code: "once", message: `${n} shows ${counts.get(n)} times. It is bound to one thing: use it once.` });
  }
  if (warns > 1) out.push({ code: "warn", message: "More than one part has tone warn. Warn is for one less reliable answer at a time." });
  if (guidanceOf(d) && (counts.get("NowPlaying") ?? 0) > 0) out.push({ code: "stage-on-route", message: 'NowPlaying is only for a Moment with no route. On a route, use Listening, or Art with Name("media.now").' });
  return out;
}

/** Live values copy must not type: figures with digits, and proper names. */
function typedValues(d: MomentData): [string, string][] {
  const figures = boundTexts(d, VALUE_KEYS).filter(([, t]) => /\d/.test(t));
  const names = boundTexts(d, NAME_KEYS).filter(([, t]) => t.length >= 8 || /\s/.test(t));
  return [...figures, ...names];
}

/** A bound part whose key has no data now would draw an empty state: refuse it. */
function dataProblems(el: Part, d: MomentData): string[] {
  const p = el.props;
  const miss = (k: string) => `${el.typeName} binds "${k}", and there is no such data now. Use a key with data.`;
  const guiding = !!guidanceOf(d);
  switch (el.typeName) {
    case "Value":
      return figureOf(p.key as ValueKey, d) ? [] : [miss(String(p.key))];
    case "Name":
      return nameOf(p.key as NameKey, d) === undefined ? [miss(String(p.key))] : [];
    case "Fact":
      return textOf(p.value as FactKey, d) === undefined ? [miss(String(p.value))] : [];
    case "Bar":
      return barOf(p.key as BarKey, d) ? [] : [miss(String(p.key))];
    case "Sequence":
      return sequenceOf(p.key as SequenceKey, d)?.length ? [] : [miss(String(p.key))];
    case "Glyph":
      return p.name === "next.turn" && !guiding ? [miss("next.turn")] : [];
    case "Art":
      return mediaOf(d) ? [] : ["Art binds what plays, and nothing plays. Use Shelf."];
    case "Listening":
    case "NowPlaying":
      return d.input.nowPlaying ? [] : [`${el.typeName} binds playback, and nothing plays. Use Shelf.`];
    case "TripRow":
      return d.screen.base.kind === "trip" || d.screen.base.kind === "waiting" ? [] : ["TripRow needs a route, and there is none."];
    case "Hero":
      return p.value === "trip.left" && !guiding ? [miss("trip.left")] : [];
    default:
      return [];
  }
}

// ---- The calm rules: one idea per Moment ----------------------------------------------------------

const wordsOf = (t: string, min = 3): string[] =>
  t.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length >= min && w.length > 0);

function leadsOf(blocks: Part[]): Part[] {
  return blocks.flatMap((b) => (b.typeName === "Lead" ? [b] : b.typeName === "Split" ? [b.props.first, b.props.second].filter((x): x is Part => isPart(x) && x.typeName === "Lead") : []));
}

/** Supporting items: blocks other than the Lead, the base row and Details. A Split counts its non-Lead side. */
export function itemsOf(blocks: Part[]): { el: Part; name: string }[] {
  const last = blocks[blocks.length - 1];
  const lastInner = last?.typeName === "Optional" && isPart(last.props.child) ? last.props.child : last;
  const base = lastInner && BASES.has(lastInner.typeName) ? last : undefined;
  const out: { el: Part; name: string }[] = [];
  for (const b of blocks) {
    if (b === base || b.typeName === "Lead" || b.typeName === "Details" || b.typeName === "Frame") continue;
    if (b.typeName === "Split") {
      for (const side of [b.props.first, b.props.second]) if (isPart(side) && side.typeName !== "Lead") out.push({ el: side, name: side.statementId ?? b.statementId ?? side.typeName });
      continue;
    }
    out.push({ el: b, name: b.statementId ?? b.typeName });
  }
  return out;
}

/** Which place a distance key belongs to: the name that must sit beside it. */
const PLACE_OF: Readonly<Record<string, string>> = { "stop.next.in": "stop.next", "stop.next.eta": "stop.next" };

/** The next turn under MOMENT_RULES.turnMeters, while guiding (an arrival is not a turn). */
export function nearTurn(d: MomentData): number | undefined {
  const g = guidanceOf(d);
  return g && g.metersToNext < R.turnMeters && g.nextStop.maneuver !== "arrive" ? g.metersToNext : undefined;
}

/** The Lead shows the turn: a Hero, or the next distance. */
function turnLeads(blocks: Part[]): boolean {
  return leadsOf(blocks).some((l) => {
    let yes = false;
    walk(l, (el) => {
      if (el.typeName === "Hero" || (el.typeName === "Value" && el.props.key === "next.distance")) yes = true;
    });
    return yes;
  });
}

function calmRules(root: Part, show: GateInput["show"], at: (id: string | undefined) => { line?: number }, d: MomentData): UiProblem[] {
  const out: UiProblem[] = [];
  const blocks = parts(root.props.blocks);
  const leads = leadsOf(blocks);
  if (leads.length !== R.leads) out.push({ code: "one-lead", message: `The Moment has ${leads.length} Leads. It has exactly ${R.leads}: the thing the driver reads first.` });
  const items = itemsOf(blocks);
  if (items.length > R.supportingItems) {
    const cut = items.slice(R.supportingItems).map((i) => i.name);
    out.push({ code: "items", message: `The Moment has ${items.length} supporting items (${items.map((i) => i.name).join(", ")}); at most ${R.supportingItems}. Cut ${cut.join(" and ")}: say it, or put it in Details.` });
  }
  const inLead = new Set<Part>();
  for (const lead of leads) {
    let leaves = 0;
    walk(lead, (el) => {
      inLead.add(el);
      if (!["Lead", "Stack", "Row"].includes(el.typeName)) leaves++;
      if (el.typeName === "Label" && wordsOf(String(el.props.text ?? ""), 0).length > R.leadLabelWords) {
        out.push({ ...at(lead.statementId), code: "lead-label", message: `The Lead's label "${String(el.props.text)}" has more than ${R.leadLabelWords} words. Say what the figure is in ${R.leadLabelWords} words or fewer.` });
      }
    });
    if (leaves > MAX_LEAD_PARTS) out.push({ ...at(lead.statementId), code: "lead-parts", message: `The Lead holds ${leaves} parts; at most ${MAX_LEAD_PARTS} (a glyph, the figure, its label, a bar). Move the rest out.` });
  }
  // Details: one, its own statement, and worth opening.
  const details = blocks.filter((b) => b.typeName === "Details");
  if (details.length > 1) out.push({ code: "details", message: "One Details per Moment." });
  for (const det of details) {
    if (!det.statementId || det.statementId === "root") out.push({ code: "details", message: "Write Details as its own statement (more = Details(...)), so Vela can open it." });
    let things = 0;
    for (const c of parts(det.props.children)) things += c.typeName === "List" ? parts(c.props.rows).length : c.typeName === "Facts" ? parts(c.props.items).length : c.typeName === "Sequence" ? 2 : 1;
    if (things < 2) out.push({ ...at(det.statementId), code: "details-thin", message: `Details "${String(det.props.label)}" holds ${things} thing. Details is for at least two facts the driver might ask for next; otherwise leave it out.` });
  }
  // No caption labels: a Label never sits before a figure or a name in the same group.
  walk(root, (el, id) => {
    if (el.typeName !== "Stack" && el.typeName !== "Row") return;
    const kids = parts(el.props.children);
    const figure = (e: Part | undefined): boolean =>
      !!e && (["Value", "Name", "Hero"].includes(e.typeName) || ((e.typeName === "Row" || e.typeName === "Stack") && parts(e.props.children).some((c) => c.typeName === "Value" || c.typeName === "Name")));
    kids.forEach((k, i) => {
      if (k.typeName === "Label" && figure(kids[i + 1])) {
        out.push({ ...at(id), code: "caption-label", message: `Label "${String(k.props.text)}" sits before a figure. The glyph is the label: cut it, or put a few words after the figure only if the number is unclear without them.` });
      }
    });
  });
  // Every place distance has the place's name beside it.
  walk(root, (el, id) => {
    if (!["Row", "Stack", "Card", "Lead", "Facts"].includes(el.typeName)) return;
    const kids = el.typeName === "Lead" ? [el.props.child].filter(isPart) : el.typeName === "Facts" ? parts(el.props.items) : parts(el.props.children);
    const keys: string[] = [];
    for (const k of kids) {
      if (k.typeName === "Value") keys.push(String(k.props.key));
      if (k.typeName === "Fact") keys.push(String(k.props.value));
      if (k.typeName === "Facts") for (const f of parts(k.props.items)) keys.push(String(f.props.value));
    }
    const names = new Set<string>();
    walk(el, (x) => {
      if (x.typeName === "Name") names.add(String(x.props.key));
      if (x.typeName === "Fact") names.add(String(x.props.value));
    });
    for (const k of keys) {
      const place = PLACE_OF[k];
      if (place && !names.has(place) && !nameNear(root, el, place)) {
        out.push({ ...at(id), code: "name-beside", message: `${k} is a distance to a place, and the place's name is not beside it. Put Name("${place}") in the same group: a glance must say what is that far.` });
      }
    }
  });
  // The voice explains, the screen answers: no whole phrase of say on screen. The Lead's label is exempt.
  const sayText = ` ${wordsOf(show.say, 0).join(" ")} `;
  walk(root, (el, id) => {
    if (inLead.has(el)) return;
    for (const prop of ["text", "title", "sub", "label"]) {
      const v = el.props[prop];
      if (typeof v !== "string" || el.typeName === "Button" || el.typeName === "Details") continue;
      const w = wordsOf(v, 0);
      if (w.length >= 3 && sayText.includes(` ${w.join(" ")} `)) out.push({ ...at(id), code: "repeats-say", message: `${el.typeName} "${v}" repeats a phrase of say. The voice explains; cut it from the screen.` });
    }
  });
  // While guiding, a turn under 1 km leads; otherwise the Moment waits for it with a chip.
  const near = nearTurn(d);
  if (near !== undefined && show.when === "now" && !turnLeads(blocks)) {
    out.push({ code: "turn-wait", message: `The next turn is ${distance(near)} away. Under ${distance(R.turnMeters)} the turn leads: send when "after-turn" with a chip of at most ${R.chipWords} words, or lead with Hero("nav.next").` });
  }
  if (show.when === "after-turn" && show.chip === undefined) out.push({ code: "when", message: `A Moment with when "after-turn" needs a chip (at most ${R.chipWords} words): it is all that shows until the turn is behind.` });
  const g = guidanceOf(d);
  if (g && !showsTurn(root) && !blocks.some((b) => b.typeName === "TripRow" || (b.typeName === "Optional" && isPart(b.props.child) && b.props.child.typeName === "TripRow"))) {
    out.push({ code: "turn", message: `The next turn (${distance(g.metersToNext)}) must show: end with TripRow() (its leading figure shows the turn) or show Row([Glyph("next.turn"), Value("next.distance"), Name("next.road")]).` });
  }
  return out;
}

/** The name sits in the group's parent group (a Stack holding the Row). */
function nameNear(root: Part, group: Part, place: string): boolean {
  let found = false;
  walk(root, (el) => {
    const kids = [el.props.child, el.props.first, el.props.second, ...parts(el.props.children)].filter(isPart);
    if (!kids.includes(group) || el.typeName === "Screen" || el.typeName === "Split") return;
    walk(el, (x) => {
      if (x.typeName === "Name" && x.props.key === place) found = true;
    });
  });
  return found;
}

// ---- 3: the render probe --------------------------------------------------------------------------

/** Whether this document lays out (a browser), so the probe can measure. */
export const canMeasure = (): boolean => typeof document !== "undefined" && typeof document.fonts !== "undefined" && typeof CSS !== "undefined" && !!CSS.supports?.("display", "grid");

/**
 * The whole gate: static checks, then, when they pass and a browser can measure, the render probe
 * at the four postures (closed and, with Details, open).
 */
export async function gate(input: GateInput): Promise<UiProblem[]> {
  const problems = checkProgram(input);
  const fatal = problems.some((p) => !["copy", "too-long", "typed-value", "unused", "warn", "one-primary", "calm"].includes(p.code));
  if (fatal || !canMeasure()) return problems;
  const { root } = read(input.program);
  if (!root || isOwnScreen(root)) return problems;
  return [...problems, ...(await renderProbe(root, input.data))];
}

export async function renderProbe(root: Part, d: MomentData): Promise<UiProblem[]> {
  await document.fonts.ready;
  const box = document.createElement("div");
  box.inert = true;
  box.setAttribute("aria-hidden", "true");
  box.style.cssText = "position:fixed;left:-20000px;top:0;pointer-events:none;visibility:hidden";
  document.body.append(box);
  const found = new Map<string, { code: string; message: string; postures: PostureId[] }>();
  let words = 0;
  const open = openDetails(root);
  try {
    for (const [tree, opened] of open ? ([[root, false], [open, true]] as const) : ([[root, false]] as const)) {
      for (const p of MOMENT_POSTURES) {
        const frame = await drawAt(box, tree, d, p.w, p.h);
        if (!opened) words = Math.max(words, countWords(frame));
        for (const [code, msg] of probe(frame)) {
          const message = opened ? `With Details open: ${msg}` : msg;
          const k = `${code}|${message}`;
          const f = found.get(k) ?? { code, message, postures: [] };
          f.postures.push(p.id);
          found.set(k, f);
        }
      }
    }
  } finally {
    box.remove();
  }
  const out: UiProblem[] = [...found.values()].map((f) => ({ code: f.code, message: `${f.message} (at ${f.postures.map(postureText).join(", ")}).`, postures: f.postures }));
  if (words > R.outsideWords) {
    out.push({ code: "words", message: `The Moment has ${words} words outside the Lead and the base row; at most ${R.outsideWords} (a bound value with its unit is 1). Cut words: the voice explains, or Details holds the rest.` });
  }
  return out;
}

/** The tree with every Details open, or undefined when it has none. */
function openDetails(root: Part): Part | undefined {
  let any = false;
  const copy = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(copy);
    if (!isPart(v)) return v;
    const props: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v.props)) props[k] = copy(x);
    if (v.typeName === "Details") {
      props.open = true;
      any = true;
    }
    return { ...v, props };
  };
  const out = copy(root) as Part;
  return any ? out : undefined;
}

/** One frame at a posture, laid out as the mount lays it out, after fit and reflow. */
async function drawAt(box: HTMLElement, tree: Part, d: MomentData, w: number, h: number): Promise<HTMLElement> {
  const cell = document.createElement("div");
  cell.style.cssText = `width:${w}px;height:${h}px;position:relative`;
  box.append(cell);
  const shell = document.createElement("div");
  shell.className = "vela";
  shell.toggleAttribute("data-daylight", d.screen.daylight);
  const frame = document.createElement("main");
  frame.className = "app";
  shell.append(frame);
  cell.append(shell);
  layout(frame, w, h, true);
  frame.replaceChildren(...drawTree(tree, d, { keyboard: 0, close: true }).els);
  await images(frame);
  fit(frame);
  if (reflow(frame)) fit(frame);
  return frame;
}

/** The plan's custom properties and flow on a frame; `free` marks a free Moment. */
export function layout(frame: HTMLElement, w: number, h: number, free: boolean): void {
  const p = plan(w || 932, h || 553);
  for (const [k, v] of Object.entries(planVars(p))) frame.style.setProperty(k, v);
  frame.dataset.flow = p.flow;
  frame.classList.toggle("m-free", free);
}

const postureText = (id: PostureId): string => {
  const p = MOMENT_POSTURES.find((x) => x.id === id);
  return p ? `${p.w}×${p.h}` : id;
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

const blockName = (c: Element): string => {
  if (c.matches(".m-lead")) return "Lead";
  const labelled = c.matches("[aria-label]") ? c : c.querySelector("[aria-label]");
  const kind = (c.getAttribute("class") ?? "").split(/\s+/)[0]?.replace(/^m-/, "") ?? "";
  return labelled ? `${kind} "${labelled.getAttribute("aria-label")}"` : kind;
};

const partName = (el: Element): string => {
  const sec = el.closest(".app > *") ?? el;
  const label = sec.getAttribute("aria-label");
  return label ? `the ${label} part` : `.${(sec.getAttribute("class") ?? sec.tagName).split(/\s+/)[0]}`;
};

/** The measured checks on a drawn frame, after fit() and reflow(). */
export function probe(app: HTMLElement): [code: string, message: string][] {
  const out: [string, string][] = [];
  const fr = app.getBoundingClientRect();
  const sections = [...app.children] as HTMLElement[];
  const body = sections.find((c) => c.classList.contains("m-body"));
  if (body && body.scrollHeight > body.clientHeight + 1) {
    const dropped = (app.dataset.reflow ?? "").split(" ").filter((x) => x === "drop").length;
    const tall = [...body.children]
      .filter((c) => !c.hasAttribute("data-dropped"))
      .map((c) => `${blockName(c)} ${Math.round(c.getBoundingClientRect().height)}`)
      .join(", ");
    out.push([
      "height",
      `The blocks need ${body.scrollHeight} px and have ${body.clientHeight} px, after space yielded, text stepped down${dropped ? ` and ${dropped} Optional block${dropped > 1 ? "s" : ""} dropped` : ""} (blocks: ${tall}). Wrap a block in Optional, or say less`,
    ]);
  }
  if (overflows(app)) out.push(["overflow", "The parts are taller than the screen. Drop a part or use a shorter one"]);

  // Text that leaves its section or the frame, or is clipped without an ellipsis.
  const walker = document.createTreeWalker(app, NodeFilter.SHOW_TEXT);
  const seen = new Set<Element>();
  const bodyOver = !!body && body.scrollHeight > body.clientHeight + 1;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.textContent?.trim() ?? "";
    const el = n.parentElement;
    if (!text || !el || el.closest("svg, [hidden], [data-dropped]")) continue;
    if (bodyOver && body?.contains(el)) continue;
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
    const cs = inClip ? getComputedStyle(inClip) : null;
    const scrolls = cs ? /auto|scroll/.test(cs.overflowY) : false;
    const cut = !!cs && !scrolls && (cs.textOverflow === "ellipsis" || (cs.webkitLineClamp !== "none" && cs.webkitLineClamp !== ""));
    const sec = el.closest(".app > *");
    const sr = sec?.getBoundingClientRect();
    const short = text.slice(0, 32);
    for (const x of cut && inClip ? [inClip.getBoundingClientRect()] : rects) {
      if (scrolls) break;
      if (x.left < fr.left - 0.5 || x.right > fr.right + 0.5 || x.top < fr.top - 0.5 || x.bottom > fr.bottom + 0.5) {
        out.push(["offscreen", `"${short}" leaves the screen`]);
        break;
      }
      const slack = Number.parseFloat(getComputedStyle(el).fontSize) * 0.25;
      if (sr && (x.left < sr.left - 0.5 || x.right > sr.right + 0.5 || x.top < sr.top - slack || x.bottom > sr.bottom + slack)) {
        out.push(["overflow", `"${short}" leaves ${partName(el)}`]);
        break;
      }
    }
    if (inClip && cs && !seen.has(inClip) && !inClip.matches(".m-body")) {
      seen.add(inClip);
      if ((inClip.scrollWidth > inClip.clientWidth + 1 || inClip.scrollHeight > inClip.clientHeight + 1) && !cut && !scrolls) {
        out.push(["clipped", `"${short}" is cut off without an ellipsis in ${partName(el)}. Use fewer words`]);
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
  }
  // Words squeezed to a stub: a readout that kept too little width is a defect.
  for (const l of app.querySelectorAll<HTMLElement>(".m-label")) {
    const r = l.getBoundingClientRect();
    const em = Number.parseFloat(getComputedStyle(l).fontSize) || 16;
    if (r.width > 0 && r.width < em * 4 && (l.textContent ?? "").trim().length > 4) {
      out.push(["squeezed", `"${(l.textContent ?? "").trim().slice(0, 32)}" is squeezed to ${Math.round(r.width)} px. Give it its own line (a Stack), or fewer parts in its row`]);
    }
  }
  // Targets: 56 px (the top row's icons draw smaller and extend their hit by margin).
  for (const b of app.querySelectorAll<HTMLElement>("button.btn, .keys button, .row[data-action], .icon-btn:not(.top .icon-btn)")) {
    const r = b.getBoundingClientRect();
    if (r.width === 0) continue;
    if (r.height < 55.5 || r.width < 55.5) out.push(["target", `A target in ${partName(b)} is ${Math.round(r.width)}×${Math.round(r.height)}; every target is at least 56×56`]);
  }
  return [...new Map(out.map((x) => [x.join("|"), x])).values()];
}

// ---- Helpers -----------------------------------------------------------------------------------

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

function astNodes(v: unknown): ASTNode[] {
  const out: ASTNode[] = [];
  const visit = (n: unknown): void => {
    if (Array.isArray(n)) {
      n.forEach(visit);
      return;
    }
    if (typeof n !== "object" || n === null || isPart(n) || !("k" in n)) return;
    const node = n as ASTNode;
    out.push(node);
    if (node.k === "Comp") node.args.forEach(visit);
    else if (node.k === "Arr") node.els.forEach(visit);
  };
  visit(v);
  return out;
}

// Which components each slot takes, read from the generated JSON Schema: lang-core checks types,
// not slot membership.
type Json = { $ref?: string; anyOf?: Json[]; items?: Json; properties?: Record<string, Json> };
const DEFS = (schema as unknown as { $defs: Record<string, Json> }).$defs;
const refName = (j: Json): string | undefined => j.$ref?.replace("#/$defs/", "");

function slotNames(j: Json): Set<string> {
  const names = new Set<string>();
  const visit = (x: Json | undefined): void => {
    if (!x) return;
    const n = refName(x);
    if (n) names.add(n);
    x.anyOf?.forEach(visit);
    visit(x.items);
  };
  visit(j);
  return names;
}

function slotProblems(el: Part): Omit<UiProblem, "line">[] {
  const props = DEFS[el.typeName]?.properties;
  if (!props) return [];
  const out: Omit<UiProblem, "line">[] = [];
  for (const [key, field] of Object.entries(props)) {
    const v = el.props[key];
    const allowed = slotNames(field);
    if (!allowed.size) continue;
    for (const child of Array.isArray(v) ? v : [v]) {
      if (!isPart(child)) continue;
      if (!allowed.has(child.typeName)) out.push({ code: "wrong-component", message: `${el.typeName} ${key} takes ${[...allowed].join(" | ")}, not ${child.typeName}.` });
    }
  }
  return out;
}
