import { createRequire } from "node:module";
import { beforeAll, expect, it, vi } from "vitest";
import initSqlJs, { type SqlJsStatic } from "sql.js";
import { Database } from "../src/engine/database";
import { Operator } from "../src/engine/iterator";
import { BPlusTree } from "../src/engine/storage/btree";

let SQLite: SqlJsStatic;
beforeAll(async () => {
  const require = createRequire(import.meta.url);
  SQLite = await initSqlJs({
    locateFile: (f) => require.resolve(`sql.js/dist/${f}`),
  });
});
const setup = `CREATE TABLE t(id INTEGER PRIMARY KEY,k INTEGER,v INTEGER);
INSERT INTO t VALUES ${Array.from({ length: 384 }, (_, i) => {
  const id = i + 1;
  return `(${id},${id % 11 === 0 ? "NULL" : id % 13 === 0 ? 8 : 7},${id % 5})`;
}).join(",")}; CREATE INDEX ix ON t(k);`;
const matching = Array.from({ length: 384 }, (_, i) => i + 1).filter(
  (id) => id % 11 !== 0 && id % 13 !== 0,
).length;

it.each([
  ["SELECT id,v FROM t WHERE k=7 LIMIT 0", 0],
  ["SELECT id,v FROM t WHERE k=7 LIMIT 1", 1],
  ["SELECT id,v FROM t WHERE k=7 LIMIT 5 OFFSET 3", 8],
  ["SELECT id FROM t WHERE 7=k LIMIT 1 OFFSET 15", 16],
  ["SELECT id FROM t WHERE k=7 LIMIT 1 OFFSET 999", matching],
  ["SELECT id FROM t WHERE k=7 LIMIT -1 OFFSET 5", matching],
  ["SELECT id FROM t WHERE k=7 LIMIT 1 OFFSET -2", 1],
  ["SELECT x.id+10 AS hasil FROM t x WHERE x.k=7 LIMIT 1", 1],
  ["SELECT id FROM t WHERE k=99 LIMIT 1", 0],
  ["SELECT id FROM t WHERE k=7 ORDER BY v DESC,id DESC LIMIT 1", matching],
  ["SELECT id FROM t WHERE k=7 ORDER BY id DESC LIMIT 2 OFFSET 4", matching],
  ["SELECT DISTINCT v FROM t WHERE k=7 LIMIT 2 OFFSET 1", 3],
  ["SELECT DISTINCT k FROM t WHERE k=7 LIMIT 1", 1],
  ["SELECT DISTINCT k FROM t WHERE k=7 LIMIT 1 OFFSET 1", matching],
  ["SELECT DISTINCT v FROM t WHERE k=7 ORDER BY v DESC LIMIT 1", matching],
  ["SELECT COUNT(*),SUM(v),AVG(v) FROM t WHERE k=7 LIMIT 1", matching],
  [
    "SELECT v,COUNT(*) FROM t WHERE k=7 GROUP BY v ORDER BY v LIMIT 1",
    matching,
  ],
  [
    "SELECT v,COUNT(*) FROM t WHERE k=7 GROUP BY v HAVING COUNT(*)>3 ORDER BY v LIMIT 1",
    matching,
  ],
  ["SELECT COUNT(*) FROM t WHERE k=99 LIMIT 1", 0],
] as const)(
  "streaming SQL matches scan/SQLite and reads only needed entries: %s",
  (sql, pulled) => {
    const auto = new Database(),
      scan = new Database({ selectAccess: "table-scan" }),
      sqlite = new SQLite.Database();
    try {
      auto.execute(setup);
      scan.execute(setup);
      sqlite.run(setup);
      const result = auto.execute(sql)[0];
      expect(result.rows).toEqual(scan.execute(sql)[0].rows);
      expect(result.rows).toEqual(sqlite.exec(sql)[0]?.values ?? []);
      expect(result.trace.find((t) => t.access)?.access).toMatchObject({
        kind: "index-equality",
        matchedRowIds: pulled,
        lookupCalls: sql.endsWith("LIMIT 0") ? 0 : 1,
      });
    } finally {
      sqlite.close();
    }
  },
);

