import { createRequire } from "node:module";
import { beforeAll, expect, it, vi } from "vitest";
import initSqlJs, { type SqlJsStatic } from "sql.js";
import { Database } from "../src/engine/database";
import { planEqualityAccess } from "../src/engine/access-plan";
import { parse } from "../src/engine/parser";
import { BPlusTree } from "../src/engine/storage/btree";

let SQLite: SqlJsStatic;
beforeAll(async () => {
  const require = createRequire(import.meta.url);
  SQLite = await initSqlJs({
    locateFile: (f) => require.resolve(`sql.js/dist/${f}`),
  });
});
function fixture(size = 2048) {
  const db = new Database();
  db.execute(
    "CREATE TABLE t(id INTEGER PRIMARY KEY,k INTEGER,v TEXT); CREATE UNIQUE INDEX ix_id ON t(id); CREATE INDEX ix_k ON t(k)",
  );
  const state = db.export();
  state.tables[0].rows = Array.from({ length: size }, (_, i) => ({
    id: i + 1,
    k: i === 0 ? null : i % 10,
    v: `r${i}`,
  }));
  db.restore(state);
  return db;
}
it.each([
  ["k=3 LIMIT 1", "table-scan", "prefix-match", 4],
  ["3=k LIMIT 1 OFFSET 0", "table-scan", "prefix-match", 4],
  ["k=7 LIMIT 1", "table-scan", "prefix-match", 8],
  ["k=8 LIMIT 1", "index-equality", "prefix-miss", 8],
  ["k=99 LIMIT 1", "index-equality", "prefix-miss", 8],
  ["id=1999 LIMIT 1", "index-equality", "unique-index", 0],
  ["k=3 LIMIT 2", "index-equality", "retain-query-shape", 0],
  ["k=3 LIMIT 0", "index-equality", "retain-query-shape", 0],
  ["k=3 LIMIT 1 OFFSET 2", "index-equality", "retain-query-shape", 0],
  ["k=3", "index-equality", "retain-query-shape", 0],
  ["k=3 ORDER BY id DESC LIMIT 1", "index-equality", "retain-query-shape", 0],
] as const)(
  "decision and SQLite/scan parity: %s",
  (suffix, kind, reason, reads) => {
    const auto = fixture(),
      scan = new Database({ selectAccess: "table-scan" }),
      sqlite = new SQLite.Database();
    const state = auto.export();
    scan.restore(state);
    try {
      sqlite.run(
        "CREATE TABLE t(id INTEGER PRIMARY KEY,k INTEGER,v TEXT); CREATE UNIQUE INDEX ix_id ON t(id); CREATE INDEX ix_k ON t(k)",
      );
      const insert = sqlite.prepare("INSERT INTO t VALUES(?,?,?)");
      try {
        for (const r of state.tables[0].rows)
          insert.run([
            Number(r.id),
            r.k === null ? null : Number(r.k),
            String(r.v),
          ]);
      } finally {
        insert.free();
      }
      const physical = vi.spyOn(BPlusTree.prototype, "scan");
      try {
        const sql = `SELECT id,v FROM t WHERE ${suffix}`,
          result = auto.execute(sql)[0];
        expect(result.rows).toEqual(scan.execute(sql)[0].rows);
        expect(result.rows).toEqual(sqlite.exec(sql)[0]?.values ?? []);
        const access = result.trace.find((t) => t.access)?.access;
        expect(access).toMatchObject({
          kind,
          planning: { reason, prefixRowsRead: reads, tableRows: 2048 },
        });
        if (kind === "table-scan") {
          expect(physical).not.toHaveBeenCalled();
          expect(access?.planning?.scanRowsUpperBound).toBe(reads);
        } else if (!suffix.endsWith("LIMIT 0"))
          expect(physical).toHaveBeenCalledTimes(1);
      } finally {
        physical.mockRestore();
      }
    } finally {
      sqlite.close();
    }
  },
);
it.each([
  "SELECT DISTINCT k FROM t WHERE k=3 LIMIT 1",
  "SELECT COUNT(*) FROM t WHERE k=3 LIMIT 1",
  "SELECT k,COUNT(*) FROM t WHERE k=3 GROUP BY k LIMIT 1",
  "SELECT id FROM t WHERE k=3 LIMIT 1+0",
])("retains established index path without probing: %s", (sql) => {
  const db = fixture(),
    scan = new Database({ selectAccess: "table-scan" });
  scan.restore(db.export());
  const result = db.execute(sql)[0];
  expect(result.rows).toEqual(scan.execute(sql)[0].rows);
  expect(result.trace.find((t) => t.access)?.access).toMatchObject({
    kind: "index-equality",
    planning: { prefixRowsRead: 0, reason: "retain-query-shape" },
  });
});
it.each(["k=NULL", "k IS NULL", "k=3 OR k=4", "k=3 AND id>5", "k='3'", "k>3"])(
  "preserves unsafe/unsupported fallback: %s",
  (predicate) => {
    const db = fixture(),
      scan = new Database({ selectAccess: "table-scan" });
    scan.restore(db.export());
    const sql = `SELECT id FROM t WHERE ${predicate} LIMIT 1`,
      result = db.execute(sql)[0];
    expect(result.rows).toEqual(scan.execute(sql)[0].rows);
    expect(result.trace.find((t) => t.access)?.access).toMatchObject({
      kind: "table-scan",
    });
    expect(
      result.trace.find((t) => t.access)?.access?.planning,
    ).toBeUndefined();
  },
);
it("bounds planning work independently of table size, including absent keys", () => {
  const db = fixture(),
    state = db.export(),
    table = state.tables[0];
  let reads = 0;
  table.rows = new Proxy(table.rows, {
    get(target, property, receiver) {
      if (typeof property === "string" && /^\d+$/.test(property)) {
        reads++;
        expect(Number(property)).toBeLessThan(8);
      }
      return Reflect.get(target, property, receiver);
    },
  });
  const query = parse("SELECT id FROM t WHERE k=99 LIMIT 1")[0];
  if (query.kind !== "select") throw new Error("expected SELECT");
  const result = planEqualityAccess(
    query,
    { kind: "index-equality", index: "ix_k", key: [99] },
    table,
    state.indexes,
  );
  expect(reads).toBe(8);
  expect(result.access.kind).toBe("index-equality");
});
it("keeps small tables, drops and current mutations deterministic", () => {
  const small = fixture(1023);
  expect(
    small.execute("SELECT id FROM t WHERE k=3 LIMIT 1")[0].trace[0].access
      ?.planning?.reason,
  ).toBe("retain-small-table");
  const db = fixture();
  db.execute("UPDATE t SET k=99 WHERE id=4");
  expect(
    db.execute("SELECT id FROM t WHERE k=3 LIMIT 1")[0].trace[0].access?.kind,
  ).toBe("index-equality");
  db.execute("DELETE FROM t WHERE id=1; DROP INDEX ix_k");
  expect(db.execute("SELECT id FROM t WHERE k=3 LIMIT 1")[0].rows).toEqual([
    [14],
  ]);
  expect(
    db.execute("SELECT id FROM t WHERE k=3 LIMIT 1")[0].trace[0].access,
  ).toMatchObject({ reason: "no-compatible-index" });
});

it("uses the same case-sensitive text equality in the bounded probe", () => {
  const db = fixture();
  db.execute("CREATE INDEX ix_v ON t(v)");
  const scan = new Database({ selectAccess: "table-scan" });
  scan.restore(db.export());
  for (const value of ["r3", "R3"]) {
    const sql = `SELECT id FROM t WHERE v='${value}' LIMIT 1`,
      result = db.execute(sql)[0];
    expect(result.rows).toEqual(scan.execute(sql)[0].rows);
    expect(result.trace[0].access?.kind).toBe(
      value === "r3" ? "table-scan" : "index-equality",
    );
  }
});
