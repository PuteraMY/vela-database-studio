import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import initSqlJs from "sql.js";
import { Database } from "../src/engine/database";
import type { Value } from "../src/engine/types";

/** Reproducible differential coverage of the implemented P0 SQL dialect. */
const seed = Number(process.env.FUZZ_SEED ?? 0x56e1a);
const total = Number(process.env.FUZZ_COUNT ?? 5000);
if (!Number.isSafeInteger(total) || total < 1 || !Number.isSafeInteger(seed))
  throw new Error("FUZZ_COUNT and FUZZ_SEED must be integers.");
let randomState = seed >>> 0;
function random(): number {
  randomState += 0x6d2b79f5;
  let value = Math.imul(randomState ^ (randomState >>> 15), 1 | randomState);
  value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}
const integer = (minimum: number, maximum: number) =>
  minimum + Math.floor(random() * (maximum - minimum + 1));
const pick = <T>(values: readonly T[]): T =>
  values[integer(0, values.length - 1)];
const nullable = <T>(value: T): T | null => (random() < 0.25 ? null : value);
const sqlValue = (value: Value): string =>
  value === null
    ? "NULL"
    : typeof value === "string"
      ? `'${value.replace(/'/g, "''")}'`
      : typeof value === "boolean"
        ? value
          ? "TRUE"
          : "FALSE"
        : String(value);
const literal = () =>
  sqlValue(pick<Value>([null, -5, -1, 0, 1, 2, 3, 5, 12, true, false]));
const direction = () => pick(["ASC", "DESC"]);
const require = createRequire(import.meta.url);
const SQL = await initSqlJs({
  locateFile: (file) => require.resolve(`sql.js/dist/${file}`),
});

type Outcome = { rows: unknown[][] } | { error: string };
interface Failure {
  index: number;
  schema: number;
  category: string;
  sql: string;
  vela: Outcome;
  sqlite: Outcome;
}
interface Schema {
  id: number;
  setup: string;
  table: string;
  parent: string;
  number: string;
  real: string;
  text: string;
  flag: string;
  link: string;
  group: string;
  score: string;
  label: string;
}
const schemas: Schema[] = [];
const failures: Failure[] = [];
const categories: Record<string, { total: number; matched: number }> = {};
let matched = 0;
function schema(id: number): Schema {
  const suffix = integer(100, 999);
  const table = `data_${id}_${suffix}`,
    parent = `groups_${id}_${suffix}`;
  const number = `amount_${integer(1, 50)}`,
    real = `price_${integer(1, 50)}`,
    text = `name_${integer(1, 50)}`,
    flag = `active_${integer(1, 50)}`,
    link = `group_${integer(1, 50)}`;
  const group = `category_${integer(1, 50)}`,
    score = `score_${integer(1, 50)}`,
    label = `title_${integer(1, 50)}`;
  const groupCount = integer(2, 8),
    rowCount = integer(8, 40);
  const words = [
    "Aina",
    "Bala",
    "Chen",
    "Devi",
    "Ehsan",
    "O'Neil",
    "",
    "  teks  ",
    "Alpha_",
    "a%b",
    "sains",
    "Sains",
    "12",
    "Äpfel",
    "äpfel",
    "中文",
  ];
  const parentRows = Array.from({ length: groupCount }, (_, i) => [
    i + 1,
    nullable(integer(0, 3)),
    nullable(integer(-20, 100)),
    nullable(pick(words)),
  ]);
  const rows = Array.from({ length: rowCount }, (_, i) => [
    i + 1,
    nullable(integer(-12, 20)),
    nullable(integer(-100, 100) / pick([1, 4, 10])),
    nullable(pick(words)),
    nullable(pick([true, false])),
    nullable(integer(1, groupCount)),
  ]);
  const extraColumns = Array.from(
    { length: integer(0, 3) },
    (_, i) => `extra_${i} ${pick(["INTEGER", "REAL", "TEXT", "BOOLEAN"])}`,
  );
  const extras = extraColumns.length ? `, ${extraColumns.join(", ")}` : "";
  const setup =
    `CREATE TABLE ${parent} (id INTEGER PRIMARY KEY, ${group} INTEGER, ${score} INTEGER, ${label} TEXT);\n` +
    `CREATE TABLE ${table} (id INTEGER PRIMARY KEY, ${number} INTEGER, ${real} REAL, ${text} TEXT, ${flag} BOOLEAN, ${link} INTEGER REFERENCES ${parent}(id)${extras});\n` +
    `INSERT INTO ${parent} VALUES ${parentRows.map((row) => `(${row.map(sqlValue).join(",")})`).join(",")};\n` +
    `INSERT INTO ${table} (id,${number},${real},${text},${flag},${link}) VALUES ${rows.map((row) => `(${row.map(sqlValue).join(",")})`).join(",")};\n`;
  return {
    id,
    setup,
    table,
    parent,
    number,
    real,
    text,
    flag,
    link,
    group,
    score,
    label,
  };
}

