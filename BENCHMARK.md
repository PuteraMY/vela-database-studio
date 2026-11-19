# Measured performance

## P1C-2B regression investigation (2026-11-19)

The historical no-LIMIT change (62.157 → 79.531 ms) was **not reproduced consistently**. A new equivalent comparison gives 49.139 ms for exact P1C-1 and 45.355 ms for exact P1C-2A. The candidate engine is byte-identical to P1C-2A, yet measures 54.934 ms: the A/A control demonstrates substantial process/run variation. The historical cause remains unconfirmed; no execution fix, threshold change or speedup is claimed. GC, JIT and host scheduling were not separately attributed.

`npm run benchmark:calibration` extracts both exact commits from local git, then runs four modes in fresh **sequential** Node processes: P1C-1, P1C-2A, candidate and candidate forced scan. Three process trials rotate mode order; each workload has 10 warmups and 15 measured queries per trial (45 retained samples per mode). Identical 100,000-row fixtures have id=i+1, k=i%10, v=floor(i/10)%5, an explicit UNIQUE id index and non-unique k index. Complete results and actual source kind are asserted after every query; all assertions passed. No build/test/browser suite ran concurrently. Short file inspection/formatting commands and shared-host activity were not controlled.

Wall timing includes parsing, binding, planning, cursor/scan, resolution, WHERE, downstream operators and result materialization. Setup/index construction, assertions and Worker/DOM transfer are excluded. No outliers are discarded and no forced GC is used. Reported p95 is nearest-rank over 45 samples, variance is sample variance (N−1), and all per-trial medians/raw samples are retained. These are lab observations, not confidence intervals or field tail-latency guarantees. The old two-warmup/nine-sample same-process harness held three databases; do not attribute changes between methodologies to engine improvements.

Environment: Node v24.22.1, Linux 6.18.57 x64, Intel Xeon Platinum 8573C; three visible CPUs, available parallelism two, CPU quota 200000/100000, memory limit 8 GiB. Source hashes matched before/after and P1C-2A/candidate hashes are identical. [Compact evidence](evidence/p1c2b-calibration.json) preserves all wall/engine/source samples, access evidence, diagnostics and hashes; full artifact: `artifacts/p1c2b-calibration.json`.

| 100k workload | P1C-1 median / p95 ms | P1C-2A median / p95 ms | Candidate median / p95 ms | Forced scan median / p95 ms |
| --- | ---: | ---: | ---: | ---: |
| unique equality | 0.159 / 0.542 | 0.160 / 0.460 | 0.172 / 0.544 | 117.775 / 228.696 |
| duplicate LIMIT 1 | 0.136 / 0.471 | 0.113 / 1.313 | 0.068 / 0.160 | 0.053 / 0.302 |
| duplicate without LIMIT | 49.139 / 83.851 | 45.355 / 51.794 | 54.934 / 93.497 | 141.452 / 284.878 |
| missing LIMIT 1 | 0.119 / 0.303 | 0.173 / 0.431 | 0.156 / 0.636 | 120.520 / 256.874 |
| duplicate LIMIT 1 OFFSET 25 | 0.283 / 0.560 | 0.275 / 0.602 | 0.315 / 0.736 | 0.383 / 0.744 |
| duplicate LIMIT 10 OFFSET 100 | 0.672 / 1.733 | 0.721 / 1.240 | 0.649 / 1.231 | 1.541 / 2.128 |
| ordered LIMIT 1 | 51.708 / 88.626 | 48.297 / 65.249 | 52.897 / 70.640 | 135.636 / 264.882 |
| DISTINCT LIMIT 3 OFFSET 1 | 0.133 / 0.264 | 0.160 / 0.333 | 0.168 / 0.420 | 0.085 / 0.175 |
| aggregate LIMIT 1 | 47.658 / 55.173 | 44.566 / 67.210 | 51.675 / 82.049 | 127.902 / 312.831 |
| late prefix LIMIT 1 | 0.196 / 0.885 | 0.124 / 0.220 | 0.129 / 0.436 | 0.073 / 0.217 |

