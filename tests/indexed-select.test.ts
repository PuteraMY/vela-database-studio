import { describe, expect, it, vi } from "vitest";
import { Database } from "../src/engine/database";
import { chooseEqualityAccess } from "../src/engine/equality-access";
import { IndexReadError } from "../src/engine/index-reader";
import { parse } from "../src/engine/parser";
import { BPlusTree } from "../src/engine/storage/btree";
import type { QueryResult } from "../src/engine/types";
import { indexedPair } from "./indexed-select-fixture";

const accesses = (result: QueryResult) => result.trace.filter((t) => t.access);
function checkQuery(sql: string, indexed: boolean) {
  const { auto, scan } = indexedPair();
  const actual = auto.execute(sql)[0],
    reference = scan.execute(sql)[0];
  expect(actual.columns).toEqual(reference.columns);
  expect(actual.rows).toEqual(reference.rows);
  const sources = accesses(actual);
  expect(sources).toHaveLength(1);
  expect(sources[0].access?.kind).toBe(
    indexed ? "index-equality" : "table-scan",
  );
  expect(accesses(reference)[0].access).toMatchObject({
    kind: "table-scan",
    reason: "forced",
  });
  auto.validateIndexes();
  return actual;
}

describe("bound indexed equality and downstream operators", () => {
  it.each([
    "SELECT * FROM t WHERE n=1",
    "SELECT * FROM t WHERE 1=n",
    "SELECT id FROM t WHERE t.n==1 ORDER BY id",
    "SELECT x.id FROM t AS x WHERE x.n=1 ORDER BY x.id DESC",
    "SELECT id,n+1 AS value FROM t WHERE n=1 ORDER BY value,id",
    "SELECT id FROM t WHERE n=1 LIMIT 1 OFFSET 1",
    "SELECT id FROM t WHERE n=1 LIMIT -1 OFFSET 1",
    "SELECT DISTINCT n FROM t WHERE n=1",
    "SELECT COUNT(*),SUM(n),AVG(n),MIN(n),MAX(n) FROM t WHERE n=1",
    "SELECT b,COUNT(*) AS total FROM t WHERE n=1 GROUP BY b HAVING COUNT(*)>0 ORDER BY total,b",
    "SELECT COUNT(*),SUM(n),AVG(n) FROM t WHERE n=99",
    "SELECT id AS chosen FROM t WHERE id=3 ORDER BY chosen",
    "SELECT id FROM t WHERE n=1 ORDER BY code DESC LIMIT 1",
    "SELECT id FROM t WHERE b=TRUE ORDER BY id",
    "SELECT id FROM t WHERE TRUE=b ORDER BY id",
    "SELECT id FROM t WHERE b=FALSE ORDER BY id",
    "SELECT id FROM t WHERE b=2",
    "SELECT id FROM t WHERE n=TRUE ORDER BY id",
    "SELECT id FROM t WHERE n=1.5",
    "SELECT id FROM t WHERE n=-0",
    "SELECT id FROM t WHERE code='A'",
    "SELECT id FROM t WHERE code='missing'",
    "SELECT * FROM t WHERE id=99",
    "SELECT id FROM t WHERE code='x'||'y'",
    "SELECT id FROM t WHERE n=3/2 ORDER BY id",
    "SELECT id FROM t WHERE n=3.0/2",
    "SELECT id FROM t WHERE n=+1",
    "SELECT id FROM t WHERE n=-(-1)",
  ])("matches reference scan: %s", (sql) => {
    checkQuery(sql, true);
  });
  it.each([
    "abs(-1)",
    "round(1.1)",
    "floor(1.9)",
    "ceil(0.1)",
    "ceiling(0.1)",
    "sqrt(1)",
    "power(1,2)",
    "mod(3,2)",
    "length('a')",
    "coalesce(NULL,1)",
    "ifnull(NULL,1)",
    "nullif(1,2)",
  ])("accepts deterministic numeric constant %s", (expression) => {
    checkQuery(`SELECT id FROM t WHERE n=${expression} ORDER BY id`, true);
  });
  it.each([
    "lower('A')",
    "upper('a')",
    "trim(' A ')",
    "ltrim(' A')",
    "rtrim('A ')",
    "substr('AB',1,1)",
    "substring('AB',1,1)",
    "replace('B','B','A')",
    "typeof(1)",
  ])("accepts deterministic text constant %s", (expression) => {
    checkQuery(`SELECT id FROM t WHERE code=${expression} ORDER BY id`, true);
  });
});