function generate(s: Schema): { category: string; sql: string } {
  const {
    table: t,
    parent: p,
    number: n,
    real: r,
    text: text,
    flag: flag,
    link: link,
    group: g,
    score: score,
    label: label,
  } = s;
  const column = () => pick([n, r, flag, link]);
  const term = () => pick([column(), literal()]);
  const comparison = () =>
    `${term()} ${pick(["=", "<>", "<", ">", "<=", ">=", "IS", "IS NOT"])} ${term()}`;
  const predicate = (): string =>
    pick([
      comparison(),
      `${comparison()} ${pick(["AND", "OR"])} ${comparison()}`,
      `NOT (${comparison()})`,
      `${column()} ${pick(["IN", "NOT IN"])} (${literal()},${literal()},${literal()})`,
      `${column()} ${pick(["BETWEEN", "NOT BETWEEN"])} ${literal()} AND ${literal()}`,
      `${column()} IS ${pick(["NULL", "NOT NULL"])}`,
      `${text} LIKE ${sqlValue(pick(["A%", "%a", "_a%", "%", "a%b", "%_%", "ä%"]))}`,
    ]);
  switch (integer(0, 19)) {
    case 0:
      return {
        category: "filter-three-valued-logic",
        sql: `SELECT id,${n},${flag} FROM ${t} WHERE ${predicate()} ORDER BY id`,
      };
    case 1:
      return {
        category: "predicate-projection",
        sql: `SELECT id,${predicate()} AS result FROM ${t} ORDER BY id`,
      };
    case 2:
      return {
        category: "integer-arithmetic",
        sql: `SELECT id, ${n} ${pick(["+", "-", "*", "/", "%"])} ${literal()} AS result FROM ${t} ORDER BY id`,
      };
    case 3:
      return {
        category: "real-arithmetic",
        sql: `SELECT id, ${r} ${pick(["+", "-", "*", "/", "%"])} ${integer(-5, 5)} AS result FROM ${t} ORDER BY id`,
      };
    case 4:
      return {
        category: "distinct-and-null-order",
        sql: `SELECT DISTINCT ${column()} AS result FROM ${t} ORDER BY result ${direction()} NULLS ${pick(["FIRST", "LAST"])}`,
      };
    case 5:
      return {
        category: "aggregate",
        sql: `SELECT COUNT(*),COUNT(${n}),SUM(${n}),AVG(${n}),MIN(${n}),MAX(${n}) FROM ${t} WHERE ${predicate()}`,
      };
    case 6:
      return {
        category: "group-and-having",
        sql: `SELECT ${link},COUNT(*) AS count_rows,SUM(${n}) AS total,AVG(${r}) AS average FROM ${t} GROUP BY ${link} HAVING COUNT(*) ${pick([">", ">=", "<", "="])} ${integer(0, 5)} ORDER BY ${link} ${direction()}`,
      };
    case 7:
      return {
        category: "aggregate-distinct",
        sql: `SELECT COUNT(DISTINCT ${n}),SUM(DISTINCT ${n}),AVG(DISTINCT ${n}),MIN(${r}),MAX(${r}) FROM ${t} WHERE ${predicate()}`,
      };
    case 8:
      return {
        category: "inner-join",
        sql: `SELECT a.id,b.id,a.${n},b.${score} FROM ${t} a JOIN ${p} b ON a.${link}=b.id WHERE a.${n} ${pick([">", "<", "<>", "="])} ${integer(-5, 8)} ORDER BY a.id,b.id`,
      };
    case 9:
      return {
        category: "left-join",
        sql: `SELECT a.id,b.id,b.${label},a.${n} FROM ${t} a LEFT JOIN ${p} b ON a.${link}=b.id AND b.${score} > ${integer(-5, 40)} ORDER BY a.id,b.id`,
      };
    case 10:
      return {
        category: "left-join-aggregate",
        sql: `SELECT b.id,COUNT(a.id),SUM(a.${n}),AVG(a.${r}) FROM ${p} b LEFT JOIN ${t} a ON b.id=a.${link} GROUP BY b.id HAVING COUNT(a.id) >= ${integer(0, 5)} ORDER BY b.id`,
      };
    case 11:
      return {
        category: "cross-join",
        sql: `SELECT a.id,b.id,a.${n}+b.${score} AS sum_values FROM ${t} a CROSS JOIN ${p} b WHERE a.id < ${integer(2, 8)} AND b.id <= ${integer(1, 5)} ORDER BY a.id,b.id LIMIT ${integer(0, 15)} OFFSET ${integer(0, 5)}`,
      };
    case 12:
      return {
        category: "case-coalesce",
        sql: `SELECT id,CASE WHEN ${predicate()} THEN COALESCE(${n},${integer(-5, 10)}) WHEN ${flag} IS NULL THEN -99 ELSE ${integer(0, 10)} END AS result FROM ${t} ORDER BY id`,
      };
    case 13:
      return {
        category: "string-functions",
        sql: `SELECT id,${pick([`LOWER(${text})`, `UPPER(${text})`, `LENGTH(${text})`, `TRIM(${text})`, `SUBSTR(${text},${integer(-10, 8)},${integer(-5, 10)})`, `REPLACE(${text},'a','X')`, `${text} || '-x'`])} AS result FROM ${t} ORDER BY id`,
      };
    case 14:
      return {
        category: "limit-offset",
        sql: `SELECT id,${n} FROM ${t} ORDER BY ${n} ${direction()},id LIMIT ${integer(0, 20)} OFFSET ${integer(-3, 20)}`,
      };
    case 15:
      return {
        category: "alias-group-order",
        sql: `SELECT ${link} AS bucket,COUNT(*) AS hits FROM ${t} GROUP BY bucket HAVING hits >= ${integer(0, 4)} ORDER BY hits ${direction()},bucket`,
      };
    case 16:
      return {
        category: "nullif-ifnull",
        sql: `SELECT id,IFNULL(${n},${integer(-5, 5)}),NULLIF(${n},${integer(-5, 5)}) FROM ${t} ORDER BY id`,
      };
    case 17:
      return {
        category: "scalar-constant-null",
        sql: `SELECT ${literal()} ${pick(["AND", "OR"])} ${literal()}, ${literal()} ${pick(["IN", "NOT IN"])} (${literal()},${literal()},${literal()})`,
      };
    case 18:
      return {
        category: "multi-join",
        sql: `SELECT a.id,b.id,c.id FROM ${t} a JOIN ${p} b ON a.${link}=b.id LEFT JOIN ${p} c ON b.${g}=c.${g} WHERE a.id < ${integer(1, 12)} ORDER BY a.id,b.id,c.id`,
      };
    default:
      return {
        category: "date-and-math-functions",
        sql: `SELECT id,ABS(${n}),ROUND(${r},${integer(0, 3)}),DATE('2026-${String(integer(1, 12)).padStart(2, "0")}-15') FROM ${t} ORDER BY id`,
      };
  }
}

