import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { Session } from "node:inspector/promises";
import { availableParallelism, cpus, release } from "node:os";
import { resolve } from "node:path";
import { PerformanceObserver } from "node:perf_hooks";
import { setImmediate as flush } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { AccessTrace, QueryResult, Value } from "../src/engine/types";
import {
  cpuSelf,
  gcOverlap,
  heapSelf,
  pairedRatio,
  statistics,
  type GCEvent,
} from "./profiling-metrics";

const commits = {
  p1c1: "8805cacd2ee207540c09a212cb3f770a251864e3",
  p1c2a: "c83da1883d101c3232857d13f047cc478ccaa8d6",
  p1c2b: "ff22873c11d7ed1595125081f60df958cb394b7e",
};
type Version = keyof typeof commits;
const versions: Version[] = ["p1c1", "p1c2a", "p1c2b"];
// All six permutations balance process position and adjacent version order.
const orders: Version[][] = [
  ["p1c1", "p1c2a", "p1c2b"],
  ["p1c2b", "p1c2a", "p1c1"],
  ["p1c2a", "p1c1", "p1c2b"],
  ["p1c2b", "p1c1", "p1c2a"],
  ["p1c1", "p1c2b", "p1c2a"],
  ["p1c2a", "p1c2b", "p1c1"],
];
const smoke = process.argv.includes("--smoke");
const config = {
  size: smoke ? 1000 : 100000,
  warmups: smoke ? 2 : 30,
  samples: smoke ? 3 : 25,
  controlBatch: smoke ? 1 : 25,
  profileQueries: smoke ? 5 : 40,
  profileTrials: smoke ? 1 : 2,
};
const directory = resolve(`artifacts/p1c2c${smoke ? "-smoke" : ""}`);
const flags = [
  "--expose-gc",
  "--random-seed=2026",
  "--max-old-space-size=1024",
  "--min-semi-space-size=16",
  "--max-semi-space-size=16",
];
function hash(root: string) {
  const h = createHash("sha256");
  for (const file of readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".ts"))
    .sort())
    h.update(file).update(readFileSync(`${root}/${file}`));
  return h.digest("hex");
}
const digest = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
function optional(path: string) {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return null;
  }
}
function schedulerWait() {
  const data = optional("/proc/self/schedstat");
  return data ? Number(data.split(/\s+/)[1]) / 1e6 : null;
}
function cpuStat() {
  const data = optional("/sys/fs/cgroup/cpu.stat");
  return data
    ? (Object.fromEntries(
        data.split("\n").map((s) => {
          const [key, value] = s.split(/\s+/);
          return [key, Number(value)];
        }),
      ) as Record<string, number>)
    : null;
}
function delta(
  after: Record<string, number> | null,
  before: Record<string, number> | null,
) {
  return after && before
    ? Object.fromEntries(
        Object.keys(after).map((k) => [k, after[k] - before[k]]),
      )
    : null;
}
interface Sample {
  name: string;
  iterations: number;
  start: number;
  end: number;
  wallMs: number;
  cpuMs: number;
  schedulerWaitMs: number | null;
  involuntarySwitches: number;
  heapDeltaBytes: number;
  sourceRows: number;
  sourceMs: number;
  access: AccessTrace;
}
async function worker(
  version: Version,
  phase: "timing" | "profiles",
  trial: number,
) {
  const root = `${directory}/${version}/src/engine`,
    sourceHash = hash(root);
  const { Database } = (await import(
    pathToFileURL(`${root}/database.ts`).href
  )) as typeof import("../src/engine/database");
  const db = new Database();
  db.execute(
    "CREATE TABLE t(id INTEGER PRIMARY KEY,k INTEGER,v INTEGER); CREATE INDEX ix ON t(k); CREATE UNIQUE INDEX ix_id ON t(id)",
  );
  const state = db.export();
  state.tables[0].rows = Array.from({ length: config.size }, (_, i) => ({
    id: i + 1,
    k: i % 10,
    v: Math.floor(i / 10) % 5,
  }));
  db.restore(state);
  db.validateIndexes();
  const matches = state.tables[0].rows.filter((r) => r.k === 3);
  const project = (rows: typeof matches) => rows.map((r) => [r.id, r.v]);
  const cases: {
    name: string;
    sql: string;
    expected: Value[][];
    iterations: number;
  }[] = [
    {
      name: "duplicate",
      sql: "SELECT id,v FROM t WHERE k=3",
      expected: project(matches),
      iterations: 1,
    },
    {
      name: "limit1",
      sql: "SELECT id,v FROM t WHERE k=3 LIMIT 1",
      expected: project(matches.slice(0, 1)),
      iterations: config.controlBatch,
    },
    {
      name: "unique",
      sql: `SELECT id,v FROM t WHERE id=${config.size - 1}`,
      expected: project(state.tables[0].rows.slice(-2, -1)),
      iterations: config.controlBatch,
    },
    {
      name: "missing",
      sql: "SELECT id,v FROM t WHERE k=99 LIMIT 1",
      expected: [],
      iterations: config.controlBatch,
    },
  ];
  function check(result: QueryResult, c: (typeof cases)[number]) {
    assert.deepEqual(result.rows, c.expected);
    const source = result.trace.find((t) => t.access);
    assert.ok(source?.access);
    const scan =
      c.name === "limit1" && config.size >= 1024 && version !== "p1c1";
    assert.equal(source.access.kind, scan ? "table-scan" : "index-equality");
    assert.equal(source.rowsOut, scan ? 4 : c.expected.length);
    if (c.name === "duplicate" && version !== "p1c1")
      assert.equal(source.access.planning?.prefixRowsRead, 0);
    return { ...source, access: source.access };
  }
  const events: GCEvent[] = [];
  const observer = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      const detail = (
        e as typeof e & { detail: { kind: number; flags: number } }
      ).detail;
      events.push({
        start: e.startTime,
        duration: e.duration,
        kind: detail.kind,
        flags: detail.flags,
      });
    }
  });
  observer.observe({ entryTypes: ["gc"] });
  for (let i = 0; i < config.warmups; i++)
    for (const c of cases)
      for (let j = 0; j < c.iterations; j++) check(db.execute(c.sql)[0], c);
  await flush();
  await flush();
  events.length = 0;
  const common = {
    version,
    phase,
    trial,
    sourceHash,
    execArgv: process.execArgv,
    affinity: optional("/proc/self/status")?.match(
      /^Cpus_allowed_list:\s*(.+)$/m,
    )?.[1],
    fixtureHash: createHash("sha256")
      .update(JSON.stringify(state))
      .digest("hex"),
  };
  const containerBefore = cpuStat();
  try {
    if (phase === "timing") {
      const samples: Sample[] = [];
      for (let i = 0; i < config.samples; i++) {
        for (let j = 0; j < cases.length; j++) {
          const c = cases[(i + j + trial) % cases.length];
          const results: QueryResult[] = [];
          const heapBefore = process.memoryUsage().heapUsed,
            waitBefore = schedulerWait(),
            usageBefore = process.resourceUsage();
          const cpuBefore = process.cpuUsage(),
            start = performance.now();
          for (let n = 0; n < c.iterations; n++)
            results.push(db.execute(c.sql)[0]);
          const end = performance.now(),
            cpu = process.cpuUsage(cpuBefore);
          const usageAfter = process.resourceUsage(),
            waitAfter = schedulerWait(),
            heapAfter = process.memoryUsage().heapUsed;
          let first: ReturnType<typeof check> | undefined;
          for (const result of results) {
            const source = check(result, c);
            first ??= source;
          }
          assert.ok(first);
          samples.push({
            name: c.name,
            iterations: c.iterations,
            start,
            end,
            wallMs: (end - start) / c.iterations,
            cpuMs: (cpu.user + cpu.system) / 1000 / c.iterations,
            schedulerWaitMs:
              waitAfter === null || waitBefore === null
                ? null
                : (waitAfter - waitBefore) / c.iterations,
            involuntarySwitches:
              usageAfter.involuntaryContextSwitches -
              usageBefore.involuntaryContextSwitches,
            heapDeltaBytes: (heapAfter - heapBefore) / c.iterations,
            sourceRows: first.rowsOut,
            sourceMs: first.ms,
            access: first.access,
          });
          // Drop full results before draining asynchronous GC events. No explicit GC in timing mode.
          results.length = 0;
          await flush();
          await flush();
        }
      }
      await flush();
      await flush();
      assert.equal(hash(root), sourceHash);
      return {
        ...common,
        containerDelta: delta(cpuStat(), containerBefore),
        samples: samples.map((s) => ({
          ...s,
          gc: gcOverlap(s.start, s.end, events),
        })),
        events,
      };
    }
    // Profiler overhead is kept out of timing workers. Full GC conditions profile windows only.
    const session = new Session();
    session.connect();
    const collect = async () => {
      await session.post("HeapProfiler.collectGarbage");
      await flush();
      await flush();
    };
    let last: QueryResult | undefined;
    const executeProfile = () => {
      let count = 0;
      for (let i = 0; i < config.profileQueries; i++) {
        last = db.execute(cases[0].sql)[0];
        count += last.rows.length;
      }
      assert.equal(count, matches.length * config.profileQueries);
    };
    try {
      await collect();
      await session.post("Profiler.enable");
      await session.post("Profiler.setSamplingInterval", { interval: 1000 });
      await session.post("Profiler.start");
      executeProfile();
      const cpu = (await session.post("Profiler.stop")).profile;
      assert.ok(last);
      check(last, cases[0]);
      last = undefined;
      await session.post("Profiler.disable");
      await collect();
      const heapBefore = process.memoryUsage();
      const heapOptions = {
        samplingInterval: 32768,
        includeObjectsCollectedByMajorGC: true,
        includeObjectsCollectedByMinorGC: true,
      };
      await session.post("HeapProfiler.startSampling", heapOptions);
      executeProfile();
      const heap = (await session.post("HeapProfiler.stopSampling")).profile;
      const heapAfterQueries = process.memoryUsage();
      assert.ok(last);
      check(last, cases[0]);
      last = undefined;
      await collect();
      const heapAfterRelease = process.memoryUsage();
      const cpuPath = `${directory}/${version}-${trial}.cpuprofile`,
        heapPath = `${directory}/${version}-${trial}.heapprofile`;
      writeFileSync(cpuPath, JSON.stringify(cpu));
      writeFileSync(heapPath, JSON.stringify(heap));
      const cpuSummary = cpuSelf(cpu),
        heapSummary = heapSelf(heap);
      assert.ok(cpuSummary.samples > 0 && heapSummary.sampledBytes > 0);
      assert.equal(hash(root), sourceHash);
      return {
        ...common,
        cpu: cpuSummary,
        heap: heapSummary,
        heapOptions,
        profileQueries: config.profileQueries,
        heapBefore,
        heapAfterQueries,
        heapAfterRelease,
        cpuArtifact: { path: cpuPath, sha256: digest(cpuPath) },
        heapArtifact: { path: heapPath, sha256: digest(heapPath) },
        containerDelta: delta(cpuStat(), containerBefore),
      };
    } finally {
      session.disconnect();
    }
  } finally {
    observer.disconnect();
  }
}
type TimingRun = Extract<
  Awaited<ReturnType<typeof worker>>,
  { samples: unknown }
