import { orderedKeys } from "./storage-fixtures";
import { describe, expect, it } from "vitest";
import {
  canonicalKey,
  compareKeys,
  decodeKey,
  decodePage,
  encodeKey,
  encodePage,
} from "../src/engine/storage/codec";
import { MemoryPager } from "../src/engine/storage/pager";
import {
  StorageError,
  type Key,
  type LeafPage,
  type PageFormat,
} from "../src/engine/storage/page";

const format: PageFormat = { pageSize: 256, maxKeys: 3, maxKeyBytes: 32 };
const leaf: LeafPage = {
  kind: "leaf",
  id: 1,
  parent: 0,
  prev: 0,
  next: 0,
  entries: [{ key: [1], rowId: 7 }],
};

describe("physical key codec and independent total order", () => {
  it.each(orderedKeys.map((key) => [JSON.stringify(key), key] as const))(
    "round-trips %s",
    (_, key) => {
      expect(decodeKey(encodeKey(key))).toEqual(key);
      expect(encodeKey(key)).toEqual(encodeKey([...key]));
    },
  );
  it("matches the manually ordered heterogeneous domain for every pair", () => {
    orderedKeys.forEach((a, i) =>
      orderedKeys.forEach((b, j) =>
        expect(Math.sign(compareKeys(a, b))).toBe(Math.sign(i - j)),
      ),
    );
  });
  it("has stable numeric and UTF-16 wire bytes", () => {
    expect([...encodeKey([1])]).toEqual([1, 0, 3, 0, 0, 0, 0, 0, 0, 240, 63]);
    expect([...encodeKey(["A"])]).toEqual([1, 0, 4, 1, 0, 0, 0, 65, 0]);
  });
  it("orders and round-trips finite numeric boundaries exactly", () => {
    const numbers = [
      -Number.MAX_VALUE,
      Number.MIN_SAFE_INTEGER,
      -Number.MIN_VALUE,
      0,
      Number.MIN_VALUE,
      Number.MAX_SAFE_INTEGER,
      Number.MAX_VALUE,
    ];
    for (const value of numbers)
      expect(decodeKey(encodeKey([value]))).toEqual([value]);
    numbers.forEach((a, i) =>
      numbers.forEach((b, j) =>
        expect(Math.sign(compareKeys([a], [b]))).toBe(Math.sign(i - j)),
      ),
    );
    expect(
      decodeKey(encodeKey(Array.from({ length: 64 }, () => null))),
    ).toHaveLength(64);
  });
  it("normalizes negative zero but preserves string code units and type distinctions", () => {
    expect(encodeKey([-0])).toEqual(encodeKey([0]));
    expect(Object.is(canonicalKey([-0])[0], -0)).toBe(false);
    expect(decodeKey(encodeKey(["\ud800", "a\0b", "e\u0301", "é"]))).toEqual([
      "\ud800",
      "a\0b",
      "e\u0301",
      "é",
    ]);
    expect(compareKeys([null], [null])).toBe(0);
    expect(compareKeys([true], [1])).toBeLessThan(0);
  });
  it.each(
    [
      [],
      [NaN],
      [Infinity],
      [-Infinity],
      [undefined],
      [{}],
      Array.from({ length: 65 }, () => null),
    ].map((key) => ({ key })),
  )("rejects invalid key %#", ({ key }) => {
    expect(() => encodeKey(key as Key)).toThrow(StorageError);
  });
  it("rejects overlong encodings", () =>
    expect(() => encodeKey(["a".repeat(32768)])).toThrow(/65535/));
  it.each(
    [
      [0],
      [0, 0],
      [1, 0, 9],
      [1, 0, 3],
      [1, 0, 4, 255, 255, 255, 255],
      [1, 0, 0, 0],
    ].map((bytes) => ({ bytes })),
  )("rejects malformed bytes %#", ({ bytes }) => {
    expect(() => decodeKey(Uint8Array.from(bytes))).toThrow(StorageError);
  });
  it("rejects nonfinite and noncanonical floating-point encodings", () => {
    for (const value of [NaN, Infinity, -0]) {
      const bytes = encodeKey([0]);
      new DataView(bytes.buffer).setFloat64(3, value, true);
      expect(() => decodeKey(bytes)).toThrow(StorageError);
    }
  });
});
describe("fixed-size page images", () => {
  it("encodes canonical zero-filled leaf and internal pages", () => {
    const bytes = encodePage(leaf, format);
    expect(bytes.length).toBe(256);
    expect(decodePage(bytes, 1, format)).toEqual(leaf);
    const internal = {
      kind: "internal" as const,
      id: 3,
      parent: 0,
      children: [1, 2],
      separators: [{ key: [10], rowId: 8 }],
    };
    expect(decodePage(encodePage(internal, format), 3, format)).toEqual(
      internal,
    );
    expect(encodePage(decodePage(bytes, 1, format), format)).toEqual(bytes);
    expect(bytes.slice(200)).toEqual(new Uint8Array(56));
  });
  it("rejects page/slot overflow without altering existing images", () => {
    const before = encodePage(leaf, format),
      copy = before.slice();
    expect(() =>
      encodePage(
        { ...leaf, entries: Array.from({ length: 4 }, () => leaf.entries[0]) },
        format,
      ),
    ).toThrow(/kapasiti/);
    expect(() =>
      encodePage(
        { ...leaf, entries: [{ key: ["x".repeat(20)], rowId: 0 }] },
        format,
      ),
    ).toThrow(/kapasiti/);
    expect(before).toEqual(copy);
  });
  it.each([0, 4, 5, 8, 24, 26, 28])(
    "detects corrupt header at byte %i",
    (offset) => {
      const bytes = encodePage(leaf, format);
      bytes[offset] = 255;
      expect(() => decodePage(bytes, 1, format)).toThrow(StorageError);
    },
  );
  it("rejects wrong page identifiers, truncated pages and invalid slot lengths", () => {
    const bytes = encodePage(leaf, format);
    expect(() => decodePage(bytes, 2, format)).toThrow(StorageError);
    expect(() => decodePage(bytes.slice(1), 1, format)).toThrow(StorageError);
    new DataView(bytes.buffer).setUint16(48, 33, true);
    expect(() => decodePage(bytes, 1, format)).toThrow(StorageError);
  });
});
describe("memory pager allocation and failure boundaries", () => {
  it("rejects the uint32 value that JavaScript arrays cannot address as an index", () => {
    expect(new MemoryPager(256, 0xfffffffe).maxPages).toBe(0xfffffffe);
    expect(() => new MemoryPager(256, 0xffffffff)).toThrow(StorageError);
  });
  it("allocates increasing positive IDs and reuses the smallest freed ID", () => {
    const pager = new MemoryPager(256);
    const batch = pager.begin();
    expect([batch.allocate(), batch.allocate(), batch.allocate()]).toEqual([
      1, 2, 3,
    ]);
    batch.commit();
    const release = pager.begin();
    release.release(3);
    release.release(1);
    release.commit();
    const reuse = pager.begin();
    expect([reuse.allocate(), reuse.allocate(), reuse.allocate()]).toEqual([
      1, 3, 4,
    ]);
    reuse.commit();
    expect(pager.ids()).toEqual([1, 2, 3, 4]);
    expect(pager.exportImage().freeIds).toEqual([]);
  });
  it("stages writes/releases and rollback preserves images and allocation sequence", () => {
    const pager = new MemoryPager(256),
      init = pager.begin(),
      id = init.allocate();
    init.commit();
    const before = pager.exportImage(),
      edit = pager.begin(),
      bytes = new Uint8Array(256).fill(7);
    edit.write(id, bytes);
    edit.allocate();
    expect(pager.read(id)[0]).toBe(0);
    expect(edit.read(id)[0]).toBe(7);
    edit.release(id);
    expect(() => edit.read(id)).toThrow(StorageError);
    edit.rollback();
    expect(pager.exportImage()).toEqual(before);
    const next = pager.begin();
    expect(next.allocate()).toBe(2);
    next.rollback();
  });
  it("defensively copies write inputs, reads and snapshot images", () => {
    const pager = new MemoryPager(256),
      batch = pager.begin(),
      id = batch.allocate(),
      bytes = new Uint8Array(256).fill(3);
    batch.write(id, bytes);
    bytes[0] = 9;
    batch.read(id)[1] = 9;
    batch.commit();
    pager.read(id)[0] = 9;
    const image = pager.exportImage(),
      restored = MemoryPager.fromImage(image);
    image.pages[0].bytes[0] = 9;
    expect(pager.read(id)[0]).toBe(3);
    expect(restored.read(id)[0]).toBe(3);
  });
  it("rejects a stale batch without publishing any of its changes", () => {
    const pager = new MemoryPager(256),
      a = pager.begin(),
      b = pager.begin();
    const id = a.allocate();
    a.write(id, new Uint8Array(256).fill(1));
    a.commit();
    b.allocate();
    const before = pager.exportImage();
    expect(() => b.commit()).toThrow(/lapuk/);
    b.rollback();
    expect(pager.exportImage()).toEqual(before);
  });
  it("enforces page limits, rejects double release and closes committed batches", () => {
    const pager = new MemoryPager(256, 1),
      batch = pager.begin(),
      id = batch.allocate();
    expect(() => batch.allocate()).toThrow(/Had halaman/);
    batch.commit();
    expect(() => batch.read(id)).toThrow(/ditutup/);
    const remove = pager.begin();
    remove.release(id);
    expect(() => remove.release(id)).toThrow(StorageError);
    remove.commit();
    const reuse = pager.begin();
    expect(reuse.allocate()).toBe(id);
    reuse.commit();
  });
  it.each([0, -1, 1.5, 0x100000000])(
    "rejects missing/invalid page %s",
    (id) => {
      const pager = new MemoryPager(256);
      expect(() => pager.read(id)).toThrow(StorageError);
      expect(() => pager.begin().write(id, new Uint8Array(256))).toThrow(
        StorageError,
      );
    },
  );
  it.each([0, 255, 300, 131072])("rejects invalid page size %s", (size) =>
    expect(() => new MemoryPager(size)).toThrow(StorageError),
  );
  it("rejects incomplete, duplicated and malformed image inventories", () => {
    const pager = new MemoryPager(256),
      batch = pager.begin();
    batch.allocate();
    batch.commit();
    const image = pager.exportImage();
    expect(() => MemoryPager.fromImage({ ...image, nextId: 3 })).toThrow(
      StorageError,
    );
    expect(() =>
      MemoryPager.fromImage({ ...image, nextId: 3, freeIds: [1] }),
    ).toThrow(StorageError);
    expect(() =>
      MemoryPager.fromImage({
        ...image,
        pages: [{ id: 1, bytes: new Uint8Array(1) }],
      }),
    ).toThrow(StorageError);
    expect(() =>
      MemoryPager.fromImage({ ...image, version: 2 } as never),
    ).toThrow(StorageError);
  });
});
