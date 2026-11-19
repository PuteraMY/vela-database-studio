import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { availableParallelism, cpus, platform, release } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { QueryResult, Value } from "../src/engine/types";

// Fresh sequential processes avoid mixing engine classes and retained databases.
// The unchanged candidate is also an A/A control; never infer causation from one median.
const commits = {
  p1c1: "8805cacd2ee207540c09a212cb3f770a251864e3",
  p1c2a: "c83da1883d101c3232857d13f047cc478ccaa8d6",
};
const modes = ["p1c1", "p1c2a", "candidate", "scan"] as const;
type Mode = (typeof modes)[number];
const directory = resolve("artifacts/p1c2b-calibration");
const size = 100_000,
  warmups = 10,
  repetitions = 15,
  trials = 3;
const hash = (root: string) => {
  const digest = createHash("sha256");
  for (const name of readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((n) => n.endsWith(".ts"))
    .sort())
    digest.update(name).update(readFileSync(`${root}/${name}`));
  return digest.digest("hex");
};
function summary(samples: number[]) {
  const ordered = [...samples].sort((a, b) => a - b);
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  return {
    medianMs: ordered[Math.ceil(samples.length * 0.5) - 1],
    p95Ms: ordered[Math.ceil(samples.length * 0.95) - 1],
    varianceMs2:
      samples.reduce((sum, x) => sum + (x - mean) ** 2, 0) /
      (samples.length - 1),
    minMs: ordered[0],
    maxMs: ordered.at(-1),
  };
}
async function worker(mode: Mode, trial: number) {
  const root =
    mode === "p1c1" || mode === "p1c2a"
      ? `${directory}/${mode}/src/engine`
      : resolve("src/engine");
  const sourceHash = hash(root);
  const { Database } = (await import(
    pathToFileURL(`${root}/database.ts`).href
  )) as typeof import("../src/engine/database");
  const db = new Database(
    mode === "scan" ? { selectAccess: "table-scan" } : {},
  );
  db.execute(
    "CREATE TABLE t(id INTEGER PRIMARY KEY,k INTEGER,v INTEGER); CREATE INDEX ix ON t(k); CREATE UNIQUE INDEX ix_id ON t(id)",
  );
  const state = db.export();
  state.tables[0].rows = Array.from({ length: size }, (_, i) => ({
    id: i + 1,
    k: i % 10,
    v: Math.floor(i / 10) % 5,
  }));
  db.restore(state);
  db.validateIndexes();
  const matches = state.tables[0].rows.filter((r) => r.k === 3);
  const project = (rows: typeof matches) => rows.map((r) => [r.id, r.v]);
  const cases: { name: string; sql: string; expected: Value[][] }[] = [
    {
      name: "unique equality",
      sql: "SELECT id,v FROM t WHERE id=99999",
      expected: project(state.tables[0].rows.slice(99998, 99999)),
    },
    {
      name: "duplicate LIMIT 1",
      sql: "SELECT id,v FROM t WHERE k=3 LIMIT 1",
      expected: project(matches.slice(0, 1)),
    },
    {
      name: "duplicate without LIMIT",
      sql: "SELECT id,v FROM t WHERE k=3",
      expected: project(matches),
    },
    {
      name: "missing LIMIT 1",
      sql: "SELECT id,v FROM t WHERE k=99 LIMIT 1",
      expected: [],
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
      expected: [[10000, 20000]],
    },
    {
      name: "late prefix LIMIT 1",
      sql: "SELECT id,v FROM t WHERE k=8 LIMIT 1",
      expected: project(state.tables[0].rows.slice(8, 9)),
    },
  ];
  const measurements = cases.map((c) => {
    const execute = () => {
      const start = performance.now();
      const result: QueryResult = db.execute(c.sql)[0];
      const wallMs = performance.now() - start;
      assert.deepEqual(result.rows, c.expected);
      const source = result.trace.find((t) => t.access);
      assert.ok(source?.access);
      assert.equal(
        source.access.kind,
        mode === "scan" || (mode !== "p1c1" && c.name === "duplicate LIMIT 1")
          ? "table-scan"
          : "index-equality",
      );
      return {
        wallMs,
        engineMs: result.ms,
        sourceMs: source.ms,
        sourceRows: source.rowsOut,
        access: source.access,
      };
    };
    for (let i = 0; i < warmups; i++) execute();
    const samples = Array.from({ length: repetitions }, execute);
    return {
      name: c.name,
      sql: c.sql,
      returned: c.expected.length,
      samples,
      ...summary(samples.map((s) => s.wallMs)),
    };
  });
  // Separate diagnostics, not subtracted from SQL timings or described as SQL speedups.
  function batch(
    name: string,
    iterations: number,
    operation: () => number,
    expected: number,
  ) {
    const run = () => {
      let checksum = 0;
      const start = performance.now();
      for (let i = 0; i < iterations; i++) checksum += operation();
      const ms = (performance.now() - start) / iterations;
      assert.equal(checksum, expected * iterations);
      return ms;
    };
    for (let i = 0; i < 5; i++) run();
    const samples = Array.from({ length: 15 }, run);
    return { name, iterations, samples, ...summary(samples) };
  }
  const table = db.tableHandle("t"),
    index = db.indexHandle(table, "ix");
  const reference = db.lookupIndex(db.indexHandle(table, "ix_id"), [4])[0];
  const diagnostics = [
    batch(
      "resolve one live row",
      10000,
      () => Number(db.resolveRow(reference)?.id ?? 0),
      4,
    ),
    batch(
      "cursor plus resolution, 10000 rows",
      1,
      () => {
        let checksum = 0;
        for (const entry of db.scanIndex(index, {
          lower: { key: [3] },
          upper: { key: [3] },
        }))
          checksum += Number(entry.row.id);
        return checksum;
      },
      matches.reduce((sum, r) => sum + Number(r.id), 0),
    ),
  ];
  if (mode !== "p1c1") {
    const { planEqualityAccess } = (await import(
      pathToFileURL(`${root}/access-plan.ts`).href
    )) as typeof import("../src/engine/access-plan");
    const { parse } = (await import(
      pathToFileURL(`${root}/parser.ts`).href
    )) as typeof import("../src/engine/parser");
    for (const suffix of ["", " LIMIT 1"]) {
      const query = parse(`SELECT id,v FROM t WHERE k=3${suffix}`)[0];
      assert.equal(query.kind, "select");
      if (query.kind !== "select") throw new Error("Expected SELECT");
      diagnostics.push(
        batch(
          `planner only${suffix || " without LIMIT"}`,
          10000,
          () => {
            const decision = planEqualityAccess(
              query,
              { kind: "index-equality", index: "ix", key: [3] },
              state.tables[0],
              state.indexes,
            );
            assert.equal(
              decision.access.kind,
              suffix ? "table-scan" : "index-equality",
            );
            return decision.planning?.prefixRowsRead ?? -1;
          },
          suffix ? 4 : 0,
        ),
      );
    }
  }
  assert.equal(hash(root), sourceHash);
  return { mode, trial, sourceHash, measurements, diagnostics };
}

