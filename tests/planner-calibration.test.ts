import { createRequire } from "node:module";
import { beforeAll, expect, it, vi } from "vitest";
import initSqlJs, { type SqlJsStatic } from "sql.js";
import { Database } from "../src/engine/database";
import { planEqualityAccess } from "../src/engine/access-plan";
import { parse } from "../src/engine/parser";
import type { AccessTrace, Value } from "../src/engine/types";

let SQLite: SqlJsStatic;
beforeAll(async () => {
  const require = createRequire(import.meta.url);
  SQLite = await initSqlJs({
    locateFile: (f) => require.resolve(`sql.js/dist/${f}`),
  });
});
const ddl =
  "CREATE TABLE t(id INTEGER PRIMARY KEY,k INTEGER,v INTEGER); CREATE UNIQUE INDEX ix_id ON t(id); CREATE INDEX ix_k ON t(k)";
function stateWith(keys: Value[]) {
  const db = new Database();
  db.execute(ddl);
  const state = db.export();
  state.tables[0].rows = keys.map((k, i) => ({ id: i + 1, k, v: i % 5 }));
  return state;
}
function query(sql: string) {
  const parsed = parse(sql)[0];
  if (parsed.kind !== "select") throw new Error("Expected SELECT");
  return parsed;
}

it.each([
  "SELECT id FROM t WHERE k=3",
  "SELECT id FROM t WHERE k=3 LIMIT 0",
  "SELECT id FROM t WHERE k=3 LIMIT 2",
  "SELECT id FROM t WHERE k=3 LIMIT 1 OFFSET 1",
  "SELECT id FROM t WHERE k=3 LIMIT 1 OFFSET 1-1",
  "SELECT id FROM t WHERE k=3 LIMIT 1+0",
  "SELECT id FROM t WHERE k=3 ORDER BY id LIMIT 1",
  "SELECT DISTINCT v FROM t WHERE k=3 LIMIT 1",
  "SELECT COUNT(*) FROM t WHERE k=3 LIMIT 1",
  "SELECT k,COUNT(*) FROM t WHERE k=3 GROUP BY k HAVING COUNT(*)>0 LIMIT 1",
])("does zero row estimation work for retained shape: %s", (sql) => {
  const state = stateWith(Array.from({ length: 2048 }, (_, i) => i % 10));
  const table = state.tables[0];
  table.rows = new Proxy(table.rows, {
    get(target, property, receiver) {
      if (typeof property === "string" && /^\d+$/.test(property))
        throw new Error("Unexpected planning row read");
      return Reflect.get(target, property, receiver);
    },
  });
  const eligible = { kind: "index-equality" as const, index: "ix_k", key: [3] };
  for (let repeat = 0; repeat < 3; repeat++) {
    const planned = planEqualityAccess(
      query(sql),
      eligible,
      table,
      state.indexes,
    );
    expect(planned.access).toBe(eligible);
    expect(planned.planning).toMatchObject({
      reason: "retain-query-shape",
      prefixRowsRead: 0,
    });
  }
});

it.each([
  [1023, 0, "retain-small-table", 0],
  [1024, 0, "prefix-match", 1],
  [1024, 7, "prefix-match", 8],
  [1024, 8, "prefix-miss", 8],
  [1024, -1, "prefix-miss", 8],
] as const)(
  "keeps exact thresholds: rows=%i position=%i",
  (size, position, reason, reads) => {
    const state = stateWith(
      Array.from({ length: size }, (_, i) => (i === position ? 3 : null)),
    );
    const result = planEqualityAccess(
      query("SELECT id FROM t WHERE k=3 LIMIT 1"),
      { kind: "index-equality", index: "ix_k", key: [3] },
      state.tables[0],
      state.indexes,
    );
    expect(result.planning).toMatchObject({ reason, prefixRowsRead: reads });
    expect(result.access.kind).toBe(
      reason === "prefix-match" ? "table-scan" : "index-equality",
    );
  },
);

