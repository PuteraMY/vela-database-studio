import { describe, expect, it } from "vitest";
import {
  BPlusTree,
  type StructureEvent,
  type TreeImage,
} from "../src/engine/storage/btree";
import { decodePage, encodePage } from "../src/engine/storage/codec";
import { MemoryPager } from "../src/engine/storage/pager";
import {
  StorageError,
  type Entry,
  type PageFormat,
  type TreePage,
} from "../src/engine/storage/page";
import { indexTableSnapshot } from "../src/engine/storage/table-index";
import { Database } from "../src/engine/database";
import { orderedKeys, random, shuffled } from "./storage-fixtures";
const small = { pageSize: 256, maxKeys: 3, maxKeyBytes: 32 };
function entries(tree: BPlusTree): Entry[] {
  return [...tree.scan()];
}
function numeric(values: number[]): Entry[] {
  return values.map((i) => ({ key: [i], rowId: i }));
}
function changePage(
  image: TreeImage,
  id: number,
  mutate: (page: TreePage) => void,
) {
  const stored = image.pager.pages.find((page) => page.id === id)!;
  const format: PageFormat = {
    pageSize: image.pager.pageSize,
    maxKeys: image.maxKeys,
    maxKeyBytes: image.maxKeyBytes,
  };
  const page = decodePage(stored.bytes, id, format);
  mutate(page);
  stored.bytes = encodePage(page, format);
}
describe("page-backed B+tree public behavior", () => {
  it("initializes one empty root leaf and handles missing keys/ranges", () => {
    const tree = BPlusTree.create(small);
    expect(tree.rootId).toBe(1);
    expect(tree.search([9])).toEqual([]);
    expect(tree.has([9], 0)).toBe(false);
    expect(tree.delete([9], 0)).toBe(false);
    expect(entries(tree)).toEqual([]);
    expect([...tree.scan({ reverse: true })]).toEqual([]);
    expect(tree.validate()).toEqual({
      height: 1,
      pageCount: 1,
      leafCount: 1,
      entryCount: 0,
    });
  });
  it("supports exact pairs, duplicate keys, NULLs and composite keys", () => {
    const tree = BPlusTree.create(small);
    for (const id of [9, 0xffffffff, 0, 4, 1])
      expect(tree.insert([null, "x"], id)).toBe(true);
    const before = tree.exportImage();
    expect(tree.insert([null, "x"], 4)).toBe(false);
    expect(tree.exportImage()).toEqual(before);
    expect(tree.search([null, "x"])).toEqual([0, 1, 4, 9, 0xffffffff]);
    expect(tree.has([null, "x"], 4)).toBe(true);
    expect(tree.has([null, "x"], 8)).toBe(false);
    expect(tree.delete([null, "x"], 4)).toBe(true);
    expect(tree.search([null, "x"])).toEqual([0, 1, 9, 0xffffffff]);
    tree.insert([false], 0);
    tree.insert([0], 0);
    tree.insert([true], 0);
    tree.insert([1], 0);
    expect(tree.insert([-0], 0)).toBe(false);
    expect(tree.validate().entryCount).toBe(8);
  });
  it.each([3, 4, 5, 8, 16])(
    "grows multiple heights at capacity %i with every insertion order",
    (maxKeys) => {
      for (const order of [
        Array.from({ length: 240 }, (_, i) => i),
        Array.from({ length: 240 }, (_, i) => 239 - i),
        shuffled(240, 351),
      ]) {
        const tree = BPlusTree.create({ maxKeys });
        order.forEach((id, i) => {
          tree.insert([id], id);
          if (i % 20 === 0) tree.validate();
        });
        expect(entries(tree)).toEqual(
          numeric(Array.from({ length: 240 }, (_, i) => i)),
        );
        expect(tree.validate().height).toBeGreaterThanOrEqual(3);
        for (const id of order) expect(tree.search([id])).toEqual([id]);
      }
    },
  );
  it("has deterministic fixed-size images for the same operation schedule", () => {
    const a = BPlusTree.create(small),
      b = BPlusTree.create(small);
    for (const id of shuffled(300, 42)) {
      a.insert([id], id);
      b.insert([id], id);
    }
    for (const id of shuffled(200, 7)) {
      a.delete([id], id);
      b.delete([id], id);
    }
    expect(a.exportImage()).toEqual(b.exportImage());
    expect(
      a
        .exportImage()
        .pager.pages.every((page) => page.bytes.byteLength === 256),
    ).toBe(true);
  });
  it("traverses duplicates across many leaves in both directions", () => {
    const tree = BPlusTree.create(small);
    for (const id of shuffled(100, 17)) tree.insert([7], id);
    expect(tree.search([7])).toEqual(Array.from({ length: 100 }, (_, i) => i));
    expect([...tree.scan({ reverse: true })].map((e) => e.rowId)).toEqual(
      Array.from({ length: 100 }, (_, i) => 99 - i),
    );
    tree.validate();
  });
  it.each([false, true])(
    "honors inclusive/exclusive key bounds, reverse=%s",
    (reverse) => {
      const tree = BPlusTree.create(small);
      for (let key = 0; key < 20; key++)
        for (let rowId = 0; rowId < 3; rowId++) tree.insert([key], rowId);
      for (const lowerInclusive of [false, true])
        for (const upperInclusive of [false, true]) {
          const expected = Array.from({ length: 20 }, (_, i) => i)
            .filter(
              (i) =>
                (lowerInclusive ? i >= 4 : i > 4) &&
                (upperInclusive ? i <= 12 : i < 12),
            )
            .flatMap((key) =>
              [0, 1, 2].map((rowId) => ({ key: [key], rowId })),
            );
          expect([
            ...tree.scan({
              lower: { key: [4], inclusive: lowerInclusive },
              upper: { key: [12], inclusive: upperInclusive },
              reverse,
            }),
          ]).toEqual(reverse ? expected.reverse() : expected);
        }
      expect([...tree.scan({ lower: { key: [21] }, reverse })]).toEqual([]);
      expect([...tree.scan({ upper: { key: [-1] }, reverse })]).toEqual([]);
      expect([
        ...tree.scan({ lower: { key: [12] }, upper: { key: [4] }, reverse }),
      ]).toEqual([]);
      expect([
        ...tree.scan({
          lower: { key: [4], inclusive: false },
          upper: { key: [4] },
          reverse,
        }),
      ]).toEqual([]);
      expect([...tree.scan({ lower: { key: [19] }, reverse })]).toHaveLength(3);
      expect([...tree.scan({ upper: { key: [0] }, reverse })]).toHaveLength(3);
    },
  );
  it("captures caller keys and returns detached keys/pages/images", () => {
    const tree = BPlusTree.create(small),
      key = [7];
    tree.insert(key, 4);
    key[0] = 99;
    const pages = tree.inspectPages();
    if (pages[0].kind === "leaf") pages[0].entries.splice(0);
    const found = entries(tree);
    (found[0].key as number[])[0] = 3;
    const image = tree.exportImage(),
      restored = BPlusTree.fromImage(image);
    image.pager.pages[0].bytes.fill(0);
    expect(tree.search([7])).toEqual([4]);
    expect(restored.search([7])).toEqual([4]);
  });
  it("fails fast on successful mutations but not idempotent or rejected operations", () => {
    const tree = BPlusTree.create(small);
    [1, 2, 3].forEach((i) => tree.insert([i], i));
    const a = tree.scan();
    tree.insert([4], 4);
    expect(() => a.next()).toThrow(/berubah/);
    const b = tree.scan();
    b.next();
    tree.delete([4], 4);
    expect(() => b.next()).toThrow(/berubah/);
    const c = tree.scan();
    c.next();
    tree.insert([2], 2);
    tree.delete([9], 9);
    expect(() => tree.insert([Infinity], 1)).toThrow(StorageError);
    expect(c.next().value).toEqual({ key: [2], rowId: 2 });
    const bound = [2],
      cursor = tree.scan({ lower: { key: bound } });
    bound[0] = 100;
    expect([...cursor]).toEqual(numeric([2, 3]));
  });
  it.each([1, 2])(
    "rolls back partial splits when the page limit is %i",
    (maxPages) => {
      const tree = BPlusTree.create({ ...small, maxPages });
      [1, 2, 3].forEach((i) => tree.insert([i], i));
      const before = tree.exportImage();
      expect(() => tree.insert([4], 4)).toThrow(/Had halaman/);
      expect(tree.exportImage()).toEqual(before);
      expect(entries(tree)).toEqual(numeric([1, 2, 3]));
      tree.validate();
      tree.delete([2], 2);
      expect(tree.insert([4], 4)).toBe(true);
      tree.validate();
    },
  );
  it("rejects invalid keys/row references and capacity configurations", () => {
    const tree = BPlusTree.create(small),
      before = tree.exportImage();
    for (const rowId of [-1, 0.5, NaN, 0x100000000])
      expect(() => tree.insert([0], rowId)).toThrow(StorageError);
    expect(() => tree.insert(["x".repeat(50)], 0)).toThrow(/kapasiti/);
    expect(() => tree.delete([], 0)).toThrow(StorageError);
    expect(() => tree.scan({ upper: { key: [NaN] } })).toThrow(StorageError);
    expect(tree.exportImage()).toEqual(before);
    for (const options of [
      { maxKeys: 2 },
      { pageSize: 256 },
      { maxKeyBytes: 2 },
      { maxKeys: 1000 },
      { maxPages: 0 },
    ])
      expect(() => BPlusTree.create(options)).toThrow(StorageError);
  });
  it("accepts the exact encoded slot boundary and preserves data on overflow", () => {
    const tree = BPlusTree.create({ ...small, maxKeyBytes: 31 });
    tree.insert(["a".repeat(12)], 0xffffffff);
    const before = tree.exportImage();
    expect(() => tree.insert(["a".repeat(13)], 0)).toThrow(/kapasiti/);
    expect(tree.exportImage()).toEqual(before);
    const restored = BPlusTree.fromImage(before);
    restored.insert([null], 0);
    restored.delete(["a".repeat(12)], 0xffffffff);
    restored.validate();
    expect(tree.search(["a".repeat(12)])).toEqual([0xffffffff]);
    expect(entries(restored)).toEqual([{ key: [null], rowId: 0 }]);
  });
});
describe("structural deletion paths", () => {
  it("redistributes leaf entries from the left", () => {
    const tree = BPlusTree.create({ maxKeys: 4 });
    [0, 1, 2, 3, 4].forEach((i) => tree.insert([i], i));
    tree.delete([4], 4);
    expect(tree.lastEvents).toContainEqual(
      expect.objectContaining({ type: "redistribute-left", kind: "leaf" }),
    );
    expect(entries(tree)).toEqual(numeric([0, 1, 2, 3]));
    tree.validate();
  });
  it("redistributes leaf entries from the right", () => {
    const tree = BPlusTree.create({ maxKeys: 4 });
    [0, 1, 2, 3, 4, 5].forEach((i) => tree.insert([i], i));
    tree.delete([0], 0);
    tree.delete([1], 1);
    expect(tree.lastEvents).toContainEqual(
      expect.objectContaining({ type: "redistribute-right", kind: "leaf" }),
    );
    tree.validate();
  });
  it.each([3, 4, 5, 8])(
    "merges, contracts and reuses pages at capacity %i",
    (maxKeys) => {
      const tree = BPlusTree.create({ maxKeys }),
        seen = new Set<string>();
      const collect = () => tree.lastEvents.forEach((e) => seen.add(e.type));
      for (const id of shuffled(500, 51)) {
        tree.insert([id], id);
        collect();
      }
      expect(tree.validate().height).toBeGreaterThan(2);
      for (const [i, id] of shuffled(500, 91).entries()) {
        expect(tree.delete([id], id)).toBe(true);
        collect();
        if (i % 10 === 0) tree.validate();
      }
      expect(entries(tree)).toEqual([]);
      expect(tree.validate()).toEqual({
        height: 1,
        pageCount: 1,
        leafCount: 1,
        entryCount: 0,
      });
      expect([...seen]).toEqual(
        expect.arrayContaining([
          "leaf-split",
          "internal-split",
          "root-grow",
          "leaf-merge",
          "internal-merge",
          "root-shrink",
        ]),
      );
      const before = tree.exportImage().pager.nextId;
      for (let id = 0; id < 100; id++) tree.insert([id], id);
      expect(tree.exportImage().pager.nextId).toBe(before);
      tree.validate();
    },
  );
  it("exercises both internal redistribution directions and checks exact remaining contents", () => {
    const tree = BPlusTree.create({ maxKeys: 4 }),
      events: StructureEvent[] = [],
      model = new Set<number>();
    for (const id of shuffled(700, 711)) {
      tree.insert([id], id);
      model.add(id);
    }
    for (const [step, id] of shuffled(700, 991).entries()) {
      tree.delete([id], id);
      model.delete(id);
      events.push(...tree.lastEvents);
      if (step % 15 === 0) {
        tree.validate();
        expect(entries(tree)).toEqual(
          numeric([...model].sort((a, b) => a - b)),
        );
      }
    }
    for (const type of ["redistribute-left", "redistribute-right"])
      expect(events).toContainEqual(
        expect.objectContaining({ type, kind: "internal" }),
      );
    tree.validate();
  });
});
describe("invariant rejection on detached images", () => {
  const fixture = () => {
    const tree = BPlusTree.create(small);
    for (let i = 0; i < 80; i++) tree.insert([i], i);
    return tree;
  };
  it.each([
    "parent",
    "separator",
    "child",
    "leaf-link",
    "order",
    "occupancy",
    "orphan",
  ])("rejects corrupt %s", (kind) => {
    const tree = fixture(),
      image = tree.exportImage(),
      nodes = tree.inspectPages();
    const leaf = nodes.find((n) => n.kind === "leaf")!,
      root = nodes.find((n) => n.id === tree.rootId)!;
    if (kind === "parent")
      changePage(image, leaf.id, (n) => {
        n.parent = 0;
      });
    if (kind === "separator")
      changePage(image, root.id, (n) => {
        if (n.kind === "internal") n.separators[0] = { key: [-100], rowId: 0 };
      });
    if (kind === "child")
      changePage(image, root.id, (n) => {
        if (n.kind === "internal") n.children[0] = root.id;
      });
    if (kind === "leaf-link")
      changePage(image, leaf.id, (n) => {
        if (n.kind === "leaf") n.next = n.id;
      });
    if (kind === "order")
      changePage(image, leaf.id, (n) => {
        if (n.kind === "leaf") n.entries.reverse();
      });
    if (kind === "occupancy")
      changePage(image, leaf.id, (n) => {
        if (n.kind === "leaf") n.entries = [];
      });
    if (kind === "orphan") {
      const id = image.pager.nextId++;
      image.pager.pages.push({
        id,
        bytes: encodePage(
          { kind: "leaf", id, parent: 0, entries: [], prev: 0, next: 0 },
          small,
        ),
      });
    }
    expect(() => BPlusTree.fromImage(image)).toThrow(StorageError);
    expect(tree.validate().entryCount).toBe(80);
  });
  it("rejects unequal leaf depths", () => {
    const pager = new MemoryPager(256),
      batch = pager.begin();
    for (let i = 0; i < 5; i++) batch.allocate();
    const nodes: TreePage[] = [
      {
        kind: "leaf",
        id: 1,
        parent: 3,
        entries: numeric([0, 1]),
        prev: 0,
        next: 4,
      },
      {
        kind: "internal",
        id: 2,
        parent: 3,
        children: [4, 5],
        separators: numeric([4]),
      },
      {
        kind: "internal",
        id: 3,
        parent: 0,
        children: [1, 2],
        separators: numeric([2]),
      },
      {
        kind: "leaf",
        id: 4,
        parent: 2,
        entries: numeric([2, 3]),
        prev: 1,
        next: 5,
      },
      {
        kind: "leaf",
        id: 5,
        parent: 2,
        entries: numeric([4, 5]),
        prev: 4,
        next: 0,
      },
    ];
    nodes.forEach((node) => batch.write(node.id, encodePage(node, small)));
    batch.commit();
    expect(() =>
      BPlusTree.fromImage({
        version: 1,
        rootId: 3,
        ...small,
        pager: pager.exportImage(),
      }),
    ).toThrow(/kedalaman/);
  });
});
describe("deterministic model-based operations", () => {
  const scenarios = [3, 4, 5, 8, 16].flatMap((capacity) =>
    [1, 7, 42, 2026, 0xdeadbeef].map((seed) => [capacity, seed] as const),
  );
  it.each(scenarios)(
    "capacity=%i seed=%i",
    (maxKeys, seed) => {
      const next = random(seed),
        tree = BPlusTree.create({ maxKeys }),
        model: { ordinal: number; rowId: number }[] = [],
        recent: string[] = [];
      for (let step = 0; step < 1000; step++) {
        const ordinal = Math.floor(next() * orderedKeys.length),
          rowId = Math.floor(next() * 40),
          insert = next() < 0.56;
        recent.push(`${insert ? "insert" : "delete"}(${ordinal},${rowId})`);
        if (recent.length > 20) recent.shift();
        try {
          const found = model.findIndex(
            (e) => e.ordinal === ordinal && e.rowId === rowId,
          );
          const result = insert
            ? tree.insert(orderedKeys[ordinal], rowId)
            : tree.delete(orderedKeys[ordinal], rowId);
          expect(result).toBe(insert ? found < 0 : found >= 0);
          if (insert && found < 0) model.push({ ordinal, rowId });
          if (!insert && found >= 0) model.splice(found, 1);
          if (step % 25 === 0 || step === 999) {
            tree.validate();
            const sorted = [...model].sort(
              (a, b) => a.ordinal - b.ordinal || a.rowId - b.rowId,
            );
            const expected = sorted.map((e) => ({
              key: orderedKeys[e.ordinal],
              rowId: e.rowId,
            }));
            expect(entries(tree)).toEqual(expected);
            expect([...tree.scan({ reverse: true })]).toEqual(
              [...expected].reverse(),
            );
            expect(tree.search(orderedKeys[ordinal])).toEqual(
              sorted.filter((e) => e.ordinal === ordinal).map((e) => e.rowId),
            );
            const low = Math.floor(next() * orderedKeys.length),
              high = Math.floor(next() * orderedKeys.length);
            expect([
              ...tree.scan({
                lower: { key: orderedKeys[low], inclusive: false },
                upper: { key: orderedKeys[high] },
              }),
            ]).toEqual(
              sorted
                .filter((e) => e.ordinal > low && e.ordinal <= high)
                .map((e) => ({ key: orderedKeys[e.ordinal], rowId: e.rowId })),
            );
          }
        } catch (cause) {
          throw new Error(
            `Replay capacity=${maxKeys}, seed=${seed}, step=${step}; recent=${recent.join(";")}`,
            { cause },
          );
        }
      }
      const restored = BPlusTree.fromImage(tree.exportImage());
      expect(entries(restored)).toEqual(entries(tree));
      restored.validate();
    },
    20000,
  );
  it("supports a 100,000-entry deterministic workload with exact scans and complete deletion", () => {
    const count = 100000,
      tree = BPlusTree.create({ maxKeys: 32, maxKeyBytes: 32 });
    for (let i = 0; i < count; i++) {
      tree.insert([i], i);
      if (i % 10000 === 0) tree.validate();
    }
    expect(tree.validate().entryCount).toBe(count);
    expect(entries(tree)).toEqual(
      numeric(Array.from({ length: count }, (_, i) => i)),
    );
    for (let i = 0; i < count; i += 997) expect(tree.search([i])).toEqual([i]);
    expect([...tree.scan({ lower: { key: [99995] } })]).toEqual(
      numeric([99995, 99996, 99997, 99998, 99999]),
    );
    for (let i = 0; i < count; i++) {
      expect(tree.delete([i], i)).toBe(true);
      if (i % 10000 === 0) tree.validate();
    }
    expect(tree.validate()).toEqual({
      height: 1,
      pageCount: 1,
      leafCount: 1,
      entryCount: 0,
    });
  }, 120000);
});
describe("detached table adapter preserves P0 SQL execution", () => {
  it("indexes exported rows without activating SQL index access or changing constraints", () => {
    const db = new Database();
    db.execute(
      "CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, score REAL); INSERT INTO t VALUES (1,'A',1.5),(2,NULL,2.5),(3,'A',3.5); CREATE INDEX names ON t(name);",
    );
    const snapshot = db.export(),
      tree = indexTableSnapshot(snapshot.tables[0], ["name"], small);
    expect(tree.search(["A"])).toEqual([0, 2]);
    expect(tree.search([null])).toEqual([1]);
    expect(
      tree.search(["A"]).map((id) => snapshot.tables[0].rows[id].id),
    ).toEqual([1, 3]);
    tree.validate();
    expect(
      db.execute("SELECT id FROM t WHERE name='A' ORDER BY id")[0].rows,
    ).toEqual([[1], [3]]);
    expect(
      db
        .execute("EXPLAIN ANALYZE SELECT id FROM t WHERE id=1")[0]
        .trace.some((t) => t.operator === "Imbasan jadual"),
    ).toBe(true);
    expect(() => db.execute("EXPLAIN SELECT id FROM t")).toThrow(
      /pengoptimum P1/,
    );
    expect(() =>
      db.execute("CREATE UNIQUE INDEX unique_names ON t(name)"),
    ).toThrow(/UNIQUE/);
    db.execute("UPDATE t SET name='B' WHERE id=1; DELETE FROM t WHERE id=3;");
    expect(tree.search(["A"])).toEqual([0, 2]);
    expect(db.execute("SELECT id FROM t WHERE name='A'")[0].rows).toEqual([]);
    expect(db.schema()[0].indexes.map((i) => i.name)).toEqual(["names"]);
  });
  it("rejects invalid adapter columns and missing row data", () => {
    const db = new Database();
    db.execute("CREATE TABLE t (id INTEGER); INSERT INTO t VALUES (1)");
    const table = db.export().tables[0];
    for (const columns of [[], ["missing"], ["id", "id"]])
      expect(() => indexTableSnapshot(table, columns)).toThrow(StorageError);
    delete table.rows[0].id;
    expect(() => indexTableSnapshot(table, ["id"])).toThrow(StorageError);
  });
});