| Workload sample variance (ms²) | P1C-1 | P1C-2A | Candidate | Scan |
| --- | ---: | ---: | ---: | ---: |
| unique equality | 0.029621 | 0.018181 | 0.026054 | 1362.726914 |
| duplicate LIMIT 1 | 0.023954 | 0.295536 | 0.001990 | 1.413989 |
| duplicate without LIMIT | 281.150362 | 16.024546 | 542.924561 | 2911.475199 |
| missing LIMIT 1 | 0.012029 | 0.010223 | 0.026544 | 4920.790247 |
| duplicate LIMIT 1 OFFSET 25 | 0.019141 | 0.031357 | 0.024964 | 0.017013 |
| duplicate LIMIT 10 OFFSET 100 | 0.634807 | 0.082095 | 0.074510 | 0.084892 |
| ordered LIMIT 1 | 174.679189 | 61.727803 | 170.695386 | 4840.906611 |
| DISTINCT LIMIT 3 OFFSET 1 | 0.002154 | 0.005657 | 0.010000 | 0.002194 |
| aggregate LIMIT 1 | 47.152900 | 302.082825 | 657.653238 | 4810.144015 |
| late prefix LIMIT 1 | 0.073113 | 0.001404 | 0.009981 | 0.009726 |

No-LIMIT trial medians (ms): p1c1 51.191, 45.764, 52.307; p1c2a 42.957, 47.218, 44.687; candidate 49.758, 63.231, 58.990; scan 130.350, 201.561, 134.749.

Candidate measurements are worse than P1C-2A for no-LIMIT, unique, OFFSET 25, ORDER BY, DISTINCT, aggregate and late-prefix medians. P1C-2A also trails P1C-1 for missing-key and DISTINCT medians. These observations are retained; no universal improvement or causal interpretation is claimed. In particular, the unchanged A/A no-LIMIT difference is about 21%, preventing calibration from one aggregate median.

Isolation evidence: no-LIMIT chooses `retain-query-shape`, performs zero prefix row reads, consumes exactly 10,000 index entries and calls the planner once. Cursor, B+tree, row resolver, iterator, eligibility and evaluator sources are identical across the two historical commits. Source traces remain inclusive (cursor/resolution/qualification together); nested operator times must not be summed or treated as isolated planner timing.

| Separate diagnostic, pooled median ms | P1C-1 | P1C-2A | Candidate |
| --- | ---: | ---: | ---: |
| resolve one live row | 0.000049 | 0.000027 | 0.000036 |
| cursor plus resolution, 10000 rows | 18.070913 | 19.459010 | 19.245539 |
| planner only without LIMIT | not present | 0.000648 | 0.000683 |
| planner only LIMIT 1 | not present | 0.001001 | 0.000908 |

Diagnostics run after SQL measurements with five warmup batches and 15 measured batches per process. Planner and resolver samples average 10,000 calls; cursor samples traverse one complete 10,000-row equality range. Checksums are checked after timing; planner diagnostics include the access-kind assertion. Planner parsing is outside these diagnostic timers. Batched per-call distributions are not individual-call p95 and are never subtracted from end-to-end SQL timings. The roughly 0.00065 ms planner-only no-LIMIT median does not substantiate the historical 17 ms gap; the full historical cause remains inconclusive.

Calibration decision: retain the 1,024-row/eight-value prefix heuristic. It proves a bounded early scan only for the supported non-unique literal LIMIT 1 shape, not global cardinality or optimal latency. Wider LIMIT/OFFSET, blocking queries and late/missing keys keep established paths. Any next calibration needs an explicit new workload-backed hypothesis; range/join planning, statistics and P2/P3 are outside this checkpoint.

## P1C-2A bounded planner (2026-11-13)

