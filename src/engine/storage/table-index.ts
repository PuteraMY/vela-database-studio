import type { Table } from "../types";
import { BPlusTree, type TreeOptions } from "./btree";
import { requireStorage } from "./page";

/** Detached demonstration only: row references are ordinals in this snapshot. */
export function indexTableSnapshot(
  table: Table,
  columns: readonly string[],
  options: TreeOptions = {},
): BPlusTree {
  requireStorage(
    columns.length > 0 &&
      new Set(columns).size === columns.length &&
      columns.every((name) =>
        table.columns.some((column) => column.name === name),
      ),
    "INVALID_ARGUMENT",
    "Lajur indeks snapshot tidak sah.",
  );
  const tree = BPlusTree.create(options);
  table.rows.forEach((row, rowId) => {
    requireStorage(
      columns.every((name) => Object.hasOwn(row, name)),
      "INVALID_ARGUMENT",
      "Rekod snapshot tidak lengkap.",
    );
    tree.insert(
      columns.map((name) => row[name]),
      rowId,
    );
  });
  return tree;
}
