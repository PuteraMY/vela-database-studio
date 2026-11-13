import { describe, expect, it, vi } from "vitest";
import { Database } from "../src/engine/database";
import {
  IndexReadError,
  IndexReadPath,
  type IndexReadCode,
  type RowReference,
} from "../src/engine/index-reader";
import { BPlusTree } from "../src/engine/storage/btree";
import type { RangeOptions } from "../src/engine/storage/cursor";
import type { Value } from "../src/engine/types";

function fixture(rows = true) {
  const db = new Database({
    indexStorage: { pageSize: 512, maxKeys: 3, maxKeyBytes: 64 },
  });
  db.execute(
    "CREATE TABLE t(id INTEGER PRIMARY KEY,k REAL,s TEXT,b BOOLEAN); CREATE INDEX ix ON t(k,s)",
  );
  if (rows)
    db.execute(
      "INSERT INTO t VALUES(10,1,'a',TRUE),(20,1,'a',1),(30,2,'b',FALSE),(40,NULL,'a',NULL)",
    );
  const table = db.tableHandle("t"),
    index = db.indexHandle(table, "ix");
  return { db, table, index };
}
function code(run: () => unknown, expected: IndexReadCode) {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(IndexReadError);
    expect((error as IndexReadError).code).toBe(expected);
    return;
  }
  throw new Error(`Expected ${expected}`);
}
const ids = (refs: readonly RowReference[]) => refs.map((r) => r.rowId);

describe("live stable-ID resolver", () => {
  it("resolves updates without depending on current array positions", () => {
    const { db, table, index } = fixture();
    const refs = db.lookupIndex(index, [1, "a"]);
    expect(ids(refs)).toEqual([1, 2]);
    db.execute("DELETE FROM t WHERE id=10; UPDATE t SET id=21,k=9 WHERE id=20");
    expect(db.resolveRow(refs[1])).toEqual({ id: 21, k: 9, s: "a", b: 1 });
    code(() => db.resolveRow(refs[0]), "MISSING_ROW");
    expect(db.resolveRows(table, db.lookupIndex(index, [9, "a"]))).toEqual([
      { id: 21, k: 9, s: "a", b: 1 },
    ]);
    db.validateIndexes();
  });
  it.each([0, -1, 1.5, NaN, Infinity, 0x100000000])(
    "rejects invalid row ID %s",
    (rowId) => {
      const { db, table } = fixture();
      code(() => db.resolveRow({ table, rowId }), "INVALID_REFERENCE");
    },
  );
  it("rejects missing IDs and never reuses deleted IDs", () => {
    const { db, table } = fixture();
    code(() => db.resolveRow({ table, rowId: 99 }), "MISSING_ROW");
    db.execute("DELETE FROM t; INSERT INTO t(id) VALUES(1)");
    code(() => db.resolveRow({ table, rowId: 1 }), "MISSING_ROW");
    expect(db.resolveRow({ table, rowId: 5 }).id).toBe(1);
  });
  it("scopes overlapping numeric IDs to the correct table", () => {
    const { db, table, index } = fixture();
    db.execute(
      "CREATE TABLE u(id INTEGER); INSERT INTO u VALUES(999); CREATE INDEX iu ON u(id)",
    );
    const other = db.tableHandle("u"),
      otherIndex = db.indexHandle(other, "iu");
    const ref = db.lookupIndex(otherIndex, [999])[0];
    expect(ref.rowId).toBe(1);
    expect(db.resolveRow(ref)).toEqual({ id: 999 });
    code(() => db.resolveRows(table, [ref]), "WRONG_TABLE");
    code(() => db.indexHandle(other, index.name), "WRONG_TABLE");
  });
  it("rejects foreign-database and forged table/index handles", () => {
    const a = fixture(),
      b = fixture();
    code(() => a.db.resolveRow({ table: b.table, rowId: 1 }), "STALE_TABLE");
    code(() => a.db.lookupIndex(b.index, [1, "a"]), "STALE_INDEX");
    code(
      () => a.db.resolveRow({ table: { ...a.table }, rowId: 1 }),
      "STALE_TABLE",
    );
    code(() => a.db.lookupIndex({ ...a.index }, [1, "a"]), "STALE_INDEX");
  });
  it("invalidates old lifetimes on DROP/recreation", () => {
    const { db, table, index } = fixture();
    const old = db.lookupIndex(index, [1, "a"])[0];
    db.execute(
      "DROP TABLE t; CREATE TABLE t(id INTEGER); INSERT INTO t VALUES(999); CREATE INDEX ix ON t(id)",
    );
    code(() => db.resolveRow(old), "STALE_TABLE");
    code(() => db.lookupIndex(index, [1, "a"]), "STALE_INDEX");
    const current = db.tableHandle("t");
    expect(current).not.toBe(table);
    expect(
      db.resolveRows(
        current,
        db.lookupIndex(db.indexHandle(current, "ix"), [999]),
      ),
    ).toEqual([{ id: 999 }]);
  });
  it("invalidates handles on restore and resolves freshly rebuilt indexes", () => {
    const { db, table, index } = fixture();
    db.execute("DELETE FROM t WHERE id=10");
    const old = db.lookupIndex(index, [1, "a"])[0];
    db.restore(db.export());
    code(() => db.resolveRow(old), "STALE_TABLE");
    code(() => db.lookupIndex(index, [1, "a"]), "STALE_INDEX");
    const current = db.tableHandle("t");
    expect(current).not.toBe(table);
    const refs = db.lookupIndex(db.indexHandle(current, "ix"), [1, "a"]);
    expect(ids(refs)).toEqual([1]);
    expect(db.resolveRow(refs[0]).id).toBe(20);
    db.validateIndexes();
  });
  it("returns detached rows and preserves caller order and repeated references", () => {
    const { db, table, index } = fixture();
    const refs = db.lookupIndex(index, [1, "a"]);
    const rows = db.resolveRows(table, [refs[1], refs[0], refs[1]]);
    expect(rows.map((r) => r.id)).toEqual([20, 10, 20]);
    rows[0].id = 999;
    expect(db.resolveRow(refs[1]).id).toBe(20);
    expect(Object.isFrozen(refs[0])).toBe(true);
  });
});