`npm run benchmark:planner` reuses the existing harness and extracts exact P1C-1 commit `8805cacd2ee207540c09a212cb3f770a251864e3` from local git. Same-process predecessor indexed/current planned/forced-scan SQL uses identical 100k rows, explicit UNIQUE id and non-unique k indexes. Data: id=i+1, k=i%10, v=floor(i/10)%5. Two warmups and nine measured runs per mode/workload, rotating order. Complete results and actual selected source are asserted outside timing. Includes parsing, binding, planning/probes, access, filtering, projection/downstream and result materialization; excludes setup/index construction, assertions, Worker transfer and DOM. No concurrent build/browser suite. Engine hashes stayed unchanged.

Linux 6.18.57 x64, Intel Xeon Platinum 8573C, Node 24.22.1; three visible CPUs, two-core quota/parallelism, 8 GiB memory limit. Warmed shared-host measurements are not field guarantees. Nine-sample nearest-rank p95 equals max. [Evidence](evidence/p1c2a-verification.json) retains all samples and traces; full raw artifact is `artifacts/p1c2a-planner-benchmark.json`. The harness's `streaming` field denotes current planned execution, which can now select a scan.

| 100k workload | P1C-1 median / p95 ms | Planned median / p95 ms | Scan median / p95 ms |
| --- | ---: | ---: | ---: |
| duplicate LIMIT 1 | 0.497 / 0.904 | 0.252 / 0.424 | 0.228 / 0.631 |
| duplicate LIMIT 1 OFFSET 25 | 0.510 / 0.665 | 0.448 / 0.658 | 0.697 / 1.102 |
| duplicate LIMIT 10 OFFSET 100 | 1.226 / 2.886 | 0.966 / 1.706 | 2.039 / 10.227 |
| missing LIMIT 1 | 0.425 / 1.062 | 0.306 / 0.780 | 117.603 / 133.164 |
| ordered LIMIT 1 | 49.563 / 56.686 | 48.518 / 57.149 | 134.493 / 140.111 |
| DISTINCT LIMIT 3 OFFSET 1 | 0.240 / 0.320 | 0.199 / 0.638 | 0.160 / 0.258 |
| aggregate LIMIT 1 | 46.271 / 52.579 | 48.127 / 54.183 | 136.148 / 153.029 |
| unique equality | 0.427 / 0.597 | 0.321 / 0.646 | 121.634 / 128.519 |
| duplicate without LIMIT | 62.157 / 127.421 | 79.531 / 114.451 | 169.421 / 283.315 |
| late prefix LIMIT 1 | 0.250 / 0.613 | 0.192 / 0.610 | 0.125 / 0.446 |

100k duplicate LIMIT 1 median (P1C-1 / planned / forced scan): **0.497 / 0.252 / 0.228 ms**. Measured regressions are retained: duplicate equality without LIMIT rose from **62.157 to 79.531 ms**, and aggregate LIMIT 1 from **46.271 to 48.127 ms**. Both retain indexed execution; this run does not establish the cause, and no universal speedup is claimed.

Only duplicate LIMIT 1 with a match inside the first eight rows changes path. Its four planning reads are reported separately from four executor rows. Unique keys avoid probing; missing/late keys read at most eight scalars then retain the index. No-LIMIT, OFFSET and blocking controls retain streaming indexes. Compare every workload above: an extra probe/metadata can regress timings, and unrelated retained-path variation is not an optimizer gain. No total-cardinality or time-cost estimate is claimed; the positive probe proves only a bounded amount of row work. Thresholds (1,024 rows/eight probes) are intentionally conservative, not calibrated universal crossovers.

## P1C-1 streaming SQL measurements (historical, 2026-11-13)

`npm run benchmark:streaming` extracts the exact P1B-2B engine at `f39ff56d8961ac556e953ecf80cff328c5721cd7` into gitignored artifacts and measures predecessor indexed, current streaming and current forced-scan SQL in one Node process. Reproduction requires that commit in the local git object database; no checkout/branch is modified. All complete-result/access-path assertions passed. [Evidence](evidence/p1c1-streaming-benchmark.json) retains every wall sample, min/max, median/p95 and actual access counts for all 1k/10k/100k workloads. Raw report: `artifacts/p1c1-streaming-benchmark.json`.

