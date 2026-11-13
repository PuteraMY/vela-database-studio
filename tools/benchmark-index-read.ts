import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { availableParallelism, cpus, platform, release } from "node:os";
import { Database } from "../src/engine/database";

const hash = () => {
  const result = createHash("sha256");
  for (const name of readdirSync("src/engine", {
    recursive: true,
    encoding: "utf8",
  })
    .filter((n) => n.endsWith(".ts"))
    .sort())
    result.update(name).update(readFileSync(`src/engine/${name}`));
  return result.digest("hex");
};
const sourceHashAtStart = hash();
const startedAt = new Date().toISOString();
function sample(
  name: string,
  iterations: number,
  operation: () => number,
  expected: number,
) {
  const run = () => {
    let checksum = 0;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) checksum += operation();
    const ms = performance.now() - start;
    assert.equal(checksum, expected * iterations);
    return ms / iterations;
  };
  run();
  run();
  const perCallMs = Array.from({ length: 7 }, run);
  const ordered = [...perCallMs].sort((a, b) => a - b);
  return {
    name,
    iterationsPerSample: iterations,
    warmupSamples: 2,
    samples: 7,
    perCallMs,
    medianMs: ordered[3],
    maxMs: ordered[6],
  };
}
const workloads = [];
for (const size of [10_000, 100_000]) {
  const db = new Database();
  db.execute("CREATE TABLE t(id INTEGER PRIMARY KEY,k INTEGER,payload TEXT)");
  const state = db.export();
  state.tables[0].rows = Array.from({ length: size }, (_, i) => ({
    id: i + 1,
    k: Math.floor(i / 4),
    payload: `r${i + 1}`,
  }));
  const loadStart = performance.now();
  db.restore(state);
  db.execute("CREATE INDEX ix ON t(k)");
  const loadMs = performance.now() - loadStart;
  db.validateIndexes();
  const table = db.tableHandle("t"),
    index = db.indexHandle(table, "ix"),
    target = Math.floor(size / 8);
  const expected = state.tables[0].rows.filter((r) => r.k === target);
  assert.deepEqual(
    db.resolveRows(table, db.lookupIndex(index, [target])),
    expected,
  );
  const range = {
    lower: { key: [target] },
    upper: { key: [target + 10], inclusive: false },
  };
  const expectedRange = state.tables[0].rows.filter(
    (r) => Number(r.k) >= target && Number(r.k) < target + 10,
  );
  assert.deepEqual(
    [...db.scanIndex(index, range)].map((r) => r.row),
    expectedRange,
  );
  const sum = (rows: typeof expected) =>
    rows.reduce((n, row) => n + Number(row.id), 0);
  const reference = { table, rowId: size };
  const measurements = [
    sample(
      "resolve one row ID",
      2000,
      () => Number(db.resolveRow(reference).id),
      size,
    ),
    sample(
      "exact lookup and resolve four rows",
      500,
      () => sum(db.resolveRows(table, db.lookupIndex(index, [target]))),
      sum(expected),
    ),
    sample(
      "bounded cursor, 40 resolved rows",
      100,
      () => {
        let n = 0;
        for (const item of db.scanIndex(index, range)) n += Number(item.row.id);
        return n;
      },
      sum(expectedRange),
    ),
    sample(
      "reference full-array filter, four matching rows",
      100,
      () => sum(state.tables[0].rows.filter((r) => r.k === target)),
      sum(expected),
    ),
  ];
  workloads.push({
    size,
    duplicateCount: 4,
    rangeRows: 40,
    loadMs,
    measurements,
  });
  console.log(
    JSON.stringify({
      size,
      medianMs: Object.fromEntries(
        measurements.map((m) => [m.name, m.medianMs]),
      ),
    }),
  );
}
const sourceHashAtEnd = hash();
assert.equal(sourceHashAtStart, sourceHashAtEnd);
const optional = (path: string) => {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return null;
  }
};
const report = {
  command: "npx tsx tools/benchmark-index-read.ts",
  startedAt,
  finishedAt: new Date().toISOString(),
  sourceHashAtStart,
  sourceHashAtEnd,
  hardware: {
    platform: platform(),
    release: release(),
    arch: process.arch,
    cpu: cpus()[0]?.model,
    logicalCpus: cpus().length,
    parallelism: availableParallelism(),
    cpuQuota: optional("/sys/fs/cgroup/cpu.max"),
    memoryLimit: optional("/sys/fs/cgroup/memory.max"),
    node: process.version,
  },
  methodology:
    "Two warmup batches, seven measured batches per operation. Values are wall ms per call averaged over a batch; max is the largest batch average, not individual-call p95. Checksums asserted after timing; complete outputs checked before sampling. Hot repeated keys, no concurrent DML, shared Node host. Resolver includes copying the row; exact lookup includes resolution/copying all four matches; range includes resolving/copying all 40 rows. Full-array reference filters existing row objects without copying. Load includes logical restore, directory build and CREATE INDEX, outside read samples.",
  sqlSelectSpeedupClaim: false,
  workloads,
};
mkdirSync("artifacts", { recursive: true });
writeFileSync(
  "artifacts/benchmark-index-read.json",
  JSON.stringify(report, null, 2) + "\n",
);
