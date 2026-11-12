import { describe, expect, it } from "vitest";
import { Database } from "../src/engine/database";
import { compare } from "../src/engine/expression";
import {
  allocateRowId,
  MAX_SQL_KEY_BYTES,
  sqlIndexKey,
  validateIndexes,
} from "../src/engine/indexes";
import { BPlusTree } from "../src/engine/storage/btree";
import { compareKeys, encodeKey } from "../src/engine/storage/codec";
import { MAX_ROW_ID } from "../src/engine/storage/page";
import type { Row, Value } from "../src/engine/types";

const schema =
  "CREATE TABLE t (id INTEGER PRIMARY KEY, n REAL, txt TEXT, b BOOLEAN)";
const indexes =
  "CREATE INDEX ix ON t(n,txt); CREATE INDEX ib ON t(b); CREATE UNIQUE INDEX ui ON t(id)";
function fixture(fixed = false) {
  const db = new Database(
    fixed
      ? { indexStorage: { pageSize: 512, maxKeys: 3, maxKeyBytes: 64 } }
      : {},
  );
  db.execute(schema);
  return db;
}
function entries(db: Database, name = "ix") {
  return [...BPlusTree.fromImage(db.inspectIndex(name)).scan()];
}
function snapshot(db: Database) {
  const state = db.export();
  return {
    state,
    identities: state.tables.map((t) => db.inspectRows(t.name)),
    trees: state.indexes.map((i) => {
      const image = db.inspectIndex(i.name);
      return {
        ...image,
        pager: {
          ...image.pager,
          pages: image.pager.pages.map((page) => ({
            id: page.id,
            bytes: Buffer.from(page.bytes).toString("hex"),
          })),
        },
      };
    }),
  };
}
function atomicFailure(db: Database, sql: string, error: RegExp = /Baris/) {
  const before = snapshot(db);
  expect(() => db.execute(sql)).toThrow(error);
  expect(snapshot(db)).toEqual(before);
  db.validateIndexes();
}

describe("stable internal row identity", () => {
  it("survives key updates and deletion of earlier array positions", () => {
    const db = fixture();
    db.execute(
      "INSERT INTO t VALUES (10,1,'a',TRUE),(20,2,'b',FALSE),(30,3,'c',NULL)",
    );
    db.execute(indexes);
    db.execute(
      "DELETE FROM t WHERE id=10; UPDATE t SET id=21,n=7 WHERE id=20; INSERT INTO t VALUES(40,4,'d',1)",
    );
    expect(db.inspectRows("t").map((r) => [r.rowId, r.row.id])).toEqual([
      [2, 21],
      [3, 30],
      [4, 40],
    ]);
    expect(entries(db, "ui")).toEqual([
      { key: [21], rowId: 2 },
      { key: [30], rowId: 3 },
      { key: [40], rowId: 4 },
    ]);
    expect(db.execute("SELECT * FROM t ORDER BY id")[0].columns).toEqual([
      "id",
      "n",
      "txt",
      "b",
    ]);
    expect(() => db.execute("SELECT rowId FROM t")).toThrow();
    db.validateIndexes();
  });
  it("does not reuse deleted IDs, including a fully emptied table", () => {
    const db = fixture();
    db.execute(
      "INSERT INTO t(id) VALUES(1),(2); DELETE FROM t; INSERT INTO t(id) VALUES(3)",
    );
    expect(db.inspectRows("t")[0].rowId).toBe(3);
  });
  it("does not consume IDs after rejected multi-row inserts", () => {
    const db = fixture();
    db.execute(indexes);
    atomicFailure(db, "INSERT INTO t(id) VALUES(1),(1)", /UNIQUE/);
    db.execute("INSERT INTO t(id) VALUES(2)");
    expect(db.inspectRows("t")[0].rowId).toBe(1);
  });
  it("scopes IDs per table and resets on recreation", () => {
    const db = fixture();
    db.execute(
      "INSERT INTO t(id) VALUES(1); CREATE TABLE u(id INTEGER); INSERT INTO u VALUES(9)",
    );
    expect(db.inspectRows("u")[0].rowId).toBe(1);
    db.execute(
      "DROP TABLE t; CREATE TABLE t(id INTEGER); INSERT INTO t VALUES(8)",
    );
    expect(db.inspectRows("t")[0]).toEqual({ rowId: 1, row: { id: 8 } });
    db.validateIndexes();
  });
  it("keeps IDs for no-op updates and missing deletes", () => {
    const db = fixture();
    db.execute("INSERT INTO t(id) VALUES(1),(2)");
    db.execute(indexes);
    const before = snapshot(db);
    db.execute("UPDATE t SET n=n; DELETE FROM t WHERE id=99");
    expect(snapshot(db)).toEqual(before);
  });
  it("handles the unsigned row-ID boundary without wrapping", () => {
    const identity = { ids: [], nextId: MAX_ROW_ID };
    expect(allocateRowId(identity)).toBe(MAX_ROW_ID);
    expect(() => allocateRowId(identity)).toThrow(/Had identiti/);
    expect(identity.nextId).toBe(MAX_ROW_ID + 1);
  });
  it("keeps diagnostic and schema results detached", () => {
    const db = fixture();
    db.execute("INSERT INTO t(id) VALUES(1)");
    db.execute(indexes);
    const before = snapshot(db);
    db.inspectRows("t")[0].row.id = 99;
    db.inspectIndex("ix").pager.pages[0].bytes.fill(0);
    const schema = db.schema();
    schema[0].indexes[0].columns[0] = "missing";
    schema[0].columns[0].name = "missing";
    expect(snapshot(db)).toEqual(before);
    db.validateIndexes();
  });
});

