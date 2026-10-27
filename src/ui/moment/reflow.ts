/**
 * Measured adaptations of a free Moment, after fit(): Signal's ladder before anything is refused.
 * Space yields first (gaps and card padding to their minimum), then text steps down once (the lead
 * figure .85x, the road tier .85x), then Optional blocks drop, last first. Sequence labels are
 * placed along their line, and the ones that do not fit are counted in "N more".
 */

const rect = (el: Element): DOMRect => el.getBoundingClientRect();

const bodyOf = (app: HTMLElement): HTMLElement | undefined => [...app.children].find((c) => c.classList.contains("m-body")) as HTMLElement | undefined;

/** Records the steps on the frame as data-reflow. Returns whether anything changed. */
export function reflow(app: HTMLElement): boolean {
  const body = bodyOf(app);
  delete app.dataset.yield;
  delete app.dataset.reflow;
  if (!body) return false;
  for (const el of body.querySelectorAll("[data-dropped]")) el.removeAttribute("data-dropped");
  const bigs = [...body.querySelectorAll<HTMLElement>(".m-big")];
  for (const b of bigs) b.classList.remove("step");
  // The lead figure never wraps or ellipsizes: when it is wider than its block, it steps down once.
  for (const b of bigs) {
    const box = b.closest(".m-lead");
    if (box && rect(b).right > rect(box).right + 0.5) b.classList.add("step");
  }
  sequences(body);
  const over = () => body.scrollHeight > body.clientHeight + 1;
  const steps: string[] = [];
  if (over()) {
    app.dataset.yield = "space";
    steps.push("space");
    sequences(body);
  }
  if (over()) {
    app.dataset.yield = "space text";
    for (const b of bigs) b.classList.add("step");
    steps.push("text");
    sequences(body);
  }
  for (const o of [...body.querySelectorAll("[data-yields]")].reverse()) {
    if (!over()) break;
    o.setAttribute("data-dropped", "");
    steps.push("drop");
  }
  if (steps.length) app.dataset.reflow = steps.join(" ");
  return steps.length > 0;
}

/**
 * Sequence labels: each at its place on the line, never over the one before; a label that would
 * leave the line, and every one after it, is counted in "N more" (the Route sheet has them all).
 */
/** The narrowest a stretch's label gets: about 7 characters, then its ellipsis. */
const LABEL_MIN = 96;

export function sequences(root: HTMLElement): void {
  for (const seq of root.querySelectorAll<HTMLElement>(".m-seq")) {
    const box = seq.querySelector<HTMLElement>(".m-seq-labels");
    if (!box) continue;
    const items = [...box.querySelectorAll<HTMLElement>(".m-seq-item")];
    const more = box.querySelector<HTMLElement>(".m-seq-more");
    const w = box.clientWidth;
    for (const it of items) {
      // A stretch's label keeps to its own stretch (at least LABEL_MIN), so a long name for the
      // weather here never pushes the weather ahead off the line; the full name ellipsizes.
      const to = it.dataset.to;
      it.style.maxWidth = to === undefined ? "" : `${Math.max(LABEL_MIN, (Number(to) - Number(it.dataset.at ?? 0)) * w - SEQ_GAP)}px`;
    }
    // When not every label fits, the plain ones ahead (clear weather) give way first: the marked
    // stretches are the news. The track still draws every stretch.
    if (place(items, more, w) < items.length) {
      const plain = items.filter((it) => it.matches(".plain") && it.getAttribute("aria-current") !== "true");
      if (plain.length) place(items.filter((it) => !plain.includes(it)), more, w, items.length);
    }
  }
}

const SEQ_GAP = 16;

/**
 * Place `shown` labels left to right, each at its place and never over the one before; hide the
 * rest from the first that would leave the line, with room for "N more". Returns how many show.
 */
