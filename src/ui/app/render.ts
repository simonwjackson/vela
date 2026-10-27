/**
 * Draw a Screen as the frame's children: T, A, C (or a sheet), B, and the keyboard spacer.
 * Pure DOM building from the model; measuring happens afterwards in view/fit.ts.
 */
import { type Child, h, svg } from "../core/dom";
import { glyph } from "../core/icons";
import {
  art,
  bar,
  btn,
  field,
  g,
  iconBtn,
  keys,
  listHead,
  note,
  row,
  seg,
  sheet,
  sheetTitle,
  switchEl,
  talkBtn,
  timeLeft,
} from "../view/parts";
import type { AnswerView, BaseView, CarView, CardView, DownloadsView, NowView, PlaceRow, Screen, SettingsUpdate, SheetView, ShelfEntry, TalkView, TopView } from "./screen";
import { SOURCES, STOP_KINDS } from "./screen";

export function renderScreen(s: Screen, opts: { keyboard: number }): HTMLElement[] {
  const talk = talkOf(s.base);
  const onRoute = s.base.kind === "trip" && s.answer.kind !== "arrived";
  if (s.keyboard.full && s.sheet) {
    // The visual viewport is under 300 px: only the sheet and the keyboard. Talk is in the field.
    return [renderSheet(s.sheet, { talk, onRoute }), kb(opts.keyboard)];
  }
  const parts: Child[] = [
    s.top ? top(s.top) : null,
    answer(s.answer, onRoute),
    s.card && !s.sheet ? card(s.card) : null,
    base(s.base),
    s.sheet ? renderSheet(s.sheet, { talk, onRoute }) : null,
    s.keyboard.open ? kb(opts.keyboard) : null,
  ];
  return parts.filter((p): p is HTMLElement => p instanceof HTMLElement);
}

const kb = (height: number): HTMLElement => h("div", { class: "plan-kb", style: `height:${Math.round(height)}px`, "aria-hidden": "true", "data-key": "kb" });

function talkOf(b: BaseView): TalkView {
  return b.kind === "none" ? { active: false, denied: false } : b.talk;
}

// ---- T ------------------------------------------------------------------------------------------
function top(t: TopView): HTMLElement {
  let chip: Child = null;
  const c = t.chip;
  if (c?.kind === "status") {
    chip = h("span", { class: `chip${c.warn ? " warn" : ""}`, title: c.text, role: "status", "aria-label": c.text }, g(c.icon), h("span", null, c.text));
  } else if (c) {
    chip = h(
      "button",
      { type: "button", class: `chip${c.toast ? " toast" : ""}${c.warn ? " warn" : ""}`, role: c.toast ? "status" : undefined, "aria-label": c.text, "data-action": c.action, "data-key": c.text },
      g(c.icon),
      h("span", null, c.text),
    );
  }
  return h(
    "div",
    { class: "top", "data-key": "top" },
    h("div", { class: "chip-slot" }, chip),
    h(
      "div",
      { class: "top-end" },
      ...(t.speed ? [h("span", { class: "readout warn num" }, t.speed.now), h("span", { class: "readout num" }, t.speed.limit)] : []),
      h("span", { class: "clock num" }, t.clock),
      t.settings ? iconBtn("settings", "Settings", { action: "settings-open" }) : null,
    ),
  );
}