Hardware: Linux 6.18.57 x64, Intel Xeon Platinum 8573C, Node 24.22.1; three visible CPUs, two available/CPU quota, 8 GiB memory limit. Identical fixtures have id=i+1, k=i%10, v=floor(i/10)%5 and one explicit k index. Two warmups and nine measured runs per mode/workload; rotate mode order. Includes SQL parsing, binding, cursor/scan, row resolution, WHERE, downstream operators and complete materialization. Excludes fixture/index creation, assertions and Worker/DOM transfer. No build/browser suite ran concurrently; engine hashes matched before/after. Nine-sample nearest-rank p95 equals the maximum; warmed shared-host Node timings are not field latency guarantees.

| Rows | Workload | Before median / p95 ms | Streaming median / p95 ms | Scan median / p95 ms |
| ---: | --- | ---: | ---: | ---: |
| 1,000 | duplicate LIMIT 1 | 0.934 / 2.707 | 0.537 / 3.178 | 0.213 / 0.987 |
| 10,000 | duplicate LIMIT 1 | 2.390 / 4.679 | 0.208 / 0.364 | 0.076 / 0.136 |
| 100,000 | duplicate LIMIT 1 | 17.626 / 22.950 | 0.257 / 2.087 | 0.113 / 0.210 |
| 100,000 | duplicate LIMIT 1 OFFSET 25 | 15.137 / 22.374 | 0.372 / 1.541 | 0.448 / 0.818 |
| 100,000 | duplicate LIMIT 10 OFFSET 100 | 15.620 / 20.498 | 0.826 / 1.956 | 1.673 / 3.130 |
| 100,000 | missing LIMIT 1 | 0.309 / 0.350 | 0.251 / 0.365 | 114.837 / 118.742 |
| 100,000 | ordered LIMIT 1 | 44.755 / 51.481 | 46.687 / 60.597 | 133.015 / 143.033 |
| 100,000 | DISTINCT LIMIT 3 OFFSET 1 | 20.451 / 35.125 | 0.255 / 1.580 | 0.124 / 0.188 |
| 100,000 | aggregate LIMIT 1 | 41.208 / 74.395 | 50.183 / 59.765 | 149.314 / 184.718 |

100k duplicate LIMIT 1: **17.626 ms before / 0.257 ms streaming / 0.113 ms scan**. Validated entries fall from 10,000 eagerly collected references to one consumed entry.

OFFSET 25 consumes 26 entries; LIMIT 10 OFFSET 100 consumes 110; DISTINCT LIMIT 3 OFFSET 1 consumes four. ORDER BY and aggregate controls consume all 10k matches and preserve full results. The reference scan still wins when a matching row occurs early; no cost heuristic is added. Blocking-query timings vary and are not promised to improve. Unordered LIMIT/DISTINCT follows existing fixture order, not a universal SQL ordering guarantee. Historical P1B-2B numbers below used a different fixture/harness and are not substituted for this contemporaneous comparison.

## P1B-2B SQL measurements (historical, 2026-11-13)

`npm run benchmark` completed both asserted harnesses sequentially, with no browser suite/build running concurrently. [Paired SQL evidence](evidence/p1b2b-indexed-sql-benchmark.json) retains all wall samples, min/max, median/p95, source timing and actual access evidence; full raw samples remain in `artifacts/benchmark-indexed-select.json`. [Original scan/join regression](evidence/p1b2b-scan-benchmark.json) retains its samples. Each harness checked unchanged engine source hashes before/after. Measurements precede the feature commit; file hashes in `p1b2b-verification.json` identify the actual measured working tree.

Hardware: Linux 6.18.57 x64, Intel Xeon Platinum 8573C, Node 24.22.1; three visible logical CPUs, available parallelism two, two-core CPU quota, 8 GiB memory limit. These warmed shared-host Node results are not browser/Worker-transfer/production latency guarantees.

