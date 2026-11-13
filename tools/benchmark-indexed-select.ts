import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { availableParallelism, cpus, platform, release } from "node:os";
import { Database } from "../src/engine/database";
import type { AccessTrace, Value } from "../src/engine/types";

const sourceHash = () => {
  const hash = createHash("sha256");
  for (const file of readdirSync("src/engine", {
    recursive: true,
    encoding: "utf8",
  })
    .filter((f) => f.endsWith(".ts"))
    .sort())
    hash.update(file).update(readFileSync(`src/engine/${file}`));
  return hash.digest("hex");
};
const startedAt = new Date().toISOString(),
  hashAtStart = sourceHash();
const percentile = (values: number[], fraction: number) =>
  [...values].sort((a, b) => a - b)[
    Math.max(0, Math.ceil(values.length * fraction) - 1)
  ];
type Mode = "auto" | "table-scan";
interface Sample {
  wallMs: number;
  engineMs: number;
  sourceMs: number;
  returned: number;
  sourceRowsOut: number;
  access: AccessTrace;
}
interface Workload {
  name: string;
  sql: string;
  expected: Value[][];
}
const summarize = (samples: Sample[]) => ({
  wallMedianMs: percentile(
    samples.map((s) => s.wallMs),
    0.5,
  ),
  wallP95Ms: percentile(
    samples.map((s) => s.wallMs),
    0.95,
  ),
  wallMinMs: Math.min(...samples.map((s) => s.wallMs)),
  wallMaxMs: Math.max(...samples.map((s) => s.wallMs)),
  engineMedianMs: percentile(
    samples.map((s) => s.engineMs),
    0.5,
  ),
  sourceMedianMs: percentile(
    samples.map((s) => s.sourceMs),
    0.5,
  ),
  samples,
});
const results = [];
for (const size of [1000, 10000, 100000]) {
  console.log(
    `Preparing paired SQL benchmark: ${size} rows, three explicit indexes per database.`,
  );
  const auto = new Database(),
    scan = new Database({ selectAccess: "table-scan" });
  auto.execute(
    "CREATE TABLE lookup_rows(id INTEGER PRIMARY KEY,small_key INTEGER,broad_key INTEGER,payload TEXT); CREATE UNIQUE INDEX ix_id ON lookup_rows(id); CREATE INDEX ix_small ON lookup_rows(small_key); CREATE INDEX ix_broad ON lookup_rows(broad_key)",
  );
  const state = auto.export();
  state.tables[0].rows = Array.from({ length: size }, (_, i) => ({
    id: i + 1,
    small_key: Math.floor(i / 4),
    broad_key: i % 10,
    payload: `Row ${i + 1}`,
  }));
  const start = performance.now();
  auto.restore(state);
  scan.restore(state);
  const loadMs = performance.now() - start;
  auto.validateIndexes();
  scan.validateIndexes();
  const project = (rows: (typeof state.tables)[0]["rows"]) =>
    rows.map((row) => [row.id, row.small_key, row.payload]);
  const existing = Math.floor(size / 2) + 1,
    small = Math.floor(size / 8),
    data = state.tables[0].rows;
  const prefix = "SELECT id,small_key,payload FROM lookup_rows WHERE ";
  const workloads: Workload[] = [
    {
      name: "existing unique key",
      sql: `${prefix}id=${existing}`,
      expected: project(data.filter((r) => r.id === existing)),
    },
    {
      name: "missing unique key",
      sql: `${prefix}id=${size + 1}`,
      expected: [],
    },
    {
      name: "four non-unique matches",
      sql: `${prefix}small_key=${small} ORDER BY id`,
      expected: project(data.filter((r) => r.small_key === small)),
    },
    {
      name: "ten-percent matches",
      sql: `${prefix}broad_key=3 ORDER BY id`,
      expected: project(data.filter((r) => r.broad_key === 3)),
    },
    {
      name: "ten-percent key with LIMIT 1",
      sql: `${prefix}broad_key=3 LIMIT 1`,
      expected: project(data.filter((r) => r.broad_key === 3).slice(0, 1)),
    },
  ];
  const measurements = [];
  for (const workload of workloads) {
    const run = (mode: Mode): Sample => {
      const db = mode === "auto" ? auto : scan;
      const begin = performance.now();
      const result = db.execute(workload.sql)[0];
      const wallMs = performance.now() - begin;
      assert.deepEqual(result.rows, workload.expected);
      const sources = result.trace.filter((t) => t.access);
      assert.equal(sources.length, 1);
      const source = sources[0];
      assert.ok(source.access);
      assert.equal(
        source.access.kind,
        mode === "auto" ? "index-equality" : "table-scan",
      );
      if (source.access.kind === "index-equality")
        assert.equal(source.access.lookupCalls, 1);
      return {
        wallMs,
        engineMs: result.ms,
        sourceMs: source.ms,
        returned: result.rows.length,
        sourceRowsOut: source.rowsOut,
        access: source.access,
      };
    };
    for (let warmup = 0; warmup < 2; warmup++) {
      run("auto");
      run("table-scan");
    }
    const samples: Record<Mode, Sample[]> = { auto: [], "table-scan": [] };
    for (let repetition = 0; repetition < 9; repetition++)
      for (const mode of (repetition % 2
        ? ["table-scan", "auto"]
        : ["auto", "table-scan"]) as Mode[])
        samples[mode].push(run(mode));
    const indexed = summarize(samples.auto),
      reference = summarize(samples["table-scan"]);
    measurements.push({
      name: workload.name,
      sql: workload.sql,
      cardinality: workload.expected.length,
      indexed,
      reference,
    });
    console.log(
      `${size} ${workload.name}: SQL auto median ${indexed.wallMedianMs.toFixed(6)} ms; scan ${reference.wallMedianMs.toFixed(6)} ms; ${workload.expected.length} result rows.`,
    );
  }
  results.push({ size, loadMs, measurements });
}
const hashAtEnd = sourceHash();
assert.equal(hashAtStart, hashAtEnd);
const optional = (path: string) => {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return null;
  }
};
const report = {
  command: "npm run benchmark (tools/benchmark-indexed-select.ts)",
  startedAt,
  finishedAt: new Date().toISOString(),
  sourceHashAtStart: hashAtStart,
  sourceHashAtEnd: hashAtEnd,
  hardware: {
    platform: platform(),
    release: release(),
    arch: process.arch,
    cpu: cpus()[0]?.model,
    visibleCpus: cpus().length,
    availableParallelism: availableParallelism(),
    cpuQuota: optional("/sys/fs/cgroup/cpu.max"),
    memoryLimit: optional("/sys/fs/cgroup/memory.max"),
    node: process.version,
  },
  methodology: {
    warmupsPerMode: 2,
    repetitionsPerMode: 9,
    modeOrder: "Alternated per repetition",
    wallIncludes:
      "SQL parsing, binding, selection, lookup/scan, row resolution/qualification, WHERE, projection, ORDER BY/LIMIT and complete materialization",
    excluded:
      "Fixture generation, restore/index creation, invariant checks, assertions, Worker transfer and DOM",
    engineMs: "Existing engine timer excludes parsing/dispatch",
    sourceMs:
      "Source Operator time includes lookup/validation/resolution/qualification together; not isolated resolver time",
    data: "IDs 1..N, small_key=floor((id-1)/4), broad_key=(id-1)%10, payload='Row '+id. Identical rows/catalog in both databases. Three explicit indexes; auto vs forced scan differs only in access selection.",
    caveats: [
      "Shared Node host, warmed repeated keys, no concurrent DML; not a browser or production latency guarantee.",
      "Nine-sample nearest-rank p95 is the maximum; do not interpret it as a field tail-latency estimate.",
      "Indexed equality streams validated rows; downstream LIMIT may stop early. Trace match counts measure consumed entries, not total key cardinality. ORDER BY and aggregates still consume all required rows.",
      "LIMIT without ORDER BY verifies the existing stable source order; SQL generally does not guarantee unordered result order.",
    ],
  },
  results,
};
mkdirSync("artifacts", { recursive: true });
writeFileSync(
  "artifacts/benchmark-indexed-select.json",
  JSON.stringify(report, null, 2) + "\n",
);