// ---- A ------------------------------------------------------------------------------------------
function answer(a: AnswerView, onRoute: boolean): HTMLElement {
  // Tap the answer on a route: the Route sheet.
  const tap = onRoute ? { role: "button", tabindex: "0", "data-action": "route-open" } : {};
  switch (a.kind) {
    case "turn": {
      const big = "word" in a.big ? h("div", { class: "big num" }, a.big.word) : h("div", { class: "big num" }, a.big.num, h("span", { class: "unit" }, a.big.unit));
      return h(
        "section",
        { class: `answer${a.stale ? " drive-stale" : ""}`, "aria-label": a.label, ...tap, "data-key": "turn" },
        h("div", { class: "hero" }, arrow(a.icon), big),
        h("div", { class: "road" }, a.road),
        a.thenTurn
          ? h("div", { class: "drive-then", "aria-label": `Then ${a.thenTurn.road}` }, h("span", null, "Then"), ic(a.thenTurn.icon), h("span", { class: "drive-then-road" }, a.thenTurn.road))
          : null,
      );
    }
    case "time":
      return h(
        "section",
        { class: "answer", "aria-label": "Time left", ...tap, "data-key": "time" },
        h("div", { class: "big num" }, ...timeLeft(a.min)),
        h("div", { class: "line2" }, ic(a.next.icon), h("span", null, h("b", null, a.next.road), ` in ${a.next.dist}`)),
      );
    case "quiet":
      return h(
        "section",
        { class: "answer", "aria-label": a.label, ...tap, "data-key": `quiet-${a.label}` },
        h("div", { class: `quiet${a.warn ? " warn" : ""}${a.named ? " plan-quiet" : ""}` }, a.icon ? g(a.icon) : null, h("span", null, a.text)),
        a.sub ? h("div", { class: "quiet-sub" }, a.sub) : null,
        a.shimmer ? h("div", { class: "shimmer" }) : null,
        a.button ? h("div", { class: "answer-actions" }, btn({ label: a.button.label, icon: a.button.icon, action: a.button.action, arg: a.button.arg })) : null,
      );
    case "arrived":
      return h(
        "section",
        { class: "answer", "aria-label": "Arrived", "data-key": "arrived" },
        h("div", { class: "hero" }, arrow(glyph.flag), h("div", { class: "big" }, "Arrived")),
        h("div", { class: "drive-arrived-line" }, h("div", { class: "road secondary" }, a.place), btn({ label: "Done", action: "arrived-done" })),
      );
    case "stage":
      return stage(a.now);
    case "shelf":
      return h(
        "section",
        { class: "shelf large", "aria-label": "Resume", "data-key": "shelf-large" },
        h("div", { class: "shelf-head" }, "Nothing playing"),
        h("div", { class: "rows" }, ...shelfRows(a.entries, false)),
      );
    case "boot":
      return h(
        "section",
        { class: "answer talk-boot", "aria-label": "Vela can't start" },
        h("div", { class: "quiet" }, g("alert"), h("span", null, "Vela can't start")),
        h("div", { class: "quiet-sub" }, a.message),
        h("div", { class: "answer-actions" }, btn({ label: "Try again", icon: "retry", action: "boot-retry" })),
      );
  }
}

const arrow = (markup: string): HTMLElement => h("div", { class: "arrow" }, svg(markup));
const ic = (markup: string): HTMLElement => h("i", null, svg(markup));

function stage(n: NowView): HTMLElement {
  return h(
    "section",
    { class: "stage", "aria-label": "Now playing", "data-key": "stage" },
    art(n.art, n.source, "art"),
    h(
      "div",
      { class: "text" },
      h("div", { class: "title" }, n.title),
      h("div", { class: "by" }, n.byLong),
      n.transport === "loading" ? h("div", { class: "bar quiet listen-loading", role: "progressbar", "aria-label": "Loading" }) : bar(n.fraction, { quiet: true }),
      keys({ skip: n.skip, playing: n.transport === "playing" || n.transport === "loading", error: n.transport === "error" ? "Try again" : undefined }),
    ),
  );
}

