# VELA delivery and skills integration report

Verification finalized on 2026-11-13. **P0 through P1B-2B are locally verified. Safe single-table equality SELECT now uses explicit B+trees; other queries retain P0 scans. General optimization, P2 and P3 remain unimplemented. The full original project is not finished.**

## P1B-2B SQL execution checkpoint

Added post-binding eligibility and a source operator using the real B+tree exact lookup and stable-ID resolver. Supported predicates are a complete direct-column `=`/`==` comparison with a compatible literal/arithmetic/allowlisted pure-function constant, in either operand order, on one base table and an explicit single-column index. The original WHERE and downstream pipeline remain active. NULL equality, mixed types, unsafe constants, composite predicates, AND/OR, ranges and joins use the authoritative scan path; unsupported syntax still errors. Multiple indexes use deterministic name ordering, not a cost model.

Verification: **622/622 unit tests**, including **1,000 three-way indexed/scan/SQLite comparisons**; skills/typecheck/lint/build pass. All **66 distinct browser cases** have passing evidence: 62 passed initially and four new cases passed after correcting test-only locator roles. Initial failures are retained and explained in TESTING.md. Curated **100/100**, fuzzer **5000/5000**, zero mismatches. Physical-call instrumentation, residual filtering and actual trace counts prove index execution; LIMIT 0 performs zero lookups. Existing EXPLAIN ANALYZE displays actual source operators without estimated costs.

SQL benchmark at 100k rows: unique-key median **0.398 ms indexed vs 179.092 ms forced scan**. Common-key LIMIT 1 is slower: **20.554 vs 0.135 ms**, because exact lookup validates all 10k references before yielding. This is an explicit limitation, not concealed by a heuristic. Memory-only storage, strict P0 type semantics, no automatic PRIMARY KEY index, cost/range/join planning or new UI. P1A storage, catalog/DML/read implementation, binder/evaluator, Worker protocol and dependencies are preserved.

Branch `feat/vela-p1b2b-indexed-select` starts at verified `8744b46b188664b1a88925764a35064da147dc84`; stacked review targets `feat/vela-p1b2a-index-read-path`. PRs #1–#3/main remain unchanged. No subagents or new skills were used; existing local skill integrity passed. No merge/deployment. Reproducible evidence: `evidence/p1b2b-verification.json` and SQL benchmark reports. Remote CI status is separate from these local checks and reported with the PR.

## P1B-2A internal read checkpoint (historical)

`IndexReadPath` resolves P1B-1 IDs through per-table directories and performs exact/range reads through real B+trees. Frozen table/index handles enforce database ownership and object lifetimes. Ordinary UPDATE retains references; deleted rows fail resolution; DROP/recreation and logical restore invalidate old handles. Every returned index entry is checked against the current row. Cursors stream in both directions, support inclusive/exclusive lexicographic bounds and release their physical iterator on completion, cancellation or error. Any successful publication invalidates open cursors; failed statements preserve them.

Local core gates pass: skills integrity, typecheck, lint, **622/622 unit tests (68 new)** and build. New tests include 900 deterministic reference-model steps, no-scan instrumentation, cleanup assertions and ten targeted SQL/SQLite comparisons. The interrupted session had also completed 62/62 production-browser tests; those valid results and the core gate were preserved without rerunning. Resumed curated checks matched 100/100 and fuzz matched 5000/5000 (seed 355866). Internal 100k-row medians were 0.072104 ms for exact lookup plus four-row resolution and 0.115886 ms for a 40-row range. These are internal measurements, not SELECT speedups. Full evidence, hardware and methodology are in TESTING.md, PROGRESS.md and BENCHMARK.md. This milestone used no subagents, new dependencies or skill loads; project-local skills remain unchanged and integrity-checked.

Limits: memory only; read handles stay within one Database instance and cannot be durable/Worker-protocol references. Directory rebuilding adds O(total rows) publication work and O(total rows) memory; individual resolution does not scan. Exact keys require full arity and must fit current slots; partial range bounds are ordinary lexicographic keys, not wildcard prefixes. Raw NULL lookup is not SQL equality. There is no snapshot isolation, SELECT index operator, optimizer or UI change.

