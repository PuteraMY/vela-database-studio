import { compare, hasAggregate } from "./expression";
import type { EqualityAccess } from "./equality-access";
import type { AccessPlanning, IndexDefinition, Select, Table } from "./types";

export const PREFIX_SCAN_BUDGET = 8;
export const PREFIX_MIN_TABLE_ROWS = 1024;

/** Bounded work heuristic, after semantic eligibility; never estimates cardinality. */
export function planEqualityAccess(
  query: Select,
  eligible: EqualityAccess,
  table: Table,
  indexes: readonly IndexDefinition[],
): { access: EqualityAccess; planning?: AccessPlanning } {
  if (eligible.kind !== "index-equality") return { access: eligible };
  const index = indexes.find(
    (i) => i.name === eligible.index && i.table === table.name,
  );
  const decision = (
    reason: AccessPlanning["reason"],
    detail: string,
    prefixRowsRead = 0,
    scanRowsUpperBound?: number,
  ) => ({
    access:
      reason === "prefix-match"
        ? {
            kind: "table-scan" as const,
            reason: "bounded-prefix-match" as const,
          }
        : eligible,
    planning: {
      reason,
      detail,
      tableRows: table.rows.length,
      prefixRowsRead,
      ...(scanRowsUpperBound === undefined ? {} : { scanRowsUpperBound }),
    },
  });
  if (index?.unique)
    return decision("unique-index", "Indeks UNIQUE dikekalkan.");
  if (table.rows.length < PREFIX_MIN_TABLE_ROWS)
    return decision(
      "retain-small-table",
      "Laluan indeks sedia ada dikekalkan untuk jadual kecil.",
    );
  if (
    !index ||
    index.columns.length !== 1 ||
    query.limit?.kind !== "literal" ||
    query.limit.value !== 1 ||
    (query.offset &&
      (query.offset.kind !== "literal" || query.offset.value !== 0)) ||
    query.distinct ||
    query.order.length ||
    query.group.length ||
    query.having ||
    query.columns.some((c) => hasAggregate(c.expr))
  )
    return decision(
      "retain-query-shape",
      "Indeks dikekalkan: bentuk pertanyaan di luar heuristik LIMIT 1.",
    );
  for (let i = 0; i < PREFIX_SCAN_BUDGET; i++) {
    // Eligibility already proved strict SQL/key equality compatibility. NULL cannot match.
    if (compare(table.rows[i][index.columns[0]], eligible.key[0]) === 0)
      return decision(
        "prefix-match",
        `Imbasan dipilih: padanan disahkan dalam ${i + 1} baris awal.`,
        i + 1,
        i + 1,
      );
  }
  return decision(
    "prefix-miss",
    "Indeks dikekalkan: tiada padanan dalam 8 baris awal.",
    PREFIX_SCAN_BUDGET,
  );
}