// ---- C ------------------------------------------------------------------------------------------
function card(c: CardView): HTMLElement {
  switch (c.kind) {
    case "listen":
      return listenCard(c.now, c.retry);
    case "shelf":
      return h(
        "section",
        { class: "listen shelf", "aria-label": "Resume", "data-key": "shelf-card" },
        h("div", { class: "shelf-head" }, "Nothing playing"),
        h("div", { class: "rows" }, ...shelfRows(c.entries, true)),
      );
    case "where":
      return h(
        "section",
        { class: "where-card", "aria-label": "Where to", "data-key": "where-card" },
        h("button", { type: "button", class: "field", "data-action": "where-open" }, g("search"), h("span", null, "Where to?")),
        h(
          "div",
          { class: "rows" },
          ...c.rows.map((r, i) => row({ icon: r.icon, title: r.title, action: "place-pick", arg: `${r.list}:${r.index}`, optional: i > 0 })),
        ),
      );
    case "codriver":
      return h(
        "section",
        { class: "codriver talk-card", "aria-label": "Co-driver", "aria-live": "polite", "data-key": "codriver" },
        h("div", { class: "codriver-mark" }, svg(glyph[c.mark])),
        h("div", { class: "codriver-label" }, c.label),
        h(
          "div",
          {
            class: `codriver-text${c.said ? " said" : ""}${c.keep ? " talk-keep" : ""}${c.paged !== undefined ? " talk-paged" : ""}`,
            "data-full": c.text,
            "data-at": c.paged === undefined ? undefined : String(c.paged),
          },
          c.text,
        ),
        c.sub ? h("div", { class: "talk-sub" }, c.sub) : null,
        c.paged !== undefined
          ? h(
              "div",
              { class: "talk-progress", hidden: true, role: "progressbar", "aria-label": "Answer spoken", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(Math.round(c.paged * 100)) },
              bar(c.paged, { quiet: true }),
            )
          : null,
        c.shimmer ? h("div", { class: "shimmer talk-shimmer" }) : null,
        c.button ? h("div", { class: "btn-row" }, btn({ label: c.button.label, action: c.button.action })) : null,
        c.reserve ? h("div", { class: "btn-row talk-reserve", "aria-hidden": "true" }) : null,
      );
    case "setup":
      return h(
        "section",
        { class: "card talk-setup", "aria-label": c.title, "data-key": "setup" },
        h("div", { class: "talk-setup-head" }, c.title),
        h(
          "div",
          { class: "rows" },
          ...c.rows.map((r) => {
            const lead = g(r.icon, "span", "lead-icon");
            if (r.end.kind === "progress") {
              return h(
                "div",
                { class: "row talk-setup-row talk-dl" },
                lead,
                h("span", { class: "text" }, h("b", null, r.title), h("span", { class: "num" }, r.sub), bar(r.end.fraction, { quiet: true })),
              );
            }
            const end =
              r.end.kind === "allow" ? btn({ label: "Allow", action: r.end.action, aria: `Allow ${r.title}` }) : r.end.kind === "ok" ? h("i", { class: "end talk-ok", "aria-label": "Allowed" }, svg(glyph.check)) : null;
            return h("div", { class: "row talk-setup-row" }, lead, h("span", { class: "text" }, h("b", null, r.title), h("span", null, r.sub)), end);
          }),
        ),
      );
  }
}

function listenCard(n: NowView, retry: string): HTMLElement {
  const err = n.transport === "error";
  const by = err
    ? h("div", { class: "by listen-err" }, g("alert"), h("span", null, n.error ?? "Playback stopped"))
    : h("div", { class: "by" }, n.transport === "loading" ? "Loading" : n.by);
  const progress =
    n.transport === "loading"
      ? h("div", { class: "bar quiet listen-loading", role: "progressbar", "aria-label": "Loading" })
      : bar(n.fraction, { quiet: true, cls: err ? "listen-stale" : "" });
  return h(
    "section",
    { class: `listen${err ? " listen-error" : ""}`, "aria-label": "Now playing", "data-action": "library-open", "data-key": "listen-card" },
    h("div", { class: "now" }, art(n.art, n.source, "art"), h("div", { class: "text" }, h("div", { class: "title" }, n.title), by)),
    progress,
    keys({ skip: n.skip, playing: n.transport === "playing" || n.transport === "loading", error: err ? retry : undefined }),
  );
}

function shelfRows(entries: readonly ShelfEntry[], compact: boolean): HTMLElement[] {
  return entries.map((e) =>
    e.title
      ? row({ compact, lead: { art: e.art, source: e.source }, title: e.title, sub: e.label, end: undefined, action: "shelf-resume", arg: e.source, label: `Resume ${e.label}: ${e.title}`, cls: "shelf-play" })
      : row({ compact, icon: e.icon, title: "Nothing yet", sub: e.label, end: "chevron", action: "shelf-open", arg: e.source, label: `Open ${e.label}` }),
  ).map((el, i) => {
    // The play glyph trails a resumable entry (filled, as the keys).
    const e = entries[i];
    if (e?.title) el.append(h("i", { class: "end" }, svg('<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M8 5.6v12.8a1 1 0 0 0 1.52.85l10.4-6.4a1 1 0 0 0 0-1.7L9.52 4.75A1 1 0 0 0 8 5.6z"/></svg>')));
    return el;
  });
}

