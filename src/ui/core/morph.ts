/**
 * Patch the live DOM to match a freshly built tree, in place. Nodes that keep their tag (and
 * their `data-key`, when set) are kept, so focus, the caret, scroll positions and running CSS
 * animations survive a GPS fix, a resize or a fold. Events are delegated (see app/render.ts), so
 * no listener lives on a patched node.
 */

/** Attributes the measured adaptations (fit.ts) own; patching leaves them alone. */
const FIT_OWNED = new Set(["data-stack", "data-short", "data-compact", "data-scroll", "data-end", "data-cut", "data-pages"]);
/** Elements whose children fit.ts rewrites (paged and trimmed co-driver text). */
const FIT_TEXT = "[data-full]";

function same(a: Node, b: Node): boolean {
  if (a.nodeType !== b.nodeType) return false;
  if (a.nodeType !== Node.ELEMENT_NODE) return true;
  const x = a as Element;
  const y = b as Element;
  return x.tagName === y.tagName && x.getAttribute("data-key") === y.getAttribute("data-key");
}

function patchAttrs(live: Element, next: Element): void {
  for (const { name } of [...live.attributes]) {
    if (!next.hasAttribute(name) && !FIT_OWNED.has(name) && !(name === "class" && next.hasAttribute("class"))) live.removeAttribute(name);
  }
  for (const { name, value } of [...next.attributes]) {
    if (name === "class") {
      // fit.ts owns the `step` class on the hero.
      const keep = live.classList.contains("step") ? " step" : "";
      if (live.getAttribute("class") !== value + keep) live.setAttribute("class", value + keep);
      continue;
    }
    if (live.getAttribute(name) !== value) live.setAttribute(name, value);
  }
}

export function morph(live: Element, next: Element): void {
  patchAttrs(live, next);
  if (live instanceof HTMLInputElement && next instanceof HTMLInputElement) {
    // The driver's typing wins over the model while the field has focus.
    if (live.ownerDocument.activeElement !== live && live.value !== next.value) live.value = next.value;
    return;
  }
  if (live.matches(FIT_TEXT) && live.getAttribute("data-full") === next.getAttribute("data-full")) return;
  morphChildren(live, next);
}

const keyOf = (n: Node): string | null => (n.nodeType === Node.ELEMENT_NODE ? (n as Element).getAttribute("data-key") : null);

export function morphChildren(live: Element, next: Element): void {
  const want = [...next.childNodes];
  const wanted = new Set(want.map(keyOf).filter((k): k is string => k !== null));
  let i = 0;
  for (; i < want.length; i++) {
    const n = want[i] as Node;
    const key = keyOf(n);
    // A keyed node that moved (a sheet that went full screen) is found and moved, not rebuilt.
    if (key !== null && keyOf(live.childNodes[i] ?? n) !== key) {
      const found = [...live.children].slice(i).find((c) => c.getAttribute("data-key") === key && c.tagName === (n as Element).tagName);
      if (found) live.insertBefore(found, live.childNodes[i] ?? null);
    }
    const cur = live.childNodes[i];
    if (!cur) {
      live.append(n);
      continue;
    }
    if (!same(cur, n)) {
      // A keyed live node that is wanted further on stays: the new node goes in before it.
      const curKey = keyOf(cur);
      if (curKey !== null && wanted.has(curKey)) live.insertBefore(n, cur);
      else live.replaceChild(n, cur);
      continue;
    }
    if (cur.nodeType === Node.ELEMENT_NODE) morph(cur as Element, n as Element);
    else if (cur.nodeValue !== n.nodeValue) cur.nodeValue = n.nodeValue;
  }
  while (live.childNodes.length > want.length) live.lastChild?.remove();
}