Paired fixtures contain 1k/10k/100k rows with identical rows and three explicit indexes in auto and forced-scan databases. ID is unique; small_key groups four IDs; broad_key selects 10% of rows. Two warmups and nine measured executions per mode/workload, alternating mode order. Timings include parsing, binding, access selection, lookup/scan, row resolution/qualification, original WHERE, projection, ordering/limit and result materialization. Fixture/restore/index creation, invariant checks and complete-result assertions are outside the timer. Every run checks expected values and actual source kind; index lookup count is one. Source time includes lookup/validation/resolution/qualification together, not isolated resolver overhead. With nine samples, nearest-rank p95 equals the maximum; it is not a field tail-latency estimate.

| Rows | Workload | Index median / p95 (ms) | Scan median / p95 (ms) |
| ---: | --- | ---: | ---: |
| 1,000 | existing unique key | 0.318 / 4.916 | 7.874 / 15.122 |
| 1,000 | missing unique key | 0.137 / 2.678 | 2.253 / 6.753 |
| 1,000 | four non-unique matches | 0.208 / 0.392 | 2.014 / 2.722 |
| 1,000 | ten-percent matches | 0.902 / 3.751 | 2.864 / 9.898 |
| 1,000 | ten-percent key with LIMIT 1 | 0.251 / 3.291 | 0.062 / 1.576 |
| 10,000 | existing unique key | 0.264 / 0.714 | 16.647 / 19.687 |
| 10,000 | missing unique key | 0.212 / 0.403 | 16.727 / 17.478 |
| 10,000 | four non-unique matches | 0.292 / 0.415 | 16.730 / 17.616 |
| 10,000 | ten-percent matches | 5.474 / 6.547 | 18.429 / 20.346 |
| 10,000 | ten-percent key with LIMIT 1 | 1.997 / 3.367 | 0.094 / 0.209 |
| 100,000 | existing unique key | 0.398 / 0.526 | 179.092 / 184.915 |
| 100,000 | missing unique key | 0.355 / 0.440 | 181.356 / 191.818 |
| 100,000 | four non-unique matches | 0.390 / 0.882 | 180.932 / 224.499 |
| 100,000 | ten-percent matches | 61.267 / 68.525 | 206.280 / 216.771 |
| 100,000 | ten-percent key with LIMIT 1 | 20.554 / 38.916 | 0.135 / 0.365 |

At 100k rows, unique indexed SQL meets the <5 ms point target for this fixture. The 10k-match LIMIT 1 workload is substantially **slower** through the index: exact lookup eagerly validates/materializes all 10k references, then emits one row; the reference scan can stop after four rows. The same reversal exists at 1k and 10k. No cost heuristic was added. Unordered LIMIT preserves existing source behavior in this fixture, not a general SQL ordering guarantee.

The separate original fixture declares PRIMARY KEY constraints without explicit indexes, so it still scans: point 153.545 ms, aggregate 208.227 ms, 100k materialization 344.658 ms, and 100k × 100 nested-loop join 4054.520 ms medians. Aggregate meets 1 s; indexed join remains unimplemented and the measured nested loop misses 1 s. Do not compare internal P1B-2A lookup timings with these end-to-end SQL timings to claim a speedup.

## P1B-2A measurements (historical, 2026-11-13)

After resuming the unchanged, verified implementation, ran `npx tsx tools/benchmark-index-read.ts` and `npm run benchmark`. Raw samples: [internal reads](evidence/p1b2a-index-benchmark.json) and [SQL regression](evidence/p1b2a-benchmark.json). Both commands completed their correctness assertions and recorded matching source hashes at start/end. Hardware: Linux 6.18.57 x64, Intel Xeon Platinum 8573C, Node 24.22.1; 3 visible CPUs, available parallelism 2, 2-core CPU quota, 8 GiB memory limit.

| Internal operation | 10,000 rows, median | 100,000 rows, median |
| --- | --- | --- |
| resolve one row ID | 0.000067 ms | 0.000098 ms |
| exact lookup and resolve four rows | 0.064758 ms | 0.072104 ms |
| bounded cursor, 40 resolved rows | 0.109127 ms | 0.115886 ms |
| reference full-array filter, four matching rows | 0.071458 ms | 0.773114 ms |

