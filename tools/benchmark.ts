import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import {
  availableParallelism,
  cpus,
  platform,
  release,
  totalmem,
} from "node:os";
import { join } from "node:path";
import { Database } from "../src/engine/database";
import type { QueryResult } from "../src/engine/types";

const FACT_ROWS = 100_000;
const DIMENSION_ROWS = 100;
const OUTPUT = "artifacts/benchmark.json";

interface Sample {
  wallMs: number;
  engineMs: number;
  rowsReturned: number;
  rowsScanned: number;
}

function readOptional(path: string): string | null {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return null;
  }
}

function engineHash(): string {
  const hash = createHash("sha256");
  for (const file of readdirSync("src/engine")
    .filter((name) => name.endsWith(".ts"))
    .sort()) {
    hash.update(file).update(readFileSync(join("src/engine", file)));
  }
  return hash.digest("hex");
}

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function summarize(samples: Sample[]) {
  return {
    wallMedianMs: percentile(
      samples.map((sample) => sample.wallMs),
      0.5,
    ),
    wallP95Ms: percentile(
      samples.map((sample) => sample.wallMs),
      0.95,
    ),
    wallMinMs: Math.min(...samples.map((sample) => sample.wallMs)),
    wallMaxMs: Math.max(...samples.map((sample) => sample.wallMs)),
    engineMedianMs: percentile(
      samples.map((sample) => sample.engineMs),
      0.5,
    ),
  };
}

function snapshotMemory() {
  const value = process.memoryUsage();
  return {
    rssMiB: value.rss / 1024 ** 2,
    heapUsedMiB: value.heapUsed / 1024 ** 2,
    heapTotalMiB: value.heapTotal / 1024 ** 2,
    externalMiB: value.external / 1024 ** 2,
  };
}

const startedAt = new Date().toISOString();
const startHash = engineHash();
const baselineMemory = snapshotMemory();
const db = new Database();
db.execute(`
  CREATE TABLE dimension (id INTEGER PRIMARY KEY, label TEXT NOT NULL);
  CREATE TABLE fact (
    id INTEGER PRIMARY KEY,
    dimension_id INTEGER NOT NULL REFERENCES dimension(id),
    value REAL,
    label TEXT NOT NULL
  );
`);
const state = db.export();
const generationStart = performance.now();
state.tables[0].rows = Array.from({ length: DIMENSION_ROWS }, (_, i) => ({
  id: i + 1,
  label: `Group ${i + 1}`,
}));
let expectedSum = 0;
let expectedCount = 0;
state.tables[1].rows = Array.from({ length: FACT_ROWS }, (_, i) => {
  const value = i % 13 === 0 ? null : (i % 1000) + 0.25;
  if (value !== null) {
    expectedSum += value;
    expectedCount++;
  }
  return {
    id: i + 1,
    dimension_id: (i % DIMENSION_ROWS) + 1,
    value,
    label: `Record ${i + 1}`,
  };
});
const generationMs = performance.now() - generationStart;
const generatedMemory = snapshotMemory();
const restoreSamples: number[] = [];
for (let i = 0; i < 3; i++) {
  const start = performance.now();
  db.restore(state);
  restoreSamples.push(performance.now() - start);
}
assert.equal(
  db.schema().find((table) => table.name === "fact")?.rowCount,
  FACT_ROWS,
);
const restoredMemory = snapshotMemory();

function benchmarkQuery(
  name: string,
  sql: string,
  warmups: number,
  repetitions: number,
  targetMs: number | null,
  strategy: string,
  verify: (result: QueryResult) => void,
) {
  for (let i = 0; i < warmups; i++) verify(db.execute(sql)[0]);
  const samples: Sample[] = [];
  let lastResult: QueryResult | undefined;
  for (let i = 0; i < repetitions; i++) {
    const start = performance.now();
    const result = db.execute(sql)[0];
    const wallMs = performance.now() - start;
    verify(result);
    samples.push({
      wallMs,
      engineMs: result.ms,
      rowsReturned: result.rows.length,
      rowsScanned: result.trace
        .filter((operator) => operator.operator === "Imbasan jadual")
        .reduce((count, operator) => count + operator.rowsOut, 0),
    });
    lastResult = result;
  }
  const statistics = summarize(samples);
  const measured = {
    name,
    sql,
    warmups,
    repetitions,
    targetMs,
    strategy,
    targetMet: targetMs === null ? null : statistics.wallMedianMs < targetMs,
    ...statistics,
    samples,
    trace: lastResult?.trace,
  };
  console.log(
    `${name}: median ${statistics.wallMedianMs.toFixed(3)} ms; p95 ${statistics.wallP95Ms.toFixed(3)} ms; scanned ${samples[0].rowsScanned}; target ${targetMs === null ? "none" : `<${targetMs} ms (${measured.targetMet ? "met" : "not met"})`}`,
  );
  return measured;
}