// ---- B ------------------------------------------------------------------------------------------
function base(b: BaseView): HTMLElement | null {
  switch (b.kind) {
    case "none":
      return null;
    case "talk-only":
      return h("section", { class: "talk-base", "aria-label": "Talk", "data-key": "talk-base" }, talkBtn(b.talk));
    case "waiting":
      return h("section", { class: "trip dim plan-waiting", "aria-label": "Trip", "data-key": "waiting" }, bar(0), h("span", { class: "eta" }, "Arrive ", h("b", null, "…")), talkBtn(b.talk));
    case "shelf-row":
      return h(
        "section",
        { class: "shelf-row", "aria-label": "Resume", "data-key": "shelf-row" },
        ...b.entries.map((e) =>
          h(
            "button",
            {
              type: "button",
              class: "shelf-item",
              "aria-current": e.source === b.playing ? "true" : undefined,
              "aria-label": e.title ? `Resume ${e.label}: ${e.title}` : `Open ${e.label}`,
              "data-action": e.title ? "shelf-resume" : "shelf-open",
              "data-arg": e.source,
            },
            g(e.icon),
            h("b", null, e.label),
            e.title && e.source !== b.playing ? h("span", null, e.title) : null,
          ),
        ),
        talkBtn(b.talk),
      );
    case "trip": {
      const left =
        "min" in b.left ? h("span", { class: "left num" }, ...timeLeft(b.left.min)) : h("span", { class: "left small" }, b.left.text);
      const eta = b.eta.via !== undefined
        ? h("span", { class: "eta" }, h("span", { class: "drive-via-name" }, b.eta.via), " ", h("b", { class: "num" }, b.eta.time))
        : h("span", { class: "eta" }, b.eta.lead ? `${b.eta.lead} ` : "", h("b", { class: "num" }, b.eta.time));
      return h(
        "section",
        { class: `trip${b.dim ? " dim" : ""}${b.eta.via !== undefined ? " drive-via" : ""}`, "aria-label": "Trip", "data-action": "route-open", "data-key": "trip" },
        left,
        bar(b.fraction, { ticks: b.ticks }),
        eta,
        talkBtn(b.talk),
      );
    }
  }
}

// ---- Sheets -------------------------------------------------------------------------------------
function placeRow(p: PlaceRow): HTMLElement {
  const label = p.address ? `${p.name}, ${p.address}` : p.name;
  return h(
    "div",
    { class: `row plan-place${p.dim ? " dim" : ""}` },
    h(
      "button",
      { type: "button", class: "plan-pick", "aria-label": label, "aria-disabled": p.dim ? "true" : undefined, "data-action": p.dim ? undefined : p.action === "Add" ? "stop-add" : "place-pick", "data-arg": `${p.list}:${p.index}` },
      g(p.icon, "span", "lead-icon"),
      h(
        "span",
        { class: "text" },
        h("b", null, p.name),
        h("span", { class: "plan-sub" }, p.meta ? h("em", { class: "num" }, p.meta) : null, p.address ? h("span", null, p.address) : null),
      ),
    ),
    p.saved
      ? h("span", { class: "plan-done" }, g("check"), h("span", null, "Saved"))
      : p.action
        ? btn({ label: p.action, kind: "quiet", action: p.action === "Add" ? "stop-add" : "place-save", arg: `${p.list}:${p.index}`, aria: `${p.action} ${p.name}` })
        : null,
  );
}

function sectionList(sections: { head?: string; id?: string; rows: Child[]; empty?: string }[]): HTMLElement {
  const kids: Child[] = [];
  for (const s of sections) {
    if (s.head) kids.push(listHead(s.head, s.id));
    if (s.rows.length) kids.push(...s.rows);
    else if (s.empty) kids.push(h("p", { class: "plan-empty" }, s.empty));
  }
  return h("div", { class: "list plan-list" }, ...kids);
}

interface SheetCtx {
  talk: TalkView;
  onRoute: boolean;
}