describe("SQL key semantics and catalog integration", () => {
  it("populates composite and single indexes from existing rows", () => {
    const db = fixture(true);
    db.execute(
      "INSERT INTO t VALUES(1,2,'a',TRUE),(2,NULL,'z',NULL),(3,2,'A',1),(4,2,'a',FALSE)",
    );
    db.execute(indexes);
    expect(entries(db)).toEqual([
      { key: [null, "z"], rowId: 2 },
      { key: [2, "A"], rowId: 3 },
      { key: [2, "a"], rowId: 1 },
      { key: [2, "a"], rowId: 4 },
    ]);
    expect(BPlusTree.fromImage(db.inspectIndex("ib")).search([1])).toEqual([
      1, 3,
    ]);
    expect(db.validateIndexes()).toEqual({
      tables: 1,
      indexes: 3,
      entries: 12,
    });
  });
  it("has a real empty root for an empty declared index", () => {
    const db = fixture();
    db.execute(indexes);
    expect(BPlusTree.fromImage(db.inspectIndex("ix")).validate()).toMatchObject(
      { height: 1, entryCount: 0, pageCount: 1 },
    );
  });
  it("matches existing SQL total ordering across mixed scalar values", () => {
    const values: Value[] = [
      null,
      false,
      true,
      -3,
      -0,
      0,
      1,
      1.5,
      "",
      "1",
      "A",
      "a",
      "é",
      "😀",
      "\ud800",
    ];
    for (const a of values)
      for (const b of values)
        expect(
          Math.sign(
            compareKeys(
              sqlIndexKey({ x: a }, ["x"]),
              sqlIndexKey({ x: b }, ["x"]),
            ),
          ),
        ).toBe(Math.sign(compare(a, b)));
    expect(encodeKey(sqlIndexKey({ x: -0 }, ["x"]))).toEqual(encodeKey([0]));
  });
  it("enforces normalized BOOLEAN uniqueness", () => {
    const db = fixture();
    db.execute(
      "CREATE UNIQUE INDEX ub ON t(b); INSERT INTO t(id,b) VALUES(1,TRUE),(2,FALSE),(3,NULL),(4,NULL)",
    );
    atomicFailure(db, "INSERT INTO t(id,b) VALUES(5,1)", /UNIQUE/);
    atomicFailure(db, "UPDATE t SET b=0 WHERE id=3", /UNIQUE/);
    expect(entries(db, "ub")).toEqual([
      { key: [null], rowId: 3 },
      { key: [null], rowId: 4 },
      { key: [0], rowId: 2 },
      { key: [1], rowId: 1 },
    ]);
  });
  it("allows any NULL component in composite UNIQUE keys", () => {
    const db = fixture();
    db.execute(
      "CREATE UNIQUE INDEX ix ON t(n,txt); INSERT INTO t(id,n,txt) VALUES(1,NULL,'a'),(2,NULL,'a'),(3,1,NULL),(4,1,NULL),(5,NULL,NULL),(6,NULL,NULL),(7,1,'a')",
    );
    atomicFailure(db, "INSERT INTO t(id,n,txt) VALUES(8,1.0,'a')", /UNIQUE/);
    expect(entries(db)).toHaveLength(7);
    db.validateIndexes();
  });
  it("uses case-sensitive UTF-16 text ordering without coercion", () => {
    const db = fixture();
    db.execute(
      "CREATE UNIQUE INDEX ix ON t(txt); INSERT INTO t(id,txt) VALUES(1,'a'),(2,'A'),(3,'1'),(4,'é')",
    );
    expect(entries(db).map((e) => e.key)).toEqual([["1"], ["A"], ["a"], ["é"]]);
    atomicFailure(db, "INSERT INTO t(id,txt) VALUES(5,1)", /TEXT/);
    atomicFailure(db, "INSERT INTO t(id,n) VALUES(5,'1')", /REAL/);
  });
  it("rejects conflicting populated UNIQUE creation without catalog publication", () => {
    const db = fixture();
    db.execute(
      "INSERT INTO t(id,n) VALUES(1,7),(2,7); CREATE INDEX ix ON t(n)",
    );
    atomicFailure(db, "CREATE UNIQUE INDEX bad ON t(n)", /UNIQUE/);
    expect(() => db.inspectIndex("bad")).toThrow();
  });
  it("preserves repeated-column index definitions and IF NOT EXISTS behavior", () => {
    const db = fixture();
    db.execute("INSERT INTO t(id,n) VALUES(1,2); CREATE INDEX ix ON t(n,n)");
    expect(entries(db)).toEqual([{ key: [2, 2], rowId: 1 }]);
    const before = snapshot(db);
    db.execute("CREATE INDEX IF NOT EXISTS ix ON absent(missing)");
    expect(snapshot(db)).toEqual(before);
    atomicFailure(db, "CREATE INDEX ix ON t(id)");
    atomicFailure(db, "CREATE INDEX bad ON t(missing)");
  });
  it("drops only the correct tree and permits name reuse", () => {
    const db = fixture();
    db.execute("INSERT INTO t(id,n) VALUES(1,2)");
    db.execute(indexes);
    const ib = db.inspectIndex("ib");
    db.execute("DROP INDEX ix");
    expect(() => db.inspectIndex("ix")).toThrow();
    expect(db.inspectIndex("ib")).toEqual(ib);
    db.execute("CREATE INDEX ix ON t(id); DROP INDEX IF EXISTS absent");
    expect(entries(db)).toEqual([{ key: [1], rowId: 1 }]);
    atomicFailure(db, "DROP INDEX absent");
  });
  it("rejects unsupported component counts even on an empty table", () => {
    const db = fixture();
    atomicFailure(
      db,
      `CREATE INDEX ix ON t(${Array(65).fill("n").join(",")})`,
      /Takrif indeks/,
    );
    db.execute(
      `CREATE INDEX ix ON t(${Array(64).fill("n").join(",")}); INSERT INTO t(id,n) VALUES(1,2)`,
    );
    expect(entries(db)).toEqual([{ key: Array(64).fill(2), rowId: 1 }]);
    db.validateIndexes();
  });
  it("cleans all table indexes without disturbing another table", () => {
    const db = fixture();
    db.execute(indexes);
    db.execute(
      "CREATE TABLE u(id INTEGER); INSERT INTO u VALUES(1); CREATE INDEX iu ON u(id); DROP TABLE t",
    );
    expect(db.validateIndexes()).toEqual({ tables: 1, indexes: 1, entries: 1 });
    expect(() => db.inspectIndex("ix")).toThrow();
    expect(entries(db, "iu")).toEqual([{ key: [1], rowId: 1 }]);
  });
  it("grows physical slots atomically for longer text keys", () => {
    const db = fixture();
    db.execute(
      "INSERT INTO t(id,txt) VALUES(1,'a'); CREATE INDEX ix ON t(txt)",
    );
    const text = "z".repeat(5000);
    db.execute(`UPDATE t SET txt='${text}' WHERE id=1`);
    expect(entries(db)).toEqual([{ key: [text], rowId: 1 }]);
    expect(db.inspectIndex("ix").maxKeyBytes).toBeGreaterThan(10000);
    db.validateIndexes();
  });
  it("rejects keys beyond the physical maximum without changing rows", () => {
    const db = fixture();
    db.execute(
      "INSERT INTO t(id,txt) VALUES(1,'a'); CREATE INDEX ix ON t(txt)",
    );
    atomicFailure(
      db,
      `UPDATE t SET txt='${"z".repeat(MAX_SQL_KEY_BYTES)}'`,
      /KEY_TOO_LARGE/,
    );
  });
  it("accepts the exact maximum slot size and rejects the next code unit", () => {
    const db = fixture();
    const value = "x".repeat((MAX_SQL_KEY_BYTES - 7) / 2);
    db.execute(
      `INSERT INTO t(id,txt) VALUES(1,'${value}'); CREATE INDEX ix ON t(txt)`,
    );
    expect(encodeKey([value]).length).toBe(MAX_SQL_KEY_BYTES);
    expect(entries(db)).toEqual([{ key: [value], rowId: 1 }]);
    atomicFailure(db, `UPDATE t SET txt=txt || 'x'`, /KEY_TOO_LARGE/);
  });
  it("leaves index bytes unchanged for non-key or normalized-equivalent updates", () => {
    const db = fixture();
    db.execute("INSERT INTO t VALUES(1,2,'a',TRUE); CREATE INDEX ib ON t(b)");
    const before = db.inspectIndex("ib");
    db.execute("UPDATE t SET txt='b',b=1");
    expect(db.inspectIndex("ib")).toEqual(before);
    expect(db.inspectRows("t")[0].row.txt).toBe("b");
    db.validateIndexes();
  });
  it("preserves SELECT results and full-scan traces after index creation", () => {
    const db = fixture();
    db.execute("INSERT INTO t VALUES(1,2,'a',1),(2,NULL,'b',0),(3,2,'c',NULL)");
    const sql = "SELECT n,COUNT(*) FROM t GROUP BY n ORDER BY n";
    const before = db.execute(sql)[0];
    db.execute(indexes);
    const after = db.execute(sql)[0];
    expect(after.rows).toEqual(before.rows);
    expect(after.trace.map((t) => [t.operator, t.rowsIn, t.rowsOut])).toEqual(
      before.trace.map((t) => [t.operator, t.rowsIn, t.rowsOut]),
    );
  });
});

