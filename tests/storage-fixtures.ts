import type { Key } from "../src/engine/storage/page";
export const orderedKeys: Key[] = [
  [null],
  [null, false],
  [null, true],
  [false],
  [true],
  [-10],
  [-1],
  [0],
  [0, null],
  [0, 0],
  [1],
  [1, ""],
  [1, "a"],
  [2],
  [99],
  [""],
  ["A"],
  ["a"],
  ["a", null],
  ["a", true],
  ["aa"],
  ["😀"],
  ["\uffff"],
];

export function random(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}
export function shuffled(count: number, seed: number): number[] {
  const next = random(seed),
    values = Array.from({ length: count }, (_, i) => i);
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}
