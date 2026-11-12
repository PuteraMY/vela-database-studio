import { SqlError, type Table, type Value } from "./types";
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    afterQuote = false;
  const pushCell = () => {
    row.push(cell);
    cell = "";
    afterQuote = false;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else cell += c;
    } else if (c === '"' && !cell && !afterQuote) quoted = true;
    else if (c === ",") pushCell();
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      pushCell();
      rows.push(row);
      row = [];
    } else {
      if (afterQuote)
        throw new SqlError("CSV tidak sah selepas petikan penutup.");
      cell += c;
    }
  }
  if (quoted) throw new SqlError("Petikan CSV tidak ditutup.");
  if (cell || row.length || afterQuote) {
    pushCell();
    rows.push(row);
  }
  return rows;
}
export function csvTable(text: string, name = "import_csv"): Table {
  const [header, ...data] = parseCsv(text.replace(/^\uFEFF/, ""));
  if (!header?.length || !data.length)
    throw new SqlError(
      "CSV memerlukan tajuk dan sekurang-kurangnya satu baris.",
    );
  const names = header
    .map((h) =>
      h
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, "_"),
    )
    .map((h) => (/^[a-z_]/.test(h) ? h : `lajur_${h}`));
  if (new Set(names).size !== names.length)
    throw new SqlError("Tajuk lajur CSV berulang selepas penamaan.");
  if (data.some((r) => r.length !== names.length))
    throw new SqlError("Bilangan lajur CSV tidak seragam.");
  const columns = names.map((n, i) => {
    const values = data
      .map((r) => r[i])
      .filter((v) => v !== "" && v.toUpperCase() !== "NULL");
    const numeric =
      values.length > 0 &&
      values.every(
        (v) =>
          /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(v) &&
          Number.isFinite(Number(v)),
      );
    const bool =
      values.length > 0 && values.every((v) => /^(true|false)$/i.test(v));
    const type: Table["columns"][number]["type"] = bool
      ? "BOOLEAN"
      : numeric
        ? values.every((v) => Number.isInteger(Number(v)))
          ? "INTEGER"
          : "REAL"
        : "TEXT";
    return { name: n, type, primary: false, notNull: false, unique: false };
  });
  const rows = data.map((r) =>
    Object.fromEntries(
      columns.map((c, i): [string, Value] => [
        c.name,
        r[i] === "" || r[i].toUpperCase() === "NULL"
          ? null
          : c.type === "TEXT"
            ? r[i]
            : c.type === "BOOLEAN"
              ? r[i].toLowerCase() === "true"
              : Number(r[i]),
      ]),
    ),
  );
  return { name, columns, rows };
}
