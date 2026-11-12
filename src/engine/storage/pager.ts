import {
  FORMAT_VERSION,
  MAX_PAGE_ID,
  requireStorage,
  uint32,
  validatePageSize,
  type PageId,
} from "./page";

export interface PagerImage {
  version: 1;
  pageSize: number;
  maxPages: number;
  nextId: number;
  freeIds: PageId[];
  pages: { id: PageId; bytes: Uint8Array }[];
}
/** Addressed byte pages. The array is a page directory, never a key index. */
export class MemoryPager {
  private pages: (Uint8Array | undefined)[] = [undefined];
  private freeIds: PageId[] = [];
  private nextId = 1;
  private generation = 0;
  constructor(
    readonly pageSize = 4096,
    readonly maxPages = MAX_PAGE_ID,
  ) {
    validatePageSize(pageSize);
    requireStorage(
      uint32(maxPages, false) && maxPages <= MAX_PAGE_ID,
      "INVALID_ARGUMENT",
      "Had halaman tidak sah.",
    );
  }
  get revision() {
    return this.generation;
  }
  ids(): PageId[] {
    return this.pages.flatMap((page, id) => (page ? [id] : []));
  }
  read(id: PageId): Uint8Array {
    requireStorage(
      uint32(id, false) && this.pages[id],
      "MISSING_PAGE",
      `Halaman ${id} tidak wujud.`,
    );
    return this.pages[id]!.slice();
  }
  begin(): PageBatch {
    const revision = this.generation;
    return new PageBatch(
      this.pageSize,
      this.maxPages,
      this.nextId,
      [...this.freeIds],
      (id) => this.read(id),
      (writes, nextId, freeIds) => {
        requireStorage(
          this.generation === revision,
          "STALE_BATCH",
          "Kumpulan halaman telah lapuk.",
        );
        // Encoding, allocation checks and copies happen before publication.
        for (const [id, bytes] of writes) this.pages[id] = bytes ?? undefined;
        this.nextId = nextId;
        this.freeIds = freeIds;
        this.generation++;
      },
    );
  }
  exportImage(): PagerImage {
    return {
      version: FORMAT_VERSION,
      pageSize: this.pageSize,
      maxPages: this.maxPages,
      nextId: this.nextId,
      freeIds: [...this.freeIds],
      pages: this.ids().map((id) => ({ id, bytes: this.read(id) })),
    };
  }
  static fromImage(image: PagerImage): MemoryPager {
    requireStorage(
      image.version === FORMAT_VERSION,
      "INVALID_ARGUMENT",
      "Versi imej pager tidak disokong.",
    );
    const pager = new MemoryPager(image.pageSize, image.maxPages);
    requireStorage(
      Number.isInteger(image.nextId) &&
        image.nextId >= 1 &&
        image.nextId <= image.maxPages + 1 &&
        image.pages.length + image.freeIds.length === image.nextId - 1,
      "CORRUPT_PAGE",
      "Inventori halaman tidak lengkap.",
    );
    const ids = [...image.pages.map((p) => p.id), ...image.freeIds];
    requireStorage(
      new Set(ids).size === ids.length &&
        ids.every((id) => uint32(id, false) && id < image.nextId),
      "CORRUPT_PAGE",
      "Pengenal halaman berulang atau tidak sah.",
    );
    requireStorage(
      image.freeIds.every((id, i) => i === 0 || image.freeIds[i - 1] < id),
      "CORRUPT_PAGE",
      "Senarai halaman bebas tidak tersusun.",
    );
    for (const { id, bytes } of image.pages) {
      requireStorage(
        bytes instanceof Uint8Array && bytes.length === image.pageSize,
        "CORRUPT_PAGE",
        "Saiz halaman tidak sah.",
      );
      pager.pages[id] = bytes.slice();
    }
    pager.nextId = image.nextId;
    pager.freeIds = [...image.freeIds];
    return pager;
  }
}
/** Stages only touched pages; its Map is a write set, not the B+tree index. */
export class PageBatch {
  private writes = new Map<PageId, Uint8Array | null>();
  private closed = false;
  constructor(
    private pageSize: number,
    private maxPages: number,
    private nextId: number,
    private freeIds: PageId[],
    private source: (id: PageId) => Uint8Array,
    private publish: (
      writes: ReadonlyMap<PageId, Uint8Array | null>,
      nextId: number,
      freeIds: PageId[],
    ) => void,
  ) {}
  private open() {
    requireStorage(
      !this.closed,
      "CLOSED_BATCH",
      "Kumpulan halaman telah ditutup.",
    );
  }
  read(id: PageId): Uint8Array {
    this.open();
    if (!this.writes.has(id)) return this.source(id);
    const bytes = this.writes.get(id);
    requireStorage(bytes, "MISSING_PAGE", `Halaman ${id} telah dibebaskan.`);
    return bytes.slice();
  }
  allocate(): PageId {
    this.open();
    requireStorage(
      this.freeIds.length > 0 || this.nextId <= this.maxPages,
      "PAGE_LIMIT",
      "Had halaman pager telah dicapai.",
    );
    const id = this.freeIds.length ? this.freeIds.shift()! : this.nextId++;
    this.writes.set(id, new Uint8Array(this.pageSize));
    return id;
  }
  write(id: PageId, bytes: Uint8Array) {
    this.read(id);
    requireStorage(
      bytes instanceof Uint8Array && bytes.length === this.pageSize,
      "INVALID_ARGUMENT",
      "Penulisan mesti satu halaman penuh.",
    );
    this.writes.set(id, bytes.slice());
  }
  release(id: PageId) {
    this.read(id);
    this.writes.set(id, null);
    this.freeIds.push(id);
    this.freeIds.sort((a, b) => a - b);
  }
  commit() {
    this.open();
    this.publish(this.writes, this.nextId, [...this.freeIds]);
    this.closed = true;
    this.writes.clear();
  }
  rollback() {
    this.open();
    this.closed = true;
    this.writes.clear();
  }
}
