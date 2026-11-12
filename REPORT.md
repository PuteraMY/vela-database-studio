# VELA delivery and skills integration report

Verified on 2026-11-12. **The P0 engine and studio are complete within the documented SQL subset. P1, P2 and P3 are not implemented. The full original project is therefore not finished.** This continuation preserves the existing application and applies the requested skills to its reliability, UX, testing and release preparation.

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

P0 provides a dependency-free handwritten SQL tokenizer/parser, typed AST, three-valued NULL logic, table/constraint and index-catalog DDL, atomic DML, expressions/aggregates/grouping, up to four joined tables and pull-based execution traces. SQL runs in a Web Worker. Physical indexes are not hidden behind catalog definitions.

The studio includes the responsive schema/editor/results/inspector layout, real operator graph replay, latency metrics, virtualized results, sorted exports, local SQLite comparison with cell diffs, three datasets, CSV import, dataset generation, IndexedDB snippets, history, command palette and three checked P0 lessons. B-tree/transaction panels and later lessons explicitly state their unavailable status.

This continuation corrected virtual-spacer paint/layout shifts, graph clipping, keyboard tabs, sorted export, formula-text export and LIKE backtracking; strengthened empty-result comparison, input rendering and actual download assertions; and added local security headers and CI configuration. TESTING.md records nineteen concrete bugs or rough edges and their fixes. The existing architecture, design direction and working features were retained. No server, external database, animation framework or new production service was added.

## Verification

| Executed command/check | Result |
| --- | --- |
| `npm run verify` | Skill integrity, strict typecheck, lint, 268/268 unit tests and production build passed; no emitted warnings/errors. |
| `npm run test:production` | 62/62 actual-browser tests passed on desktop/mobile; zero skipped/flaky/unexpected tests. |
| `npm run curated` | 100/100 hand-written expected result sets verified in VELA and SQLite. |
| `npm run fuzz` | 5,000/5,000 matched (100%), seed 355866, 25 randomized schemas, 20 P0 query categories. |
| `npm audit --json` | Zero final known advisory findings; initial audit had 2 critical and 8 moderate. |
| `npx tsx tools/inspect-ui.ts` | 360/390/768/1100/1440 layouts have no document/body horizontal overflow; no collected page/console errors or warnings. |
| `npx tsx tools/browser-profile.ts` | Real production Worker/result/scroll measurements, zero collected errors; limitations below. |
| `npm run benchmark` | Assertions passed, measured source hash unchanged; two of three requested performance targets remain unmet. |

The fuzzer's initial match rate was **98.44% (4,922/5,000)**. All 78 observed mismatches were fixed: REAL division 40, Unicode LIKE 20, SUBSTR bounds 13, boolean IS predicates 5. The final run has no unresolved mismatches **within its generated subset**. It excludes P3 subqueries, CTEs, set operations/windows and P1/P2 systems. Unsupported probes are recorded separately, never counted as matching errors. Ordered cell comparison uses a 1e-10 floating tolerance and excludes labels. This is not universal SQLite compatibility: strict stored types, JavaScript numeric limits and limited date formats intentionally differ. The comparison UI test demonstrates one known unsupported `%j` date format instead of concealing it.

Chromium tests include axe A/AA scans on initial desktop/mobile screens, keyboard interaction, reduced motion, 44px mobile control geometry, swipe, empty/error states, local assets and 100k virtualization. They do not establish full screen-reader or cross-browser conformance. Required B-tree stepping/transaction/rollback feature tests cannot pass as feature tests until P1/P2 exist; current tests verify honest unavailability and rejection without mutation.

## Performance against targets

The final Node benchmark used 100k fact rows and 100 dimension rows on Intel Xeon Platinum 8573C, Linux, Node 24.22.1, a two-CPU container quota and 8 GiB memory limit. Detailed warmups, samples, p95 and browser results are in [BENCHMARK.md](BENCHMARK.md).

| Requested workload | Measured median | Status |
| --- | ---: | --- |
| Indexed point lookup <5 ms | 162.082 ms using a full scan | Not met; index access absent |
| Two-table indexed join <1 s | 4,180.548 ms using nested loops | Not met; indexed join absent |
| Aggregate scan <1 s | 224.059 ms | Met for the measured fixture |

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

- **P1 absent:** fixed pages, real B+tree insert/split/delete/redistribute/merge/linked-leaf scans, page reads, statistics/ANALYZE, optimizer transformations/costing, join selection/reordering, estimated EXPLAIN and real tree visualizer. `EXPLAIN ANALYZE` only exposes actual P0 operators with inclusive times.
- **P2 absent:** BEGIN/COMMIT/ROLLBACK/SAVEPOINT, WAL, recovery, MVCC sessions, durable database IndexedDB storage and checkpointing. Reloading loses database changes; only snippets persist.
- **P3 absent:** scalar/IN/EXISTS/correlated subqueries, CTEs/recursive CTEs, UNION/INTERSECT/EXCEPT and windows. Three of six guided lessons await these tiers.
- Results are fully materialized/transferred despite bounded DOM rendering. Mutations clone/validate the database. Large joins/CSV/SQL inputs have no general resource governor or cancel control; large workloads can consume memory/Worker time.
- Strict storage types and IEEE-754 numbers differ from SQLite affinity/64-bit integers. Date functions implement a documented small UTC subset. Arbitrary SQL compatibility is not promised by the 100% sampled match rate.
- Only Chromium was exercised. Field performance, real-device behavior, full assistive-technology review and hosted security-header delivery are not verified.

The next engineering tier is P1 storage/index invariants, followed by optimizer selection and real tree/estimated-plan inspection. P2 and P3 remain ordered after a built, tested and committed P1. The project stops here at the verified P0 boundary for this delivery.

## Release assessment

This is a tested educational P0 studio with reproducible evidence and a stronger local development workflow. It is not a completed transactional database or a durable production datastore. The requested eight-name source review is complete, with one original vendor folder verified and seven legacy guides awaiting upstream replacements; native automatic catalog registration is unverified. The full original “done when” bar is not met because later tiers and indexed targets are absent.

The static build is ready for an approved preview deployment, subject to the explicit P0 limits above. After the user created [PuteraMY/vela-database-studio](https://github.com/PuteraMY/vela-database-studio), the project was published to its main branch. The initial remote commit and owner's MIT license were preserved in merge commit `9b58b91`, along with the full local development history. No unrelated project or shared skills repository was modified. No production site deployment occurred. npm/Chromium/skill access succeeded; omitted engine tiers are scope limits rather than installation failures.

The first [GitHub Actions run](https://github.com/PuteraMY/vela-database-studio/actions/runs/43174807797) passed on `9b58b91366ffb189ac565805a69a3f497b5d6bb1`, independently repeating npm ci, core gates, 268 unit tests, 62 browser tests, curated 100/100, fuzz 5000/5000, zero known audit findings and artifact upload. Actual logs and job statuses were inspected; see `evidence/github-ci.json`. The implementation is unchanged from the locally verified P0 tree. CI does emit nonblocking old-action-runtime/ESLint deprecation and npm lifecycle-policy notices; passing browser console checks do not imply a warning-free dependency installation. Tooling maintenance remains separate from the completed source publication. Deployment checks and rollback steps remain documented in README.md.

Small evidence files are checked into `evidence/`; full logs, browser screenshots and larger generated schemas remain in the gitignored `artifacts/` directory. Every reported gate has a corresponding executed command; generated raw data identifies the measured source and environment.
