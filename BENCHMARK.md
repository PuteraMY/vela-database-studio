# Measured performance

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