if (process.argv.includes("--worker")) {
  const mode = process.argv[process.argv.indexOf("--worker") + 1] as Mode;
  assert.ok(modes.includes(mode));
  const trial = Number(process.argv.at(-1));
  const result = await worker(mode, trial);
  writeFileSync(`${directory}/${mode}-${trial}.json`, JSON.stringify(result));
} else {
  mkdirSync(directory, { recursive: true });
  const sourceAtStart = hash("src/engine"),
    startedAt = new Date().toISOString();
  for (const [mode, commit] of Object.entries(commits)) {
    const destination = `${directory}/${mode}`;
    mkdirSync(destination, { recursive: true });
    execFileSync("tar", ["-x", "-C", destination], {
      input: execFileSync("git", ["archive", commit, "src/engine"]),
    });
  }
  const runs: Awaited<ReturnType<typeof worker>>[] = [];
  for (let trial = 0; trial < trials; trial++) {
    for (let j = 0; j < modes.length; j++) {
      const mode = modes[(trial + j) % modes.length];
      console.log(`Trial ${trial + 1}/${trials}: ${mode}`);
      execFileSync(
        process.execPath,
        [
          "--import",
          "tsx",
          fileURLToPath(import.meta.url),
          "--worker",
          mode,
          String(trial),
        ],
        { stdio: "inherit" },
      );
      runs.push(
        JSON.parse(
          readFileSync(`${directory}/${mode}-${trial}.json`, "utf8"),
        ) as Awaited<ReturnType<typeof worker>>,
      );
    }
  }
  const measurements = runs[0].measurements.map((c) => ({
    name: c.name,
    modes: Object.fromEntries(
      modes.map((mode) => {
        const selected = runs
          .filter((r) => r.mode === mode)
          .map((r) => r.measurements.find((m) => m.name === c.name)!);
        return [
          mode,
          {
            ...summary(selected.flatMap((m) => m.samples.map((s) => s.wallMs))),
            trialMedians: selected.map((m) => m.medianMs),
          },
        ];
      }),
    ),
  }));
  const sourceAtEnd = hash("src/engine");
  assert.equal(sourceAtStart, sourceAtEnd);
  const optional = (name: string) => {
    try {
      return readFileSync(name, "utf8").trim();
    } catch {
      return null;
    }
  };
  const report = {
    command: "npm run benchmark:calibration",
    startedAt,
    finishedAt: new Date().toISOString(),
    commits,
    sourceAtStart,
    sourceAtEnd,
    harnessHash: createHash("sha256")
      .update(readFileSync(fileURLToPath(import.meta.url)))
      .digest("hex"),
    size,
    trials,
    warmups,
    repetitions,
    hardware: {
      node: process.version,
      platform: platform(),
      release: release(),
      arch: process.arch,
      cpu: cpus()[0]?.model,
      cpus: cpus().length,
      availableParallelism: availableParallelism(),
      cpuMax: optional("/sys/fs/cgroup/cpu.max"),
      memoryMax: optional("/sys/fs/cgroup/memory.max"),
    },
    measurements,
    runs,
  };
  writeFileSync(
    "artifacts/p1c2b-calibration.json",
    JSON.stringify(report, null, 2),
  );
  for (const c of measurements)
    console.log(
      `${c.name}: ${modes.map((m) => `${m} ${c.modes[m].medianMs.toFixed(3)}/${c.modes[m].p95Ms.toFixed(3)} ms`).join("; ")}`,
    );
}