function renderSheet(sv: SheetView, ctx: SheetCtx): HTMLElement {
  switch (sv.kind) {
    case "where": {
      const f = field({ placeholder: "Where to?", value: sv.query, field: "where", cls: "plan-field", talk: sv.full ? ctx.talk : undefined, autofocus: sv.typing });
      let body: HTMLElement;
      const withSaving = (r: PlaceRow): HTMLElement =>
        sv.saving && sv.saving.list === r.list && sv.saving.index === r.index
          ? h(
              "div",
              { class: "plan-saving", "aria-current": "true" },
              placeRow({ ...r, action: undefined }),
              h(
                "div",
                { class: "plan-save-form" },
                field({ placeholder: "Name this place", value: sv.saving.name, field: "save-name", cls: "plan-field plan-name", glyphName: null }),
                h("div", { class: "btn-row plan-actions" }, btn({ label: "Cancel", kind: "quiet", action: "save-cancel" }), btn({ label: "Save", kind: "primary", action: "save-confirm" })),
              ),
            )
          : placeRow(r);
      const places = [
        { head: "Saved places", rows: sv.saved.map(placeRow), empty: "Save a place from search to see it here." },
        ...(sv.recent.length ? [{ head: "Recent destinations", id: "recent", rows: sv.recent.map(withSaving) }] : []),
      ];
      if (sv.body === "none") body = h("div", { class: "plan-body" }, note("search", "No places found", "Check the spelling, or search for a nearby town."));
      else if (sv.body === "offline") body = sectionList([{ rows: [note("nosignal", "Search needs signal", "Routes start when signal returns.")] }, ...places]);
      else if (sv.body === "results" || sv.body === "loading") body = sectionList([{ rows: sv.results.map(withSaving) }]);
 else body = sectionList(places);
      return sheet({ label: "Where to", key: "where", head: [f], body: [body], full: sv.full });
    }
    case "preview":
      return sheet({
        label: "Route preview",
        key: "preview",
        back: { action: "preview-back" },
        hug: true,
        head: [sheetTitle(sv.title, true)],
        body: [
          h(
            "div",
            { class: "plan-body plan-preview" },
            sv.address ? h("div", { class: "plan-where" }, sv.address) : null,
            h("div", { class: "plan-time num" }, ...timeLeft(sv.min)),
            h("div", { class: "plan-facts" }, h("span", null, h("b", { class: "num" }, sv.km)), h("span", null, "Arrive ", h("b", { class: "num" }, sv.arrive))),
          ),
        ],
        foot: [btn({ label: "Start", kind: "primary", action: "preview-start", style: "width:100%" })],
      });
    case "route": {
      const rows: Child[] = [
        ...sv.stops.map((st) =>
          h(
            "div",
            { class: "row plan-stop" },
            g("pin", "span", "lead-icon"),
            h("span", { class: "text" }, h("b", null, st.name), h("span", { class: "plan-sub" }, st.at ? h("em", { class: "num" }, st.at) : null, st.address ? h("span", null, st.address) : null)),
            sv.edit ? btn({ label: "Remove", kind: "quiet", action: "stop-remove", arg: st.index, aria: `Remove ${st.name}` }) : null,
          ),
        ),
        h(
          "div",
          { class: "row plan-stop end" },
          g("flag", "span", "lead-icon"),
          h("span", { class: "text" }, h("b", null, sv.dest.name), h("span", { class: "plan-sub" }, h("em", { class: "num" }, sv.dest.at))),
        ),
      ];
      const foot: Child[] = sv.confirm
        ? [
            h("p", { class: "plan-ask" }, sv.confirm),
            h("div", { class: "btn-row plan-actions" }, btn({ label: "Keep route", kind: "quiet", action: "end-keep" }), btn({ label: "End route", kind: "primary", action: "end-confirm" })),
          ]
        : [
            h(
              "div",
              { class: "btn-row" },
              btn({ label: "Add stop", icon: "plus", action: "add-stop-open" }),
              sv.edit ? null : btn({ label: "End route", action: "end-ask" }),
            ),
          ];
      return sheet({
        label: "Route",
        key: "route",
        head: [sheetTitle(sv.title, true), sv.stops.length ? btn({ label: sv.edit ? "Done" : "Edit", kind: "quiet", action: "route-edit" }) : null],
        body: [sectionList([{ rows }])],
        foot,
      });
    }
    case "add-stop": {
      const head: Child[] = [];
      if (sv.compact) {
        head.push(h("div", { class: "plan-compact", "aria-label": "Next turn" }, ic(sv.compact.icon), h("b", { class: "num" }, sv.compact.dist), h("span", null, sv.compact.road)));
      }
      head.push(field({ placeholder: "Add a stop", value: sv.query, field: "add-stop", cls: "plan-field", talk: sv.full ? ctx.talk : undefined, autofocus: sv.typing }));
      let body: HTMLElement;
      if (sv.body === "kinds") {
        body = sectionList([
          {
            head: "On the way",
            rows: STOP_KINDS.map((k) => row({ icon: k.id, title: k.label, end: "chevron", action: "stop-kind", arg: k.query, label: `Find ${k.label} on the way` })),
          },
        ]);
      } else if (sv.body === "none") body = h("div", { class: "plan-body" }, note("search", "No places found", "Check the spelling, or try Fuel, Food or Rest area."));
      else if (sv.body === "offline") body = h("div", { class: "plan-body" }, note("nosignal", "Search needs signal", "Your Route continues from the saved copy."));
      else body = sectionList([{ rows: sv.results.map(placeRow) }]);
      return sheet({ label: "Add a stop", key: "add-stop", back: sv.full ? undefined : { action: "add-stop-back" }, head, body: [body], full: sv.full });
    }
    case "library":
      return library(sv);
    case "settings":
      return sheet({
        label: "Settings",
        key: "settings",
        head: [sheetTitle("Settings")],
        body: [
          h(
            "div",
            { class: "list talk-list" },
            setRow({ icon: "bubble", title: "Co-driver", sub: sv.coDriver, action: "codriver-open" }),
            setRow({ icon: "sound", title: "Sound mode", sub: sv.soundMode, action: "sound-mode-open" }),
            setSwitch({ icon: "wake", title: "Hey Vela", sub: sv.wakeSub, on: sv.wake, action: "wake-toggle" }),
            setSwitch({ icon: "screens", title: "Moments", sub: "Screens from your co-driver", on: sv.moments, action: "moments-toggle" }),
            h(
              "div",
              { class: "row talk-row" },
              g("bell", "span", "lead-icon"),
              h("span", { class: "text" }, h("b", null, "Turn sound")),
              btn({ label: "Test", kind: "quiet", icon: "sound", action: "test-sound", aria: "Test the Turn sound" }),
            ),
            h(
              "div",
              { class: "talk-segrow" },
              h("div", { class: "talk-seghead" }, g("contrast", "span", "lead-icon"), h("div", { class: "text" }, h("b", null, "Daylight contrast"))),
              seg(
                [
                  { id: "auto", label: "Automatic" },
                  { id: "on", label: "On" },
                  { id: "off", label: "Off" },
                ],
                sv.daylight,
                "daylight",
                "talk-seg",
                true,
              ),
            ),
            setRow({ icon: "download", title: "Downloads", sub: sv.downloads, action: "downloads-open" }),
            setSwitch({ icon: "wifi", title: "Wi-Fi only", sub: "Download only on Wi-Fi", on: sv.wifiOnly, action: "wifi-only" }),
            setRow({ icon: "trip", title: "Trips", sub: sv.trips, action: "trips-open" }),
            ...carRows(sv.car),
            versionRow(sv.version, sv.update),
          ),
        ],
      });
    case "co-driver":
      return sheet({
        label: "Co-driver",
        key: "co-driver",
        back: { action: "sheet-back" },
        head: [sheetTitle("Co-driver")],
        body: [
          h(
            "div",
            { class: "list" },
            ...sv.rows.map((r) =>
              row({ icon: r.icon, title: r.title, sub: r.sub, current: r.current, end: r.current ? "check" : undefined, action: "codriver-choose", arg: r.id }),
            ),
          ),
        ],
      });
    case "sound-mode":
      return sheet({
        label: "Sound mode",
        key: "sound-mode",
        back: { action: "sheet-back" },
        head: [sheetTitle("Sound mode")],
        body: [
          h(
            "div",
            { class: "talk-pad" },
            seg(
              [
                { id: "sounds", label: "Sounds only" },
                { id: "co-driver", label: "Co-driver" },
              ],
              sv.mode,
              "sound-mode",
              "talk-seg",
              true,
            ),
            h("p", { class: "talk-note" }, sv.note),
          ),
        ],
      });
    case "trips":
      return sheet({
        label: "Trips",
        key: "trips",
        back: { action: "sheet-back" },
        head: [sheetTitle("Trips")],
        body: [
          h(
            "div",
            { class: "talk-pad talk-trips" },
            h(
              "div",
              { class: "talk-block" },
              h("b", null, "Recorded while you drive"),
              h("span", null, "Every drive, with or without a Route."),
              h("span", { class: "meta num" }, sv.waiting),
            ),
            sv.error ? h("p", { class: "talk-err" }, g("alert"), h("span", null, sv.error)) : null,
            sv.queued ? h("div", { class: "btn-row" }, btn({ label: "Send now", icon: "retry", action: "trips-send" })) : null,
          ),
        ],
      });
  }
}

