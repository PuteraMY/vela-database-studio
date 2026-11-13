import { evaluate } from "./expression";
import { normalizeIndexKey } from "./indexes";
import { checkedEntry } from "./storage/codec";
import { StorageError, type Key, type PageFormat } from "./storage/page";
import type {
  Column,
  Expr,
  IndexDefinition,
  ScanReason,
  Select,
  Value,
} from "./types";

export type SelectAccessMode = "auto" | "table-scan";
export type EqualityAccess =
  | { kind: "table-scan"; reason: ScanReason }
  | { kind: "index-equality"; index: string; key: Key };

// Deliberately pinned: new functions require review before entering this set.
const pureFunctions = new Set([
  "abs",
  "round",
  "floor",
  "ceil",
  "ceiling",
  "sqrt",
  "power",
  "mod",
  "length",
  "lower",
  "upper",
  "trim",
  "ltrim",
  "rtrim",
  "substr",
  "substring",
  "replace",
  "coalesce",
  "ifnull",
  "nullif",
  "typeof",
]);
const arithmetic = new Set(["+", "-", "*", "/", "%", "||"]);
function constant(e: Expr): boolean {
  switch (e.kind) {
    case "literal":
      return true;
    case "unary":
      return (e.op === "+" || e.op === "-") && constant(e.expr);
    case "binary":
      return arithmetic.has(e.op) && constant(e.left) && constant(e.right);
    case "call":
      return !e.distinct && pureFunctions.has(e.name) && e.args.every(constant);
    default:
      return false;
  }
}

/** Selection only, after authoritative binding; no row/page reads or AST rewriting. */
export function chooseEqualityAccess(
  query: Select,
  columns: readonly Column[],
  definitions: readonly IndexDefinition[],
  physical: ReadonlyMap<string, { readonly format: PageFormat }>,
  mode: SelectAccessMode = "auto",
): EqualityAccess {
  const scan = (reason: ScanReason): EqualityAccess => ({
    kind: "table-scan",
    reason,
  });
  if (mode === "table-scan") return scan("forced");
  if (!query.from || query.joins.length) return scan("multiple-tables");
  const where = query.where;
  if (!where || where.kind !== "binary" || !["=", "=="].includes(where.op))
    return scan("unsupported-predicate");
  const column =
    where.left.kind === "column"
      ? where.left
      : where.right.kind === "column"
        ? where.right
        : undefined;
  if (!column || column.table !== query.from.alias)
    return scan("unsupported-predicate");
  const expression = column === where.left ? where.right : where.left;
  const definition = columns.find((c) => c.name === column.name);
  if (!definition || !constant(expression)) return scan("unsafe-constant");
  const candidates = definitions
    .filter(
      (i) =>
        i.table === query.from?.table &&
        i.columns.length === 1 &&
        i.columns[0] === column.name &&
        physical.has(i.name),
    )
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  if (!candidates.length) return scan("no-compatible-index");
  let value: Value;
  try {
    value = evaluate(expression);
  } catch {
    // Keep P0 evaluation/error timing, especially on empty tables and LIMIT 0.
    return scan("unsafe-constant");
  }
  if (value === null || (typeof value === "number" && !Number.isFinite(value)))
    return scan("null-or-nonfinite");
  if (
    definition.type === "TEXT"
      ? typeof value !== "string"
      : typeof value !== "number" && typeof value !== "boolean"
  )
    return scan("incompatible-type");
  const key = normalizeIndexKey([value]);
  for (const candidate of candidates) {
    const tree = physical.get(candidate.name);
    if (!tree) continue;
    try {
      return {
        kind: "index-equality",
        index: candidate.name,
        key: checkedEntry(key, 0, tree.format).key,
      };
    } catch (error) {
      if (!(error instanceof StorageError) || error.code !== "KEY_TOO_LARGE")
        throw error;
    }
  }
  return scan("key-capacity");
}
