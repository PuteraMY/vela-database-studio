import {
  normalizeIndexKey,
  sqlIndexKey,
  type PhysicalIndexes,
  type RowIdentities,
} from "./indexes";
import type { BPlusTree } from "./storage/btree";
import { checkedEntry, compareKeys } from "./storage/codec";
import type { RangeOptions } from "./storage/cursor";
import { StorageError, uint32, type Entry, type Key } from "./storage/page";
import type { DatabaseState, Row, Value } from "./types";

const tableBrand: unique symbol = Symbol("table-lifetime");
const indexBrand: unique symbol = Symbol("index-lifetime");
export interface TableHandle {
  readonly name: string;
  readonly [tableBrand]: true;
}
export interface IndexHandle {
  readonly name: string;
  readonly table: TableHandle;
  readonly [indexBrand]: true;
}
export interface RowReference {
  readonly table: TableHandle;
  readonly rowId: number;
}
export interface IndexRow extends RowReference {
  readonly key: Key;
  readonly row: Row;
}
export type IndexReadCode =
  | "STALE_TABLE"
  | "STALE_INDEX"
  | "MISSING_INDEX"
  | "MISSING_ROW"
  | "WRONG_TABLE"
  | "INVALID_REFERENCE"
  | "INVALID_KEY"
  | "STALE_CURSOR"
  | "INCONSISTENT_INDEX";
export class IndexReadError extends Error {
  constructor(
    readonly code: IndexReadCode,
    message: string,
  ) {
    super(message);
    this.name = "IndexReadError";
  }
}
function check(
  condition: unknown,
  code: IndexReadCode,
  message: string,
): asserts condition {
  if (!condition) throw new IndexReadError(code, message);
}
interface RowDirectory {
  handle: TableHandle;
  rows: Map<number, Row>;
}
interface IndexBinding {
  handle: IndexHandle;
  columns: readonly string[];
  tree: BPlusTree;
}
interface ReadState {
  revision: symbol;
  tables: Map<string, RowDirectory>;
  indexes: Map<string, IndexBinding>;
}

/** Internal read service. Maps address existing row IDs/catalog names, never index keys. */
export class IndexReadPath {
  private current: ReadState = {
    revision: Symbol(),
    tables: new Map(),
    indexes: new Map(),
  };

  /** Build once per publication, outside the read path. No second row-ID allocator. */
  prepare(
    state: DatabaseState,
    identities: RowIdentities,
    indexes: PhysicalIndexes,
    reset = false,
  ): ReadState {
    const next: ReadState = {
      revision: Symbol(),
      tables: new Map(),
      indexes: new Map(),
    };
    for (const table of state.tables) {
      const ids = identities.get(table.name)?.ids;
      check(
        ids && ids.length === table.rows.length,
        "INCONSISTENT_INDEX",
        "Identiti jadual tidak sepadan.",
      );
      const handle =
        (!reset && this.current.tables.get(table.name)?.handle) ||
        Object.freeze({ name: table.name, [tableBrand]: true as const });
      const rows = new Map<number, Row>();
      table.rows.forEach((row, i) => {
        check(
          uint32(ids[i], false) && !rows.has(ids[i]),
          "INCONSISTENT_INDEX",
          "Identiti baris tidak sah.",
        );
        rows.set(ids[i], row);
      });
      next.tables.set(table.name, { handle, rows });
    }
    for (const definition of state.indexes) {
      const table = next.tables.get(definition.table),
        tree = indexes.get(definition.name);
      check(
        table && tree,
        "INCONSISTENT_INDEX",
        "Pemilik atau pokok indeks tiada.",
      );
      const previous = !reset && this.current.indexes.get(definition.name);
      const handle =
        previous &&
        previous.handle.table === table.handle &&
        JSON.stringify(previous.columns) === JSON.stringify(definition.columns)
          ? previous.handle
          : Object.freeze({
              name: definition.name,
              table: table.handle,
              [indexBrand]: true as const,
            });
      next.indexes.set(definition.name, {
        handle,
        columns: [...definition.columns],
        tree,
      });
    }
    return next;
  }
  publish(state: ReadState): void {
    this.current = state;
  }

