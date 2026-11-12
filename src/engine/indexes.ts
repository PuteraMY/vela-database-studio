import { normalize } from "./expression";
import { BPlusTree, type TreeOptions } from "./storage/btree";
import { compareEntries, compareKeys, encodeKey } from "./storage/codec";
import {
  MAX_ROW_ID,
  StorageError,
  requireStorage,
  type Entry,
  type Key,
} from "./storage/page";
import { SqlError, type DatabaseState, type Row } from "./types";

/** IDs are stable values; the parallel array only associates them with P0 rows. */
export interface TableIdentity {
  ids: number[];
  nextId: number;
}
export type RowIdentities = Map<string, TableIdentity>;
export type PhysicalIndexes = Map<string, BPlusTree>;

export function allocateRowId(identity: TableIdentity): number {
  if (identity.nextId > MAX_ROW_ID)
    throw new SqlError("Had identiti baris dalaman telah dicapai.");
  return identity.nextId++;
}

/** Logical restore starts a new identity lifetime; public snapshots stay P0-compatible. */
export function restoreIdentities(state: DatabaseState): RowIdentities {
  const result: RowIdentities = new Map();
  for (const table of state.tables) {
    if (result.has(table.name)) throw new SqlError("Nama jadual berulang.");
    const identity: TableIdentity = { ids: [], nextId: 1 };
    identity.ids = table.rows.map(() => allocateRowId(identity));
    result.set(table.name, identity);
  }
  return result;
}

export function sqlIndexKey(row: Row, columns: readonly string[]): Key {
  return columns.map((column) => {
    if (!Object.hasOwn(row, column))
      throw new SqlError(`Lajur indeks “${column}” tiada dalam rekod.`);
    const value = normalize(row[column]);
    return Object.is(value, -0) ? 0 : value;
  });
}

// Largest slot possible with the minimum three keys in a 64 KiB page.
export const MAX_SQL_KEY_BYTES = Math.floor((65536 - 36) / 3) - 10;

function formatFor(required: number, previous?: BPlusTree): TreeOptions {
  if (previous && required <= previous.format.maxKeyBytes)
    return previous.format;
  requireStorage(
    required <= MAX_SQL_KEY_BYTES,
    "KEY_TOO_LARGE",
    `Kunci indeks melebihi ${MAX_SQL_KEY_BYTES} bait.`,
  );
  const maxKeyBytes = Math.min(
    MAX_SQL_KEY_BYTES,
    2 ** Math.ceil(Math.log2(Math.max(128, required))),
  );
  let pageSize = 4096;
  while (pageSize < 65536 && 36 + 16 * (maxKeyBytes + 10) > pageSize)
    pageSize *= 2;
  return {
    pageSize,
    maxKeyBytes,
    maxKeys: Math.min(16, Math.floor((pageSize - 36) / (maxKeyBytes + 10))),
  };
}