const distributions = ["clustered", "uniform", "skewed"] as const;
const workloads = distributions.flatMap((distribution) =>
  [17, 2909, 0x51ced].map((seed) => ({ distribution, seed })),
);
it.each(workloads)(
  "scan/SQLite equivalence and repeatable decisions: $distribution seed=$seed",
  ({ distribution, seed }) => {
    let randomState = seed;
    const random = () => {
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
      return randomState;
    };
    const keys = Array.from({ length: 1536 }, (_, i) => {
      if (i % 17 === 0) return null;
      if (distribution === "clustered") return Math.floor(i / 154);
      const value = random();
      return distribution === "skewed" && value % 10 < 9
        ? 3
        : (value >>> 8) % 10;
    });
    const state = stateWith(keys),
      db = new Database(),
      scan = new Database({ selectAccess: "table-scan" }),
      sqlite = new SQLite.Database();
    db.restore(state);
    scan.restore(state);
    const cursor = vi.spyOn(db, "scanIndex"),
      eager = vi.spyOn(db, "lookupIndex");
    try {
      sqlite.run(ddl);
      const insert = sqlite.prepare("INSERT INTO t VALUES(?,?,?)");
      try {
        for (const row of state.tables[0].rows)
          insert.run([
            Number(row.id),
            row.k === null ? null : Number(row.k),
            Number(row.v),
          ]);
      } finally {
        insert.free();
      }
      const sqlCases = [
        "SELECT id,v FROM t WHERE k=3",
        "SELECT id,v FROM t WHERE k=3 LIMIT 1",
        "SELECT id,v FROM t WHERE 3=k LIMIT 1 OFFSET 0",
        "SELECT id,v FROM t WHERE k=3 LIMIT 1 OFFSET 7",
        "SELECT id,v FROM t WHERE k=3 LIMIT 10 OFFSET 25",
        "SELECT id,v FROM t WHERE k=3 LIMIT 0",
        "SELECT id,v FROM t WHERE k=99 LIMIT 1",
        "SELECT id,v FROM t WHERE id=1535 LIMIT 1",
        "SELECT id,v FROM t WHERE k=NULL LIMIT 1",
        "SELECT id,v FROM t WHERE k IS NULL LIMIT 1",
        "SELECT id,v FROM t WHERE k=3 OR k=4 ORDER BY id LIMIT 1",
        "SELECT id,v FROM t WHERE k=3 AND id>150 LIMIT 1",
        "SELECT id,v FROM t WHERE k=3 ORDER BY id DESC LIMIT 1",
        "SELECT DISTINCT v FROM t WHERE k=3 LIMIT 3 OFFSET 1",
        "SELECT COUNT(*),SUM(v) FROM t WHERE k=3 LIMIT 1",
        "SELECT k,COUNT(*) FROM t WHERE k=3 GROUP BY k HAVING COUNT(*)>1 LIMIT 1",
      ];
      for (const sql of sqlCases) {
        const expected = scan.execute(sql)[0].rows;
        expect(sqlite.exec(sql)[0]?.values ?? [], sql).toEqual(expected);
        let previous: AccessTrace | undefined;
        for (let repeat = 0; repeat < 3; repeat++) {
          cursor.mockClear();
          const result = db.execute(sql)[0],
            access = result.trace.find((t) => t.access)?.access;
          expect(result.rows, sql).toEqual(expected);
          expect(access).toBeDefined();
          if (/IS NULL|=NULL| OR | AND /.test(sql)) {
            expect(access?.kind).toBe("table-scan");
            expect(access?.planning).toBeUndefined();
          }
          if (sql.includes("WHERE id=")) {
            expect(access).toMatchObject({
              kind: "index-equality",
              planning: { reason: "unique-index", prefixRowsRead: 0 },
            });
          }
          if (repeat) expect(access, sql).toEqual(previous);
          previous = access;
          if (access?.kind === "table-scan")
            expect(cursor).not.toHaveBeenCalled();
          else if (!sql.endsWith("LIMIT 0"))
            expect(cursor).toHaveBeenCalledTimes(1);
          if (sql === sqlCases[0]) {
            expect(access).toMatchObject({
              kind: "index-equality",
              matchedRowIds: expected.length,
              lookupCalls: 1,
              planning: { reason: "retain-query-shape", prefixRowsRead: 0 },
            });
          }
          if (sql === sqlCases[1]) {
            const first = keys.indexOf(3);
            const prefix = first >= 0 && first < 8;
            expect(access).toMatchObject({
              kind: prefix ? "table-scan" : "index-equality",
              planning: {
                reason: prefix ? "prefix-match" : "prefix-miss",
                prefixRowsRead: prefix ? first + 1 : 8,
              },
            });
          }
        }
      }
      expect(eager).not.toHaveBeenCalled();
      db.validateIndexes();
    } finally {
      cursor.mockRestore();
      eager.mockRestore();
      sqlite.close();
    }
  },
);

it.each([false, true])(
  "retained large-table cursor closes safely (invalidate=%s)",
  (invalidate) => {
    const db = new Database();
    db.restore(stateWith(Array.from({ length: 1024 }, (_, i) => i % 10)));
    const original = db.scanIndex.bind(db);
    let closed = 0,
      pulls = 0;
    const spy = vi.spyOn(db, "scanIndex").mockImplementationOnce((...args) => {
      const cursor = original(...args);
      return (function* () {
        try {
          for (const entry of cursor) {
            pulls++;
            yield entry;
            if (invalidate) db.execute("DELETE FROM t WHERE id=14");
          }
        } finally {
          cursor.return?.();
          closed++;
        }
      })();
    });
    try {
      const run = () =>
        db.execute("SELECT id FROM t WHERE k=3 LIMIT 2 OFFSET 1")[0];
      if (invalidate) {
        expect(run).toThrow(/berubah/);
        expect(pulls).toBe(1);
      } else {
        const result = run();
        expect(result.rows).toEqual([[14], [24]]);
        expect(pulls).toBe(3);
        expect(result.trace[0].access?.planning).toMatchObject({
          reason: "retain-query-shape",
          prefixRowsRead: 0,
        });
      }
      expect(closed).toBe(1);
      db.validateIndexes();
      expect(db.execute("SELECT id FROM t WHERE k=3 LIMIT 2")[0].rows).toEqual(
        invalidate ? [[4], [24]] : [[4], [14]],
      );
    } finally {
      spy.mockRestore();
    }
  },
);