describe("physical exact-key contract", () => {
  it("retains handles while a larger key rebuilds the physical tree", () => {
    const db = new Database();
    db.execute("CREATE TABLE t(s TEXT); CREATE INDEX ix ON t(s)");
    const table = db.tableHandle("t"),
      index = db.indexHandle(table, "ix"),
      cursor = db.scanIndex(index);
    const value = "x".repeat(300);
    db.execute(`INSERT INTO t VALUES('${value}')`);
    expect(db.indexHandle(table, "ix")).toBe(index);
    expect(db.resolveRows(table, db.lookupIndex(index, [value]))).toEqual([
      { s: value },
    ]);
    code(() => cursor.next(), "STALE_CURSOR");
    db.validateIndexes();
  });
  it("handles duplicates, missing keys, NULL and normalized booleans", () => {
    const { db, index, table } = fixture();
    expect(ids(db.lookupIndex(index, [1, "a"]))).toEqual([1, 2]);
    expect(db.lookupIndex(index, [99, "a"])).toEqual([]);
    expect(ids(db.lookupIndex(index, [null, "a"]))).toEqual([4]);
    db.execute("CREATE INDEX ib ON t(b)");
    const ib = db.indexHandle(table, "ib");
    expect(ids(db.lookupIndex(ib, [true]))).toEqual([1, 2]);
    expect(db.lookupIndex(ib, [true])).toEqual(db.lookupIndex(ib, [1]));
    expect(db.lookupIndex(ib, [false])).toEqual(db.lookupIndex(ib, [-0]));
    expect(ids(db.lookupIndex(ib, [null]))).toEqual([4]);
  });
  it("keeps text/numeric values distinct and follows existing case sensitivity", () => {
    const { db, index, table } = fixture();
    expect(db.lookupIndex(index, ["1", "a"])).toEqual([]);
    expect(db.lookupIndex(index, [1, "A"])).toEqual([]);
    db.execute("CREATE INDEX it ON t(s)");
    expect(db.lookupIndex(db.indexHandle(table, "it"), [1])).toEqual([]);
  });
  it("does not collapse repeated-column key components", () => {
    const { db, table } = fixture();
    db.execute("CREATE INDEX repeated ON t(k,k)");
    const index = db.indexHandle(table, "repeated");
    expect(ids(db.lookupIndex(index, [1, 1]))).toEqual([1, 2]);
    expect(db.lookupIndex(index, [1, 2])).toEqual([]);
  });
  it("supports unique indexes and multiple NULL keys", () => {
    const { db, table } = fixture(false);
    db.execute(
      "INSERT INTO t(id,k) VALUES(1,1),(2,NULL),(3,NULL); CREATE UNIQUE INDEX uq ON t(k)",
    );
    const index = db.indexHandle(table, "uq");
    expect(ids(db.lookupIndex(index, [1.0]))).toEqual([1]);
    expect(ids(db.lookupIndex(index, [null]))).toEqual([2, 3]);
    expect(() => db.execute("INSERT INTO t(id,k) VALUES(4,1)")).toThrow(
      /UNIQUE/,
    );
    expect(ids(db.lookupIndex(index, [1]))).toEqual([1]);
  });
  it.each([
    [],
    [1],
    [1, "a", 3],
    [NaN, "a"],
    [Infinity, "a"],
    [1, "x".repeat(80)],
  ])("rejects invalid key %j", (...args) => {
    // Vitest expands array cases; reconstruct the intended composite key.
    const { db, index } = fixture();
    code(() => db.lookupIndex(index, args as Value[]), "INVALID_KEY");
  });
  it("uses current physical keys after insert/update/delete", () => {
    const { db, index } = fixture(false);
    db.execute("INSERT INTO t VALUES(1,1,'a',NULL),(2,1,'a',NULL)");
    expect(ids(db.lookupIndex(index, [1, "a"]))).toEqual([1, 2]);
    db.execute("UPDATE t SET k=2 WHERE id=1; DELETE FROM t WHERE id=2");
    expect(db.lookupIndex(index, [1, "a"])).toEqual([]);
    expect(ids(db.lookupIndex(index, [2, "a"]))).toEqual([1]);
    db.validateIndexes();
  });
  it("rejects missing and dropped/recreated index handles", () => {
    const { db, index, table } = fixture();
    code(() => db.indexHandle(table, "absent"), "MISSING_INDEX");
    db.execute("DROP INDEX ix");
    code(() => db.lookupIndex(index, [1, "a"]), "STALE_INDEX");
    db.execute("CREATE INDEX ix ON t(k,s)");
    code(() => db.scanIndex(index), "STALE_INDEX");
    expect(ids(db.lookupIndex(db.indexHandle(table, "ix"), [1, "a"]))).toEqual([
      1, 2,
    ]);
  });
});