describe("atomic DML and restore", () => {
  it("maintains multiple indexes through multi-row insert, update and delete", () => {
    const db = fixture(true);
    db.execute(indexes);
    db.execute(
      "INSERT INTO t VALUES(1,1,'a',1),(2,2,'b',0),(3,NULL,'c',NULL),(4,1,'a',1)",
    );
    db.execute(
      "UPDATE t SET n=n+10,txt=UPPER(txt) WHERE n IS NOT NULL; DELETE FROM t WHERE id IN(1,3)",
    );
    expect(entries(db)).toEqual([
      { key: [11, "A"], rowId: 4 },
      { key: [12, "B"], rowId: 2 },
    ]);
    expect(db.validateIndexes()).toEqual({ tables: 1, indexes: 3, entries: 6 });
  });
  it("permits final-state unique-key swaps", () => {
    const db = fixture();
    db.execute(
      "INSERT INTO t(id,n) VALUES(1,1),(2,2); CREATE UNIQUE INDEX ix ON t(n); UPDATE t SET n=3-n",
    );
    expect(entries(db)).toEqual([
      { key: [1], rowId: 2 },
      { key: [2], rowId: 1 },
    ]);
    db.validateIndexes();
  });
  it.each([
    "INSERT INTO t(id,n) VALUES(3,3),(4,1)",
    "UPDATE t SET n=1",
    "UPDATE t SET id=NULL WHERE id=2",
    "UPDATE t SET n='wrong' WHERE id=2",
    "INSERT INTO t(id,n) VALUES(3,3),(4,'wrong')",
  ])("rolls back constraint failure: %s", (sql) => {
    const db = fixture();
    db.execute(
      "INSERT INTO t(id,n) VALUES(1,1),(2,2); CREATE UNIQUE INDEX ix ON t(n)",
    );
    atomicFailure(db, sql);
  });
  it("rolls back foreign-key update/delete/drop failures with indexes intact", () => {
    const db = fixture();
    db.execute(
      "INSERT INTO t(id) VALUES(1); CREATE TABLE u(id INTEGER REFERENCES t(id)); INSERT INTO u VALUES(1); CREATE INDEX iu ON u(id)",
    );
    db.execute(indexes);
    for (const sql of [
      "DELETE FROM t",
      "UPDATE t SET id=2",
      "DROP TABLE t",
      "UPDATE u SET id=9",
    ])
      atomicFailure(db, sql);
  });
  it("discards earlier staged indexes when a later index fails", () => {
    const db = fixture(true);
    db.execute(
      "INSERT INTO t(id,n,txt) VALUES(1,1,'a'),(2,2,'b'); CREATE INDEX first ON t(n); CREATE INDEX last ON t(txt)",
    );
    atomicFailure(
      db,
      `UPDATE t SET n=n+10,txt='${"x".repeat(80)}'`,
      /KEY_TOO_LARGE/,
    );
    db.execute("UPDATE t SET n=n+10");
    expect(entries(db, "first")).toEqual([
      { key: [11], rowId: 1 },
      { key: [12], rowId: 2 },
    ]);
  });
  it("rolls back staged splits on page exhaustion, including row ID allocation", () => {
    const db = new Database({
      indexStorage: { pageSize: 512, maxKeys: 3, maxKeyBytes: 64, maxPages: 2 },
    });
    db.execute(
      "CREATE TABLE t(id INTEGER); CREATE INDEX ix ON t(id); INSERT INTO t VALUES(1),(2),(3)",
    );
    atomicFailure(db, "INSERT INTO t VALUES(4),(5)", /PAGE_LIMIT/);
    db.execute("DELETE FROM t WHERE id=2; INSERT INTO t VALUES(6)");
    expect(db.inspectRows("t").map((r) => r.rowId)).toEqual([1, 3, 4]);
    db.validateIndexes();
  });
  it("does not publish CREATE INDEX when physical population fails", () => {
    const db = new Database({
      indexStorage: { pageSize: 512, maxKeys: 3, maxKeyBytes: 64, maxPages: 1 },
    });
    db.execute(
      "CREATE TABLE t(id INTEGER); INSERT INTO t VALUES(1),(2),(3),(4)",
    );
    atomicFailure(db, "CREATE INDEX ix ON t(id)", /PAGE_LIMIT/);
  });
  it("keeps earlier statements when a later statement fails", () => {
    const db = fixture();
    db.execute(indexes);
    expect(() =>
      db.execute("INSERT INTO t(id) VALUES(1); INSERT INTO t(id) VALUES(1)"),
    ).toThrow();
    expect(entries(db, "ui")).toEqual([{ key: [1], rowId: 1 }]);
    db.validateIndexes();
  });
  it("rebuilds physical indexes and starts new identities on logical restore", () => {
    const db = fixture();
    db.execute("INSERT INTO t(id) VALUES(1),(2); DELETE FROM t WHERE id=1");
    db.execute(indexes);
    const logical = db.export();
    expect(logical.tables[0]).not.toHaveProperty("rowIds");
    db.restore(logical);
    expect(db.inspectRows("t")[0].rowId).toBe(1);
    expect(entries(db, "ui")).toEqual([{ key: [2], rowId: 1 }]);
    db.execute("INSERT INTO t(id) VALUES(3)");
    expect(db.inspectRows("t")[1].rowId).toBe(2);
    db.validateIndexes();
  });
  it("keeps all live structures on failed restore", () => {
    const db = fixture(true);
    db.execute(
      "INSERT INTO t(id,txt) VALUES(1,'a'); CREATE INDEX ix ON t(txt)",
    );
    const before = snapshot(db),
      bad = db.export();
    bad.tables[0].rows.push({ id: 2, n: null, txt: "x".repeat(100), b: null });
    expect(() => db.restore(bad)).toThrow(/KEY_TOO_LARGE/);
    expect(snapshot(db)).toEqual(before);
    const invalid = db.export();
    invalid.indexes.push({
      name: "bad",
      table: "missing",
      columns: ["id"],
      unique: false,
    });
    expect(() => db.restore(invalid)).toThrow(/Takrif indeks/);
    expect(snapshot(db)).toEqual(before);
  });
});