Each operation uses two warmup batches and seven measured batches. Medians are per-call wall times averaged within each batch (2,000 resolver calls, 500 exact lookups, 100 range scans or 100 reference filters). These hot repeated-key Node measurements are not individual-call p95, browser latency or a general performance guarantee. Resolver timings include returning a detached row; exact lookup includes resolving/copying four matching rows; bounded scans resolve/copy all 40 rows. The reference uses a plain array filter without SQL execution or copying. Complete outputs are compared before timing, checksums after each timed batch. Loading/index creation is excluded from read timings and reported separately in the raw evidence.

These are internal read-path measurements, **not SQL SELECT speedups**. The unchanged SQL executor benchmark on 100k rows measured point/full-scan median **181.989 ms**, aggregate **241.670 ms**, materialization **387.757 ms**, and nested-loop 100k × 100 join **4245.250 ms**. Aggregate meets the 1 s target; the indexed point/join targets remain unimplemented. Logical restore median was **222.717 ms**, including fresh identities and read directories. Process-wide RSS after queries was **442.8 MiB**. Shared-host scheduling and the differing workload/measurement methods prevent treating the internal/reference/SQL numbers as interchangeable.

Measurements preceded the milestone commit: the SQL report's `gitCommit` names the P1B-1 base, while its source hash and `p1b2a-verification.json` file hashes identify the measured P1B-2A working tree.

## P1B-1 rerun (2026-11-12)

`npm run benchmark` completed after the final P1B-1 build/browser/differential gates. Full samples: [evidence/p1b1-benchmark.json](evidence/p1b1-benchmark.json). Source hashes at start/end match. Hardware: Linux 6.18.57 x64, Intel Xeon Platinum 8573C, Node 24.22.1; 3 visible logical CPUs, available parallelism 2, CPU quota 2 cores, memory limit 8 GiB. Shared-host timing is not a browser or production latency guarantee.

| Asserted workload | Median wall time | p95 | Target status |
| --- | --- | --- | --- |
| Point predicate / full scan, 100k rows | 175.821 ms | 205.009 ms | <5 ms not met; no SELECT index access |
| Aggregate scan, 100k rows | 264.344 ms | 373.013 ms | <1 s met |
| Materialize 100k rows | 394.688 ms | 403.218 ms | No target |
| Nested-loop join, 100k × 100 | 4118.031 ms | 4541.747 ms | <1 s not met; no indexed join |

Logical restore median: 211.052 ms; process RSS after queries: 439.0 MiB (not isolated storage allocation). This fixture declares PRIMARY KEY constraints but no explicit CREATE INDEX, so it checks SQL/load regression and does not measure index-maintenance throughput. Explicit trees are maintained in P1B-1; SELECT still scans. Previous measurements below are preserved as historical P0 evidence.

Measured on 2026-11-12. Commands: `npm run benchmark` and `npx tsx tools/browser-profile.ts`. Raw samples are retained in [evidence/benchmark.json](evidence/benchmark.json) and [evidence/browser-profile.json](evidence/browser-profile.json). These are P0 SQL measurements; the measured executor has no physical index access or indexed join. P1A storage is tested separately.

## Engine environment and method

- Linux x64 6.18.57, Intel Xeon Platinum 8573C, Node 24.22.1 / V8 13.6.233.17.
- Container CPU quota: 2 CPUs (`200000 100000`); memory limit: 8 GiB. The host exposes 3 logical CPUs and approximately 9.73 GiB memory. This is shared infrastructure, not a dedicated performance machine.
- Deterministic fixture: 100,000 fact rows, 100 dimension rows, foreign keys and a NULL every thirteenth numeric value. Restore validates constraints and types.
- Query wall time includes parse, binding, execution and result materialization. It excludes fixture generation, assertions, Worker transfer, browser rendering and persistence.
- Point query: 2 warmups/7 samples. Aggregate: 1/5. Materialization and join: 1/3. p95 uses nearest rank; with three samples it is simply the maximum, not a production tail-latency estimate.
- No browser tests/builds were run concurrently with this final benchmark. Source SHA-256 was unchanged before/after: `d36bf25023f7b528c034ac5cc6fb2d21b9838863883c53d4ebf547ce0381d707`.