function same(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number")
    return (
      a === b ||
      Math.abs(a - b) <= 1e-10 * Math.max(1, Math.abs(a), Math.abs(b))
    );
  if (Array.isArray(a) && Array.isArray(b))
    return (
      a.length === b.length && a.every((value, index) => same(value, b[index]))
    );
  return a === b;
}
function outcome(fn: () => unknown[][]): Outcome {
  try {
    return { rows: fn() };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
const started = performance.now();
for (let index = 0; index < total;) {
  const s = schema(schemas.length);
  schemas.push(s);
  const vela = new Database(),
    sqlite = new SQL.Database();
  vela.execute(s.setup);
  sqlite.run(s.setup);
  for (let q = 0; q < 200 && index < total; q++, index++) {
    const { category, sql } = generate(s);
    const velaResult = outcome(() => vela.execute(sql)[0].rows);
    const sqliteResult = outcome(() => sqlite.exec(sql)[0]?.values ?? []);
    categories[category] ??= { total: 0, matched: 0 };
    categories[category].total++;
    // Errors never count as successful differential matches.
    if (
      "rows" in velaResult &&
      "rows" in sqliteResult &&
      same(velaResult.rows, sqliteResult.rows)
    ) {
      matched++;
      categories[category].matched++;
    } else {
      failures.push({
        index: index + 1,
        schema: s.id,
        category,
        sql,
        vela: velaResult,
        sqlite: sqliteResult,
      });
    }
  }
  sqlite.close();
}
const unsupportedProbes = [
  "SELECT (SELECT 1)",
  "SELECT 1 WHERE 1 IN (SELECT 1)",
  "SELECT 1 WHERE EXISTS (SELECT 1)",
];
const probeDb = new Database();
const unsupported = unsupportedProbes.map((sql) => ({
  sql,
  result: outcome(() => probeDb.execute(sql)[0].rows),
}));
const report = {
  command: "npm run fuzz",
  seed,
  total,
  matched,
  mismatches: failures.length,
  matchRate: matched / total,
  elapsedMs: performance.now() - started,
  schemaCount: schemas.length,
  comparison:
    "Ordered values, excluding labels; numeric relative/absolute tolerance 1e-10. Both successful execution and equal results required. Every query specifies deterministic ordering where multiple rows matter.",
  scope:
    "P0 supported syntax: randomized typed schemas/data, NULLs, expressions, predicates, scalar functions, inner/left/cross/multi joins, aggregates, GROUP BY/HAVING, DISTINCT, ORDER BY, LIMIT/OFFSET.",
  excluded: [
    "P3 subqueries (scalar, IN, EXISTS, correlated)",
    "CTEs, set operations, window functions",
    "P1 optimizer/index access semantics",
    "P2 WAL/MVCC/transactions",
  ],
  unsupportedProbesExcludedFromTotals: unsupported,
  categories,
  schemas,
  failures,
};
await mkdir("artifacts", { recursive: true });
await writeFile(
  "artifacts/differential-fuzz.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      seed,
      total,
      matched,
      mismatches: failures.length,
      matchRate: matched / total,
      elapsedMs: report.elapsedMs,
      schemaCount: schemas.length,
      categories,
      firstFailures: failures
        .slice(0, 5)
        .map(({ index, category, sql }) => ({ index, category, sql })),
      artifact: "artifacts/differential-fuzz.json",
    },
    null,
    2,
  ),
);
if (failures.length) process.exitCode = 1;
