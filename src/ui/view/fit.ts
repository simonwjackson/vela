/**
 * Measured adaptations: decisions from the space each part actually got, never from the device.
 * Ported from the Signal mockup's index.html fit(), peek.js and talk/components.js. Run after
 * every render and on every resize.
 */

/** A trip bar shorter than this takes its own line. */
export const MIN_TRIP_BAR = 120;
/** A cut-off row must show at least this share of itself. */
export const PEEK_MIN = 0.4;

const rect = (el: Element): DOMRect => el.getBoundingClientRect();

export function fit(app: HTMLElement): void {
  // The hero never wraps or ellipsizes: when it is wider than its answer, step down once (.85x).
  for (const big of app.querySelectorAll<HTMLElement>(".answer .big")) {
    big.classList.remove("step");
    const box = big.closest(".answer");
    if (box && rect(big).right > rect(box).right + 0.5) big.classList.add("step");
  }
  // Trip row: when the bar would be under 120 px, it takes its own line above the figures.
  for (const trip of app.querySelectorAll(".trip")) {
    trip.removeAttribute("data-stack");
    const bar = trip.querySelector(".bar");
    if (bar && rect(bar).width < MIN_TRIP_BAR) trip.setAttribute("data-stack", "");
  }
  // A status chip whose text would ellipsize shows its glyph only: "No sig…" says nothing.
  for (const c of app.querySelectorAll(".chip:not(.toast)")) {
    c.removeAttribute("data-short");
    const t = c.querySelector<HTMLElement>(":scope > span");
    if (c.querySelector("i") && t && t.scrollWidth > t.clientWidth + 0.5) c.setAttribute("data-short", "");
  }
  // A full-form listening card that pushes the answer into the top row goes back to inline keys.
  const listen = app.querySelector(".listen:not(.shelf)");
  const top = app.querySelector(".top");
  const answer = app.querySelector(".answer, .stage, .shelf.large");
  if (listen) {
    listen.removeAttribute("data-compact");
    const m = Number.parseFloat(getComputedStyle(app).getPropertyValue("--m")) || 24;
    if (top && answer && rect(answer).top < rect(top).bottom + m * 0.75) listen.setAttribute("data-compact", "");
  }
  // Cards with optional rows (the Where to card) drop them, last first, while the frame overflows.
  const optional = [...app.querySelectorAll("[data-optional]")].reverse();
  for (const el of optional) {
    if (!overflows(app)) break;
    el.remove();
  }
  // Lists that hold more rows than their box become scroll regions.
  for (const l of app.querySelectorAll<HTMLElement>(".list")) {
    const scrolls = l.scrollHeight > l.clientHeight + 1;
    l.toggleAttribute("data-scroll", scrolls);
    if (scrolls) l.toggleAttribute("data-end", l.scrollTop + l.clientHeight >= l.scrollHeight - 1);
    else l.removeAttribute("data-end");
  }
  // Co-driver text: the live transcript keeps its newest words; a spoken answer is paged.
  for (const el of app.querySelectorAll<HTMLElement>(".talk-keep")) keepNewest(el, 3);
  for (const card of app.querySelectorAll<HTMLElement>(".talk-card")) {
    const el = card.querySelector<HTMLElement>(".talk-paged");
    if (el) showPage(card, Number(el.dataset.at ?? 0));
  }
  peek(app);
}

/** The frame scrolls, or two of its parts overlap. */
export function overflows(app: HTMLElement): boolean {
  if (app.scrollHeight > app.clientHeight + 1) return true;
  const parts = [...app.children].filter((c) => getComputedStyle(c).position !== "absolute" && !c.matches(".sheet, .plan-kb"));
  return parts.some((a, i) =>
    parts.slice(i + 1).some((b) => {
      const x = rect(a);
      const y = rect(b);
      return x.left < y.right - 1 && y.left < x.right - 1 && x.top < y.bottom - 1 && y.top < x.bottom - 1;
    }),
  );
}

/**
 * A scrolling sheet list always shows part of a row at its bottom edge. When the cut falls between
 * rows, or shows under 40% of a row, the list gets shorter so the cut lands mid-row. Col flow: the
 * sheet's top moves down; row flow: the list gives up height below itself.
 */
