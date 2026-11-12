import { checkedEntry, compareEntries, decodePage, encodePage } from "./codec";
import { lowerBound, rangeCursor, seekLeaf, type RangeOptions } from "./cursor";
import { validateTree, type InvariantReport } from "./invariants";
import { MemoryPager, type PageBatch, type PagerImage } from "./pager";
import {
  FORMAT_VERSION,
  requireStorage,
  uint32,
  validateFormat,
  type Entry,
  type InternalPage,
  type Key,
  type LeafPage,
  type PageFormat,
  type PageId,
  type TreePage,
  type TreeReader,
} from "./page";

export interface TreeOptions {
  pageSize?: number;
  maxKeys?: number;
  maxKeyBytes?: number;
  maxPages?: number;
}
export interface TreeImage {
  version: 1;
  rootId: PageId;
  maxKeys: number;
  maxKeyBytes: number;
  pager: PagerImage;
}
export interface StructureEvent {
  type:
    | "leaf-split"
    | "internal-split"
    | "redistribute-left"
    | "redistribute-right"
    | "leaf-merge"
    | "internal-merge"
    | "root-grow"
    | "root-shrink";
  kind: TreePage["kind"];
  pageId: PageId;
  relatedId: PageId;
}
/** One isolated, ordered, byte-page index. It is not wired to SQL execution. */
export class BPlusTree {
  private events: StructureEvent[] = [];
  private constructor(
    private pager: MemoryPager,
    private root: PageId,
    readonly format: PageFormat,
  ) {}
  static create(options: TreeOptions = {}): BPlusTree {
    const format = Object.freeze({
      pageSize: options.pageSize ?? 4096,
      maxKeys: options.maxKeys ?? 16,
      maxKeyBytes: options.maxKeyBytes ?? 128,
    });
    validateFormat(format);
    const pager = new MemoryPager(format.pageSize, options.maxPages),
      batch = pager.begin(),
      root = batch.allocate();
    batch.write(
      root,
      encodePage(
        { kind: "leaf", id: root, parent: 0, prev: 0, next: 0, entries: [] },
        format,
      ),
    );
    batch.commit();
    return new BPlusTree(pager, root, format);
  }
  static fromImage(image: TreeImage): BPlusTree {
    requireStorage(
      image.version === FORMAT_VERSION && uint32(image.rootId, false),
      "INVALID_ARGUMENT",
      "Metadata pokok tidak sah.",
    );
    const format = Object.freeze({
      pageSize: image.pager.pageSize,
      maxKeys: image.maxKeys,
      maxKeyBytes: image.maxKeyBytes,
    });
    validateFormat(format);
    const tree = new BPlusTree(
      MemoryPager.fromImage(image.pager),
      image.rootId,
      format,
    );
    tree.validate();
    return tree;
  }
  get rootId() {
    return this.root;
  }
  get lastEvents(): readonly StructureEvent[] {
    return this.events.map((event) => ({ ...event }));
  }
  private reader(): TreeReader {
    return {
      rootId: this.root,
      format: this.format,
      read: (id) => decodePage(this.pager.read(id), id, this.format),
      revision: () => this.pager.revision,
    };
  }
  inspectPages(): TreePage[] {
    const reader = this.reader();
    return this.pager.ids().map((id) => reader.read(id));
  }
  exportImage(): TreeImage {
    return {
      version: FORMAT_VERSION,
      rootId: this.root,
      maxKeys: this.format.maxKeys,
      maxKeyBytes: this.format.maxKeyBytes,
      pager: this.pager.exportImage(),
    };
  }
  validate(): InvariantReport {
    return validateTree(this.reader(), this.pager.ids());
  }
  scan(options: RangeOptions = {}): IterableIterator<Entry> {
    return rangeCursor(this.reader(), options);
  }
  search(key: Key): number[] {
    return [...this.scan({ lower: { key }, upper: { key } })].map(
      (entry) => entry.rowId,
    );
  }
  has(key: Key, rowId: number): boolean {
    const target = checkedEntry(key, rowId, this.format),
      leaf = seekLeaf(this.reader(), target),
      i = lowerBound(leaf.entries, target);
    return (
      i < leaf.entries.length && compareEntries(leaf.entries[i], target) === 0
    );
  }
  insert(key: Key, rowId: number): boolean {
    return this.mutate(checkedEntry(key, rowId, this.format), false);
  }
  delete(key: Key, rowId: number): boolean {
    return this.mutate(checkedEntry(key, rowId, this.format), true);
  }
  private mutate(entry: Entry, remove: boolean): boolean {
    const batch = this.pager.begin(),
      edit = new TreeEdit(batch, this.root, this.format);
    try {
      const changed = remove ? edit.remove(entry) : edit.insert(entry);
      if (changed) {
        batch.commit();
        this.root = edit.rootId;
        this.events = edit.events;
      } else {
        batch.rollback();
        this.events = [];
      }
      return changed;
    } catch (error) {
      batch.rollback();
      throw error;
    }
  }
}