| Workload | Median | p95 | Requested target | Outcome |
| --- | ---: | ---: | ---: | --- |
| Primary-key point predicate, 100k rows | 162.082 ms | 166.888 ms | <5 ms indexed | Not met; scans 100k rows, no physical index |
| Aggregate COUNT/SUM/AVG, 100k rows | 224.059 ms | 241.362 ms | <1,000 ms | Met for this fixture/environment |
| Materialize 100k projected rows | 339.653 ms | 372.281 ms | None specified | Result length/first/last rows asserted |
| Join 100k fact × 100 dimension | 4,180.548 ms | 4,444.873 ms | <1,000 ms indexed | Not met; 10 million nested-loop equality probes |

Restore median was 247.346 ms (three samples, clone plus type/uniqueness/foreign-key validation). This is not an SQL INSERT throughput or durability benchmark. Final process RSS was 420.2 MiB, including the fixture, runtime and previous result allocations; no forced garbage collection or isolated database-memory measurement was performed. Operator times are inclusive of child pulls and must not be summed as exclusive CPU time.

The benchmark records the parent commit because the measured implementation was still in the working tree. The engine content hash identifies the exact measured source and is checked against the final tree; committing documentation does not change that hash.

## Production browser lab

Chromium 158.0.8127.18, local built preview at port 4173 with static security headers. One fresh desktop and mobile context, no CPU or network throttling. The harness generates 100k rows, selects/materializes them through the actual Worker, then makes 60 large scripted scroll jumps. It records observer entries and animation-frame intervals, not a real-device field study.

| Metric | Desktop 1440×960 | Mobile viewport 390×844 |
| --- | ---: | ---: |
| Initial result/fonts ready | 407.5 ms | 310.4 ms |
| Observed LCP | 424 ms | 244 ms |
| CLS before first interaction | 0.0041 | 0.0061 |
| 100k-result click-to-visible roundtrip | 682.7 ms | 543.5 ms |
| Maximum observed Event Timing duration | 56 ms | 64 ms |
| Sampled frame intervals | 99 | 91 |
| Median / p95 frame interval | 16.7 / 16.7 ms | 16.7 / 16.7 ms |
| Maximum frame interval | 50.0 ms | 33.4 ms |
| DOM rows at final scroll position (including spacers) | 13 | 17 |
| Collected page/console errors and warnings | 0 | 0 |

Initial CLS and LCP look healthy in this limited lab sample. Event Timing maxima are **not field INP**. The maximum frame intervals show missed frames, so a sustained 60fps guarantee is not established. Full 100k-result arrays still cross the Worker boundary; virtualization bounds DOM rows, not result memory.

Before the spacer correction, maximum-session-window CLS during artificial long-distance scroll jumps was **10.62 desktop / 32.82 mobile**. LayoutShift sources identified empty spacer TR elements; disabling scroll anchoring or fixing column widths did not help. Those empty rows now reserve height without painting. The final same-harness score is **0.0065 desktop / 0.0061 mobile**, and both browser regressions stay below 0.1 while reaching the last record. This fixes empty-spacer rendering and its metric contribution; it does not establish that visible data had previously moved by the reported score. Before/after samples are retained in evidence. Repeated real-input/device profiling remains necessary for field claims.

## Next performance work

P1A now implements fixed pages and a real standalone B+tree; SQL still uses the measured P0 executor. These historical SQL numbers are not a P1A index benchmark. P1B must integrate SQL index maintenance/access before measuring index selection and join strategies on the same asserted fixture. Separately profile large-result transfer, virtualized scrolling and sorting on real mobile hardware. The 500k generator exists but has not received an equivalent browser stress benchmark. No performance claim is extrapolated from 100k to 500k.