const queries = [
  benchmarkQuery(
    "Primary-key point predicate",
    "SELECT id, dimension_id, value FROM fact WHERE id = 99999",
    2,
    7,
    5,
    "Full table scan. PRIMARY KEY enforces uniqueness; this fixture declares no explicit physical index.",
    (result) => assert.deepEqual(result.rows, [[99999, 99, 998.25]]),
  ),
  benchmarkQuery(
    "Aggregate scan",
    "SELECT COUNT(*), COUNT(value), SUM(value), AVG(value) FROM fact",
    1,
    5,
    1000,
    "Full scan followed by a blocking aggregate operator; NULL values excluded from value aggregates.",
    (result) =>
      assert.deepEqual(result.rows, [
        [FACT_ROWS, expectedCount, expectedSum, expectedSum / expectedCount],
      ]),
  ),
  benchmarkQuery(
    "100k result materialization",
    "SELECT id, dimension_id, value, label FROM fact",
    1,
    3,
    null,
    "Full scan and projection, materializing 100,000 result arrays. Excludes Worker transfer, DOM and browser rendering.",
    (result) => {
      assert.equal(result.rows.length, FACT_ROWS);
      assert.equal(result.rows[0][0], 1);
      assert.equal(result.rows[FACT_ROWS - 1][0], FACT_ROWS);
    },
  ),
  benchmarkQuery(
    "100k × 100 two-table join",
    "SELECT COUNT(*) FROM fact f INNER JOIN dimension d ON f.dimension_id = d.id",
    1,
    3,
    1000,
    "Nested-loop join with 10,000,000 equality probes; SELECT has no index access or hash join.",
    (result) => assert.deepEqual(result.rows, [[FACT_ROWS]]),
  ),
];

const endHash = engineHash();
const report = {
  schemaVersion: 1,
  startedAt,
  finishedAt: new Date().toISOString(),
  command: "npm run benchmark",
  gitCommit: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  engineSha256AtStart: startHash,
  engineSha256AtEnd: endHash,
  sourceChangedDuringRun: startHash !== endHash,
  hardware: {
    platform: platform(),
    release: release(),
    arch: process.arch,
    cpuModel: cpus()[0]?.model ?? "unknown",
    visibleLogicalCpus: cpus().length,
    availableParallelism: availableParallelism(),
    hostMemoryGiB: totalmem() / 1024 ** 3,
    cgroupCpuMax: readOptional("/sys/fs/cgroup/cpu.max"),
    cgroupMemoryMax: readOptional("/sys/fs/cgroup/memory.max"),
    nodeVersion: process.version,
    v8Version: process.versions.v8,
  },
  fixture: {
    factRows: FACT_ROWS,
    dimensionRows: DIMENSION_ROWS,
    nullEveryNthValue: 13,
    deterministic: true,
    generationMs,
  },
  load: {
    operation:
      "Database.restore: structured clone + constraints + fresh row identities and read directories (fixture has no explicit indexes)",
    warmups: 0,
    repetitions: restoreSamples.length,
    samplesMs: restoreSamples,
    medianMs: percentile(restoreSamples, 0.5),
    p95Ms: percentile(restoreSamples, 0.95),
    excludes:
      "SQL INSERT parsing, row generation, persistence and Worker messaging",
  },
  memory: {
    baseline: baselineMemory,
    generatedFixture: generatedMemory,
    restored: restoredMemory,
    afterQueries: snapshotMemory(),
    note: "Process-wide snapshots; no forced garbage collection. Includes fixture and runtime. Not isolated database heap allocation.",
  },
  queries,
  caveats: [
    "Measured in Node.js on a shared Linux execution environment, not an end-user browser. Concurrent development/test work may affect timings.",
    "Wall timings include SQL parse, planning/binding, execution and result materialization; exclude assertion checks, Worker transfer and rendering.",
    "P1B-1 maintains explicit B+tree indexes, but SELECT has no index access, statistics-driven optimizer or indexed joins. This fixture declares only PRIMARY KEY constraints; measured queries use full scans and nested loops.",
    "p95 uses the nearest-rank sample percentile. Three-sample p95 is the maximum sample, not a production latency estimate.",
    "Operator times are inclusive downstream pull time and must not be summed as exclusive CPU time.",
  ],
};
mkdirSync("artifacts", { recursive: true });
writeFileSync(OUTPUT, JSON.stringify(report, null, 2) + "\n");
console.log(
  `Saved ${OUTPUT}. Restore median ${report.load.medianMs.toFixed(3)} ms; process RSS ${report.memory.afterQueries.rssMiB.toFixed(1)} MiB.`,
);