describe("authoritative scan fallback and errors", () => {
  it.each([
    "SELECT id FROM t",
    "SELECT id FROM t WHERE n>1",
    "SELECT id FROM t WHERE n=1 OR n=2",
    "SELECT id FROM t WHERE n=1 AND code='A'",
    "SELECT id FROM t WHERE n+0=1",
    "SELECT id FROM t WHERE n=id",
    "SELECT id FROM t WHERE n IS NULL",
    "SELECT id FROM t WHERE n=NULL",
    "SELECT id FROM t WHERE NULL=n",
    "SELECT id FROM t WHERE n=coalesce(NULL,NULL)",
    "SELECT id FROM t WHERE n=1/0",
    "SELECT id FROM t WHERE n=power(10,999)",
    "SELECT id FROM t WHERE n='1'",
    "SELECT id FROM t WHERE code=1",
    "SELECT id FROM t WHERE code=TRUE",
    "SELECT id FROM t WHERE n=CASE WHEN 1 THEN 1 ELSE 2 END",
    "SELECT id FROM t WHERE n IN(1,2)",
    "SELECT id FROM t WHERE n BETWEEN 1 AND 2",
    "SELECT id FROM t WHERE n=(1=1)",
    "SELECT id FROM t WHERE n=NOT FALSE",
    "SELECT id FROM t WHERE code=date('2026-01-01')",
    "SELECT id FROM t WHERE code=datetime('now')",
    "SELECT id FROM t WHERE code=strftime('%Y','now')",
    "SELECT id FROM t WHERE code=coalesce('A',date('now'))",
    "SELECT id FROM t WHERE code=lower(DISTINCT 'A')",
    `SELECT id FROM t WHERE code='${"x".repeat(1000)}'`,
  ])("keeps P0 behavior: %s", (sql) => {
    checkQuery(sql, false);
  });
  it("does not evaluate clock functions during selection", () => {
    const { auto } = indexedPair();
    const clock = vi.spyOn(Date, "now").mockReturnValue(0);
    try {
      const result = auto.execute(
        "SELECT id FROM t WHERE code=date('now') LIMIT 0",
      )[0];
      expect(clock).not.toHaveBeenCalled();
      expect(accesses(result)[0].access?.kind).toBe("table-scan");
    } finally {
      clock.mockRestore();
    }
  });
  it.each([
    "SELECT missing FROM t WHERE n=1",
    "SELECT id FROM t WHERE missing=1",
    "SELECT n AS x FROM t WHERE x=1",
    "SELECT t.id FROM t AS x WHERE x.n=1",
    "SELECT id FROM t WHERE n=unknown(1)",
    "SELECT id FROM t WHERE n=abs() LIMIT 0",
    "SELECT id FROM t WHERE n=SUM(n)",
    "SELECT id FROM t WHERE n=1 ORDER BY missing",
    "SELECT id FROM t WHERE n=1 LIMIT 'x'",
    "SELECT id FROM t WHERE n=1 HAVING id>0",
    "SELECT id FROM t WHERE n=1 ORDER BY 99",
    "SELECT id FROM t WHERE code COLLATE NOCASE='a'",
    "SELECT id FROM t WHERE id=(SELECT id FROM t)",
    "SELECT id FROM t a,t b WHERE id=1",
  ])("preserves binding/parser errors: %s", (sql) => {
    const { auto, scan } = indexedPair(),
      search = vi.spyOn(BPlusTree.prototype, "scan");
    try {
      const error = (db: Database) => {
        try {
          db.execute(sql);
          return "no error";
        } catch (e) {
          return e instanceof Error ? e.message : String(e);
        }
      };
      const expected = error(scan);
      expect(expected).not.toBe("no error");
      expect(error(auto)).toBe(expected);
      expect(search).not.toHaveBeenCalled();
    } finally {
      search.mockRestore();
    }
  });
  it("does not select indexes for joins or multi-table queries", () => {
    const { auto, scan } = indexedPair();
    for (const sql of [
      "SELECT a.id,b.id FROM t a JOIN t b ON a.id=b.id WHERE a.id=1",
      "SELECT a.id,b.id FROM t a,t b WHERE a.id=1 ORDER BY b.id",
    ]) {
      const result = auto.execute(sql)[0];
      expect(result.rows).toEqual(scan.execute(sql)[0].rows);
      expect(accesses(result)).toHaveLength(2);
      expect(
        accesses(result).every((t) => t.access?.kind === "table-scan"),
      ).toBe(true);
    }
  });
  it("has no automatic PRIMARY KEY or composite lookup", () => {
    const db = new Database();
    db.execute(
      "CREATE TABLE t(id INTEGER PRIMARY KEY,n INTEGER); INSERT INTO t VALUES(1,2); CREATE INDEX pair ON t(id,n)",
    );
    for (const sql of [
      "SELECT * FROM t WHERE id=1",
      "SELECT * FROM t WHERE id=1 AND n=2",
    ])
      expect(accesses(db.execute(sql)[0])[0].access?.kind).toBe("table-scan");
  });
  it("falls back when a catalog definition has no physical tree", () => {
    const { auto } = indexedPair(),
      query = parse("SELECT id FROM t WHERE n=1")[0];
    if (
      query.kind !== "select" ||
      query.where?.kind !== "binary" ||
      query.where.left.kind !== "column"
    )
      throw new Error("fixture AST");
    query.where.left.table = "t";
    const state = auto.export();
    expect(
      chooseEqualityAccess(
        query,
        state.tables[0].columns,
        state.indexes,
        new Map(),
      ),
    ).toEqual({ kind: "table-scan", reason: "no-compatible-index" });
  });
});