>;
if (process.argv.includes("--worker")) {
  const i = process.argv.indexOf("--worker"),
    version = process.argv[i + 1] as Version,
    phase = process.argv[i + 2],
    trial = Number(process.argv[i + 3]);
  assert.ok(
    versions.includes(version) &&
      (phase === "timing" || phase === "profiles") &&
      Number.isInteger(trial),
  );
  const result = await worker(version, phase as "timing" | "profiles", trial);
  writeFileSync(
    `${directory}/${phase}-${version}-${trial}.json`,
    JSON.stringify(result),
  );
} else {
  mkdirSync(directory, { recursive: true });
  const startedAt = new Date().toISOString(),
    sourceAtStart = hash("src/engine");
  assert.equal(
    process.platform,
    "linux",
    "Controlled protocol requires Linux taskset and procfs",
  );
  const allowed = readFileSync("/proc/self/status", "utf8").match(
    /^Cpus_allowed_list:\s*(.+)$/m,
  )?.[1];
  assert.ok(allowed);
  const cpu = allowed.split(/[,-]/)[0];
  for (const version of versions) {
    const dest = `${directory}/${version}`;
    mkdirSync(dest, { recursive: true });
    execFileSync("tar", ["-x", "-C", dest], {
      input: execFileSync("git", ["archive", commits[version], "src/engine"]),
    });
  }
  assert.equal(
    hash(`${directory}/p1c2a/src/engine`),
    hash(`${directory}/p1c2b/src/engine`),
    "A/A control changed",
  );
  const runs: Awaited<ReturnType<typeof worker>>[] = [];
  const launch = (
    version: Version,
    phase: "timing" | "profiles",
    trial: number,
  ) => {
    console.log(`${phase} trial ${trial + 1}: ${version}`);
    execFileSync(
      "taskset",
      [
        "-c",
        cpu,
        process.execPath,
        ...flags,
        "--import",
        "tsx",
        fileURLToPath(import.meta.url),
        "--worker",
        version,
        phase,
        String(trial),
        ...(smoke ? ["--smoke"] : []),
      ],
      { stdio: "inherit", env: { ...process.env, NODE_OPTIONS: "" } },
    );
    const result = JSON.parse(
      readFileSync(`${directory}/${phase}-${version}-${trial}.json`, "utf8"),
    ) as Awaited<ReturnType<typeof worker>>;
    assert.equal(result.affinity, cpu);
    runs.push(result);
  };
  for (const [trial, order] of (smoke
    ? [["p1c2b"] as Version[]]
    : orders
  ).entries())
    for (const version of order) launch(version, "timing", trial);
  for (let trial = 0; trial < config.profileTrials; trial++)
    for (const version of smoke
      ? ["p1c2b" as const]
      : trial % 2
        ? [...versions].reverse()
        : versions)
      launch(version, "profiles", trial);
  const timing = runs.filter((r): r is TimingRun => "samples" in r);
  const measurements = ["duplicate", "limit1", "unique", "missing"].map(
    (name) => {
      const measured = Object.fromEntries(
        (smoke ? ["p1c2b" as const] : versions).map((version) => {
          const selected = timing.filter((r) => r.version === version),
            samples = selected.flatMap((r) =>
              r.samples.filter((s) => s.name === name),
            );
          const conditional = (found: typeof samples) =>
            found.length ? statistics(found.map((s) => s.wallMs)) : null;
          return [
            version,
            {
              wallMs: statistics(samples.map((s) => s.wallMs)),
              cpuMs: statistics(samples.map((s) => s.cpuMs)),
              gcOverlapMsPerQuery: statistics(
                samples.map((s) => s.gc.unionMs / s.iterations),
              ),
              withGC: conditional(samples.filter((s) => s.gc.events)),
              withoutGC: conditional(samples.filter((s) => !s.gc.events)),
              schedulerWaitMs: statistics(
                samples.map((s) => s.schedulerWaitMs ?? 0),
              ),
              trialMedians: selected.map(
                (r) =>
                  statistics(
                    r.samples
                      .filter((s) => s.name === name)
                      .map((s) => s.wallMs),
                  ).median,
              ),
            },
          ];
        }),
      );
      return {
        name,
        measured,
        ratios: smoke
          ? null
          : {
              p1c2aOverP1c1: pairedRatio(
                measured.p1c2a.trialMedians,
                measured.p1c1.trialMedians,
              ),
              p1c2bOverP1c2a: pairedRatio(
                measured.p1c2b.trialMedians,
                measured.p1c2a.trialMedians,
              ),
            },
      };
    },
  );
  const sourceAtEnd = hash("src/engine");
  assert.equal(sourceAtStart, sourceAtEnd);
  assert.equal(new Set(runs.map((r) => r.fixtureHash)).size, 1);
  const report = {
    command: `npm run profile:planner${smoke ? " -- --smoke" : ""}`,
    startedAt,
    finishedAt: new Date().toISOString(),
    commits,
    config,
    flags,
    cpu,
    orders,
    sourceAtStart,
    sourceAtEnd,
    toolHashes: Object.fromEntries(
      ["tools/profile-planner.ts", "tools/profiling-metrics.ts"].map((p) => [
        p,
        digest(p),
      ]),
    ),
    hardware: {
      node: process.version,
      v8: process.versions.v8,
      platform: process.platform,
      release: release(),
      cpu: cpus()[0]?.model,
      availableParallelism: availableParallelism(),
      parentAffinity: allowed,
      cpuMax: optional("/sys/fs/cgroup/cpu.max"),
      memoryMax: optional("/sys/fs/cgroup/memory.max"),
    },
    measurements,
    runs,
  };
  writeFileSync(`${directory}/report.json`, JSON.stringify(report, null, 2));
  for (const m of measurements)
    console.log(
      m.name,
      JSON.stringify({
        medians: Object.fromEntries(
          Object.entries(m.measured).map(([v, x]) => [v, x.wallMs.median]),
        ),
        ratios: m.ratios,
      }),
    );
}
