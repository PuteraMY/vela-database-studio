import { expect, it } from "vitest";
import {
  cpuSelf,
  gcOverlap,
  heapSelf,
  pairedRatio,
  statistics,
} from "../tools/profiling-metrics";
const frame = (name: string) => ({
  functionName: name,
  scriptId: "1",
  url: "file:///snapshot/src/engine/iterator.ts",
  lineNumber: 1,
  columnNumber: 2,
});
it("summarizes a known sample without mutating inputs", () => {
  const values = [4, 1, 3, 2];
  expect(statistics(values)).toMatchObject({
    count: 4,
    median: 2.5,
    p95: 4,
    mean: 2.5,
    variance: 5 / 3,
    min: 1,
    max: 4,
  });
  expect(values).toEqual([4, 1, 3, 2]);
  expect(statistics([7])).toMatchObject({ median: 7, variance: 0 });
});
it.each([{ values: [] }, { values: [NaN] }, { values: [Infinity] }])(
  "rejects invalid statistics: %j",
  ({ values }) => expect(() => statistics(values)).toThrow(),
);
it("bootstraps process pairs deterministically and retains the A/A control", () => {
  expect(pairedRatio([2, 4, 6], [1, 2, 3])).toMatchObject({
    ratio: 2,
    low95: 2,
    high95: 2,
  });
  expect(pairedRatio([1, 2, 3], [1, 2, 3])).toMatchObject({
    ratio: 1,
    low95: 1,
    high95: 1,
  });
  expect(pairedRatio([1, 4, 3], [2, 2, 3])).toEqual(
    pairedRatio([1, 4, 3], [2, 2, 3]),
  );
});
it.each([
  [[1], [1]],
  [[1, 2], [1]],
  [
    [0, 1],
    [1, 1],
  ],
  [
    [NaN, 1],
    [1, 1],
  ],
])("rejects invalid process pairs", (a, b) =>
  expect(() => pairedRatio(a, b)).toThrow(),
);
it("clips GC windows and unions overlapping durations without double counting", () => {
  expect(
    gcOverlap(10, 20, [
      { start: 8, duration: 5, kind: 1, flags: 0 },
      { start: 12, duration: 3, kind: 1, flags: 0 },
      { start: 18, duration: 5, kind: 4, flags: 0 },
      { start: 20, duration: 2, kind: 1, flags: 0 },
      { start: 9, duration: 1, kind: 1, flags: 0 },
    ]),
  ).toEqual({ events: 3, unionMs: 7, counts: { 1: 2, 4: 1 } });
  expect(gcOverlap(10, 10, [])).toEqual({ events: 0, unionMs: 0, counts: {} });
  expect(() => gcOverlap(20, 10, [])).toThrow();
});
it("attributes CPU self-time by sample duration, not hit counts or inclusive stacks", () => {
  const result = cpuSelf({
    nodes: [
      { id: 1, callFrame: frame("parent"), children: [2], hitCount: 9 },
      { id: 2, callFrame: frame("child"), hitCount: 1 },
    ],
    startTime: 0,
    endTime: 9000,
    samples: [1, 2, 2],
    timeDeltas: [1000, 2000, 3000],
  });
  expect(result.sampledMs).toBe(6);
  expect(result.elapsedMs).toBe(9);
  expect(result.self.map((s) => s.ms)).toEqual([5, 1]);
  expect(result.self[0].location).toBe("child @ src/engine/iterator.ts:2:3");
});
it("rejects missing CPU samples and unknown node references", () => {
  expect(() => cpuSelf({ nodes: [], startTime: 0, endTime: 1 })).toThrow();
  expect(() =>
    cpuSelf({
      nodes: [],
      startTime: 0,
      endTime: 1,
      samples: [1],
      timeDeltas: [1],
    }),
  ).toThrow();
});
it("sums allocation self sizes once, preserving collected allocation estimates", () => {
  const result = heapSelf({
    head: {
      callFrame: frame("root"),
      selfSize: 100,
      children: [{ callFrame: frame("leaf"), selfSize: 300, children: [] }],
    },
  });
  expect(result.sampledBytes).toBe(400);
  expect(result.self.map((s) => s.percent)).toEqual([75, 25]);
});
