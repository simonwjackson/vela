/**
 * An evaluated Moment program as plain data, and walking it. No lang-core here: the renderer and
 * the mount use this in the main bundle; program.ts (lang-core) loads lazily.
 */

/** A part of an evaluated program: its component, props and the statement it was written in. */
export interface Part {
  readonly type: "element";
  readonly typeName: string;
  readonly props: Readonly<Record<string, unknown>>;
  readonly statementId?: string | undefined;
}

/** An action step, as a Button carries it. */
export interface Step {
  readonly type: string;
  readonly [k: string]: unknown;
}

export const isPart = (v: unknown): v is Part => typeof v === "object" && v !== null && (v as { type?: unknown }).type === "element";

/** Every part under `el` (itself included), with the statement it was written in. */
export function walk(el: Part, visit: (el: Part, statementId: string | undefined, path: readonly string[]) => void, inherited?: string, path: readonly string[] = []): void {
  const id = el.statementId ?? inherited;
  visit(el, id, path);
  const next = [...path, el.typeName];
  const go = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(go);
    else if (isPart(v)) walk(v, visit, id, next);
  };
  for (const v of Object.values(el.props)) go(v);
}

export const parts = (v: unknown): Part[] => (Array.isArray(v) ? v.filter(isPart) : []);
export const isStep = (v: unknown): v is Step => typeof v === "object" && v !== null && !isPart(v) && typeof (v as { type?: unknown }).type === "string";