export function peek(app: HTMLElement): void {
  const col = app.dataset.flow === "col";
  for (const sheet of app.querySelectorAll<HTMLElement>(".sheet")) sheet.style.marginTop = "";
  for (const l of app.querySelectorAll<HTMLElement>(".sheet .list[data-scroll]")) {
    l.style.marginBottom = "";
    const bottom = rect(l).bottom;
    const rows = [...l.children].filter((c) => !c.matches(".list-head"));
    const i = rows.findIndex((r) => rect(r).bottom > bottom - 1);
    if (i < 0) continue;
    const cut = rows[i];
    if (!cut) continue;
    let r = rect(cut);
    if (bottom - r.top >= r.height * PEEK_MIN) continue;
    const before = rows[i - 1];
    // A row opened to name it keeps its Save in view: the cut never moves into it.
    if (before?.matches(".plan-saving")) continue;
    if (i > 0 && before) r = rect(before);
    const give = Math.round(bottom - (r.top + r.height * 0.5));
    if (give <= 0) continue;
    const sheet = l.closest<HTMLElement>(".sheet");
    if (col && sheet && !sheet.matches(".plan-hug, .plan-full")) {
      sheet.style.marginTop = `${Number.parseFloat(getComputedStyle(sheet).marginTop) + give}px`;
    } else l.style.marginBottom = `${give}px`;
  }
}

/**
 * The live transcript keeps its newest words: drop words from the start until the text fits
 * `lines` lines, and mark the cut with a leading ellipsis.
 */
export function keepNewest(el: HTMLElement, lines = 3): void {
  const full = el.dataset.full ?? el.textContent ?? "";
  el.textContent = full;
  const lh = Number.parseFloat(getComputedStyle(el).lineHeight);
  if (!lh) return;
  const fits = () => el.scrollHeight <= lh * lines + 1;
  if (fits()) return;
  const words = full.split(/\s+/);
  let i = 1;
  for (; i < words.length; i++) {
    el.textContent = `…${words.slice(i).join(" ")}`;
    if (fits()) break;
  }
  el.dataset.cut = String(i);
}

/**
 * Pages of a long answer, measured on the real card: each fills up to `lines` lines. A page holds
 * whole sentences while they fit; a longer sentence breaks between words and ends with "…".
 */
export function pageFit(el: HTMLElement, lines = 4): string[] {
  const full = el.dataset.full ?? el.textContent ?? "";
  el.style.display = "block";
  el.style.setProperty("-webkit-line-clamp", "none");
  const lh = Number.parseFloat(getComputedStyle(el).lineHeight);
  const fits = (t: string) => {
    el.textContent = t;
    return !lh || el.scrollHeight <= lh * lines + 1;
  };
  const sentences = full.match(/[^.?!]+[.?!]+(\s+|$)|[^.?!]+$/g)?.map((x) => x.trim()) ?? [full];
  const out: string[] = [];
  let page = "";
  for (let i = 0; i < sentences.length; i++) {
    const sn = sentences[i] ?? "";
    if (!sn) continue;
    const tryText = page ? `${page} ${sn}` : sn;
    if (fits(tryText)) {
      page = tryText;
      continue;
    }
    if (page) {
      out.push(page);
      page = "";
      i--;
      continue;
    }
    const words = sn.split(/\s+/);
    let n = 1;
    while (n < words.length && fits(`${words.slice(0, n + 1).join(" ").replace(/[,;:]$/, "")}…`)) n++;
    out.push(`${words.slice(0, n).join(" ").replace(/[,;:]$/, "")}…`);
    sentences[i] = words.slice(n).join(" ");
    i--;
  }
  if (page) out.push(page);
  el.style.display = "";
  el.style.removeProperty("-webkit-line-clamp");
  return out.length ? out : [full];
}

/** Show the page the co-driver is speaking; `at` (0..1) is the share said, in characters. */
export function showPage(card: HTMLElement, at: number): void {
  const el = card.querySelector<HTMLElement>(".talk-paged");
  if (!el) return;
  const all = pageFit(el);
  const len = (t: string) => t.replace(/…$/, "").length;
  const total = all.reduce((n, t) => n + len(t), 0);
  let i = 0;
  for (let done = 0; i < all.length - 1 && done + len(all[i] ?? "") < at * total; i++) done += len(all[i] ?? "");
  el.textContent = all[i] ?? "";
  el.dataset.pages = `${i + 1} of ${all.length}`;
  const prog = card.querySelector<HTMLElement>(".talk-progress");
  if (!prog) return;
  prog.hidden = all.length < 2;
  const fill = prog.querySelector<HTMLElement>(".bar i");
  if (fill) fill.style.width = `${at * 100}%`;
  prog.setAttribute("aria-valuenow", String(Math.round(at * 100)));
}