/** Mutations see staged images; no changed page reaches the pager before commit. */
class TreeEdit implements TreeReader {
  readonly events: StructureEvent[] = [];
  constructor(
    private batch: PageBatch,
    public rootId: PageId,
    readonly format: PageFormat,
  ) {}
  revision() {
    return 0;
  }
  read(id: PageId): TreePage {
    return decodePage(this.batch.read(id), id, this.format);
  }
  private write(node: TreePage) {
    this.batch.write(node.id, encodePage(node, this.format));
  }
  private record(
    type: StructureEvent["type"],
    node: TreePage,
    relatedId: PageId,
  ) {
    this.events.push({ type, kind: node.kind, pageId: node.id, relatedId });
  }
  private minimum(id: PageId): Entry {
    let node = this.read(id);
    while (node.kind === "internal") node = this.read(node.children[0]);
    requireStorage(
      node.entries.length > 0,
      "INVARIANT",
      "Subpokok bukan akar tidak boleh kosong.",
    );
    return node.entries[0];
  }
  private refresh(node: InternalPage) {
    node.separators = node.children.slice(1).map((id) => this.minimum(id));
  }
  private refreshAncestors(node: TreePage) {
    if (node.parent === 0) return;
    const minimum = this.minimum(node.id);
    while (node.parent !== 0) {
      const parent = this.parent(node),
        position = parent.children.indexOf(node.id);
      if (position > 0) {
        if (compareEntries(parent.separators[position - 1], minimum) !== 0) {
          parent.separators[position - 1] = minimum;
          this.write(parent);
        }
        return;
      }
      // The first child's minimum is inherited, not stored in this parent.
      node = parent;
    }
  }
  private setParent(id: PageId, parent: PageId) {
    const node = this.read(id);
    node.parent = parent;
    this.write(node);
  }
  private parent(node: TreePage): InternalPage {
    const parent = this.read(node.parent);
    requireStorage(
      parent.kind === "internal" && parent.children.includes(node.id),
      "INVARIANT",
      "Rujukan induk/anak tidak sepadan.",
    );
    return parent;
  }
  insert(entry: Entry): boolean {
    const leaf = seekLeaf(this, entry),
      position = lowerBound(leaf.entries, entry);
    if (
      position < leaf.entries.length &&
      compareEntries(leaf.entries[position], entry) === 0
    )
      return false;
    leaf.entries.splice(position, 0, entry);
    if (leaf.entries.length <= this.format.maxKeys) {
      this.write(leaf);
      if (position === 0) this.refreshAncestors(leaf);
      return true;
    }
    const right: LeafPage = {
      kind: "leaf",
      id: this.batch.allocate(),
      parent: leaf.parent,
      prev: leaf.id,
      next: leaf.next,
      entries: leaf.entries.splice(Math.ceil(leaf.entries.length / 2)),
    };
    if (leaf.next !== 0) {
      const next = this.read(leaf.next);
      requireStorage(
        next.kind === "leaf",
        "INVARIANT",
        "Pautan daun tidak sah.",
      );
      next.prev = right.id;
      this.write(next);
    }
    leaf.next = right.id;
    this.write(leaf);
    this.write(right);
    this.record("leaf-split", leaf, right.id);
    this.insertSibling(leaf, right);
    return true;
  }
  private insertSibling(left: TreePage, right: TreePage) {
    if (left.parent === 0) {
      const root: InternalPage = {
        kind: "internal",
        id: this.batch.allocate(),
        parent: 0,
        children: [left.id, right.id],
        separators: [],
      };
      this.setParent(left.id, root.id);
      this.setParent(right.id, root.id);
      this.refresh(root);
      this.write(root);
      this.rootId = root.id;
      this.record("root-grow", root, left.id);
      return;
    }
    const parent = this.parent(left),
      i = parent.children.indexOf(left.id);
    parent.children.splice(i + 1, 0, right.id);
    this.refresh(parent);
    if (parent.children.length <= this.format.maxKeys + 1) {
      this.write(parent);
      this.refreshAncestors(parent);
      return;
    }
    const sibling: InternalPage = {
      kind: "internal",
      id: this.batch.allocate(),
      parent: parent.parent,
      children: parent.children.splice(Math.ceil(parent.children.length / 2)),
      separators: [],
    };
    sibling.children.forEach((id) => this.setParent(id, sibling.id));
    this.refresh(parent);
    this.refresh(sibling);
    this.write(parent);
    this.write(sibling);
    this.record("internal-split", parent, sibling.id);
    this.insertSibling(parent, sibling);
  }
  remove(entry: Entry): boolean {
    const leaf = seekLeaf(this, entry),
      i = lowerBound(leaf.entries, entry);
    if (
      i === leaf.entries.length ||
      compareEntries(leaf.entries[i], entry) !== 0
    )
      return false;
    leaf.entries.splice(i, 1);
    this.write(leaf);
    if (leaf.parent === 0) return true;
    if (leaf.entries.length < this.minimumSize(leaf)) this.rebalance(leaf);
    else if (i === 0) this.refreshAncestors(leaf);
    return true;
  }
  private size(node: TreePage) {
    return node.kind === "leaf" ? node.entries.length : node.children.length;
  }
  private minimumSize(node: TreePage) {
    return Math.ceil(
      (this.format.maxKeys + (node.kind === "internal" ? 1 : 0)) / 2,
    );
  }
  private rebalance(node: TreePage) {
    const parent = this.parent(node),
      i = parent.children.indexOf(node.id);
    const left = i > 0 ? this.read(parent.children[i - 1]) : undefined;
    const right =
      i + 1 < parent.children.length
        ? this.read(parent.children[i + 1])
        : undefined;
    const donor =
      left && this.size(left) > this.minimumSize(left)
        ? left
        : right && this.size(right) > this.minimumSize(right)
          ? right
          : undefined;
    if (donor) {
      const fromLeft = donor.id === left?.id;
      if (node.kind === "leaf" && donor.kind === "leaf") {
        const entry = fromLeft ? donor.entries.pop()! : donor.entries.shift()!;
        if (fromLeft) node.entries.unshift(entry);
        else node.entries.push(entry);
      } else {
        requireStorage(
          node.kind === "internal" && donor.kind === "internal",
          "INVARIANT",
          "Jenis adik-beradik tidak sepadan.",
        );
        const child = fromLeft
          ? donor.children.pop()!
          : donor.children.shift()!;
        if (fromLeft) node.children.unshift(child);
        else node.children.push(child);
        this.setParent(child, node.id);
        this.refresh(node);
        this.refresh(donor);
      }
      this.write(node);
      this.write(donor);
      this.refresh(parent);
      this.write(parent);
      this.refreshAncestors(parent);
      this.record(
        fromLeft ? "redistribute-left" : "redistribute-right",
        node,
        donor.id,
      );
      return;
    }
    requireStorage(
      left || right,
      "INVARIANT",
      "Nod kurang isi tiada adik-beradik.",
    );
    const keep = left ?? node,
      discard = left ? node : right!;
    if (keep.kind === "leaf" && discard.kind === "leaf") {
      keep.entries.push(...discard.entries);
      keep.next = discard.next;
      if (discard.next !== 0) {
        const next = this.read(discard.next);
        requireStorage(
          next.kind === "leaf",
          "INVARIANT",
          "Pautan daun tidak sah.",
        );
        next.prev = keep.id;
        this.write(next);
      }
      this.record("leaf-merge", keep, discard.id);
    } else {
      requireStorage(
        keep.kind === "internal" && discard.kind === "internal",
        "INVARIANT",
        "Jenis adik-beradik tidak sepadan.",
      );
      keep.children.push(...discard.children);
      discard.children.forEach((id) => this.setParent(id, keep.id));
      this.refresh(keep);
      this.record("internal-merge", keep, discard.id);
    }
    this.write(keep);
    this.batch.release(discard.id);
    parent.children.splice(parent.children.indexOf(discard.id), 1);
    if (parent.parent === 0 && parent.children.length === 1) {
      this.setParent(keep.id, 0);
      this.rootId = keep.id;
      this.batch.release(parent.id);
      this.record("root-shrink", keep, parent.id);
      return;
    }
    this.refresh(parent);
    this.write(parent);
    if (
      parent.parent !== 0 &&
      parent.children.length < this.minimumSize(parent)
    )
      this.rebalance(parent);
    else this.refreshAncestors(parent);
  }
}
