export type PageId = number;
export type KeyPart = null | boolean | number | string;
export type Key = readonly KeyPart[];
export interface Entry {
  key: Key;
  rowId: number;
}
interface NodeHeader {
  id: PageId;
  parent: PageId;
}
export interface LeafPage extends NodeHeader {
  kind: "leaf";
  entries: Entry[];
  prev: PageId;
  next: PageId;
}
export interface InternalPage extends NodeHeader {
  kind: "internal";
  separators: Entry[];
  children: PageId[];
}
export type TreePage = LeafPage | InternalPage;
export interface PageFormat {
  readonly pageSize: number;
  readonly maxKeys: number;
  readonly maxKeyBytes: number;
}
export const HEADER_BYTES = 32;
export const MAX_ROW_ID = 0xffffffff;
// UINT32_MAX is not an array index in JavaScript; reserve it for page IDs.
export const MAX_PAGE_ID = 0xfffffffe;
export const FORMAT_VERSION = 1;
export type StorageErrorCode =
  | "INVALID_ARGUMENT"
  | "KEY_TOO_LARGE"
  | "PAGE_FULL"
  | "PAGE_LIMIT"
  | "MISSING_PAGE"
  | "CORRUPT_PAGE"
  | "INVARIANT"
  | "STALE_BATCH"
  | "CLOSED_BATCH"
  | "STALE_CURSOR";
export class StorageError extends Error {
  constructor(
    public readonly code: StorageErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "StorageError";
  }
}
export function requireStorage(
  condition: unknown,
  code: StorageErrorCode,
  message: string,
): asserts condition {
  if (!condition) throw new StorageError(code, message);
}
export function uint32(value: number, allowZero = true): boolean {
  return (
    Number.isInteger(value) &&
    value >= (allowZero ? 0 : 1) &&
    value <= MAX_ROW_ID
  );
}
export function validatePageSize(pageSize: number) {
  requireStorage(
    Number.isInteger(pageSize) &&
      pageSize >= 256 &&
      pageSize <= 65536 &&
      (pageSize & (pageSize - 1)) === 0,
    "INVALID_ARGUMENT",
    "Saiz halaman mesti kuasa dua antara 256 dan 65536 bait.",
  );
}
export function validateFormat(format: PageFormat) {
  validatePageSize(format.pageSize);
  requireStorage(
    Number.isInteger(format.maxKeys) &&
      format.maxKeys >= 3 &&
      format.maxKeys <= 65534,
    "INVALID_ARGUMENT",
    "Kapasiti nod mesti sekurang-kurangnya tiga kunci.",
  );
  requireStorage(
    Number.isInteger(format.maxKeyBytes) &&
      format.maxKeyBytes >= 3 &&
      format.maxKeyBytes <= 65535,
    "INVALID_ARGUMENT",
    "Had bait kunci tidak sah.",
  );
  requireStorage(
    HEADER_BYTES +
      (format.maxKeys + 1) * 4 +
      format.maxKeys * (6 + format.maxKeyBytes) <=
      format.pageSize,
    "INVALID_ARGUMENT",
    "Slot nod melebihi saiz halaman.",
  );
}
export interface TreeReader {
  readonly rootId: PageId;
  readonly format: PageFormat;
  read(id: PageId): TreePage;
  revision(): number;
}
