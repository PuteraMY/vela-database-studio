import { beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import initSqlJs, { type SqlJsStatic } from "sql.js";
import { Database } from "../src/engine/database";
import type { Value } from "../src/engine/types";
import { indexedFixture } from "./indexed-select-fixture";

let SQLite: SqlJsStatic;
beforeAll(async () => {
  const require = createRequire(import.meta.url);
  SQLite = await initSqlJs({
    locateFile: (file) => require.resolve(`sql.js/dist/${file}`),
  });
});
const literal = (value: Value) =>
  value === null
    ? "NULL"
    : typeof value === "string"
      ? `'${value.replace(/'/g, "''")}'`
      : typeof value === "boolean"
        ? value
          ? "TRUE"
          : "FALSE"
        : String(value);

describe("seeded SQL equality: auto vs forced scan vs SQLite", () => {
  it.each([1, 7, 42, 2026, 3735928559])(
    "seed %s: 200 queries with catalog and DML changes",
    (seed) => {
      const auto = new Database(),
        scan = new Database({ selectAccess: "table-scan" }),
        sqlite = new SQLite.Database();
      let rng = seed >>> 0,
        nIndexed = true,
        indexed = 0,
        fallback = 0;
      const random = (n: number) => {
        rng ^= rng << 13;
        rng ^= rng >>> 17;
        rng ^= rng << 5;
        return (rng >>> 0) % n;
      };
      const pick = <T>(items: readonly T[]) => items[random(items.length)];
      const numeric = () => pick([null, 0, 0.5, 1, 2, 3, 5]);
      const text = () =>
        pick([null, "A", "a", "B", "xy", "O'Neil", "12", "é", "中文"]);
      const boolean = () => pick([null, true, false, 0, 1]);
      const history: string[] = [];
      const apply = (sql: string) => {
        auto.execute(sql);
        scan.execute(sql);
        sqlite.run(sql);
        history.push(sql);
      };
      try {
        apply(indexedFixture);
        apply(
          `INSERT INTO t VALUES ${Array.from({ length: 34 }, (_, i) => `(${i + 7},${literal(numeric())},${literal(text())},${literal(boolean())})`).join(",")}`,
        );
        for (let step = 0; step < 200; step++) {
          if (step % 40 === 20) {
            apply(nIndexed ? "DROP INDEX ix_n" : "CREATE INDEX ix_n ON t(n)");
            nIndexed = !nIndexed;
          }
          if (step % 10 === 0) {
            const id = 1 + random(40);
            if (step % 30 === 0)
              apply(
                `INSERT INTO t VALUES(${1000 + step},${literal(numeric())},${literal(text())},${literal(boolean())})`,
              );
            else if (step % 30 === 10)
              apply(
                `UPDATE t SET n=${literal(numeric())},code=${literal(text())},b=${literal(boolean())} WHERE id=${id}`,
              );
            else apply(`DELETE FROM t WHERE id=${id}`);
          }
          const n = numeric(),
            s = text(),
            b = boolean(),
            kind = random(11);
          let predicate: string, eligible: boolean;
          switch (kind) {
            case 0:
              predicate = `x.n=${literal(n)}`;
              eligible = n !== null && nIndexed;
              break;
            case 1:
              predicate = `${literal(n)}=x.n`;
              eligible = n !== null && nIndexed;
              break;
            case 2:
              predicate = `x.code=${literal(s)}`;
              eligible = s !== null;
              break;
            case 3:
              predicate = `x.b=${literal(b)}`;
              eligible = b !== null;
              break;
            case 4:
              predicate = `x.n>=${literal(n)}`;
              eligible = false;
              break;
            case 5:
              predicate = `x.n=${literal(n)} OR x.n=2`;
              eligible = false;
              break;
            case 6:
              predicate = `x.n=${literal(n)} AND x.code=${literal(s)}`;
              eligible = false;
              break;
            case 7:
              predicate = `x.n+0=${literal(n)}`;
              eligible = false;
              break;
            case 8:
              predicate = `x.n=ABS(-${literal(n ?? 1)})`;
              eligible = nIndexed;
              break;
            case 9:
              predicate = `x.n=CASE WHEN 1 THEN ${literal(n)} ELSE 9 END`;
              eligible = false;
              break;
            default:
              predicate = `x.id=${1 + random(50)}`;
              eligible = true;
          }
          const queryKind = random(5);
          const sql =
            queryKind === 0
              ? `SELECT x.id AS picked,x.n,x.code,x.b FROM t AS x WHERE ${predicate} ORDER BY picked`
              : queryKind === 1
                ? `SELECT COUNT(*),SUM(x.n),AVG(x.n) FROM t AS x WHERE ${predicate}`
                : queryKind === 2
                  ? `SELECT DISTINCT x.n FROM t AS x WHERE ${predicate} ORDER BY x.n`
                  : queryKind === 3
                    ? `SELECT x.b,COUNT(*),SUM(x.n) FROM t AS x WHERE ${predicate} GROUP BY x.b HAVING COUNT(*)>0 ORDER BY x.b`
                    : `SELECT x.id,x.code FROM t AS x WHERE ${predicate} ORDER BY x.id DESC LIMIT 2 OFFSET 1`;
          const label = `seed=${seed} step=${step} nIndexed=${nIndexed} sql=${sql} recent=${history.slice(-8).join("; ")}`;
          const a = auto.execute(sql)[0],
            r = scan.execute(sql)[0],
            oracle = sqlite.exec(sql)[0]?.values ?? [];
          expect(a.columns, label).toEqual(r.columns);
          expect(a.rows, label).toEqual(r.rows);
          expect(a.rows, label).toEqual(oracle);
          const access = a.trace.find((t) => t.access)?.access;
          expect(access?.kind, label).toBe(
            eligible ? "index-equality" : "table-scan",
          );
          expect(r.trace.find((t) => t.access)?.access).toMatchObject({
            kind: "table-scan",
            reason: "forced",
          });
          if (access?.kind === "index-equality") {
            indexed++;
            expect(access.lookupCalls, label).toBe(1);
          } else fallback++;
          if (step % 20 === 0) {
            auto.validateIndexes();
            scan.validateIndexes();
          }
        }
        expect(indexed).toBeGreaterThan(20);
        expect(fallback).toBeGreaterThan(20);
        expect(auto.export()).toEqual(scan.export());
        auto.validateIndexes();
      } finally {
        sqlite.close();
      }
    },
    30_000,
  );
});
