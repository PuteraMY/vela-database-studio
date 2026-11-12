import { compareEntries } from "./codec";
import {
  requireStorage,
  type Entry,
  type LeafPage,
  type PageId,
  type TreeReader,
} from "./page";

export interface InvariantReport {
  height: number;
  pageCount: number;
  leafCount: number;
  entryCount: number;
}
/** Audits decoded pages, subtree bounds and the complete allocated-page inventory. */
export function validateTree(
  reader: TreeReader,
  allocated: readonly PageId[],
): InvariantReport {
  const visited = new Set<number>(),
    leaves: LeafPage[] = [];
  let leafDepth = -1,
    entryCount = 0;
  const check = (condition: unknown, detail: string) =>
    requireStorage(
      condition,
      "INVARIANT",
      `Invariant B+tree gagal: ${detail}.`,
    );
  function visit(
    id: PageId,
    parent: PageId,
    depth: number,
  ): { min?: Entry; max?: Entry } {
    check(!visited.has(id), `halaman ${id} dikongsi atau berkitar`);
    visited.add(id);
    const node = reader.read(id);
    check(node.id === id && node.parent === parent, `rujukan induk ${id}`);
    const entries = node.kind === "leaf" ? node.entries : node.separators;
    check(entries.length <= reader.format.maxKeys, `kapasiti ${id}`);
    for (let i = 1; i < entries.length; i++)
      check(compareEntries(entries[i - 1], entries[i]) < 0, `turutan ${id}`);
    if (node.kind === "leaf") {
      check(
        parent === 0 || entries.length >= Math.ceil(reader.format.maxKeys / 2),
        `daun kurang isi ${id}`,
      );
      if (leafDepth === -1) leafDepth = depth;
      check(depth === leafDepth, "kedalaman daun tidak seragam");
      leaves.push(node);
      entryCount += entries.length;
      return { min: entries[0], max: entries.at(-1) };
    }
    check(node.children.length === entries.length + 1, `bilangan anak ${id}`);
    check(
      node.children.length >=
        (parent === 0 ? 2 : Math.ceil((reader.format.maxKeys + 1) / 2)),
      `nod dalaman kurang isi ${id}`,
    );
    const bounds = node.children.map((child) => visit(child, id, depth + 1));
    for (let i = 0; i < bounds.length; i++) {
      check(bounds[i].min && bounds[i].max, `subpokok kosong ${id}`);
      if (i === 0) continue;
      check(
        compareEntries(bounds[i - 1].max!, bounds[i].min!) < 0,
        `julat anak bertindih ${id}`,
      );
      check(
        compareEntries(entries[i - 1], bounds[i].min!) === 0,
        `pemisah tidak tepat ${id}`,
      );
    }
    return { min: bounds[0].min, max: bounds.at(-1)!.max };
  }
  visit(reader.rootId, 0, 1);
  leaves.forEach((leaf, i) => {
    check(
      leaf.prev === (leaves[i - 1]?.id ?? 0),
      `pautan daun sebelumnya ${leaf.id}`,
    );
    check(
      leaf.next === (leaves[i + 1]?.id ?? 0),
      `pautan daun seterusnya ${leaf.id}`,
    );
  });
  check(
    visited.size === allocated.length &&
      new Set(allocated).size === allocated.length &&
      allocated.every((id) => visited.has(id)),
    "halaman yatim atau inventori hilang",
  );
  return {
    height: leafDepth,
    pageCount: visited.size,
    leafCount: leaves.length,
    entryCount,
  };
}
