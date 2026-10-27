/**
 * Signal view components: typed builders that return elements with the class names in
 * styles/system.css. No listeners: every target carries `data-action` (and `data-arg`), and the
 * app mount handles events by delegation, so patched nodes never lose a handler.
 */
import { type Child, h, icon, svg } from "../core/dom";
import { hm } from "../core/format";
import { type GlyphName, glyph, keyIcon } from "../core/icons";
import type { SourceId } from "../app/contract";

export const SOURCE_TINT: Readonly<Record<SourceId, string>> = { music: "#4f4a6e", podcasts: "#5d5656", books: "#5c5332" };
const SOURCE_GLYPH: Readonly<Record<SourceId, GlyphName>> = { music: "music", podcasts: "podcast", books: "book" };

export interface Act {
  action: string;
  arg?: string | number | undefined;
}
const act = (a: Act | undefined): Record<string, string | undefined> =>
  a ? { "data-action": a.action, "data-arg": a.arg === undefined ? undefined : String(a.arg) } : {};

export const g = (name: GlyphName, tag = "i", cls?: string): HTMLElement => icon(glyph[name], tag, cls);

/** "11<unit>h</unit> 45<unit>min</unit>": the time left, large. */
export function timeLeft(min: number): (Node | string)[] {
  const t = hm(min);
  const unit = (u: string) => h("span", { class: "unit" }, u);
  return t.h ? [`${t.h}`, unit("h"), ` ${t.m}`, unit("min")] : [`${t.m}`, unit("min")];
}

// ---- Buttons ------------------------------------------------------------------------------------
export interface BtnOpts extends Act {
  label: string;
  icon?: GlyphName | undefined;
  kind?: "secondary" | "primary" | "quiet";
  aria?: string | undefined;
  disabled?: boolean;
  cls?: string;
  style?: string;
}
export function btn(o: BtnOpts): HTMLElement {
  const cls = ["btn", o.kind && o.kind !== "secondary" ? o.kind : "", o.cls ?? ""].filter(Boolean).join(" ");
  return h(
    "button",
    { type: "button", class: cls, "aria-label": o.aria, disabled: o.disabled, style: o.style, ...act(o) },
    o.icon ? g(o.icon) : null,
    h("span", null, o.label),
  );
}

export function iconBtn(name: GlyphName, label: string, a: Act, cls = ""): HTMLElement {
  return h("button", { type: "button", class: `icon-btn${cls ? ` ${cls}` : ""}`, "aria-label": label, ...act(a) }, svg(glyph[name]));
}

/** Talk: press and hold, or tap while the co-driver speaks. Handled by pointer delegation. */
export function talkBtn(t: { active: boolean; denied: boolean; fault?: "offline" | "unreachable" | undefined }): HTMLElement {
  // At rest a fault shows on the button: mic-off, no signal, or the broken link. A press shows why.
  const mark = t.denied ? glyph.micOff : t.fault === "offline" ? glyph.nosignal : t.fault === "unreachable" ? glyph.unlinked : glyph.mic;
  const label = t.denied ? "Talk, microphone blocked" : t.fault === "offline" ? "Talk, no signal" : t.fault === "unreachable" ? "Talk, co-driver unreachable" : "Talk";
  return h(
    "button",
    { type: "button", class: `talk-btn${t.denied || t.fault ? " denied" : ""}`, "aria-label": label, "aria-pressed": String(t.active), "data-talk": "" },
    svg(mark),
  );
}

export function switchEl(on: boolean, label: string, a: Act): HTMLElement {
  return h("button", { type: "button", class: "switch", role: "switch", "aria-checked": String(on), "aria-label": label, ...act(a) });
}

// ---- Progress -----------------------------------------------------------------------------------
/** A position bar: what plays, a download, an answer spoken, a Moment's range or fuel. */
export function bar(fraction: number, opts: { cls?: string } = {}): HTMLElement {
  const pct = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
  return h("div", { class: ["bar", opts.cls ?? ""].filter(Boolean).join(" ") }, h("i", { style: `width:${pct}` }));
}

// ---- Art ----------------------------------------------------------------------------------------
/** A cover, or the Source tint with the Source glyph when the cover is missing. */
export function art(src: string | undefined, source: SourceId, cls: string): HTMLElement {
  if (src) return h("img", { class: cls, src, alt: "", "data-key": src });
  const el = icon(glyph[SOURCE_GLYPH[source]], "span", `${cls} listen-noart`);
  el.setAttribute("style", `--tint:${SOURCE_TINT[source]}`);
  el.setAttribute("aria-hidden", "true");
  return el;
}

// ---- Transport keys -----------------------------------------------------------------------------
export function keys(o: { skip: "track" | "seconds"; playing: boolean; error?: string | undefined }): HTMLElement {
  if (o.error !== undefined) {
    return h("div", { class: "keys" }, h("button", { type: "button", class: "play", "aria-label": o.error, "data-action": "key-retry" }, svg(glyph.retry)));
  }
  const [b, f] =
    o.skip === "track"
      ? [["Previous", keyIcon.prev], ["Next", keyIcon.next]]
      : [["Back 15 seconds", keyIcon.back], ["Forward 30 seconds", keyIcon.fwd]];
  return h(
    "div",
    { class: "keys" },
    h("button", { type: "button", "aria-label": b?.[0], "data-action": "key-back" }, svg(b?.[1] ?? "")),
    h(
      "button",
      { type: "button", class: "play", "aria-label": o.playing ? "Pause" : "Play", "data-action": "key-toggle" },
      svg(o.playing ? keyIcon.pause : keyIcon.play),
    ),
    h("button", { type: "button", "aria-label": f?.[0], "data-action": "key-forward" }, svg(f?.[1] ?? "")),
  );
}