/**
 * "Vela <version>" and its update action. The action keeps one slot, 56 tall, in every state, so
 * the row does not jump: a quiet button to check, the status while checking or after a check found
 * nothing, and a secondary button once an update is ready.
 */
function versionRow(version: string | undefined, update: SettingsUpdate): HTMLElement {
  const name = version ? `Vela ${version}` : "Vela";
  const end =
    update === "ready"
      ? btn({ label: "Update ready, restart", icon: "retry", action: "update-check", cls: "talk-act" })
      : update === "check"
        ? btn({ label: "Check for updates", icon: "retry", kind: "quiet", action: "update-check", cls: "talk-act" })
        : h(
            "span",
            { class: "talk-act talk-status", role: "status" },
            g(update === "current" ? "check" : "retry"),
            h("span", null, update === "current" ? "Up to date" : "Checking for updates"),
          );
  return h(
    "div",
    { class: "row talk-row talk-version", "aria-busy": update === "checking" ? "true" : undefined },
    g("vela", "span", "lead-icon"),
    h("span", { class: "text" }, h("b", { class: "num" }, name)),
    end,
  );
}

/** The car: its link (with Connect while it can), then the readings while connected (ADR 0012). */
function carRows(c: CarView): HTMLElement[] {
  // Reconnecting is Vela's own retry: it shows here only, calmly; the chip is for a needed tap.
  const sub =
    c.state === "connected" ? "Connected" : c.state === "connecting" ? "Connecting" : c.state === "reconnecting" ? "Reconnecting" : c.state === "connect" ? "Not connected" : "Needs Chrome with Bluetooth";
  const link = h(
    "div",
    { class: "row talk-row talk-car", role: c.state === "connecting" || c.state === "reconnecting" ? "status" : undefined },
    g("car", "span", "lead-icon"),
    h("span", { class: "text" }, h("b", null, "Car"), h("span", null, sub)),
    c.state === "connect" ? btn({ label: "Connect", kind: "quiet", action: "car-connect", aria: "Connect the car" }) : null,
  );
  const reading = (r: CarView["rows"][number]) =>
    h("div", { class: "row talk-row talk-reading" }, g(r.icon, "span", "lead-icon"), h("span", { class: "text" }, h("b", null, r.title)), h("span", { class: `meta num${r.value === undefined ? " talk-none" : ""}` }, r.value ?? "No reading"));
  const e = c.engine;
  const engine = e
    ? h(
        "div",
        { class: `row talk-row talk-reading${e.on ? " talk-engine-on" : ""}` },
        g("engine", "span", "lead-icon"),
        h("span", { class: "text" }, h("b", null, "Check engine"), h("span", null, e.codes.length ? e.codes.join(", ") : "No fault codes")),
        h("span", { class: `meta${e.on === undefined ? " talk-none" : ""}` }, e.on === undefined ? "No reading" : e.on ? "On" : "Off"),
      )
    : null;
  return [link, ...c.rows.map(reading), ...(engine ? [engine] : [])];
}

