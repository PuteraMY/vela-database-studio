import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import initSqlJs from "sql.js";
import { Database } from "../src/engine/database";
import { cases, fixture } from "../tests/cases";
import type { Value } from "../src/engine/types";

const require = createRequire(import.meta.url);
const SQL = await initSqlJs({
  locateFile: (file) => require.resolve(`sql.js/dist/${file}`),
});
const sqlite = new SQL.Database();
const vela = new Database();
sqlite.run(fixture);
vela.execute(fixture);
const failures: {
  index: number;
  sql: string;
  expected: Value[][];
  sqlite?: unknown;
  vela?: unknown;
  error?: string;
}[] = [];
for (const [index, [sql, expected]] of cases.entries()) {
  try {
    const sqliteRows = sqlite.exec(sql)[0]?.values ?? [];
    const velaRows = vela.execute(sql)[0].rows;
    if (
      JSON.stringify(sqliteRows) !== JSON.stringify(expected) ||
      JSON.stringify(velaRows) !== JSON.stringify(expected)
    ) {
      failures.push({
        index: index + 1,
        sql,
        expected,
        sqlite: sqliteRows,
        vela: velaRows,
      });
    }
  } catch (error) {
    failures.push({
      index: index + 1,
      sql,
      expected,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
sqlite.close();
const report = {
  command: "npm run curated",
  total: cases.length,
  passed: cases.length - failures.length,
  failed: failures.length,
  matchRate: (cases.length - failures.length) / cases.length,
  comparison:
    "Both SQLite and VELA results must match the hand-written expected rows exactly; column labels are excluded.",
  failures,
};
await mkdir("artifacts", { recursive: true });
await writeFile(
  "artifacts/differential-curated.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({ ...report, failures: failures.slice(0, 5) }, null, 2),
);
if (failures.length) process.exitCode = 1;
