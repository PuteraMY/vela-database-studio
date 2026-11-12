import { describe, it, expect } from "vitest";
import { like } from "../src/engine/like";
import { csvCell, resultCsv } from "../src/lib/export";
import { compareResults } from "../src/worker/compare";
describe("bounded LIKE matcher", () => {
  it.each<[string, string, boolean]>([
    ["Aina", "a%", true],
    ["%abc", "%", true],
    ["a%b", "a%b", true],
    ["a%b", "a%_b", true],
    ["😀", "_", true],
    ["Äpfel", "ä%", false],
    ["a\nb", "a_b", true],
    ["", "%", true],
    ["", "_", false],
    ["abc", "a%c", true],
    ["a.b", "a.b", true],
    ["ab", "a.b", false],
    ["abc", "%b%", true],
    ["aaaa", "%a%z", false],
    ["abc", "a%%c", true],
  ])("%s LIKE %s", (text, pattern, expected) =>
    expect(like(text, pattern)).toBe(expected),
  );
  it("finishes the formerly exponential adversarial pattern", () => {
    const start = performance.now();
    expect(like("a".repeat(8000), "%a".repeat(16) + "%z")).toBe(false);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
describe("spreadsheet-safe CSV export", () => {
  it.each([
    "=1+1",
    "+CMD",
    "-1+2",
    "@SUM(A1:A2)",
    "\t=1",
    " \t=SUM(1,2)",
    "\rformula",
    "\nformula",
  ])("neutralizes text %s", (value) =>
    expect(csvCell(value)).toBe(`"'${value}"`),
  );
  it("preserves negative numbers and ordinary text", () => {
    expect(csvCell(-3)).toBe('"-3"');
    expect(csvCell("Aina")).toBe('"Aina"');
    expect(csvCell(null)).toBe("");
  });
  it("escapes quotes and protects column headers too", () =>
    expect(resultCsv({ columns: ["=header"], rows: [['a"b']] })).toBe(
      '"\'=header"\r\n"a""b"',
    ));
});
describe("SQLite cell diff contract", () => {
  it("matches empty and nonempty statement results", () =>
    expect(compareResults([[], [[1, null]]], [[], [[1, null]]])).toEqual({
      match: true,
      differences: [],
    }));
  it("identifies cell and missing rows", () =>
    expect(compareResults([[[1], [2]]], [[[3]]]).differences).toEqual([
      { statement: 1, row: 1, column: 1, vela: "1", sqlite: "3" },
      { statement: 1, row: 2, column: 1, vela: "2", sqlite: "Tiada nilai" },
    ]));
  it("bounds mismatch output", () =>
    expect(
      compareResults(
        [Array.from({ length: 100 }, () => [1])],
        [Array.from({ length: 100 }, () => [2])],
      ).differences,
    ).toHaveLength(20));
  it("treats NULL and string NULL separately", () =>
    expect(compareResults([[[null]]], [[["NULL"]]]).match).toBe(false));
});