function setRow(o: { icon: Parameters<typeof g>[0]; title: string; sub?: string; action: string }): HTMLElement {
  return h(
    "button",
    { type: "button", class: "row talk-row", "data-action": o.action },
    g(o.icon, "span", "lead-icon"),
    h("span", { class: "text" }, h("b", null, o.title), o.sub ? h("span", null, o.sub) : null),
    g("chevron", "i", "end"),
  );
}

function setSwitch(o: { icon: Parameters<typeof g>[0]; title: string; sub?: string; on: boolean; action: string }): HTMLElement {
  return h(
    "div",
    { class: "row talk-row" },
    g(o.icon, "span", "lead-icon"),
    h("span", { class: "text" }, h("b", null, o.title), o.sub ? h("span", null, o.sub) : null),
    switchEl(o.on, o.title, { action: o.action }),
  );
}

function downloadRows(d: DownloadsView): HTMLElement[] {
  const lead = () => g("download", "span", "lead-icon");
  switch (d.kind) {
    case "wait":
      return [
        h("div", { class: "row listen-dl", role: "status" }, lead(), h("span", { class: "text" }, h("b", null, "Downloads wait for Wi-Fi"), h("span", null, `${d.waiting} to download`))),
        h(
          "div",
          { class: "row listen-dl" },
          h("span", { class: "lead-icon" }),
          h("span", { class: "text" }, h("b", null, "On Wi-Fi now"), h("span", null, "Download on this connection")),
          switchEl(d.manualWifi, "On Wi-Fi now", { action: "wifi-now" }),
        ),
      ];
    case "running":
      return [
        h(
          "div",
          { class: "row listen-dl", role: "status" },
          lead(),
          h("span", { class: "text" }, h("b", null, `Downloading ${d.done} of ${d.total}`), h("span", { class: "listen-dl-bar" }, bar(d.total ? d.done / d.total : 0, { quiet: true }))),
        ),
      ];
    case "saved":
      return [h("div", { class: "row listen-dl", role: "status" }, lead(), h("span", { class: "text" }, h("b", null, `${d.saved} saved for offline`)))];
    case "checking":
      return [h("div", { class: "row listen-dl", role: "status" }, lead(), h("span", { class: "text" }, h("b", null, "Checking for downloads")))];
  }
}

