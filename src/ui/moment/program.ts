/**
 * Reading a Moment program: lang-core's parser fed the generated JSON Schema
 * (src/contract/moment-schema.json), then a small evaluation of our own that turns action calls
 * into plain steps. lang-core's `evaluateRoot` needs the zod library, which stays out of the app.
 * `patch` is lang-core's `mergeStatements`: Details open by a merged statement.
 *
 * lang-core runs zod at load, so this module (with gate.ts) is the lazy chunk the mount imports
 * when the first Moment arrives (moment/load.ts); the app's main bundle has neither.
 */
import { type ASTNode, type ElementNode, type ParseResult, createParser, mergeStatements } from "@openuidev/lang-core";
import schema from "../../contract/moment-schema.json";
import { ACTION_NAMES, ROOT } from "./keys";
import { type Part, isPart } from "./tree";

export type { Part, Step } from "./tree";

export interface Read {
  result: ParseResult;
  /** The evaluated tree; null when the program has no root. */
  root: Part | null;
}

type Schema = Parameters<typeof createParser>[0];
let parser: ReturnType<typeof createParser> | undefined;
let parserSchema: Schema | undefined;

/** The parser for a schema (the committed one by default; tests may pass a fresh one). */
function parserFor(s: Schema): ReturnType<typeof createParser> {
  if (!parser || parserSchema !== s) {
    parser = createParser(s, ROOT);
    parserSchema = s;
  }
  return parser;
}

export function read(program: string, s: Schema = schema as unknown as Schema): Read {
  const result = parserFor(s).parse(program);
  return { result, root: result.root ? (evaluate(result.root) as Part) : null };
}

/** The program with the patch's statements in place of its own; unreachable ones drop. */
export function patch(program: string, statements: string): string {
  return mergeStatements(program, statements);
}


const ACTIONS = new Set<string>(ACTION_NAMES);

function isAst(v: unknown): v is ASTNode {
  return typeof v === "object" && v !== null && "k" in v && !isPart(v);
}

/** Literals stay; action calls become steps; anything else (state, queries) becomes undefined. */
function evaluate(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(evaluate);
  if (isPart(v)) {
    const props: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v.props)) props[k] = evaluate(x);
    return { type: "element", typeName: v.typeName, props, statementId: (v as ElementNode).statementId };
  }
  if (!isAst(v)) return v;
  const n = v as ASTNode & Record<string, unknown>;
  switch (n.k) {
    case "Str":
    case "Num":
    case "Bool":
      return n.v;
    case "Null":
      return null;
    case "Arr":
      return (n.els as unknown[]).map(evaluate);
    case "Comp": {
      const name = String(n.name);
      if (!ACTIONS.has(name)) return undefined;
      const mapped = (n.mappedProps ?? {}) as Record<string, unknown>;
      const step: Record<string, unknown> = { type: name };
      for (const [k, x] of Object.entries(mapped)) step[k] = evaluate(x);
      return step;
    }
    default:
      return undefined;
  }
}

