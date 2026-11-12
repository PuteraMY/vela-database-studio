export interface Difference {
  statement: number;
  row: number;
  column: number;
  vela: string;
  sqlite: string;
}
/** Keep the first differences bounded, even when comparing 100k rows. */
export function compareResults(
  vela: readonly (readonly (readonly unknown[])[])[],
  sqlite: readonly (readonly (readonly unknown[])[])[],
  limit = 20,
): { match: boolean; differences: Difference[] } {
  const differences: Difference[] = [];
  const label = (value: unknown) =>
    value === undefined
      ? "Tiada nilai"
      : value === null
        ? "NULL"
        : JSON.stringify(value);
  for (let s = 0; s < Math.max(vela.length, sqlite.length); s++) {
    const left = vela[s] ?? [],
      right = sqlite[s] ?? [];
    for (let r = 0; r < Math.max(left.length, right.length); r++) {
      const a = left[r] ?? [],
        b = right[r] ?? [];
      for (let c = 0; c < Math.max(a.length, b.length); c++) {
        if (JSON.stringify(a[c]) === JSON.stringify(b[c])) continue;
        differences.push({
          statement: s + 1,
          row: r + 1,
          column: c + 1,
          vela: label(a[c]),
          sqlite: label(b[c]),
        });
        if (differences.length >= limit) return { match: false, differences };
      }
    }
  }
  return {
    match: differences.length === 0 && vela.length === sqlite.length,
    differences,
  };
}
