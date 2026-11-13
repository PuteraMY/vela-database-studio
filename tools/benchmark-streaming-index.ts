import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { cpus, availableParallelism, platform, release } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Database } from "../src/engine/database";
import type { Value } from "../src/engine/types";

// Execute the exact verified predecessor, without changing branches or adding a runtime mode.
const baseCommit = "f39ff56d8961ac556e953ecf80cff328c5721cd7";
const baselineDir = resolve("artifacts/p1c1-benchmark-base");
mkdirSync(baselineDir, { recursive: true });
execFileSync("tar", ["-x", "-C", baselineDir], {
  input: execFileSync("git", ["archive", baseCommit, "src/engine"]),
});
const { Database: Before } = (await import(
  pathToFileURL(`${baselineDir}/src/engine/database.ts`).href
)) as typeof import("../src/engine/database");
assert.notEqual(Before, Database);
const sourceHash = () => {
  const h = createHash("sha256");
  for (const file of readdirSync("src/engine", {
    recursive: true,
    encoding: "utf8",
  })
    .filter((f) => f.endsWith(".ts"))
    .sort())
    h.update(file).update(readFileSync(`src/engine/${file}`));
  return h.digest("hex");
};
const sourceAtStart = sourceHash(),
  startedAt = new Date().toISOString();
const percentile = (samples: number[], p: number) =>
  [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * p) - 1];
const sizes = [];
for (const size of [1000, 10000, 100000]) {
  console.log(
    `Preparing ${size} rows: predecessor indexed, streaming indexed, reference scan.`,
  );
  const before = new Before(),
    streaming = new Database(),
    scan = new Database({ selectAccess: "table-scan" });
  const databases = { before, streaming, scan };
  before.execute(
    "CREATE TABLE t(id INTEGER PRIMARY KEY,k INTEGER,v INTEGER); CREATE INDEX ix ON t(k)",
  );
  const state = before.export();
  state.tables[0].rows = Array.from({ length: size }, (_, i) => ({
    id: i + 1,
    k: i % 10,
    v: Math.floor(i / 10) % 5,
  }));
  const loadStart = performance.now();
  for (const db of Object.values(databases)) {
    db.restore(state);
    db.validateIndexes();
  }
  const loadMs = performance.now() - loadStart;
  const matches = state.tables[0].rows.filter((row) => row.k === 3);
  const project = (rows: typeof matches) => rows.map((r) => [r.id, r.v]);
  const cases: { name: string; sql: string; expected: Value[][] }[] = [
    {
      name: "duplicate LIMIT 1",
      sql: "SELECT id,v FROM t WHERE k=3 LIMIT 1",
      expected: project(matches.slice(0, 1)),
    },
    {
      name: "duplicate LIMIT 1 OFFSET 25",
      sql: "SELECT id,v FROM t WHERE k=3 LIMIT 1 OFFSET 25",
      expected: project(matches.slice(25, 26)),
    },
    {
      name: "duplicate LIMIT 10 OFFSET 100",
      sql: "SELECT id,v FROM t WHERE k=3 LIMIT 10 OFFSET 100",
      expected: project(matches.slice(100, 110)),
    },
    {
      name: "missing LIMIT 1",
      sql: "SELECT id,v FROM t WHERE k=99 LIMIT 1",
      expected: [],
    },
    {
      name: "ordered LIMIT 1",
      sql: "SELECT id,v FROM t WHERE k=3 ORDER BY id DESC LIMIT 1",
      expected: project(matches.slice(-1)),
    },
    {
      name: "DISTINCT LIMIT 3 OFFSET 1",
      sql: "SELECT DISTINCT v FROM t WHERE k=3 LIMIT 3 OFFSET 1",
      expected: [[1], [2], [3]],
    },
    {
      name: "aggregate LIMIT 1",
      sql: "SELECT COUNT(*),SUM(v) FROM t WHERE k=3 LIMIT 1",
      expected: [
        [matches.length, matches.reduce((sum, r) => sum + Number(r.v), 0)],
      ],
    },
  ];
  const measurements = [];
  for (const c of cases) {
    const execute = (mode: keyof typeof databases) => {
      const start = performance.now(),
        result = databases[mode].execute(c.sql)[0],
        wallMs = performance.now() - start;
      assert.deepEqual(result.rows, c.expected);
      const source = result.trace.find((t) => t.access);
      assert.ok(source?.access);
      assert.equal(
        source.access.kind,
        mode === "scan" ? "table-scan" : "index-equality",
      );
      return { wallMs, sourceRows: source.rowsOut, access: source.access };
    };
    const modes = ["before", "streaming", "scan"] as const;
    for (let i = 0; i < 2; i++) for (const mode of modes) execute(mode);
    const samples: Record<
      (typeof modes)[number],
      ReturnType<typeof execute>[]
    > = { before: [], streaming: [], scan: [] };
    for (let i = 0; i < 9; i++)
      for (let j = 0; j < 3; j++) {
        const mode = modes[(i + j) % 3];
        samples[mode].push(execute(mode));
      }
    const measured = Object.fromEntries(
      modes.map((mode) => {
        const times = samples[mode].map((s) => s.wallMs);
        return [
          mode,
          {
            medianMs: percentile(times, 0.5),
            p95Ms: percentile(times, 0.95),
            minMs: Math.min(...times),
            maxMs: Math.max(...times),
            samples: samples[mode],
          },
        ];
      }),
    );
    measurements.push({
      name: c.name,
      sql: c.sql,
      returned: c.expected.length,
      measured,
    });
    console.log(
      `${size} ${c.name}: before ${measured.before.medianMs.toFixed(6)} / streaming ${measured.streaming.medianMs.toFixed(6)} / scan ${measured.scan.medianMs.toFixed(6)} ms`,
    );
  }
  sizes.push({ size, loadMs, measurements });
}
const sourceAtEnd = sourceHash();
assert.equal(sourceAtStart, sourceAtEnd);
const optional = (path: string) => {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return null;
  }
};
writeFileSync(
  "artifacts/p1c1-streaming-benchmark.json",
  JSON.stringify(
    {
      command: "npm run benchmark:streaming",
      baseCommit,
      sourceAtStart,
      sourceAtEnd,
      startedAt,
      finishedAt: new Date().toISOString(),
      hardware: {
        platform: platform(),
        release: release(),
        cpu: cpus()[0]?.model,
        visibleCpus: cpus().length,
        parallelism: availableParallelism(),
        node: process.version,
        cpuQuota: optional("/sys/fs/cgroup/cpu.max"),
        memoryLimit: optional("/sys/fs/cgroup/memory.max"),
      },
      methodology: {
        warmups: 2,
        repetitions: 9,
        order: "Rotate all three modes each repetition",
        includes:
          "SQL parsing, binding, access, row resolution, WHERE, downstream operators and result materialization",
        excludes: "Fixture/index creation, validation/assertions, Worker/DOM",
        data: "id=i+1, k=i%10, v=floor(i/10)%5; exact predecessor and current databases have identical rows and explicit indexes",
        caveats: [
          "Warmed shared-host Node measurements, not browser latency guarantees",
          "Nine-sample nearest-rank p95 is the maximum",
          "Unordered LIMIT/DISTINCT checks existing stable source order, not a general SQL ordering guarantee",
          "matchedRowIds is total eager matches before, consumed validated matches after; sourceRows counts emitted frames in both",
        ],
      },
      sizes,
    },
    null,
    2,
  ) + "\n",
);