describe("complete consistency diagnostic", () => {
  it.each([
    "missing",
    "stale",
    "wrong-key",
    "wrong-row",
    "duplicate-id",
    "missing-tree",
  ])("detects %s", (fault) => {
    const db = fixture();
    db.execute(
      "INSERT INTO t(id,n) VALUES(1,2),(2,3); CREATE INDEX ix ON t(n)",
    );
    const tree = BPlusTree.fromImage(db.inspectIndex("ix"));
    const identities = new Map([["t", { ids: [1, 2], nextId: 3 }]]);
    const physical = new Map([["ix", tree]]);
    if (fault === "missing") tree.delete([2], 1);
    if (fault === "stale") tree.insert([9], 99);
    if (fault === "wrong-key") {
      tree.delete([2], 1);
      tree.insert([9], 1);
    }
    if (fault === "wrong-row") {
      tree.delete([2], 1);
      tree.insert([2], 99);
    }
    if (fault === "duplicate-id")
      identities.set("t", { ids: [1, 1], nextId: 3 });
    if (fault === "missing-tree") physical.clear();
    expect(() => validateIndexes(db.export(), identities, physical)).toThrow();
  });
});

describe("seeded DML against an independent reference list", () => {
  it.each([1, 7, 42, 2026, 0xdeadbeef])(
    "seed %s: exact keys, IDs, order and rollback",
    (seed) => {
      const db = fixture(true),
        twin = fixture(true);
      db.execute(indexes);
      twin.execute(indexes);
      let rng = seed >>> 0,
        nextRowId = 1;
      const random = (max: number) => {
        rng ^= rng << 13;
        rng ^= rng >>> 17;
        rng ^= rng << 5;
        return (rng >>> 0) % max;
      };
      let model: { rowId: number; row: Row }[] = [];
      const literal = (v: Value) =>
        v === null ? "NULL" : typeof v === "string" ? `'${v}'` : String(v);
      const key = (row: Row, names: string[]) =>
        names.map((name) =>
          typeof row[name] === "boolean" ? Number(row[name]) : row[name],
        );
      const order = (a: Value[], b: Value[]) => {
        for (let i = 0; i < a.length; i++) {
          const x = a[i],
            y = b[i];
          if (x === y) continue;
          if (x === null) return -1;
          if (y === null) return 1;
          return x < y ? -1 : 1;
        }
        return 0;
      };
      const history: string[] = [];
      for (let step = 0; step < 400; step++) {
        let candidate = structuredClone(model),
          allocation = nextRowId;
        let sql: string;
        const op = random(5),
          id = random(40);
        if (op <= 1) {
          const rows = Array.from({ length: op + 1 }, (_, i) => ({
            id: id + i,
            n: random(4) === 0 ? null : random(8),
            txt: [null, "A", "a", "z"][random(4)],
            b: [null, true, false, 0, 1][random(5)],
          }));
          sql = `INSERT INTO t VALUES ${rows.map((r) => `(${Object.values(r).map(literal).join(",")})`).join(",")}`;
          candidate.push(...rows.map((row) => ({ rowId: allocation++, row })));
        } else if (op === 2) {
          sql = `DELETE FROM t WHERE id=${id}`;
          candidate = candidate.filter((r) => r.row.id !== id);
        } else if (op === 3) {
          const n = random(4) === 0 ? null : random(8);
          sql = `UPDATE t SET n=${literal(n)},b=TRUE WHERE id=${id}`;
          candidate.forEach((r) => {
            if (r.row.id === id) {
              r.row.n = n;
              r.row.b = true;
            }
          });
        } else {
          sql = "UPDATE t SET n=n+1 WHERE n IS NOT NULL";
          candidate.forEach((r) => {
            if (typeof r.row.n === "number") r.row.n++;
          });
        }
        history.push(sql);
        const label = `seed=${seed} step=${step} recent=${history.slice(-8).join("; ")}`;
        const conflict =
          new Set(candidate.map((r) => r.row.id)).size !== candidate.length;
        if (conflict) {
          const before = snapshot(db);
          expect(() => db.execute(sql), label).toThrow(/UNIQUE/);
          expect(() => twin.execute(sql), label).toThrow(/UNIQUE/);
          expect(snapshot(db), label).toEqual(before);
        } else {
          db.execute(sql);
          twin.execute(sql);
          model = candidate;
          nextRowId = allocation;
        }
        if (step % 10 === 0 || step === 399) {
          expect(db.inspectRows("t"), label).toEqual(model);
          for (const [name, names] of [
            ["ix", ["n", "txt"]],
            ["ib", ["b"]],
            ["ui", ["id"]],
          ] as const) {
            const expected = model
              .map((r) => ({ key: key(r.row, [...names]), rowId: r.rowId }))
              .sort((a, b) => order(a.key, b.key) || a.rowId - b.rowId);
            expect(entries(db, name), label).toEqual(expected);
          }
          db.validateIndexes();
          twin.validateIndexes();
        }
      }
      expect(snapshot(db)).toEqual(snapshot(twin));
    },
    60_000,
  );
});