Branch `feat/vela-p1b2a-index-read-path` starts at verified `77bfc1b264392cd5320ca5a52e413972570a2d6f` and targets `feat/vela-p1b1-index-maintenance` in a separate stacked PR. Preserve PR #1/#2; no merge or deployment. P1B-2B should start with a single-table equality index operator and differential SQL binding/residual/fallback tests. Work stops at P1B-2A.

## P1B-1 index maintenance checkpoint (historical)

Stable internal row IDs survive ordinary INSERT/UPDATE/DELETE without array-position dependence. SQL key normalization matches P0 strict types, BOOLEAN 0/1 and case-sensitive UTF-16 ordering; duplicate keys and NULL-containing UNIQUE keys retain supported behavior. CREATE INDEX populates real trees, DROP removes them, and candidate row/catalog/identity/tree publication is atomic across all indexes. Diagnostics verify every entry and reference plus P1A invariants.

Limits: memory-only storage; logical restore/table recreation reset identity lifetimes; unsigned 32-bit IDs are not reused within a lifetime. Only explicit indexes get trees. Constraints still use full candidate-state validation, modified trees are copied, and oversized keys trigger detached rebuilds up to 21,823 encoded bytes/64 components. Larger keys fail atomically. SELECT, joins, EXPLAIN and UI do not gain index access or performance guarantees.

Local core verification: `npm run verify` passed skill integrity, typecheck, lint, **443/443 unit tests (48 new)** and build. The new suite includes 2,000 deterministic randomized DML attempts checked against an independent reference model and a twin database. Production browser regression passed 62/62; curated matched 100/100 and fuzz matched 5000/5000, with zero mismatches. The benchmark completed (point/full scan 175.821 ms, aggregate 264.344 ms, nested-loop join 4118.031 ms median); indexed access remains absent. Source-hashed evidence and hardware are recorded in TESTING.md, PROGRESS.md and BENCHMARK.md. No subagents, additional skill loads, dependency installs, shared-repository changes, merge or deployment were used for this milestone.

Branch: `feat/vela-p1b1-index-maintenance`, based on exact P1A commit `5f25dab28c73b7661268119d7f718d0f76965896`; review targets `feat/vela-p1a-storage-btree`, leaving PR #1 unchanged. Stop after this checkpoint. P1B-2 should start with a read-only stable-ID resolver and exact-key access contract plus differential tests before planner integration.

## P1A storage checkpoint (historical)

P1A adds real fixed-size Uint8Array pages, deterministic allocation/reuse, bounded slots and deterministic typed/composite-key encoding. The B+tree supports exact search, duplicate pairs, insertion, leaf/internal splitting, root growth, linked-leaf forward/reverse range scans, deletion, redistribution in both directions, leaf/internal merges and root contraction. Structural validation checks occupancy, ordering, exact separators, unique reachability, parent links, common leaf depth and both leaf-link directions. Detached page images are validated on restore; failed normal operations publish no partial page changes.

At the P1A checkpoint, the final local gates passed: skill integrity, strict typecheck, lint, **395/395 unit tests (127 new)** and production build. Tests include 25 seeded model sequences of 1,000 operations each and a 100,000-entry insert/search/scan/delete workload. Curated SQL remains 100/100 and differential fuzz remains 5000/5000. Final logs and compact source-hashed evidence are recorded in TESTING.md and `evidence/p1a-verification.json`. No tests were skipped in the final gate.

The adapter indexes exported table snapshots only. SQL/CREATE INDEX behavior, EXPLAIN, the Worker and UI are unchanged; the studio still has no live tree visualizer or index access. No P1B planning/optimization, WAL, MVCC, durability or advanced SQL was started. Physical key ordering is deliberately separate from SQL NULL/affinity semantics. The memory image boundary is not crash recovery. Page/slot limits are explicit, and row references are unsigned 32-bit values; snapshot ordinals are not stable identities for mutable SQL rows.