/** Prepare detached trees. The caller publishes rows, identities and trees together. */
export function maintainIndexes(
  before: DatabaseState,
  after: DatabaseState,
  oldIds: RowIdentities,
  newIds: RowIdentities,
  existing: PhysicalIndexes,
  fixedOptions?: TreeOptions,
): PhysicalIndexes {
  try {
    const next: PhysicalIndexes = new Map();
    for (const definition of after.indexes) {
      const table = after.tables.find((t) => t.name === definition.table);
      if (
        next.has(definition.name) ||
        !table ||
        definition.columns.length === 0 ||
        definition.columns.length > 64 ||
        definition.columns.some((c) => !table.columns.some((x) => x.name === c))
      )
        throw new SqlError(`Takrif indeks “${definition.name}” tidak sah.`);
      const identity = newIds.get(table.name);
      requireStorage(identity, "INVARIANT", "Identiti jadual tiada.");
      const entries: Entry[] = table.rows.map((row, i) => ({
        rowId: identity.ids[i],
        key: sqlIndexKey(row, definition.columns),
      }));
      const previousDefinition = before.indexes.find(
        (i) => i.name === definition.name,
      );
      const previous =
        JSON.stringify(previousDefinition) === JSON.stringify(definition)
          ? existing.get(definition.name)
          : undefined;
      const required = entries.reduce(
        (size, entry) => Math.max(size, encodeKey(entry.key).length),
        3,
      );
      const options = fixedOptions ?? formatFor(required, previous);
      if (!previous || required > previous.format.maxKeyBytes) {
        const tree = BPlusTree.create(options);
        for (const entry of entries) tree.insert(entry.key, entry.rowId);
        next.set(definition.name, tree);
        continue;
      }
      const oldTable = before.tables.find((t) => t.name === table.name);
      const oldIdentity = oldIds.get(table.name);
      requireStorage(
        oldTable && oldIdentity,
        "INVARIANT",
        "Asal indeks tiada.",
      );
      const oldEntries = oldTable.rows.map((row, i) => ({
        rowId: oldIdentity.ids[i],
        key: sqlIndexKey(row, definition.columns),
      }));
      const oldKeys = new Map(oldEntries.map((e) => [e.rowId, e.key]));
      const newKeys = new Map(entries.map((e) => [e.rowId, e.key]));
      const changed = (entry: Entry, keys: Map<number, Key>) => {
        const key = keys.get(entry.rowId);
        return !key || compareKeys(key, entry.key) !== 0;
      };
      const removed = oldEntries.filter((e) => changed(e, newKeys));
      const added = entries.filter((e) => changed(e, oldKeys));
      if (removed.length === 0 && added.length === 0) {
        next.set(definition.name, previous);
        continue;
      }
      const tree = BPlusTree.fromImage(previous.exportImage());
      // Remove all old keys first: a statement may swap unique keys between rows.
      for (const entry of removed)
        requireStorage(
          tree.delete(entry.key, entry.rowId),
          "INVARIANT",
          "Pautan indeks lama tiada.",
        );
      for (const entry of added)
        requireStorage(
          tree.insert(entry.key, entry.rowId),
          "INVARIANT",
          "Pautan indeks berulang.",
        );
      next.set(definition.name, tree);
    }
    return next;
  } catch (error) {
    if (error instanceof StorageError)
      throw new SqlError(
        `Indeks fizikal gagal (${error.code}): ${error.message}`,
      );
    throw error;
  }
}

/** Internal diagnostic: complete content comparison, not just row counts. */
export function validateIndexes(
  state: DatabaseState,
  identities: RowIdentities,
  indexes: PhysicalIndexes,
): { tables: number; indexes: number; entries: number } {
  requireStorage(
    identities.size === state.tables.length &&
      indexes.size === state.indexes.length,
    "INVARIANT",
    "Bilangan katalog fizikal tidak sepadan.",
  );
  for (const table of state.tables) {
    const identity = identities.get(table.name);
    requireStorage(identity, "INVARIANT", "Identiti jadual tiada.");
    requireStorage(
      identity.ids.length === table.rows.length &&
        Number.isInteger(identity.nextId) &&
        identity.nextId >= 1 &&
        identity.nextId <= MAX_ROW_ID + 1 &&
        new Set(identity.ids).size === identity.ids.length &&
        identity.ids.every(
          (id) => Number.isInteger(id) && id > 0 && id < identity.nextId,
        ),
      "INVARIANT",
      "Identiti baris tidak sah.",
    );
  }
  let count = 0;
  const names = new Set<string>();
  for (const definition of state.indexes) {
    const tree = indexes.get(definition.name);
    const table = state.tables.find((t) => t.name === definition.table);
    const identity = identities.get(definition.table);
    requireStorage(
      tree &&
        table &&
        identity &&
        !names.has(definition.name) &&
        definition.columns.length > 0 &&
        definition.columns.length <= 64 &&
        definition.columns.every((c) =>
          table.columns.some((column) => column.name === c),
        ),
      "INVARIANT",
      "Indeks katalog tiada atau berulang.",
    );
    names.add(definition.name);
    tree.validate();
    const expected = table.rows
      .map((row, i) => ({
        key: sqlIndexKey(row, definition.columns),
        rowId: identity.ids[i],
      }))
      .sort(compareEntries);
    const actual = [...tree.scan()];
    requireStorage(
      actual.length === expected.length &&
        actual.every((entry, i) => compareEntries(entry, expected[i]) === 0),
      "INVARIANT",
      "Kandungan indeks tidak sepadan dengan baris jadual.",
    );
    if (definition.unique)
      for (let i = 1; i < actual.length; i++)
        requireStorage(
          actual[i].key.includes(null) ||
            compareKeys(actual[i - 1].key, actual[i].key) !== 0,
          "INVARIANT",
          "Kunci UNIQUE berulang.",
        );
    count += actual.length;
  }
  return { tables: state.tables.length, indexes: indexes.size, entries: count };
}
