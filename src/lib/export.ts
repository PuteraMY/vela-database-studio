import type { QueryResult, Value } from "../engine/types";
/** Escape CSV syntax and neutralize string formulas for spreadsheet consumers.
 * Numeric values keep their original meaning; JSON export is lossless.
 */
export function csvCell(value: Value): string {
  if (value === null) return "";
  const text = String(value);
  const safe =
    typeof value === "string" &&
    (/^[\t\r\n]/.test(text) || /^\s*[=+@-]/.test(text))
      ? `'${text}`
      : text;
  return `"${safe.replace(/"/g, '""')}"`;
}
export function resultCsv(
  result: Pick<QueryResult, "columns" | "rows">,
): string {
  return [
    result.columns.map(csvCell).join(","),
    ...result.rows.map((row) => row.map(csvCell).join(",")),
  ].join("\r\n");
}