The requested checkpoint is branch `feat/vela-p1a-storage-btree`, submitted as a PR targeting main after local verification. Do not merge automatically. Full module/API/invariant documentation is in [src/engine/storage/README.md](src/engine/storage/README.md). The exact next P1B task is stable row identities and SQL key normalization followed by atomic catalog/DML physical-index maintenance, before index query access is enabled. Work stops at P1A.

## Skills access, loading and use

All eight requested entries were accessed through the GitHub connector, read in full and copied into `.agents/skills/`. **The user's later source-migration recheck found one official vendor original and seven legacy custom guides among these eight names.** The updated shared README/audit also says migration remains in progress. The table records actual development use; earlier work must not be retroactively attributed to a newly fetched vendor version.

| Skill | Actual application |
| --- | --- |
| frontend-design | Updated to the original Anthropic folder, used for screenshot/design critique while honoring VELA's specified tokens. Earlier graph/comparison/keyboard work used the old custom guide. |
| design-system | Existing colors/fonts retained; shared focus, radius and motion tokens documented. |
| fullstack-development | Typed UI/Worker/engine boundaries and bounded comparison-difference responses. |
| database-architecture | Atomic constraint review, SQL differential checks and measured storage/query limits; server/PostgreSQL advice adapted to this browser engine. |
| security-audit | Reproduced/fixed adversarial LIKE and spreadsheet export; dependency audit and static response headers. |
| automated-testing | Unit regressions, actual Worker/WASM browser tests, accessibility checks and stronger export assertions. |
| performance-optimization | Bounded matching/diffs, retained virtualization/code splitting, measured engine and production browser performance. |
| deployment-qa | Production-preview checks, CI configuration, static deployment and rollback documentation. |

`frontend-design/SKILL.md` matches both PuteraMY and Anthropic at Git blob `a5333457c414d20d625f307df945842c0952ecc3`. The inspected original folder contains that file and `LICENSE.txt`; VELA now includes both. The Apache-2.0 license was fetched directly because the shared mirror currently omits it. Seven other entrypoint hashes remain unchanged and their classification is **legacy custom guide**, not official vendor integration. Their previous generic guidance informed the work listed above; their files are retained for provenance, not presented as migrated vendor skills.

`npm run skills:verify` passes **eight entrypoint hashes plus one support/license hash**, complete selected vendor-folder inventory and locally adapted structure checks. The old shared validator assumes custom headings and needed local adaptation; official source bytes were preserved. Three negative probes reject entrypoint tampering, a missing license and license tampering. **None of the eight entrypoints was inaccessible.** The executor catalog is still empty, so automatic runtime discovery or native plugin installation is **not verified**. See [SKILLS_INTEGRATION.md](SKILLS_INTEGRATION.md) for source URLs, current status and per-skill usage. No shared-repository files were changed.

## Completed scope

P0 provides a dependency-free handwritten SQL tokenizer/parser, typed AST, three-valued NULL logic, table/constraint and index-catalog DDL, atomic DML, expressions/aggregates/grouping, up to four joined tables and pull-based execution traces. SQL runs in a Web Worker. P1B-1 subsequently connects explicit catalog definitions to physical trees; P1B-2B adds the bounded SQL access path described above.

The studio includes the responsive schema/editor/results/inspector layout, real operator graph replay, latency metrics, virtualized results, sorted exports, local SQLite comparison with cell diffs, three datasets, CSV import, dataset generation, IndexedDB snippets, history, command palette and three checked P0 lessons. B-tree/transaction panels and later lessons explicitly state their unavailable status.

This continuation corrected virtual-spacer paint/layout shifts, graph clipping, keyboard tabs, sorted export, formula-text export and LIKE backtracking; strengthened empty-result comparison, input rendering and actual download assertions; and added local security headers and CI configuration. TESTING.md records nineteen concrete bugs or rough edges and their fixes. The existing architecture, design direction and working features were retained. No server, external database, animation framework or new production service was added.

## Verification

