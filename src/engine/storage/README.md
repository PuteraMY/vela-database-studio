# P1A: independent page storage and B+tree

This module is a memory-backed physical index foundation. P1B-1's `../indexes.ts` now uses this unchanged API to maintain explicit SQL catalog indexes with stable row IDs and normalized keys. SELECT still scans P0 row arrays; the Worker protocol, UI and EXPLAIN remain unchanged. No query optimization, statistics, WAL, MVCC, IndexedDB durability or advanced SQL is implemented here.

## API

```ts
import { BPlusTree } from './btree';

const tree = BPlusTree.create();
tree.insert([null, 'Aina'], 7); // true: insert a key + row reference
tree.insert([null, 'Aina'], 9); // same key, distinct reference
tree.insert([null, 'Aina'], 7); // false: identical pair already exists
tree.search([null, 'Aina']);    // [7, 9]
tree.has([null, 'Aina'], 7);    // true
tree.delete([null, 'Aina'], 7); // removes only this pair

const rows = [...tree.scan({
  lower: { key: [null], inclusive: false },
  upper: { key: ['Z'], inclusive: true },
  reverse: true,
})];
const report = tree.validate();
const image = tree.exportImage();
const restored = BPlusTree.fromImage(image);
```

Search returns unsigned 32-bit row references in ascending order. Scan returns copied `{ key, rowId }` entries. Bounds apply to the whole key, independently of the row-reference tiebreaker; inclusivity defaults to true. Reversed or empty bounds produce no rows. Reverse traversal follows previous-leaf links. A cursor captures bounds and pager revision when created and fails on a successful mutation, including before its first `next()`. Rejected/no-op operations do not invalidate it. It is not a snapshot-isolation cursor.

`inspectPages()` returns detached decoded diagnostic pages. `lastEvents` records actual committed split, redistribution, merge and root changes with real page IDs; it is not a simulated visual trace or an I/O estimate. `validate()` derives height, reachable page count, leaf count and entry count by inspecting the real tree. There are no invented physical-page read metrics.

## Physical key contract

A key has 1–64 components. Its total order is **NULL < BOOLEAN < finite NUMBER < TEXT**; false precedes true. Numeric components compare by value, with -0 canonicalized to +0. BOOLEAN true and NUMBER 1 remain different. Strings compare by JavaScript UTF-16 code units; there is no locale collation or Unicode normalization. Composite keys compare component by component, with shorter equal prefixes first. NaN, infinities, undefined and other object types are rejected.

This ordering is independent of SQL three-valued comparisons, affinity and UNIQUE semantics. The codec preserves finite IEEE-754 values, not arbitrary 64-bit integers. `compareKeys` operates on this validated domain; public tree operations validate/copy their arguments. Internal physical entry order adds `rowId` as the final tiebreaker. Duplicate keys may span several leaves. An identical (key, rowId) insertion or missing-pair deletion returns false without publishing pages.

Encoding is deterministic, little-endian and versioned; bytes are decoded for comparison rather than compared with memcmp. A key starts with a u16 component count. Tags are 0=NULL, 1=false, 2=true, 3=float64, 4=text. Text stores a u32 code-unit length followed by UTF-16LE units, preserving embedded NULs and lone surrogates. The encoded key limit is configurable per tree; oversized keys fail rather than truncate or use an unimplemented overflow-page path.

## Pages and pager

Defaults: 4096-byte pages, 16 keys per node, 128 encoded bytes per key. Page sizes must be powers of two in 256–65536. Capacity must be at least 3 and must fit this physical layout:

| Byte offset | Field |
| --- | --- |
| 0 | u32 magic `0x56454c41` |
| 4 / 5 | u8 version / node kind (1 leaf, 2 internal) |
| 6 | u16 occupied entry/separator count |
| 8 / 12 | u32 page ID / parent ID |
| 16 / 20 | u32 previous / next leaf ID (zero for internal nodes) |
| 24 / 26 | u16 maximum keys / maximum key bytes |
| 28 | reserved zero u32 |
| 32 | `(maxKeys + 1)` u32 child-pointer slots |
| after children | `maxKeys` entry slots: u16 key length, u32 row reference, fixed key-byte area |

