import { Session } from "node:inspector/promises";
import { expect, it } from "vitest";
import { heapSelf } from "../tools/profiling-metrics";

// Verify the runtime really retains sampled allocations that have been collected.
// Without these protocol flags a profile would only describe surviving objects.
function allocationProbe() {
  let checksum = 0;
  for (let i = 0; i < 20000; i++) {
    const values = new Array<number>(128).fill(i);
    checksum += values[i % 128];
  }
  return checksum;
}
it("distinguishes total sampled allocation from retained heap", async () => {
  const session = new Session();
  session.connect();
  try {
    const measure = async (includeCollected: boolean) => {
      await session.post("HeapProfiler.collectGarbage");
      const options = {
        samplingInterval: 4096,
        includeObjectsCollectedByMajorGC: includeCollected,
        includeObjectsCollectedByMinorGC: includeCollected,
      };
      await session.post("HeapProfiler.startSampling", options);
      const checksum = allocationProbe();
      await session.post("HeapProfiler.collectGarbage");
      const { profile } = await session.post("HeapProfiler.stopSampling");
      expect(checksum).toBe(199990000);
      return heapSelf(profile)
        .self.filter((s) => s.location.startsWith("allocationProbe @"))
        .reduce((sum, s) => sum + s.bytes, 0);
    };
    const retained = await measure(false),
      allocated = await measure(true);
    expect(allocated).toBeGreaterThan(8 * 1024 * 1024);
    expect(allocated).toBeGreaterThan(retained * 4);
  } finally {
    session.disconnect();
  }
});
