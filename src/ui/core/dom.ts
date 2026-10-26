/**
 * A small element builder. Data always goes in as text (textContent); only the static icon
 * strings from icons.ts go in as markup.
 */
export type Child = Node | string | false | null | undefined;
export type Attrs = Record<string, string | number | boolean | undefined | null | EventListener>;

/** Events are attached with `on<name>` keys: `{ onclick: () => … }`. */
export function h(tag: string, attrs: Attrs | null = null, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith("on") && typeof v === "function") {
        el.addEventListener(k.slice(2), v);
        continue;
      }
      if (k === "class") el.className = String(v);
      else if (k === "style") el.setAttribute("style", String(v));
      else el.setAttribute(k, v === true ? "" : String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el: Element, children: readonly Child[]): void {
  for (const c of children) {
    if (c === false || c === null || c === undefined || c === "") continue;
    el.append(typeof c === "string" ? document.createTextNode(c) : c);
  }
}

/** An icon wrapper: `<i>` (or another tag) holding a static SVG string. */
export function icon(svg: string, tag = "i", cls?: string): HTMLElement {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  el.innerHTML = svg;
  return el;
}

/** Parse one static SVG string into its element. */
export function svg(markup: string): Element {
  const t = document.createElement("template");
  t.innerHTML = markup;
  return t.content.firstElementChild ?? document.createElement("span");
}