function place(shown: HTMLElement[], more: HTMLElement | null, w: number, total = shown.length): number {
  const all = shown[0]?.parentElement ? [...shown[0].parentElement.querySelectorAll<HTMLElement>(".m-seq-item")] : shown;
  for (const it of all) {
    it.hidden = !shown.includes(it);
    it.style.left = "0px";
  }
  if (more) more.hidden = true;
  let right = -SEQ_GAP;
  let hiddenFrom = shown.length;
  for (const [i, it] of shown.entries()) {
    const width = it.offsetWidth;
    const at = Number(it.dataset.at ?? 0);
    // A point at the very end (the destination) ends at the line's end; anything else starts at its place.
    const left = Math.max(at * w - (at >= 1 ? width : 0), right + SEQ_GAP);
    if (left + width > w + 0.5) {
      if (i === shown.length - 1 && w - width >= right + SEQ_GAP) {
        it.style.left = `${w - width}px`;
        right = w;
        continue;
      }
      hiddenFrom = i;
      break;
    }
    it.style.left = `${left}px`;
    right = left + width;
  }
  for (const it of shown.slice(hiddenFrom)) it.hidden = true;
  const hidden = () => total - hiddenFrom;
  if (more && hidden() > 0) {
    more.textContent = `${hidden()} more`;
    more.hidden = false;
    let left = right + SEQ_GAP;
    while (left + more.offsetWidth > w && hiddenFrom > 0) {
      hiddenFrom--;
      const it = shown[hiddenFrom];
      if (it) it.hidden = true;
      more.textContent = `${hidden()} more`;
      const prev = shown[hiddenFrom - 1];
      left = prev ? Number.parseFloat(prev.style.left) + prev.offsetWidth + SEQ_GAP : 0;
    }
    more.style.left = `${left}px`;
  }
  return hiddenFrom;
}

// ---- The word budget ---------------------------------------------------------------------------

const UNITS = /^(m|km|min|h|s|am|pm|km\/h|%|°c|v|of)$/i;

/**
 * The share of an element's text that is drawn: text cut by an ellipsis or a line clamp shows only
 * part of its words. 1 without layout (tests).
 */
function shown(el: HTMLElement): number {
  let box: HTMLElement | null = el;
  for (let i = 0; box && i < 3; i++, box = box.parentElement) {
    const cs = getComputedStyle(box);
    if (cs.textOverflow === "ellipsis" && box.scrollWidth > box.clientWidth + 1) return box.clientWidth / box.scrollWidth;
    if (cs.webkitLineClamp !== "none" && cs.webkitLineClamp !== "" && box.scrollHeight > box.clientHeight + 1) return box.clientHeight / box.scrollHeight;
  }
  return 1;
}

/**
 * Words on a free Moment outside the Lead, the base row and open Details, as drawn: a bound value
 * with its unit is one word; a number and the unit after it are one word; hidden and dropped parts
 * do not count, and text cut by an ellipsis counts only its drawn share.
 */
export function countWords(app: HTMLElement): number {
  const body = bodyOf(app);
  if (!body) return 0;
  const skip = (el: Element | null): boolean => !!el?.closest(".m-lead, .m-details-body, [hidden], [data-dropped], [aria-hidden='true'], svg");
  let n = 0;
  for (const b of body.querySelectorAll("[data-bound]")) if (!skip(b) && !b.parentElement?.closest("[data-bound]")) n++;
  const tokens: string[] = [];
  // A plain walk (not a TreeWalker): the test DOM's TreeWalker skips text nodes.
  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const el = node.parentElement;
      if (el && !skip(el) && !el.closest("[data-bound]")) {
        const all = (node.textContent ?? "").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
        tokens.push(...all.slice(0, Math.max(1, Math.ceil(all.length * shown(el)))));
      }
      return;
    }
    for (const c of node.childNodes) visit(c);
  };
  visit(body);
  for (let i = 0; i < tokens.length; i++) {
    n++;
    if (/\d/.test(tokens[i] ?? "") && UNITS.test(tokens[i + 1] ?? "")) i++;
  }
  return n;
}