describe("ordered physical cursor", () => {
  it.each([
    { lower: { key: [] } },
    { upper: { key: [1, "a", 3] } },
    { lower: { key: [NaN] } },
  ])("rejects invalid range bounds %j", (options) => {
    const { db, index } = fixture();
    code(() => db.scanIndex(index, options), "INVALID_KEY");
  });
  it("supports empty, single, full and reverse traversal", () => {
    const { db, index } = fixture(false);
    expect([...db.scanIndex(index)]).toEqual([]);
    db.execute("INSERT INTO t VALUES(1,1,'a',NULL)");
    expect([...db.scanIndex(index)].map((r) => r.row.id)).toEqual([1]);
    expect(
      [...db.scanIndex(index, { reverse: true })].map((r) => r.rowId),
    ).toEqual([1]);
    db.execute(
      "INSERT INTO t VALUES(2,2,'b',NULL),(3,1,'a',NULL),(4,NULL,'a',NULL)",
    );
    expect(ids([...db.scanIndex(index)])).toEqual([4, 1, 3, 2]);
    expect(ids([...db.scanIndex(index, { reverse: true })])).toEqual([
      2, 3, 1, 4,
    ]);
  });
  for (const lowerInclusive of [false, true])
    for (const upperInclusive of [false, true])
      for (const reverse of [false, true])
        it(`bounds lower=${lowerInclusive} upper=${upperInclusive} reverse=${reverse}`, () => {
          const { db, index } = fixture();
          const expected = [
            ...(lowerInclusive ? [1, 2] : []),
            ...(upperInclusive ? [3] : []),
          ];
          if (reverse) expected.reverse();
          expect(
            ids([
              ...db.scanIndex(index, {
                lower: { key: [1, "a"], inclusive: lowerInclusive },
                upper: { key: [2, "b"], inclusive: upperInclusive },
                reverse,
              }),
            ]),
          ).toEqual(expected);
        });
  it("supports one-sided, empty and lexicographic prefix bounds", () => {
    const { db, index } = fixture();
    expect(ids([...db.scanIndex(index, { lower: { key: [1] } })])).toEqual([
      1, 2, 3,
    ]);
    expect(ids([...db.scanIndex(index, { upper: { key: [1] } })])).toEqual([4]);
    expect(
      ids([
        ...db.scanIndex(index, { lower: { key: [1] }, upper: { key: [2] } }),
      ]),
    ).toEqual([1, 2]);
    expect([
      ...db.scanIndex(index, { lower: { key: [2] }, upper: { key: [1] } }),
    ]).toEqual([]);
    expect([
      ...db.scanIndex(index, {
        lower: { key: [1, "a"], inclusive: false },
        upper: { key: [1, "a"] },
      }),
    ]).toEqual([]);
  });
  it("copies bounds before first pull and returns detached results", () => {
    const { db, index } = fixture();
    const key: Value[] = [1, "a"],
      cursor = db.scanIndex(index, { lower: { key } });
    key[0] = 99;
    const item = cursor.next();
    expect(item.done).toBe(false);
    if (!item.done) {
      item.value.row.id = 999;
      expect(db.resolveRow(item.value).id).toBe(10);
    }
    expect(ids([...cursor])).toEqual([2, 3]);
  });
  it("crosses splits, merges and root contraction", () => {
    const { db, index } = fixture(false);
    db.execute(
      `INSERT INTO t(id,k,s) VALUES${Array.from({ length: 180 }, (_, i) => `(${i},${Math.floor(i / 3)},'a')`).join(",")}`,
    );
    expect(
      BPlusTree.fromImage(db.inspectIndex("ix")).validate().height,
    ).toBeGreaterThan(2);
    expect(
      ids([
        ...db.scanIndex(index, { lower: { key: [20] }, upper: { key: [22] } }),
      ]),
    ).toEqual([61, 62, 63, 64, 65, 66]);
    db.execute("DELETE FROM t WHERE id<179");
    expect(BPlusTree.fromImage(db.inspectIndex("ix")).validate().height).toBe(
      1,
    );
    expect(ids([...db.scanIndex(index)])).toEqual([180]);
    db.execute("DELETE FROM t");
    expect([...db.scanIndex(index)]).toEqual([]);
    db.validateIndexes();
  });
  it.each([
    "INSERT INTO t(id) VALUES(50)",
    "UPDATE t SET k=7 WHERE id=10",
    "UPDATE t SET b=FALSE",
    "DELETE FROM t WHERE id=10",
    "CREATE TABLE u(id INTEGER)",
    "DROP INDEX ix",
    "UPDATE t SET id=id WHERE id=999",
  ])("fails fast on successful publication: %s", (sql) => {
    const { db, index } = fixture(),
      beforeStart = db.scanIndex(index),
      started = db.scanIndex(index);
    started.next();
    db.execute(sql);
    code(() => beforeStart.next(), "STALE_CURSOR");
    code(() => started.next(), "STALE_CURSOR");
    expect(started.next().done).toBe(true);
  });
  it("keeps handles/cursors valid through reads and failed publication", () => {
    const { db, index } = fixture(),
      cursor = db.scanIndex(index);
    db.execute("SELECT * FROM t");
    expect(() => db.execute("INSERT INTO t(id) VALUES(10)")).toThrow();
    expect(() => db.execute(`UPDATE t SET s='${"z".repeat(80)}'`)).toThrow();
    const bad = db.export();
    bad.tables[0].rows[0].k = "bad";
    expect(() => db.restore(bad)).toThrow();
    expect(ids([...cursor])).toEqual([4, 1, 2, 3]);
    expect(ids(db.lookupIndex(index, [1, "a"]))).toEqual([1, 2]);
  });
  it("invalidates cursors on restore", () => {
    const { db, index } = fixture(),
      cursor = db.scanIndex(index);
    db.restore(db.export());
    code(() => cursor.next(), "STALE_CURSOR");
  });
  it("supports return before/after pull and repeated cleanup", () => {
    const { db, index } = fixture();
    for (const started of [false, true]) {
      const cursor = db.scanIndex(index);
      if (started) cursor.next();
      expect(cursor.return?.().done).toBe(true);
      db.execute("UPDATE t SET id=id");
      expect(cursor.next().done).toBe(true);
      expect(cursor.return?.().done).toBe(true);
    }
    const cursor = db.scanIndex(index),
      error = new Error("cancel");
    expect(() => cursor.throw?.(error)).toThrow(error);
    expect(cursor.next().done).toBe(true);
  });
});

