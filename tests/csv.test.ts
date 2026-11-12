import { describe, it, expect } from "vitest";
import { csvTable, parseCsv } from "../src/engine/csv";
import { splitStatements } from "../src/engine/tokenizer";
import { createDataset, generatedTable } from "../src/engine/datasets";
describe("CSV import", () => {
  it("parses quoted comma, escaped quote and newline", () =>
    expect(parseCsv('a,b\r\n"x,y","a""b"\r\n"line\n2",v')).toEqual([
      ["a", "b"],
      ["x,y", 'a"b'],
      ["line\n2", "v"],
    ]));
  it("infers nullable mixed numeric data", () => {
    const t = csvTable("id,nilai,aktif,nama\n1,2.5,true,Aina\n2,,false,Bala");
    expect(t.columns.map((c) => c.type)).toEqual([
      "INTEGER",
      "REAL",
      "BOOLEAN",
      "TEXT",
    ]);
    expect(t.rows[1]).toEqual({
      id: 2,
      nilai: null,
      aktif: false,
      nama: "Bala",
    });
  });
  it("strips BOM and normalizes column names", () =>
    expect(csvTable("\uFEFFNama Murid,Skor\nAina,1").columns[0].name).toBe(
      "nama_murid",
    ));
  it.each(["a,b\n1,2,3", "a,a\n1,2", 'a\n"open', 'a,b\n"ok"x,2', "a,b"])(
    "rejects malformed CSV %s",
    (csv) => expect(() => csvTable(csv)).toThrow(),
  );
  it("keeps ambiguous numeric-looking values as text", () =>
    expect(csvTable("kod\n1\n12A").columns[0].type).toBe("TEXT"));
  it("parses an explicit empty quoted field", () =>
    expect(parseCsv('a\n""')).toEqual([["a"], [""]]));
});
describe("statement splitting", () => {
  it("preserves quoted semicolons and ignores comment terminators", () =>
    expect(splitStatements("-- ;\nSELECT ';';/* ; */ SELECT 2;")).toEqual([
      "SELECT ';'",
      "SELECT 2",
    ]));
  it("omits empty statements and comment-only input", () =>
    expect(splitStatements(";;-- x")).toEqual([]));
});
describe("built-in datasets", () => {
  it.each(["sekolah", "kedai", "edagang"] as const)(
    "loads %s with enforced constraints",
    (name) => expect(createDataset(name).schema().length).toBeGreaterThan(1),
  );
  it("generates deterministic unique rows", () => {
    const t = generatedTable(10000);
    expect(t.rows).toHaveLength(10000);
    expect(new Set(t.rows.map((r) => r.id)).size).toBe(10000);
  });
  it("rejects an unsupported size", () =>
    expect(() => generatedTable(3)).toThrow());
});
