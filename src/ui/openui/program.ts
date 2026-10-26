/**
 * Reading a Signal program: lang-core's parser fed the vocabulary, then `evaluateRoot` so action
 * steps become plain `{ typeName, props }` nodes. `patch` is lang-core's `mergeStatements`: a
 * program changes by statements, and the renderer redraws the merged one in place.
 */
import { type ElementNode, type ParseResult, createParser, createStore, evaluateRoot, mergeStatements } from "@openuidev/lang-core";
import { ROOT, library } from "./vocabulary";

const parser = createParser(library.toJSONSchema(), ROOT);

export interface Read {
  result: ParseResult;
  /** The evaluated tree; null when the program has no root. */
  root: ElementNode | null;
}

export function read(program: string): Read {
  const result = parser.parse(program);
  const root = result.root
    ? evaluateRoot(result, { ctx: { getState: () => undefined, resolveRef: () => undefined }, library, store: createStore() })
    : null;
  return { result, root };
}

/** The program with the patch's statements in place of its own; unreachable ones drop. */
export function patch(program: string, statements: string): string {
  return mergeStatements(program, statements);
}

export const isElement = (v: unknown): v is ElementNode =>
  typeof v === "object" && v !== null && (v as { type?: unknown }).type === "element";