describe("catalog lifecycle and exact live rows", () => {
  it.each([true, false])("index created before inserts: %s", (before) => {
    const db = new Database();
    db.execute("CREATE TABLE t(id INTEGER PRIMARY KEY,n INTEGER)");
    if (before) db.execute("CREATE INDEX ix ON t(n)");
    db.execute("INSERT INTO t VALUES(1,7),(2,7),(3,NULL)");
    if (!before) db.execute("CREATE INDEX ix ON t(n)");
    const result = db.execute("SELECT * FROM t WHERE n=7")[0];
    expect(result.rows).toEqual([
      [1, 7],
      [2, 7],
    ]);
    expect(accesses(result)[0].access?.kind).toBe("index-equality");
    db.execute(
      "DELETE FROM t WHERE id=1; UPDATE t SET n=8,id=20 WHERE id=2; INSERT INTO t VALUES(4,7)",
    );
    expect(db.execute("SELECT * FROM t WHERE n=7")[0].rows).toEqual([[4, 7]]);
    expect(db.execute("SELECT * FROM t WHERE n=8")[0].rows).toEqual([[20, 8]]);
    db.validateIndexes();
  });
  it("uses current metadata after drop/recreate and logical restore", () => {
    const { auto: db } = indexedPair();
    db.execute("DROP INDEX ix_n");
    expect(
      accesses(db.execute("SELECT * FROM t WHERE n=1")[0])[0].access?.kind,
    ).toBe("table-scan");
    db.execute("CREATE INDEX ix_n ON t(n)");
    db.restore(db.export());
    expect(
      accesses(db.execute("SELECT * FROM t WHERE n=1")[0])[0].access,
    ).toMatchObject({ kind: "index-equality", index: "ix_n" });
    db.execute(
      "DROP TABLE t; CREATE TABLE t(n INTEGER); INSERT INTO t VALUES(1)",
    );
    expect(
      accesses(db.execute("SELECT * FROM t WHERE n=1")[0])[0].access?.kind,
    ).toBe("table-scan");
  });
  it("chooses the lexicographically first compatible index", () => {
    const { auto } = indexedPair();
    auto.execute("CREATE INDEX z_n ON t(n); CREATE INDEX a_n ON t(n)");
    expect(
      accesses(auto.execute("SELECT id FROM t WHERE n=1")[0])[0].access,
    ).toMatchObject({ index: "a_n" });
  });
  it("skips a small slot without cloning pages or misreporting a fallback", () => {
    const db = new Database(),
      value = "x".repeat(200);
    db.execute(
      `CREATE TABLE t(s TEXT); INSERT INTO t VALUES('${value}'); CREATE INDEX z_large ON t(s); DELETE FROM t; CREATE INDEX a_small ON t(s)`,
    );
    const image = vi.spyOn(BPlusTree.prototype, "exportImage");
    try {
      const result = db.execute(`SELECT * FROM t WHERE s='${value}'`)[0];
      expect(result.rows).toEqual([]);
      expect(accesses(result)[0].access).toMatchObject({
        index: "z_large",
        lookupCalls: 1,
      });
      expect(image).not.toHaveBeenCalled();
    } finally {
      image.mockRestore();
    }
  });
  it("handles empty trees and constant NULL without changing aggregate semantics", () => {
    const db = new Database();
    db.execute("CREATE TABLE t(n INTEGER); CREATE INDEX ix ON t(n)");
    expect(
      db.execute("SELECT COUNT(*),SUM(n) FROM t WHERE n=1")[0].rows,
    ).toEqual([[0, null]]);
    expect(
      accesses(db.execute("SELECT COUNT(*) FROM t WHERE n=NULL")[0])[0].access
        ?.kind,
    ).toBe("table-scan");
  });
  it("preserves index results after a rejected statement", () => {
    const { auto } = indexedPair();
    expect(() => auto.execute("UPDATE t SET id=1")).toThrow(/UNIQUE/);
    expect(auto.execute("SELECT id FROM t WHERE id=3")[0].rows).toEqual([[3]]);
    auto.validateIndexes();
  });
});