| Executed command/check | Result |
| --- | --- |
| `npm run verify` | Skill integrity, strict typecheck, lint, 622/622 unit tests and production build passed; no emitted warnings/errors. |
| `npm run test:production` | 66 distinct desktop/mobile cases have passing evidence (62 retained + four corrected tests); initial four locator failures documented, zero skipped/flaky cases. |
| `npm run curated` | 100/100 hand-written expected result sets verified in VELA and SQLite. |
| `npm run fuzz` | 5,000/5,000 matched (100%), seed 355866, 25 randomized schemas, 20 P0 query categories. |
| `npm audit --json` (historical P0) | Zero known advisory findings at that run; initial audit had 2 critical and 8 moderate. |
| `npx tsx tools/inspect-ui.ts` (historical P0) | 360/390/768/1100/1440 layouts have no document/body horizontal overflow; no collected page/console errors or warnings. |
| `npx tsx tools/browser-profile.ts` (historical P0) | Real production Worker/result/scroll measurements, zero collected errors; limitations below. |
| `npm run benchmark` | Assertions passed, measured source hash unchanged; indexed equality and aggregate targets met on measured fixtures; indexed joins remain absent. |

The fuzzer's initial match rate was **98.44% (4,922/5,000)**. All 78 observed mismatches were fixed: REAL division 40, Unicode LIKE 20, SUBSTR bounds 13, boolean IS predicates 5. The final run has no unresolved mismatches **within its generated subset**. It excludes P3 subqueries, CTEs, set operations/windows and P1/P2 systems. Unsupported probes are recorded separately, never counted as matching errors. Ordered cell comparison uses a 1e-10 floating tolerance and excludes labels. This is not universal SQLite compatibility: strict stored types, JavaScript numeric limits and limited date formats intentionally differ. The comparison UI test demonstrates one known unsupported `%j` date format instead of concealing it.

Chromium tests include axe A/AA scans on initial desktop/mobile screens, keyboard interaction, reduced motion, 44px mobile control geometry, swipe, empty/error states, local assets and 100k virtualization. They do not establish full screen-reader or cross-browser conformance. Required B-tree stepping/transaction/rollback feature tests cannot pass as feature tests until P1/P2 exist; current tests verify honest unavailability and rejection without mutation.

## Performance against targets

The final Node benchmark used 100k fact rows and 100 dimension rows on Intel Xeon Platinum 8573C, Linux, Node 24.22.1, a two-CPU container quota and 8 GiB memory limit. Detailed warmups, samples, p95 and browser results are in [BENCHMARK.md](BENCHMARK.md).

| Requested workload | Measured median | Status |
| --- | ---: | --- |
| Indexed equality SELECT <5 ms | 0.398 ms with explicit unique index | Met on paired 100k fixture |
| Two-table indexed join <1 s | 4054.520 ms using nested loops | Not met; indexed join absent |
| Aggregate scan <1 s | 208.227 ms | Met for the measured fixture |

Production-browser p95 sampled frame intervals were 16.7/16.7ms at desktop/mobile widths; maxima were 50.0/33.4ms, so uninterrupted 60fps is not claimed. Initial CLS was 0.0041/0.0061. After investigating empty spacer-row paint, scripted-scroll CLS improved from 10.62/32.82 to 0.0065/0.0061. Both browser tests enforce the scroll-shift bound and final-row visibility; before/after evidence is retained. There are no field INP measurements, repeated real-device studies or 500k stress claims.

## Delegation record

These three bounded delegations occurred earlier, after the root built/committed the P0 engine milestone. Root built the engine, applied fixes, integrated the results and reran validation. The latest supplied AGENTS.md says to work alone; no new agents were spawned for skills integration or final QA.

| Agent / ownership | Work and findings | Integration / conflict or rework |
| --- | --- | --- |
| differential — `tools/fuzz.ts`, `tools/curated.ts`, differential artifacts | Implemented/ran seeded random schema/query comparison and 100 explicit curated cases. Found the initial 78 mismatches; curated cases passed. | Root fixed engine semantics and reran 5,000/5,000 and 100/100. No shared-file edit conflict. |
| engine_review — read-only engine review, owned `tests/review.test.ts` | Reproduced 18 SQLite-verified semantic/validation failures involving REAL, precedence, aliases, LIKE, boolean IS, SUBSTR, stars/ordinals and aggregate misuse. B+tree absent, so no tree review claimed. | Root fixed all 18; regression tests now pass. No agent edited engine files or caused merge conflict. |
| benchmark — `tools/benchmark.ts` only | Built asserted 100k fixture/hardware/sample reporting. Initial measurements exposed full-scan/nested-loop target misses. | Root retained the harness and reran it on final source; current figures supersede earlier timings. No edit conflict. |

