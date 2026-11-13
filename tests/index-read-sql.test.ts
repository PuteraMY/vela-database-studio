import { beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import initSqlJs, { type SqlJsStatic } from "sql.js";
import { Database } from "../src/engine/database";
import type { Value } from "../src/engine/types";

let sqlite: SqlJsStatic;
beforeAll(async () => {
  const require = createRequire(import.meta.url);
  sqlite = await initSqlJs({
    locateFile: (file) => require.resolve(`sql.js/dist/${file}`),
  });
});
const setup = `CREATE TABLE t(id INTEGER PRIMARY KEY,k REAL,s TEXT,b BOOLEAN);
INSERT INTO t VALUES(1,1,'A',TRUE),(2,1,'a',1),(3,NULL,'A',NULL),(4,NULL,NULL,NULL),(5,2,'b',FALSE),(6,0,'0',0);
CREATE INDEX ik ON t(k); CREATE INDEX iks ON t(k,s); CREATE INDEX ib ON t(b); CREATE UNIQUE INDEX ui ON t(id);`;
const cases: { sql: string; index: string; key: Value[] }[] = [
  { sql: "SELECT id FROM t WHERE k=1 ORDER BY id", index: "ik", key: [1] },
  { sql: "SELECT id FROM t WHERE k=0 ORDER BY id", index: "ik", key: [-0] },
  {
    sql: "SELECT id FROM t WHERE k IS NULL ORDER BY id",
    index: "ik",
    key: [null],
  },
  {
    sql: "SELECT id FROM t WHERE k=1 AND s='A' ORDER BY id",
    index: "iks",
    key: [1, "A"],
  },
  {
    sql: "SELECT id FROM t WHERE k IS NULL AND s IS NULL ORDER BY id",
    index: "iks",
    key: [null, null],
  },
  {
    sql: "SELECT id FROM t WHERE b=TRUE ORDER BY id",
    index: "ib",
    key: [true],
  },
  {
    sql: "SELECT id FROM t WHERE b=FALSE ORDER BY id",
    index: "ib",
    key: [false],
  },
  { sql: "SELECT id FROM t WHERE id=5 ORDER BY id", index: "ui", key: [5] },
];
describe("SQL differential semantics (SQLite validates SQL, not the internal API)", () => {
  it.each(cases)("$sql", ({ sql, index, key }) => {
    const reference = new sqlite.Database(),
      db = new Database();
    try {
      reference.run(setup);
      db.execute(setup);
      const expected = reference.exec(sql)[0]?.values ?? [];
      expect(db.execute(sql)[0].rows).toEqual(expected);
      // The SQL predicate above explicitly selects the physical matching semantics.
      const table = db.tableHandle("t");
      const rows = db.resolveRows(
        table,
        db.lookupIndex(db.indexHandle(table, index), key),
      );
      expect(
        rows.map((row) => [row.id]).sort((a, b) => Number(a[0]) - Number(b[0])),
      ).toEqual(expected);
    } finally {
      reference.close();
    }
  });
  it("distinguishes a raw NULL key from SQL NULL equality", () => {
    const reference = new sqlite.Database(),
      db = new Database();
    try {
      reference.run(setup);
      db.execute(setup);
      const sql = "SELECT id FROM t WHERE k = NULL";
      expect(reference.exec(sql)[0]?.values ?? []).toEqual([]);
      expect(db.execute(sql)[0].rows).toEqual([]);
      const table = db.tableHandle("t");
      expect(db.lookupIndex(db.indexHandle(table, "ik"), [null])).toHaveLength(
        2,
      );
    } finally {
      reference.close();
    }
  });
  it("matches a bounded physical read to explicit SQL after DML", () => {
    const reference = new sqlite.Database(),
      db = new Database();
    try {
      const dml =
        "UPDATE t SET k=4 WHERE id=1; DELETE FROM t WHERE id=2; INSERT INTO t VALUES(7,1,'z',TRUE);";
      reference.run(setup + dml);
      db.execute(setup + dml);
      const sql = "SELECT id FROM t WHERE k>=1 AND k<3 ORDER BY k,s,id";
      const expected = reference.exec(sql)[0]?.values ?? [];
      expect(db.execute(sql)[0].rows).toEqual(expected);
      const index = db.indexHandle(db.tableHandle("t"), "iks");
      expect(
        [
          ...db.scanIndex(index, {
            lower: { key: [1] },
            upper: { key: [3], inclusive: false },
          }),
        ].map((entry) => [entry.row.id]),
      ).toEqual(expected);
      db.validateIndexes();
    } finally {
      reference.close();
    }
  });
});