describe("physical execution evidence", () => {
  it("calls the actual B+tree and emits no table-scan operator", () => {
    const { auto } = indexedPair(),
      search = vi.spyOn(BPlusTree.prototype, "scan"),
      eager = vi.spyOn(auto, "lookupIndex");
    try {
      const result = auto.execute("SELECT id FROM t WHERE n=1")[0];
      expect(search).toHaveBeenCalledExactlyOnceWith({
        lower: { key: [1], inclusive: undefined },
        upper: { key: [1], inclusive: undefined },
        reverse: undefined,
      });
      expect(eager).not.toHaveBeenCalled();
      expect(result.trace.some((t) => t.operator === "Imbasan jadual")).toBe(
        false,
      );
      expect(accesses(result)[0]).toMatchObject({
        operator: "Carian indeks",
        rowsOut: 2,
        access: {
          kind: "index-equality",
          table: "t",
          index: "ix_n",
          lookupCalls: 1,
          matchedRowIds: 2,
        },
      });
      search.mockReturnValueOnce((function* () {})());
      expect(auto.execute("SELECT id FROM t WHERE n=1")[0].rows).toEqual([]);
    } finally {
      search.mockRestore();
      eager.mockRestore();
    }
  });
  it("fallback emits a scan and never probes the tree", () => {
    const { auto } = indexedPair(),
      search = vi.spyOn(BPlusTree.prototype, "scan");
    try {
      const result = auto.execute("SELECT id FROM t WHERE n=1 OR n=2")[0];
      expect(result.rows).toEqual([[1], [2], [3]]);
      expect(accesses(result)[0]).toMatchObject({
        operator: "Imbasan jadual",
        rowsOut: 6,
      });
      expect(search).not.toHaveBeenCalled();
    } finally {
      search.mockRestore();
    }
  });
  it("still evaluates the complete original predicate", () => {
    const { auto } = indexedPair(),
      table = auto.tableHandle("t");
    const lookup = vi.spyOn(auto, "scanIndex").mockReturnValueOnce(
      (function* () {
        for (const rowId of [1, 5])
          yield {
            table,
            rowId,
            key: [1],
            row: auto.resolveRow({ table, rowId }),
          };
      })(),
    );
    try {
      const result = auto.execute("SELECT id FROM t WHERE n=1")[0];
      expect(result.rows).toEqual([[1]]);
      expect(accesses(result)[0].rowsOut).toBe(2);
      expect(result.trace.find((t) => t.operator === "Tapis")?.rowsOut).toBe(1);
    } finally {
      lookup.mockRestore();
    }
  });
  it("does not hide a runtime index error behind a scan", () => {
    const { auto } = indexedPair(),
      failure = new IndexReadError("STALE_INDEX", "Rujukan luput.");
    const lookup = vi.spyOn(auto, "scanIndex").mockImplementationOnce(() => {
      throw failure;
    });
    try {
      expect(() => auto.execute("SELECT id FROM t WHERE n=1")).toThrow(failure);
    } finally {
      lookup.mockRestore();
    }
  });
  it("counts only streamed matches and limited emitted rows", () => {
    const { auto } = indexedPair(),
      search = vi.spyOn(BPlusTree.prototype, "scan");
    try {
      const zero = auto.execute("SELECT id FROM t WHERE n=1 LIMIT 0")[0];
      expect(search).not.toHaveBeenCalled();
      expect(accesses(zero)[0]).toMatchObject({
        rowsOut: 0,
        access: { lookupCalls: 0, matchedRowIds: 0 },
      });
      const one = auto.execute("SELECT id FROM t WHERE n=1 LIMIT 1")[0];
      expect(accesses(one)[0]).toMatchObject({
        rowsOut: 1,
        access: { lookupCalls: 1, matchedRowIds: 1 },
      });
      const missing = auto.execute("SELECT id FROM t WHERE n=99")[0];
      expect(accesses(missing)[0]).toMatchObject({
        rowsOut: 0,
        access: { lookupCalls: 1, matchedRowIds: 0 },
      });
    } finally {
      search.mockRestore();
    }
  });
  it("EXPLAIN ANALYZE exposes the executed operator without estimated costs", () => {
    const { auto } = indexedPair();
    const result = auto.execute(
      "EXPLAIN ANALYZE SELECT id FROM t WHERE n=1",
    )[0];
    expect(result.rows[0][0]).toBe("Carian indeks");
    expect(accesses(result)[0].access).toMatchObject({
      lookupCalls: 1,
      matchedRowIds: 2,
    });
    expect(() => auto.execute("EXPLAIN SELECT id FROM t WHERE n=1")).toThrow(
      /tanpa ANALYZE/,
    );
  });
});
