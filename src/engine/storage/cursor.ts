import {
  canonicalKey,
  checkedEntry,
  compareEntries,
  compareKeys,
} from "./codec";
import {
  MAX_ROW_ID,
  requireStorage,
  type Entry,
  type Key,
  type LeafPage,
  type TreeReader,
} from "./page";

export interface RangeBound {
  key: Key;
  inclusive?: boolean;
}
export interface RangeOptions {
  lower?: RangeBound;
  upper?: RangeBound;
  reverse?: boolean;
}
export function lowerBound(entries: readonly Entry[], target: Entry): number {
  let low = 0,
    high = entries.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (compareEntries(entries[mid], target) < 0) low = mid + 1;
    else high = mid;
  }
  return low;
}
export function seekLeaf(
  reader: TreeReader,
  target?: Entry,
  last = false,
): LeafPage {
  let node = reader.read(reader.rootId);
  const visited = new Set<number>();
  while (node.kind === "internal") {
    requireStorage(
      !visited.has(node.id),
      "INVARIANT",
      "Kitaran dalam laluan pokok.",
    );
    visited.add(node.id);
    let child = last ? node.children.length - 1 : 0;
    if (target) {
      child = lowerBound(node.separators, target);
      if (
        child < node.separators.length &&
        compareEntries(node.separators[child], target) === 0
      )
        child++;
    }
    node = reader.read(node.children[child]);
  }
  return node;
}
/** Capture bounds/revision immediately, including before the first next(). */
export function rangeCursor(
  reader: TreeReader,
  options: RangeOptions = {},
): IterableIterator<Entry> {
  const revision = reader.revision(),
    reverse = !!options.reverse;
  const copyBound = (bound: RangeBound | undefined) =>
    bound && {
      key: checkedEntry(bound.key, 0, reader.format).key,
      inclusive: bound.inclusive !== false,
    };
  const lower = copyBound(options.lower),
    upper = copyBound(options.upper);
  const guard = () =>
    requireStorage(
      reader.revision() === revision,
      "STALE_CURSOR",
      "Pokok berubah semasa kursor digunakan.",
    );
  return (function* () {
    guard();
    if (lower && upper && compareKeys(lower.key, upper.key) > 0) return;
    const bound = reverse ? upper : lower;
    const target = bound
      ? { key: bound.key, rowId: reverse ? MAX_ROW_ID : 0 }
      : undefined;
    let leaf = seekLeaf(reader, target, reverse);
    let position = target
      ? lowerBound(leaf.entries, target)
      : reverse
        ? leaf.entries.length
        : 0;
    if (reverse) {
      if (
        target &&
        position < leaf.entries.length &&
        compareEntries(leaf.entries[position], target) === 0
      )
        position++;
      position--;
    }
    const visited = new Set<number>();
    while (true) {
      guard();
      requireStorage(
        !visited.has(leaf.id),
        "INVARIANT",
        "Kitaran dalam pautan daun.",
      );
      visited.add(leaf.id);
      for (
        ;
        position >= 0 && position < leaf.entries.length;
        position += reverse ? -1 : 1
      ) {
        guard();
        const entry = leaf.entries[position];
        const below =
          !!lower &&
          (compareKeys(entry.key, lower.key) < 0 ||
            (!lower.inclusive && compareKeys(entry.key, lower.key) === 0));
        const above =
          !!upper &&
          (compareKeys(entry.key, upper.key) > 0 ||
            (!upper.inclusive && compareKeys(entry.key, upper.key) === 0));
        if (reverse ? below : above) return;
        if (below || above) continue;
        yield { key: canonicalKey(entry.key), rowId: entry.rowId };
        guard();
      }
      const id = reverse ? leaf.prev : leaf.next;
      if (id === 0) return;
      const next = reader.read(id);
      requireStorage(
        next.kind === "leaf",
        "INVARIANT",
        "Pautan daun merujuk nod dalaman.",
      );
      leaf = next;
      position = reverse ? leaf.entries.length - 1 : 0;
    }
  })();
}