Playwright tests, security changes, UI implementation and final documents were root-owned. Root's earlier formatting while Vite tests ran caused one navigation abort; malformed synthetic Touch fixtures and a transpiler helper in the profiling harness required test-tool corrections. These were root test-process issues, not hidden engine passes or agent conflicts. Final results were collected after fixing them.

## Limitations and next ordered milestone

- **P1 incomplete:** P1A pages/B+tree, P1B-1 maintenance, P1B-2A internal reads and P1B-2B bounded equality execution are implemented; broader index access, page-read reporting in the studio, statistics/ANALYZE, optimizer transformations/costing, join selection/reordering, estimated EXPLAIN and the tree visualizer remain absent. `EXPLAIN ANALYZE` exposes actual scan/index source operators with inclusive times, without estimates.
- **P2 absent:** BEGIN/COMMIT/ROLLBACK/SAVEPOINT, WAL, recovery, MVCC sessions, durable database IndexedDB storage and checkpointing. Reloading loses database changes; only snippets persist.
- **P3 absent:** scalar/IN/EXISTS/correlated subqueries, CTEs/recursive CTEs, UNION/INTERSECT/EXCEPT and windows. Three of six guided lessons await these tiers.
- Results are fully materialized/transferred despite bounded DOM rendering. Mutations clone/validate the database. Large joins/CSV/SQL inputs have no general resource governor or cancel control; large workloads can consume memory/Worker time.
- Strict storage types and IEEE-754 numbers differ from SQLite affinity/64-bit integers. Date functions implement a documented small UTC subset. Arbitrary SQL compatibility is not promised by the 100% sampled match rate.
- Only Chromium was exercised. Field performance, real-device behavior, full assistive-technology review and hosted security-header delivery are not verified.

This checkpoint stops at P1B-2B. P1C requires a new instruction: begin by defining the logical/physical planning contract and estimate/actual evidence before extending access rules. P2 and P3 remain ordered after verified P1.

## Release assessment

This is a tested educational P0 SQL studio with verified P1A storage, P1B-1 maintenance, P1B-2A internal reads, P1B-2B bounded indexed SQL and reproducible evidence. It is not a completed transactional database or a durable production datastore. The requested eight-name source review is complete, with one original vendor folder verified and seven legacy guides awaiting upstream replacements; native automatic catalog registration is unverified. The full original “done when” bar is not met because later tiers and indexed joins are absent.

The static build is ready for an approved preview deployment, subject to the explicit P0 limits above. After the user created [PuteraMY/vela-database-studio](https://github.com/PuteraMY/vela-database-studio), the project was published to its main branch. The initial remote commit and owner's MIT license were preserved in merge commit `9b58b91`, along with the full local development history. No unrelated project or shared skills repository was modified. No production site deployment occurred. npm/Chromium/skill access succeeded; omitted engine tiers are scope limits rather than installation failures.

The first [GitHub Actions run](https://github.com/PuteraMY/vela-database-studio/actions/runs/43174807797) passed on `9b58b91366ffb189ac565805a69a3f497b5d6bb1`, independently repeating npm ci, core gates, 268 unit tests, 62 browser tests, curated 100/100, fuzz 5000/5000, zero known audit findings and artifact upload. Actual logs and job statuses were inspected; see `evidence/github-ci.json`. That P0 publication preserved the locally verified implementation; the separate P1A changes are described above. CI does emit nonblocking old-action-runtime/ESLint deprecation and npm lifecycle-policy notices; passing browser console checks do not imply a warning-free dependency installation. Tooling maintenance remains separate from the completed source publication. Deployment checks and rollback steps remain documented in README.md.

Small evidence files are checked into `evidence/`; full logs, browser screenshots and larger generated schemas remain in the gitignored `artifacts/` directory. Every reported gate has a corresponding executed command; generated raw data identifies the measured source and environment.