function library(sv: Extract<SheetView, { kind: "library" }>): HTMLElement {
  const f = sv.offline
    ? h("div", { class: "field listen-field-off", "aria-disabled": "true" }, g("nosignal"), h("span", null, "Search needs signal"))
    : field({ placeholder: sv.placeholder, value: sv.query, field: "library" });
  let list: HTMLElement;
  if (sv.body === "empty" && sv.searching) {
    list = h("div", { class: "listen-empty" }, h("div", { class: "listen-note", role: "status" }, g("search"), h("div", null, h("b", null, "No results"), h("span", null, "Check the spelling, or try the show's name."))));
  } else if (sv.body === "error") {
    list = h("div", { class: "listen-empty" }, h("div", { class: "listen-note", role: "status" }, g("alert"), h("div", null, h("b", null, "Can't load this library"), h("span", null, sv.error ?? ""))));
  } else {
    list = h(
      "div",
      { class: "list" },
      sv.head ? listHead(sv.head) : null,
      ...sv.rows.map((r) =>
        row({
          lead: { art: r.art, source: r.source },
          title: r.title,
          sub: r.sub,
          meta: r.meta,
          mark: r.downloaded ? "download" : undefined,
          current: r.current,
          dim: r.dim,
          action: "lib-play",
          arg: r.index,
          label: `${r.title}, ${r.sub}`,
        }),
      ),
      ...(sv.downloads ? downloadRows(sv.downloads) : []),
    );
  }
  return sheet({
    label: "Library",
    key: "library",
    back: sv.searching ? { action: "lib-search-back" } : undefined,
    head: [seg(SOURCES.map((s) => ({ id: s.id, label: s.label, icon: s.icon })), sv.source, "lib-source")],
    body: [f, list],
  });
}

/** The parts one by one, for the Moment renderer (src/ui/moment), which composes them itself. */
export { answer as renderAnswer, base as renderBase, card as renderCard, listenCard as renderListenCard, renderSheet, stage as renderStage, top as renderTop };