  tableHandle(name: string): TableHandle {
    const directory = this.current.tables.get(name);
    check(directory, "STALE_TABLE", `Jadual “${name}” tidak wujud.`);
    return directory.handle;
  }
  private directory(table: TableHandle): RowDirectory {
    const directory = this.current.tables.get(table?.name);
    check(
      directory && directory.handle === table,
      "STALE_TABLE",
      "Rujukan jadual luput atau berasal daripada pangkalan data lain.",
    );
    return directory;
  }
  indexHandle(table: TableHandle, name: string): IndexHandle {
    this.directory(table);
    const binding = this.current.indexes.get(name);
    check(binding, "MISSING_INDEX", `Indeks “${name}” tidak wujud.`);
    check(
      binding.handle.table === table,
      "WRONG_TABLE",
      "Indeks bukan milik jadual ini.",
    );
    return binding.handle;
  }
  private binding(index: IndexHandle): IndexBinding {
    const binding = this.current.indexes.get(index?.name);
    check(
      binding && binding.handle === index,
      "STALE_INDEX",
      "Rujukan indeks luput atau tidak sah.",
    );
    this.directory(index.table);
    return binding;
  }
  private row(directory: RowDirectory, rowId: number): Row {
    check(
      uint32(rowId, false),
      "INVALID_REFERENCE",
      "Identiti baris mesti integer positif 32-bit.",
    );
    const row = directory.rows.get(rowId);
    check(row, "MISSING_ROW", "Baris tidak wujud atau telah dipadam.");
    return row;
  }
  resolveRow(reference: RowReference): Row {
    return { ...this.row(this.directory(reference?.table), reference?.rowId) };
  }
  resolveRows(table: TableHandle, references: readonly RowReference[]): Row[] {
    this.directory(table);
    return Array.from(references, (reference) => {
      check(
        reference?.table === table,
        "WRONG_TABLE",
        "Rujukan baris bukan milik jadual ini.",
      );
      return this.resolveRow(reference);
    });
  }
  private key(
    binding: IndexBinding,
    values: readonly Value[],
    prefix = false,
  ): Key {
    check(
      Array.isArray(values) &&
        values.length > 0 &&
        (prefix
          ? values.length <= binding.columns.length
          : values.length === binding.columns.length),
      "INVALID_KEY",
      "Bilangan komponen kunci tidak sah.",
    );
    try {
      return checkedEntry(normalizeIndexKey(values), 0, binding.tree.format)
        .key;
    } catch (error) {
      if (error instanceof StorageError)
        throw new IndexReadError(
          "INVALID_KEY",
          `Kunci carian tidak sah: ${error.message}`,
        );
      throw error;
    }
  }
  private entryRow(
    binding: IndexBinding,
    directory: RowDirectory,
    entry: Entry,
  ): Row {
    const row = this.row(directory, entry.rowId);
    check(
      compareKeys(sqlIndexKey(row, binding.columns), entry.key) === 0,
      "INCONSISTENT_INDEX",
      "Kunci indeks tidak sepadan dengan baris semasa.",
    );
    return row;
  }
  /** Exact physical match, including NULL; not the SQL '=' predicate. */
  lookupIndex(index: IndexHandle, values: readonly Value[]): RowReference[] {
    const binding = this.binding(index),
      key = this.key(binding, values);
    const directory = this.directory(index.table);
    return binding.tree.search(key).map((rowId) => {
      this.entryRow(binding, directory, { key, rowId });
      return Object.freeze({ table: index.table, rowId });
    });
  }
  scanIndex(
    index: IndexHandle,
    options: RangeOptions = {},
  ): IterableIterator<IndexRow> {
    const binding = this.binding(index);
    check(
      options.reverse === undefined || typeof options.reverse === "boolean",
      "INVALID_KEY",
      "Arah kursor tidak sah.",
    );
    const bound = (value: RangeOptions["lower"]) => {
      if (value === undefined) return undefined;
      check(
        value &&
          (value.inclusive === undefined ||
            typeof value.inclusive === "boolean"),
        "INVALID_KEY",
        "Sempadan kursor tidak sah.",
      );
      return {
        key: this.key(binding, value.key, true),
        inclusive: value.inclusive,
      };
    };
    // Capture bounds and revision before the first next(), even for empty trees.
    let context:
      | {
          revision: symbol;
          binding: IndexBinding;
          directory: RowDirectory;
          source: IterableIterator<Entry>;
        }
      | undefined = {
      revision: this.current.revision,
      binding,
      directory: this.directory(index.table),
      source: binding.tree.scan({
        lower: bound(options.lower),
        upper: bound(options.upper),
        reverse: options.reverse,
      }),
    };
    const close = () => {
      const source = context?.source;
      context = undefined;
      source?.return?.();
    };
    return {
      [Symbol.iterator]() {
        return this;
      },
      next: (): IteratorResult<IndexRow> => {
        if (!context) return { done: true, value: undefined };
        try {
          check(
            context.revision === this.current.revision,
            "STALE_CURSOR",
            "Pangkalan data berubah; buka kursor baharu.",
          );
          const item = context.source.next();
          if (item.done) {
            close();
            return { done: true, value: undefined };
          }
          const row = this.entryRow(
            context.binding,
            context.directory,
            item.value,
          );
          return {
            done: false,
            value: {
              table: context.binding.handle.table,
              rowId: item.value.rowId,
              key: [...item.value.key],
              row: { ...row },
            },
          };
        } catch (error) {
          close();
          throw error;
        }
      },
      return: () => {
        close();
        return { done: true, value: undefined };
      },
      throw: (error?: unknown) => {
        close();
        throw error;
      },
    };
  }
  validate(
    state: DatabaseState,
    identities: RowIdentities,
    indexes: PhysicalIndexes,
  ): void {
    check(
      this.current.tables.size === state.tables.length &&
        this.current.indexes.size === indexes.size,
      "INCONSISTENT_INDEX",
      "Direktori bacaan tidak sepadan dengan katalog.",
    );
    for (const table of state.tables) {
      const directory = this.directory(this.tableHandle(table.name)),
        ids = identities.get(table.name)?.ids;
      check(
        ids &&
          directory.rows.size === table.rows.length &&
          table.rows.every((row, i) => directory.rows.get(ids[i]) === row),
        "INCONSISTENT_INDEX",
        "Direktori baris tidak sepadan dengan jadual semasa.",
      );
    }
    for (const definition of state.indexes) {
      const binding = this.binding(
        this.indexHandle(this.tableHandle(definition.table), definition.name),
      );
      check(
        binding.tree === indexes.get(definition.name) &&
          JSON.stringify(binding.columns) ===
            JSON.stringify(definition.columns),
        "INCONSISTENT_INDEX",
        "Direktori indeks tidak sepadan dengan katalog semasa.",
      );
    }
  }
}
