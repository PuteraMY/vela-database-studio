import type { HeapProfiler, Profiler, Runtime } from "node:inspector";

export function statistics(values: readonly number[]) {
  if (!values.length || values.some((n) => !Number.isFinite(n)))
    throw new Error("Expected finite, nonempty samples");
  const sorted = [...values].sort((a, b) => a - b),
    n = sorted.length;
  const median =
    (sorted[Math.floor((n - 1) / 2)] + sorted[Math.floor(n / 2)]) / 2;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance =
    n === 1 ? 0 : values.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (n - 1);
  return {
    count: n,
    median,
    p95: sorted[Math.ceil(n * 0.95) - 1],
    mean,
    variance,
    stddev: Math.sqrt(variance),
    min: sorted[0],
    max: sorted[n - 1],
  };
}

// Bootstrap whole paired process-trial medians, never treat correlated queries as independent trials.
export function pairedRatio(
  a: readonly number[],
  b: readonly number[],
  seed = 2026,
) {
  if (
    a.length !== b.length ||
    a.length < 2 ||
    [...a, ...b].some((x) => !Number.isFinite(x) || x <= 0)
  )
    throw new Error("Expected paired positive process medians");
  const logs = a.map((x, i) => Math.log(x / b[i]));
  let state = seed >>> 0;
  const estimates = Array.from({ length: 10000 }, () => {
    let total = 0;
    for (let i = 0; i < logs.length; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      total += logs[Math.floor((state / 4294967296) * logs.length)];
    }
    return Math.exp(total / logs.length);
  }).sort((x, y) => x - y);
  return {
    ratio: Math.exp(logs.reduce((x, y) => x + y, 0) / logs.length),
    low95: estimates[249],
    high95: estimates[9749],
    pairedTrials: logs.length,
    bootstrapReplicates: estimates.length,
    seed,
  };
}
export interface GCEvent {
  start: number;
  duration: number;
  kind: number;
  flags: number;
}
export function gcOverlap(
  start: number,
  end: number,
  events: readonly GCEvent[],
) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start)
    throw new Error("Invalid measurement interval");
  if (start === end) return { events: 0, unionMs: 0, counts: {} };
  const intervals = events
    .filter(
      (e) => e.duration > 0 && e.start < end && e.start + e.duration > start,
    )
    .map((e) => ({
      start: Math.max(start, e.start),
      end: Math.min(end, e.start + e.duration),
      kind: e.kind,
    }))
    .sort((a, b) => a.start - b.start);
  let unionMs = 0,
    lastEnd = start;
  const counts: Record<number, number> = {};
  for (const interval of intervals) {
    counts[interval.kind] = (counts[interval.kind] ?? 0) + 1;
    unionMs += Math.max(0, interval.end - Math.max(interval.start, lastEnd));
    lastEnd = Math.max(lastEnd, interval.end);
  }
  return { events: intervals.length, unionMs, counts };
}
function location(frame: Runtime.CallFrame) {
  const i = frame.url.lastIndexOf("/src/engine/");
  const file = i < 0 ? frame.url : frame.url.slice(i + 1);
  return `${frame.functionName || "(anonymous)"} @ ${file}:${frame.lineNumber + 1}:${frame.columnNumber + 1}`;
}
export function cpuSelf(profile: Profiler.Profile) {
  if (
    !profile.samples?.length ||
    profile.samples.length !== profile.timeDeltas?.length
  )
    throw new Error("CPU profile has no matching samples/time deltas");
  const nodes = new Map(profile.nodes.map((n) => [n.id, n.callFrame]));
  const totals = new Map<string, number>();
  profile.samples.forEach((id, i) => {
    const frame = nodes.get(id),
      delta = profile.timeDeltas![i];
    if (!frame || !Number.isFinite(delta) || delta < 0)
      throw new Error("Invalid CPU sample");
    const name = location(frame);
    totals.set(name, (totals.get(name) ?? 0) + delta / 1000);
  });
  const sampledMs = [...totals.values()].reduce((a, b) => a + b, 0);
  return {
    sampledMs,
    elapsedMs: (profile.endTime - profile.startTime) / 1000,
    samples: profile.samples.length,
    self: [...totals]
      .map(([location, ms]) => ({
        location,
        ms,
        percent: (ms / sampledMs) * 100,
      }))
      .sort((a, b) => b.ms - a.ms),
  };
}
export function heapSelf(profile: HeapProfiler.SamplingHeapProfile) {
  const totals = new Map<string, number>();
  const visit = (node: HeapProfiler.SamplingHeapProfileNode) => {
    if (!Number.isFinite(node.selfSize) || node.selfSize < 0)
      throw new Error("Invalid allocation sample");
    const name = location(node.callFrame);
    totals.set(name, (totals.get(name) ?? 0) + node.selfSize);
    node.children.forEach(visit);
  };
  visit(profile.head);
  const sampledBytes = [...totals.values()].reduce((a, b) => a + b, 0);
  return {
    sampledBytes,
    self: [...totals]
      .map(([location, bytes]) => ({
        location,
        bytes,
        percent: sampledBytes ? (bytes / sampledBytes) * 100 : 0,
      }))
      .sort((a, b) => b.bytes - a.bytes),
  };
}