/** Direct service harness permits read instrumentation without exposing DB internals. */
function instrumented() {
  const { db } = fixture(),
    state = db.export(),
    tree = BPlusTree.fromImage(db.inspectIndex("ix"));
  const identities = new Map([["t", { ids: [1, 2, 3, 4], nextId: 5 }]]),
    trees = new Map([["ix", tree]]);
  const reads = new IndexReadPath();
  reads.publish(reads.prepare(state, identities, trees));
  const table = reads.tableHandle("t"),
    index = reads.indexHandle(table, "ix");
  return { state, tree, reads, table, index };
}
describe("no fallback and cursor cleanup", () => {
  it("routes the Database API through physical search and scan", () => {
    const { db, index } = fixture();
    const search = vi
      .spyOn(BPlusTree.prototype, "search")
      .mockReturnValueOnce([]);
    try {
      expect(db.lookupIndex(index, [1, "a"])).toEqual([]);
      expect(search).toHaveBeenCalledWith([1, "a"]);
    } finally {
      search.mockRestore();
    }
    const scan = vi
      .spyOn(BPlusTree.prototype, "scan")
      .mockReturnValueOnce([][Symbol.iterator]());
    try {
      expect([...db.scanIndex(index)]).toEqual([]);
      expect(scan).toHaveBeenCalledTimes(1);
    } finally {
      scan.mockRestore();
    }
  });
  it("reads without accessing table arrays after directory publication", () => {
    const { state, tree, reads, table, index } = instrumented();
    Object.defineProperty(state.tables[0], "rows", {
      get: () => {
        throw new Error("full table access forbidden");
      },
    });
    const search = vi.spyOn(tree, "search"),
      scan = vi.spyOn(tree, "scan");
    expect(reads.resolveRow({ table, rowId: 3 }).id).toBe(30);
    expect(ids(reads.lookupIndex(index, [1, "a"]))).toEqual([1, 2]);
    expect(search).toHaveBeenCalledWith([1, "a"]);
    expect(ids([...reads.scanIndex(index)])).toEqual([4, 1, 2, 3]);
    expect(scan).toHaveBeenCalled();
    search.mockReturnValueOnce([]);
    expect(reads.lookupIndex(index, [1, "a"])).toEqual([]);
  });
  it("pulls only requested rows and closes the actual physical iterator", () => {
    const { tree, reads, index } = instrumented(),
      original = tree.scan.bind(tree);
    const next = vi.fn(),
      close = vi.fn();
    vi.spyOn(tree, "scan").mockImplementation((options) => {
      const source = original(options);
      return {
        [Symbol.iterator]() {
          return this;
        },
        next: () => {
          next();
          return source.next();
        },
        return: () => {
          close();
          source.return?.();
          return { done: true, value: undefined };
        },
      };
    });
    const cursor = reads.scanIndex(index);
    expect(next).not.toHaveBeenCalled();
    for (const entry of cursor) {
      expect(entry.rowId).toBe(4);
      break;
    }
    expect(next).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(cursor.next().done).toBe(true);
    const unopened = reads.scanIndex(index);
    unopened.return?.();
    expect(close).toHaveBeenCalledTimes(2);
  });
  it("rejects missing/wrong-key physical references instead of returning stale rows", () => {
    const { tree, reads, index } = instrumented();
    tree.insert([9, "a"], 99);
    code(() => reads.lookupIndex(index, [9, "a"]), "MISSING_ROW");
    tree.insert([8, "a"], 1);
    code(() => reads.lookupIndex(index, [8, "a"]), "INCONSISTENT_INDEX");
    const cursor = reads.scanIndex(index, { lower: { key: [8] } });
    code(() => cursor.next(), "INCONSISTENT_INDEX");
    expect(cursor.next().done).toBe(true);
  });
});

