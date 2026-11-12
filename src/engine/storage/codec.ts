import {
  FORMAT_VERSION,
  HEADER_BYTES,
  MAX_ROW_ID,
  requireStorage,
  uint32,
  validateFormat,
  type Entry,
  type Key,
  type KeyPart,
  type PageFormat,
  type TreePage,
} from "./page";

const MAGIC = 0x56454c41;
function rank(value: KeyPart): number {
  return value === null
    ? 0
    : typeof value === "boolean"
      ? 1
      : typeof value === "number"
        ? 2
        : 3;
}
/** Physical total order; deliberately does not evaluate SQL NULL predicates. */
export function compareKeys(a: Key, b: Key): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i],
      y = b[i];
    if (rank(x) !== rank(y)) return rank(x) - rank(y);
    if (x !== y) return x! < y! ? -1 : 1;
  }
  return a.length - b.length;
}
export function compareEntries(a: Entry, b: Entry): number {
  return compareKeys(a.key, b.key) || a.rowId - b.rowId;
}
export function canonicalKey(key: Key): KeyPart[] {
  requireStorage(
    Array.isArray(key) && key.length > 0 && key.length <= 64,
    "INVALID_ARGUMENT",
    "Kunci mesti mempunyai satu hingga 64 komponen.",
  );
  return Array.from(key, (value) => {
    requireStorage(
      value === null ||
        typeof value === "boolean" ||
        typeof value === "string" ||
        (typeof value === "number" && Number.isFinite(value)),
      "INVALID_ARGUMENT",
      "Komponen kunci tidak sah.",
    );
    return typeof value === "number" && value === 0 ? 0 : value;
  });
}
export function encodeKey(key: Key): Uint8Array {
  const values = canonicalKey(key);
  const length =
    2 +
    values.reduce<number>(
      (n, value) =>
        n +
        (typeof value === "string"
          ? 5 + value.length * 2
          : typeof value === "number"
            ? 9
            : 1),
      0,
    );
  requireStorage(
    length <= 65535,
    "KEY_TOO_LARGE",
    "Kunci melebihi 65535 bait.",
  );
  const bytes = new Uint8Array(length),
    view = new DataView(bytes.buffer);
  view.setUint16(0, values.length, true);
  let offset = 2;
  for (const value of values) {
    if (value === null) bytes[offset++] = 0;
    else if (typeof value === "boolean") bytes[offset++] = value ? 2 : 1;
    else if (typeof value === "number") {
      bytes[offset++] = 3;
      view.setFloat64(offset, value, true);
      offset += 8;
    } else {
      bytes[offset++] = 4;
      view.setUint32(offset, value.length, true);
      offset += 4;
      for (let i = 0; i < value.length; i++, offset += 2)
        view.setUint16(offset, value.charCodeAt(i), true);
    }
  }
  return bytes;
}
export function decodeKey(bytes: Uint8Array): KeyPart[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  const need = (count: number) =>
    requireStorage(
      offset + count <= bytes.length,
      "CORRUPT_PAGE",
      "Pengekodan kunci terpotong.",
    );
  need(2);
  const count = view.getUint16(offset, true);
  offset += 2;
  requireStorage(
    count > 0 && count <= 64,
    "CORRUPT_PAGE",
    "Bilangan komponen kunci rosak.",
  );
  const values: KeyPart[] = [];
  for (let i = 0; i < count; i++) {
    need(1);
    const tag = bytes[offset++];
    if (tag === 0) values.push(null);
    else if (tag === 1 || tag === 2) values.push(tag === 2);
    else if (tag === 3) {
      need(8);
      const value = view.getFloat64(offset, true);
      offset += 8;
      requireStorage(
        Number.isFinite(value) && !Object.is(value, -0),
        "CORRUPT_PAGE",
        "Nombor kunci rosak.",
      );
      values.push(value);
    } else {
      requireStorage(tag === 4, "CORRUPT_PAGE", "Tag kunci tidak dikenali.");
      need(4);
      const length = view.getUint32(offset, true);
      offset += 4;
      need(length * 2);
      let value = "";
      for (let j = 0; j < length; j++, offset += 2)
        value += String.fromCharCode(view.getUint16(offset, true));
      values.push(value);
    }
  }
  requireStorage(
    offset === bytes.length,
    "CORRUPT_PAGE",
    "Bait tambahan dalam kunci.",
  );
  return values;
}
export function checkedEntry(
  key: Key,
  rowId: number,
  format: PageFormat,
): Entry {
  requireStorage(
    uint32(rowId),
    "INVALID_ARGUMENT",
    `Rujukan baris mesti integer antara 0 dan ${MAX_ROW_ID}.`,
  );
  const canonical = canonicalKey(key);
  requireStorage(
    encodeKey(canonical).length <= format.maxKeyBytes,
    "KEY_TOO_LARGE",
    "Kunci melebihi kapasiti slot halaman.",
  );
  return { key: canonical, rowId };
}
export function encodePage(node: TreePage, format: PageFormat): Uint8Array {
  validateFormat(format);
  requireStorage(
    uint32(node.id, false) && uint32(node.parent),
    "INVALID_ARGUMENT",
    "Pengenal halaman tidak sah.",
  );
  const entries = node.kind === "leaf" ? node.entries : node.separators;
  requireStorage(
    entries.length <= format.maxKeys,
    "PAGE_FULL",
    "Halaman melebihi kapasiti kunci.",
  );
  if (node.kind === "internal")
    requireStorage(
      node.children.length === entries.length + 1 &&
        node.children.every((id) => uint32(id, false)),
      "INVALID_ARGUMENT",
      "Rujukan anak nod tidak sah.",
    );
  else
    requireStorage(
      uint32(node.prev) && uint32(node.next),
      "INVALID_ARGUMENT",
      "Pautan daun tidak sah.",
    );
  const bytes = new Uint8Array(format.pageSize),
    view = new DataView(bytes.buffer);
  view.setUint32(0, MAGIC, true);
  bytes[4] = FORMAT_VERSION;
  bytes[5] = node.kind === "leaf" ? 1 : 2;
  view.setUint16(6, entries.length, true);
  view.setUint32(8, node.id, true);
  view.setUint32(12, node.parent, true);
  view.setUint32(16, node.kind === "leaf" ? node.prev : 0, true);
  view.setUint32(20, node.kind === "leaf" ? node.next : 0, true);
  view.setUint16(24, format.maxKeys, true);
  view.setUint16(26, format.maxKeyBytes, true);
  if (node.kind === "internal")
    node.children.forEach((id, i) =>
      view.setUint32(HEADER_BYTES + 4 * i, id, true),
    );
  const base = HEADER_BYTES + 4 * (format.maxKeys + 1),
    slot = 6 + format.maxKeyBytes;
  entries.forEach((entry, i) => {
    const checked = checkedEntry(entry.key, entry.rowId, format),
      key = encodeKey(checked.key),
      offset = base + slot * i;
    view.setUint16(offset, key.length, true);
    view.setUint32(offset + 2, entry.rowId, true);
    bytes.set(key, offset + 6);
  });
  return bytes;
}
export function decodePage(
  bytes: Uint8Array,
  expectedId: number,
  format: PageFormat,
): TreePage {
  validateFormat(format);
  requireStorage(
    bytes.length === format.pageSize,
    "CORRUPT_PAGE",
    "Saiz imej halaman rosak.",
  );
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  requireStorage(
    view.getUint32(0, true) === MAGIC &&
      bytes[4] === FORMAT_VERSION &&
      (bytes[5] === 1 || bytes[5] === 2),
    "CORRUPT_PAGE",
    "Format halaman tidak dikenali.",
  );
  requireStorage(
    uint32(expectedId, false) &&
      view.getUint32(8, true) === expectedId &&
      view.getUint16(24, true) === format.maxKeys &&
      view.getUint16(26, true) === format.maxKeyBytes &&
      view.getUint32(28, true) === 0,
    "CORRUPT_PAGE",
    "Metadata halaman tidak sepadan.",
  );
  const count = view.getUint16(6, true),
    parent = view.getUint32(12, true);
  requireStorage(
    count <= format.maxKeys,
    "CORRUPT_PAGE",
    "Bilangan kunci halaman rosak.",
  );
  const base = HEADER_BYTES + 4 * (format.maxKeys + 1),
    slot = 6 + format.maxKeyBytes;
  const entries: Entry[] = [];
  for (let i = 0; i < count; i++) {
    const offset = base + slot * i,
      length = view.getUint16(offset, true);
    requireStorage(
      length <= format.maxKeyBytes,
      "CORRUPT_PAGE",
      "Panjang slot kunci rosak.",
    );
    entries.push({
      key: decodeKey(bytes.subarray(offset + 6, offset + 6 + length)),
      rowId: view.getUint32(offset + 2, true),
    });
  }
  if (bytes[5] === 1)
    return {
      kind: "leaf",
      id: expectedId,
      parent,
      entries,
      prev: view.getUint32(16, true),
      next: view.getUint32(20, true),
    };
  requireStorage(
    view.getUint32(16, true) === 0 && view.getUint32(20, true) === 0,
    "CORRUPT_PAGE",
    "Nod dalaman mempunyai pautan daun.",
  );
  const children = Array.from({ length: count + 1 }, (_, i) =>
    view.getUint32(HEADER_BYTES + i * 4, true),
  );
  requireStorage(
    children.every((id) => id !== 0),
    "CORRUPT_PAGE",
    "Anak halaman kosong.",
  );
  return {
    kind: "internal",
    id: expectedId,
    parent,
    separators: entries,
    children,
  };
}