it.each(["k=7 OR k=8", "k=7 AND v>2", "k IS NULL", "k=NULL", "k>7", "k='7'"])(
  "retains scan fallback and LIMIT semantics: %s",
  (predicate) => {
    const auto = new Database(),
      scan = new Database({ selectAccess: "table-scan" });
    auto.execute(setup);
    scan.execute(setup);
    const physical = vi.spyOn(BPlusTree.prototype, "scan");
    try {
      const sql = `SELECT id,v FROM t WHERE ${predicate} LIMIT 2 OFFSET 1`;
      const result = auto.execute(sql)[0];
      expect(result.rows).toEqual(scan.execute(sql)[0].rows);
      expect(result.trace.find((t) => t.access)?.access?.kind).toBe(
        "table-scan",
      );
      expect(physical).not.toHaveBeenCalled();
    } finally {
      physical.mockRestore();
    }
  },
);

it("streams live rows after deletes, updates, inserts and index recreation", () => {
  const auto = new Database(),
    scan = new Database({ selectAccess: "table-scan" }),
    sqlite = new SQLite.Database();
  try {
    for (const sql of [
      setup,
      "DELETE FROM t WHERE id=1; UPDATE t SET k=8 WHERE id=2; INSERT INTO t VALUES(500,7,99)",
      "DROP INDEX ix; CREATE INDEX ix ON t(k)",
    ]) {
      auto.execute(sql);
      scan.execute(sql);
      sqlite.run(sql);
      const query = "SELECT id,v FROM t WHERE k=7 ORDER BY id LIMIT 7 OFFSET 1";
      expect(auto.execute(query)[0].rows).toEqual(scan.execute(query)[0].rows);
      expect(auto.execute(query)[0].rows).toEqual(sqlite.exec(query)[0].values);
      auto.validateIndexes();
    }
    expect(auto.execute("SELECT id FROM t WHERE k=7 LIMIT 1")[0].rows).toEqual([
      [3],
    ]);
  } finally {
    sqlite.close();
  }
});

it.each([
  "LIMIT 1",
  "LIMIT 2 OFFSET 3",
  "LIMIT 999",
  "ORDER BY id DESC LIMIT 1",
])("closes the actual cursor without an extra pull: %s", (suffix) => {
  const db = new Database();
  db.execute(setup);
  const original = BPlusTree.prototype.scan;
  let yielded = 0,
    closed = 0;
  const eager = vi.spyOn(db, "lookupIndex");
  const physical = vi
    .spyOn(BPlusTree.prototype, "scan")
    .mockImplementation(function (this: BPlusTree, options) {
      const cursor = original.call(this, options);
      return (function* () {
        try {
          for (const entry of cursor) {
            yielded++;
            yield entry;
          }
        } finally {
          closed++;
        }
      })();
    });
  try {
    const result = db.execute(`SELECT id FROM t WHERE k=7 ${suffix}`)[0];
    expect(closed).toBe(1);
    expect(yielded).toBe(
      suffix === "LIMIT 1" ? 1 : suffix === "LIMIT 2 OFFSET 3" ? 5 : matching,
    );
    expect(result.trace.find((t) => t.access)?.access).toMatchObject({
      matchedRowIds: yielded,
    });
    expect(eager).not.toHaveBeenCalled();
  } finally {
    physical.mockRestore();
    eager.mockRestore();
  }
});