Unused space is zero-filled on encoding. Every stored page is a full Uint8Array of the configured size. Overfull nodes exist only as temporary decoded objects during a split and are never published to the pager. The layout rejects malformed headers, bounds and used key payloads. It is not a checksum, authentication or corruption-repair system.

Page ID zero is the absent-pointer sentinel; allocated IDs start at one and cannot exceed `0xfffffffe` (the last JavaScript array index). `0xffffffff` remains valid as a row reference but is not an allocatable page ID. Allocation uses the smallest free ID first, otherwise the next increasing ID. Released IDs remain recorded in sorted order, and the high-water ID is not reduced. The optional `maxPages` enforces a deterministic allocation limit and supports rollback tests. The array directory addresses byte pages by ID; no Map or sorted JavaScript collection substitutes for the index.

`MemoryPager.begin()` creates a write batch. Reads, inputs and exported images are defensively copied. The batch's Map contains only staged page writes/releases. A commit checks its captured pager revision before publication; a stale batch fails without overwriting newer pages. Tree operations encode/check all touched pages in a batch and update the root only after successful publication. A failed split, oversized key or invalid operation cannot publish partial tree changes. A raw pager caller owns its batch and must explicitly commit or roll back. Process termination and unrecoverable memory exhaustion are outside these in-process guarantees.

## Structural invariants and algorithms

Let M be `maxKeys`:

- Leaves contain at most M strictly ordered entries; non-root leaves contain at least `ceil(M / 2)`. The empty tree is one empty root leaf.
- Internal nodes have one fewer separator than children, at most M+1 children and (unless root) at least `ceil((M + 1) / 2)` children. An internal root has at least two children.
- Every separator is exactly the minimum full (key, rowId) entry in its right child subtree. Left subtree maxima are strictly below right subtree minima. The first child's minimum is inherited from below, not stored in that parent.
- Only the root has parent zero. Every other child has the correct parent; each allocated page is reachable exactly once. One tree owns its pager, so orphan allocations are invalid.
- All leaves have the same depth. Previous/next links exactly match sorted DFS leaf order, with zero at both ends.

Insertion binary-searches separators and the destination leaf. A leaf overflow splits at the ceiling midpoint and repairs its neighbors. The new right child is inserted into its parent; internal overflow splits children at the ceiling midpoint and reparents moved children. Root overflow creates a new root.

Deletion removes one exact pair. Underflow borrows from a surplus left sibling first, then right; otherwise it merges with the left sibling when available, or with the right. Internal borrowing/merging reparents moved children. An internal root with one remaining child contracts to that child and releases the old root. Ordinary minimum-key changes update only the affected separator path, stopping when a non-first-child separator is updated; structural changes rebuild the affected node's separators.

`validate()` checks these properties, including complete page inventory, global subtree bounds, occupancy, depth, unique reachability and both leaf-link directions. `fromImage()` runs this validation before accepting a restored tree. Deterministic model tests use a separately ordered key domain and an independent reference list, not the tree comparator as their oracle.

## Persistence and SQL boundary

`TreeImage` carries version, root ID, slot configuration and a `PagerImage` containing copied page bytes, free IDs, high-water ID and capacity. This is an in-memory structured-clone-compatible boundary for future persistence work, not a durable file/IndexedDB format with atomic crash recovery. Metadata and pages would need coordinated durable publication in P2. Images are typed snapshots; no arbitrary JSON import interface is provided.

`indexTableSnapshot(table, columns, options)` remains a detached P1A demonstration with zero-based snapshot ordinals and raw physical key semantics. It is not used for live SQL maintenance. P1B-1's separate `../indexes.ts` bridge provides stable IDs, BOOLEAN normalization and atomic catalog/DML maintenance; see the root README and DECISIONS.md. Planner index access remains deferred. Do not use snapshot ordinals as live row identities.
