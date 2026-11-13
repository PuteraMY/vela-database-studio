# VELA — Studio Pangkalan Data

A browser-only SQL engine and a studio that shows its actual execution operators. Repository: [PuteraMY/vela-database-studio](https://github.com/PuteraMY/vela-database-studio). Product copy is in Bahasa Melayu. Engine code, comments, and documentation are in English.

The SQL engine and studio implement **P0**. **P1A** provides page-backed B+trees; **P1B-1** connects explicit SQL index definitions and atomic DML maintenance; **P1B-2A** adds verified internal index reads and stable-ID resolution. **P1B-2B** executes a safe subset of single-table equality SELECTs through explicit indexes, retaining P0 scans for other queries. Cost-based optimization, P2 transactions/durable database storage, and P3 advanced SQL are not implemented. See [REPORT.md](REPORT.md), [TESTING.md](TESTING.md), and [BENCHMARK.md](BENCHMARK.md) for evidence and limitations.

## Run

Requires Node.js 22.12+ or 24 and npm. Development was verified with Node 24.22.1 on Linux.

```sh
npm ci
npm run dev -- --host 0.0.0.0
```

Open http://localhost:5173. The initial Sekolah dataset and query run automatically. Ctrl/Cmd+Enter runs the editor; Ctrl/Cmd+K opens the command palette. The run button executes the entire multi-statement editor document.

No backend, account, API key, or remote database is required. All runtime fonts and SQLite comparison WASM are bundled locally. The built site works without third-party requests after it is served; an offline service worker/installable PWA is not implemented.

## Verify

```sh
npm run verify
npx playwright install chromium
npm run test:production
npm run curated
npm run fuzz
npm run benchmark
npm audit --audit-level=moderate
```

`npm run verify` combines skill integrity, strict typecheck, lint, unit tests and production build. `npm run test:production` starts the built preview on port 4173 with the same headers configured for hosting; keep that port free. `npm run test:e2e` uses the development server on port 5173 instead. `npm run curated` checks 100 hand-written expected result sets against both VELA and SQLite. `npm run fuzz` defaults to seed 355866 and 5,000 randomized queries; set `FUZZ_SEED` and `FUZZ_COUNT` to reproduce other runs. The fuzzer counts successful executions with matching ordered values; errors never count as matches. Later-tier syntax is excluded and reported.

`npm run benchmark` writes hardware, source hashes, samples, medians, p95, result assertions, and scan counts to `artifacts/benchmark.json`. Run it without concurrent builds or browser tests for useful measurements. Generated artifacts, screenshots, and large Playwright traces are gitignored. Small release evidence is checked into `evidence/`.

With `npm run preview` running on port 4173, `npx tsx tools/inspect-ui.ts` captures layouts at 360, 390, 768, 1100, and 1440 pixels and records console errors/warnings. `npx tsx tools/browser-profile.ts` measures initial rendering, 100k-result roundtrip and scripted scrolling. Set `VELA_PROFILE_URL` to use another local URL. These are lab measurements, not field Core Web Vitals. Source formatting uses Prettier; upstream skill files are excluded to preserve their hashes.

The eight requested entries are present under `.agents/skills/` and pass structural/hash validation. After rechecking the upstream migration, `frontend-design` is the complete original Anthropic folder with its Apache-2.0 license; the other seven are unchanged legacy custom guides, not official vendor integrations. All were read, but automatic runtime catalog discovery is not verified. See [SKILLS_INTEGRATION.md](SKILLS_INTEGRATION.md) for source status and actual use, [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) for design conventions, and [SECURITY.md](SECURITY.md) for the local security review.

## Supported SQL

- Types: INTEGER, REAL, TEXT, BOOLEAN, and NULL. BOOLEAN results use 0/1.
- `CREATE TABLE`, `DROP TABLE`, `IF [NOT] EXISTS`, single-column PRIMARY KEY, NOT NULL, UNIQUE, DEFAULT, and single-column foreign keys referencing a unique/primary parent column.
- `CREATE [UNIQUE] INDEX` populates real B+trees; INSERT/UPDATE/DELETE maintain them atomically and DROP removes them. Unique indexes enforce composite uniqueness, permitting duplicate keys containing NULL. SELECT does not yet use index access.
- Multi-row `INSERT`, `UPDATE`, and `DELETE`. Constraint violations do not partially apply a statement.
- `SELECT`, expressions, aliases, WHERE, DISTINCT, ORDER BY (including ordinals and NULLS FIRST/LAST), LIMIT/OFFSET, CASE, LIKE, BETWEEN, IN lists.
- COUNT, SUM, AVG, MIN, MAX, DISTINCT aggregate inputs, GROUP BY, and HAVING.
- INNER, LEFT, and CROSS JOIN, including aliases and up to four tables.
- String functions: LENGTH, LOWER, UPPER, TRIM/LTRIM/RTRIM, SUBSTR/SUBSTRING, REPLACE, COALESCE, IFNULL, NULLIF.
- Math: ABS, ROUND, FLOOR, CEIL/CEILING, SQRT, POWER, MOD. Date functions: DATE, DATETIME, STRFTIME with basic UTC ISO input and `now`; supported format codes are `%Y`, `%m`, `%d`, `%H`, `%M`, `%S`, `%w`, `%s`, and `%%`. Unsupported codes return NULL; SQLite date modifiers are not implemented.
- `EXPLAIN ANALYZE SELECT ...` returns actual operator trace rows. Plain EXPLAIN is rejected because no optimizer/estimated plan exists yet.

Example:

```sql
SELECT k.nama AS kursus,
       COUNT(p.id) AS pelajar,
       ROUND(AVG(p.markah), 1) AS purata_markah
FROM kursus k
LEFT JOIN pendaftaran p ON k.id = p.kursus_id
GROUP BY k.id, k.nama
ORDER BY purata_markah DESC;
```

Identifiers are case-insensitive; string values preserve case. NULL comparisons propagate unknown, filters keep only true, aggregate inputs ignore NULL except COUNT(*), and DISTINCT/grouping coalesce equivalent NULL values. Default ordering puts NULL first ascending and last descending. LIKE uses ASCII case folding and Unicode-aware single-character wildcards.

INTEGER storage is strict, REAL preserves numeric affinity through bound expressions, TEXT requires strings, and BOOLEAN accepts booleans or 0/1. Unlike SQLite's dynamic affinity, invalid stored types are rejected. Numbers use JavaScript IEEE-754 arithmetic, not SQLite's 64-bit integer representation; exact integers beyond JavaScript's safe range are not promised. Date functions are intentionally a small subset. This is a teaching engine, not a full SQLite replacement.

## Architecture

`src/engine` has no UI imports or runtime package dependencies. Its handwritten tokenizer records offsets, lines, and columns. A recursive-descent statement parser and Pratt expression parser produce a discriminated TypeScript AST. Binding validates references before scanning, expands aliases/ordinals, rejects invalid aggregates/wildcards, and preserves REAL column affinity.

`Database` holds typed row arrays, private stable row IDs and catalog-backed B+trees. A mutation clones candidate rows/identities, applies the complete statement, validates types/uniqueness/nullability/foreign keys, then prepares detached index changes. Publication occurs only after all stages succeed. Scripts are parsed before execution; a runtime failure keeps prior successful statements. There is no implicit multi-statement transaction. Large mutations remain expensive because of cloning, full constraint validation and copying affected trees.

SELECT uses a pull-based Volcano pipeline. Each `Operator.next()` requests one frame from its children. Scans, nested-loop joins, filters, grouping, projection, distinct, sort, and limit are separate operators. Sorting and grouping are blocking stages. LIMIT can stop streaming scans early. Every operator records actual rows in/out and accumulated execution time; parent timings include child work, so they must not be added together as exclusive CPU times.

The worker owns the database and serializes commands. React communicates through typed request/response messages. Zustand holds UI state; CodeMirror is used only as the editor. Results render a bounded row window with spacer rows; the complete result arrays still cross the Worker boundary and occupy memory. The plan graph and latency chart are custom SVG. Plan replay animates recorded traces; it does not suspend/resume the running executor.

Three deterministic sample datasets, CSV type inference, and 10k/100k/500k generators run inside the Worker. Database data lives only for the current page session. Snippets alone persist in IndexedDB (`vela-studio`, `snippets` store). Query history and metrics are session-local.

SQLite is dynamically loaded only when Banding SQLite is enabled. The comparison reconstructs current data in a separate SQLite database and runs SELECT statements in both engines; no VELA query is delegated to SQLite. The UI reports timing and up to twenty concrete cell differences. The developer-only fuzzer and curated suite also use sql.js.

CSV copy/export follows the displayed sort order and prefixes formula-looking text with an apostrophe for spreadsheet safety. This changes those exported text cells; use JSON when exact values are required.

### B+tree, optimizer, WAL and MVCC status

**P1A provides a real independent B+tree** in `src/engine/storage/`: fixed-size byte pages, deterministic allocation/reuse, typed composite-key encoding, exact search, insert/split/root growth, delete/redistribute/merge/root contraction, linked-leaf forward/reverse range scans and automatic structural validation. A detached adapter indexes table-snapshot keys and row ordinals. See [storage architecture and API](src/engine/storage/README.md) for page layout, duplicate/NULL rules and failure boundaries.

P1B-1's `src/engine/indexes.ts` connects explicit catalog definitions to the storage API. IDs start at 1 per table, survive UPDATE and DELETE of other rows, and are never reused within that table lifetime. Table recreation and logical restore reset the lifetime; logical snapshots preserve the P0 format and rebuild trees. PRIMARY KEY and column UNIQUE constraints remain validation-only unless an explicit index is declared. `inspectRows`, `inspectIndex` and `validateIndexes` are internal diagnostics, not query access paths.

SQL index keys normalize BOOLEAN to 0/1 and -0 to 0; NULL sorts first, followed by numbers then text. Composite keys compare lexicographically; text uses case-sensitive UTF-16 code-unit order, matching P0. No implicit text/number conversion or new collation is introduced. Default slots grow for larger keys through an atomic rebuild, up to 21,823 encoded bytes and 64 key components. Over-limit values fail the statement; overflow pages are not implemented. Catalog indexes do not accelerate SELECT and the studio has no live tree visualizer. Copied page images provide no durability.

There is **no optimizer**. Operators follow SQL semantics with nested-loop joins; no statistics/ANALYZE, cost estimates, predicate pushdown, projection pruning, hash join, or join reordering is implemented.

There is **no WAL or MVCC**. No transaction sessions, savepoints, checkpoints, database IndexedDB persistence, or crash recovery are implemented. Per-statement candidate-state validation provides atomicity only; it is not transaction isolation or durability. BEGIN/COMMIT/ROLLBACK are rejected.

P1B-2A's `src/engine/index-reader.ts` provides internal engine reads, with no SQL syntax or Worker protocol additions:

```ts
const table = db.tableHandle("t");
const index = db.indexHandle(table, "ix");
const refs = db.lookupIndex(index, [1, "A"]); // Full key, normalized like maintenance.
const rows = db.resolveRows(table, refs); // Detached current rows; no per-ID table scan.
for (const entry of db.scanIndex(index, {
  lower: { key: [1] }, upper: { key: [3], inclusive: false },
})) {
  // entry contains table handle, rowId, full key and a detached row.
  console.log(entry.row);
  break; // Closes the physical cursor.
}
```

`resolveRow(ref)` returns one current row or throws for an invalid/deleted reference. Frozen table/index handles bind references to one database and object lifetime. DROP/recreation and logical restore invalidate old handles; ordinary UPDATE preserves row identity and resolves the new contents. Failed statements do not publish directories or invalidate cursors. Row directories are built once per successful publication (O(total rows)); individual resolution uses a keyed directory. Directory maps never substitute for B+tree key search.

Exact physical lookup includes NULL and returns duplicates in ascending stable-ID order. It does not evaluate SQL equality. Missing keys return `[]`; invalid arity/nonfinite values/current slot overflow throw `IndexReadError`. Bounds accept full keys or lexicographic prefixes, default inclusive; upper `[1]` excludes full `[1, ...]` keys. Reverse traversal reverses the full key/ID order. All active cursors fail on their next pull after any successful DDL/DML/restore, including no-op or unrelated changes; closed cursors stay closed. There is no snapshot isolation. Handles cannot be serialized into durable references.

### SQL indexed equality (P1B-2B)

`SELECT ... FROM t WHERE t.k = 7` (also reversed operands, aliases and `==`) uses a declared single-column B+tree on `k` when types agree. Literal, arithmetic and explicitly allowlisted pure-function constants are supported. CREATE INDEX before or after inserts, duplicate values and subsequent atomic DML are supported. `src/engine/equality-access.ts` selects the source after existing binding; the original WHERE, projection and downstream operators still run. Stable-ID resolution never scans the table.

NULL equality, mixed text/numeric operands, dates, CASE, AND/OR, ranges, column expressions, composite indexes and joins use P0 scans. Unsupported SQL syntax still raises its original diagnostic. No automatic PRIMARY KEY tree, collation conversion, cost model or join optimization is added. Multiple eligible indexes use deterministic name ordering, not statistics.

`QueryResult.trace[].access` records the actual source (`index-equality` or `table-scan`), index/fallback reason and performed lookup/match counts. LIMIT 0 performs zero lookups. Existing EXPLAIN ANALYZE shows `Carian indeks` only for the selected index source; plain EXPLAIN remains unsupported. The internal constructor option `selectAccess: "table-scan"` provides reference comparisons without modifying SQL.

Exact lookup eagerly validates all matching references before emitting rows, so LIMIT on a common key can be slower than a scan that stops early. SQL-level measurements and this tradeoff are in BENCHMARK.md. `npm run benchmark` runs the original scan/join fixture and paired indexed SELECT workloads at 1k/10k/100k rows. Earlier internal-read measurements remain reproducible with `npx tsx tools/benchmark-index-read.ts`. P1C optimizer work is deferred.

## Studio and accessibility

Desktop uses schema/editor/results/inspector panels; tablets use a schema drawer and an inspector below results; mobile uses five bottom-navigation panels with horizontal swipe on panel backgrounds. SQL and results scroll within their own panels. The first data column remains sticky. Small-screen controls are designed for 44px targets. Keyboard shortcuts, focus rings, dialog focus management, live result/error announcements, reduced motion, and graph text alternatives are included.

Three P0 labs have actual result checkers (SELECT, JOIN, GROUP BY). The index, transaction, and window-function lessons are visible but explicitly unavailable.

## Static deployment on Vercel

1. Import this Git repository into Vercel and choose Vite.
2. Set install command to `npm ci`, build command to `npm run build`, and output directory to `dist`.
3. Use Node 22 or 24. No environment variables are needed.
4. Deploy the static output and verify the Worker and `.wasm` assets load from the same deployment.

`vercel.json` supplies a same-origin CSP and other static security headers. It allows WASM compilation for SQLite and inline styles for CodeMirror; there are no remote script/font dependencies. `.github/workflows/ci.yml` runs the core gates, production browser suite, differential suites and dependency audit. The first [GitHub Actions run](https://github.com/PuteraMY/vela-database-studio/actions/runs/43174807797) passed on commit `9b58b91`; exact job steps and remaining tooling notices are recorded in `evidence/github-ci.json`. This verifies GitHub CI, not a deployed production site.

Before an approved release, run the commands above and retain the passing commit and evidence. After deployment, check the actual URL's headers, Worker/WASM responses, initial query, CSV import and mobile layout. If those checks fail, use Vercel's rollback/redeploy action to restore the previous verified deployment. P0 stores no durable database data to migrate; snippets remain in the browser's origin-specific IndexedDB.

No Vercel deployment was performed for this delivery. `npm run preview` serves the built output locally for verification. Production publication requires separate approval.

## License

VELA is distributed under the repository owner's MIT license in [LICENSE](LICENSE). Vendored skills retain their own licenses; Anthropic frontend-design is Apache-2.0. See [.agents/SOURCES.md](.agents/SOURCES.md) for that boundary.