it("counts qualifying rows after residual filtering, then closes", () => {
  const db = new Database();
  db.execute(setup);
  const table = db.tableHandle("t");
  let pulled = 0,
    closed = false;
  const cursor = vi.spyOn(db, "scanIndex").mockReturnValueOnce(
    (function* () {
      try {
        for (const id of [13, 1, 26, 2, 3]) {
          pulled++;
          yield {
            table,
            rowId: id,
            key: [7],
            row: db.resolveRow({ table, rowId: id }),
          };
        }
      } finally {
        closed = true;
      }
    })(),
  );
  try {
    const result = db.execute("SELECT id FROM t WHERE k=7 LIMIT 1 OFFSET 1")[0];
    expect(result.rows).toEqual([[2]]);
    expect(pulled).toBe(4);
    expect(closed).toBe(true);
    expect(result.trace.find((t) => t.operator === "Tapis")?.rowsOut).toBe(2);
  } finally {
    cursor.mockRestore();
  }
});

it("fails and closes safely when a cursor is invalidated during consumption", () => {
  const db = new Database();
  db.execute(setup);
  const original = db.scanIndex.bind(db);
  let closed = false;
  const spy = vi.spyOn(db, "scanIndex").mockImplementationOnce((...args) => {
    const cursor = original(...args);
    return (function* () {
      try {
        const first = cursor.next();
        if (!first.done) yield first.value;
        db.execute("DELETE FROM t WHERE id=2");
        yield* cursor;
      } finally {
        cursor.return?.();
        closed = true;
      }
    })();
  });
  try {
    expect(() => db.execute("SELECT id FROM t WHERE k=7 LIMIT 2")).toThrow(
      /berubah/,
    );
    expect(closed).toBe(true);
    expect(db.execute("SELECT id FROM t WHERE k=7 LIMIT 2")[0].rows).toEqual([
      [1],
      [3],
    ]);
  } finally {
    spy.mockRestore();
  }
});

it("propagates source failures and runs cursor cleanup", () => {
  const db = new Database();
  db.execute(setup);
  let closed = false;
  const failure = new Error("test cursor failure");
  const spy = vi.spyOn(db, "scanIndex").mockReturnValueOnce(
    (function* () {
      try {
        const table = db.tableHandle("t");
        yield {
          table,
          rowId: 1,
          key: [7],
          row: db.resolveRow({ table, rowId: 1 }),
        };
        throw failure;
      } finally {
        closed = true;
      }
    })(),
  );
  try {
    expect(() => db.execute("SELECT id FROM t WHERE k=7 LIMIT 2")).toThrow(
      failure,
    );
    expect(closed).toBe(true);
  } finally {
    spy.mockRestore();
  }
});

it("Operator closes inputs on downstream error and prevents reuse", () => {
  let closed = 0;
  const source = new Operator(0, "test", "", [], function* () {
    try {
      yield { row: {} };
      yield { row: {} };
    } finally {
      closed++;
    }
  });
  const failProjection = () => {
    throw new Error("projection failure");
  };
  const failed = new Operator(1, "test", "", [source], function* () {
    source.next();
    failProjection();
    yield { row: {} };
  });
  expect(() => failed.next()).toThrow("projection failure");
  expect(closed).toBe(1);
  expect(source.next().done).toBe(true);
  expect(failed.next().done).toBe(true);
  failed.return();
  source.return();
  expect(closed).toBe(1);
});

it("rejects a stale physical row reference and closes the cursor", () => {
  const db = new Database();
  db.execute(setup);
  let closed = false;
  const physical = vi.spyOn(BPlusTree.prototype, "scan").mockReturnValueOnce(
    (function* () {
      try {
        yield { key: [7], rowId: 99999 };
      } finally {
        closed = true;
      }
    })(),
  );
  try {
    expect(() => db.execute("SELECT id FROM t WHERE k=7 LIMIT 1")).toThrow(
      /baris/i,
    );
    expect(closed).toBe(true);
  } finally {
    physical.mockRestore();
  }
});

it("Operator return before first pull never opens its source", () => {
  const produce = vi.fn(function* () {
    yield { row: {} };
  });
  const source = new Operator(0, "test", "", [], produce);
  source.return();
  source.return();
  expect(source.next().done).toBe(true);
  expect(produce).not.toHaveBeenCalled();
});