// ---- Rows -----------------------------------------------------------------------------------------
export interface RowOpts extends Partial<Act> {
  lead?: { art?: string | undefined; source: SourceId } | undefined;
  icon?: GlyphName | undefined;
  title: string;
  sub?: string | undefined;
  meta?: string | undefined;
  mark?: GlyphName | undefined;
  end?: GlyphName | undefined;
  current?: boolean;
  compact?: boolean;
  dim?: boolean;
  label?: string | undefined;
  optional?: boolean;
  cls?: string;
}
export function row(o: RowOpts): HTMLElement {
  const cls = ["row", o.compact && "compact", o.dim && "dim", !o.lead && !o.icon && "bare", o.cls].filter(Boolean).join(" ");
  const leadEl = o.lead ? art(o.lead.art, o.lead.source, "lead") : o.icon ? g(o.icon, "span", "lead-icon") : null;
  const trailing: Child = o.meta !== undefined || o.mark
    ? h("span", { class: `meta num${o.mark ? " listen-mark" : ""}` }, o.mark ? g(o.mark) : null, o.meta ?? "")
    : o.end
      ? g(o.end, "i", "end")
      : null;
  return h(
    o.action ? "button" : "div",
    {
      ...(o.action ? { type: "button" } : {}),
      class: cls,
      "aria-current": o.current ? "true" : undefined,
      "aria-label": o.label,
      disabled: o.dim && o.action ? true : undefined,
      "data-optional": o.optional ? "" : undefined,
      ...act(o.action ? (o as Act) : undefined),
    },
    leadEl,
    h("span", { class: "text" }, h("b", null, o.title), o.sub ? h("span", null, o.sub) : null),
    trailing,
  );
}

export function listHead(text: string, id?: string): HTMLElement {
  return h("div", { class: "list-head", "data-head": id }, text);
}

// ---- Sheet ----------------------------------------------------------------------------------------
export interface SheetOpts {
  label: string;
  key: string;
  head: Child[];
  body: Child[];
  back?: Act | undefined;
  close?: boolean;
  foot?: Child[] | undefined;
  full?: boolean;
  hug?: boolean;
}
export function sheet(o: SheetOpts): HTMLElement {
  return h(
    "section",
    { class: ["sheet", o.full ? "plan-full" : "", o.hug ? "plan-hug" : ""].filter(Boolean).join(" "), "aria-label": o.label, "data-key": o.key },
    h(
      "div",
      { class: "sheet-top" },
      o.back ? iconBtn("back", "Back", o.back) : null,
      ...o.head,
      o.close === false ? null : iconBtn("close", "Close", { action: "sheet-close" }),
    ),
    ...o.body,
    o.foot?.length ? h("div", { class: "plan-foot" }, ...o.foot) : null,
  );
}

export const sheetTitle = (text: string, two = false): HTMLElement => h("div", { class: `sheet-title${two ? " plan-title" : ""}` }, text);

export function seg(options: readonly { id: string; label: string; icon?: GlyphName | undefined }[], pressed: string, action: string, cls = "", radio = false): HTMLElement {
  return h(
    "div",
    { class: `seg${cls ? ` ${cls}` : ""}`, role: radio ? "radiogroup" : undefined },
    ...options.map((o) =>
      h(
        "button",
        {
          type: "button",
          role: radio ? "radio" : undefined,
          "aria-pressed": String(o.id === pressed),
          "aria-checked": radio ? String(o.id === pressed) : undefined,
          "aria-label": o.label,
          "data-action": action,
          "data-arg": o.id,
        },
        o.icon ? g(o.icon) : null,
        h("span", null, o.label),
      ),
    ),
  );
}

/**
 * A search field: a real input. `talk` docks Talk in its trailing slot (keyboard open, short screen).
 * `field` names it for the mount's input handling.
 */
export function field(o: { placeholder: string; value: string; field: string; cls?: string; talk?: { active: boolean; denied: boolean } | undefined; autofocus?: boolean; glyphName?: GlyphName | null }): HTMLElement {
  return h(
    "label",
    { class: `field${o.cls ? ` ${o.cls}` : ""}${o.value ? " has-value" : ""}` },
    o.glyphName === null ? null : g(o.glyphName ?? "search"),
    h("input", {
      type: "search",
      class: "field-input",
      placeholder: o.placeholder,
      "aria-label": o.placeholder,
      value: o.value,
      enterkeyhint: "search",
      autocomplete: "off",
      spellcheck: "false",
      "data-field": o.field,
      autofocus: o.autofocus,
      "data-key": o.field,
    }),
    o.talk ? talkBtn(o.talk) : null,
  );
}

/** A short message: glyph, title 16 t1, sub 14 t2. Errors use t2 and a glyph, never warn. */
export function note(name: GlyphName, title: string, sub?: string): HTMLElement {
  return h("div", { class: "plan-note", role: "status" }, g(name), h("div", null, h("b", null, title), sub ? h("span", null, sub) : null));
}