describe("seeded index reads against independent table scans", () => {
  it.each([7, 2026, 0xdeadbeef])(
    "seed %s",
    (seed) => {
      const { db, table, index } = fixture(false);
      let rng = seed >>> 0,
        nextId = 1;
      const random = (n: number) => {
        rng ^= rng << 13;
        rng ^= rng >>> 17;
        rng ^= rng << 5;
        return (rng >>> 0) % n;
      };
      let model: {
        rowId: number;
        row: { id: number; k: number | null; s: string | null; b: null };
      }[] = [];
      const literal = (v: Value) =>
        v === null ? "NULL" : typeof v === "string" ? `'${v}'` : String(v);
      const cmp = (a: readonly Value[], b: readonly Value[]) => {
        for (let i = 0; i < Math.min(a.length, b.length); i++) {
          const x = a[i],
            y = b[i];
          if (x === y) continue;
          if (x === null) return -1;
          if (y === null) return 1;
          return x < y ? -1 : 1;
        }
        return a.length - b.length;
      };
      const history: string[] = [];
      for (let step = 0; step < 300; step++) {
        const id = random(70),
          k = random(4) === 0 ? null : random(12),
          s = [null, "A", "a", "z"][random(4)],
          op = random(3);
        let sql: string;
        if (op === 0) {
          sql = `INSERT INTO t VALUES(${id},${literal(k)},${literal(s)},NULL)`;
          if (model.some((r) => r.row.id === id)) {
            expect(() => db.execute(sql)).toThrow();
          } else {
            db.execute(sql);
            model.push({ rowId: nextId++, row: { id, k, s, b: null } });
          }
        } else if (op === 1) {
          sql = `UPDATE t SET k=${literal(k)},s=${literal(s)} WHERE id=${id}`;
          db.execute(sql);
          model.forEach((r) => {
            if (r.row.id === id) {
              r.row.k = k;
              r.row.s = s;
            }
          });
        } else {
          sql = `DELETE FROM t WHERE id=${id}`;
          db.execute(sql);
          model = model.filter((r) => r.row.id !== id);
        }
        history.push(sql);
        const label = `seed=${seed} step=${step} recent=${history.slice(-6).join("; ")}`;
        const expected = model
          .filter((r) => cmp([r.row.k, r.row.s], [k, s]) === 0)
          .sort((a, b) => a.rowId - b.rowId);
        const refs = db.lookupIndex(index, [k, s]);
        expect(ids(refs), label).toEqual(expected.map((r) => r.rowId));
        expect(db.resolveRows(table, refs), label).toEqual(
          expected.map((r) => r.row),
        );
        const lower: Value[] = random(2) ? [random(12)] : [null, "A"],
          upper: Value[] = [random(12), "z"];
        const options: RangeOptions = {
          lower: { key: lower, inclusive: !!random(2) },
          upper: { key: upper, inclusive: !!random(2) },
          reverse: !!random(2),
        };
        const ordered = model
          .map((r) => ({ ...r, key: [r.row.k, r.row.s] }))
          .sort((a, b) => cmp(a.key, b.key) || a.rowId - b.rowId);
        const ranged = ordered.filter((r) => {
          const lo = cmp(r.key, lower),
            hi = cmp(r.key, upper);
          return (
            (lo > 0 || (lo === 0 && options.lower?.inclusive)) &&
            (hi < 0 || (hi === 0 && options.upper?.inclusive))
          );
        });
        if (options.reverse) ranged.reverse();
        expect(
          [...db.scanIndex(index, options)].map(({ rowId, key, row }) => ({
            rowId,
            key,
            row,
          })),
          label,
        ).toEqual(ranged);
        if (step % 10 === 0 || step === 299) {
          expect(
            [...db.scanIndex(index)].map(({ rowId, key, row }) => ({
              rowId,
              key,
              row,
            })),
            label,
          ).toEqual(ordered);
          db.validateIndexes();
        }
      }
    },
    30_000,
  );
});
