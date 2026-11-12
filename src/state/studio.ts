import { create } from "zustand";
import { examples, type Dataset } from "../engine/datasets";
import type { QueryResult, SchemaTable } from "../engine/types";
import type { Request, Response, Comparison } from "../worker/protocol";
const worker = new Worker(
  new URL("../worker/engine.worker.ts", import.meta.url),
  { type: "module" },
);
let requestId = 0;
const pending = new Map<
  number,
  { resolve: (v: Response) => void; reject: (e: Error) => void }
>();
worker.onmessage = (e: MessageEvent<Response>) => {
  pending.get(e.data.id)?.resolve(e.data);
  pending.delete(e.data.id);
};
worker.onerror = () => {
  for (const p of pending.values())
    p.reject(
      new Error("Enjin terhenti. Muat semula halaman untuk memulakan semula."),
    );
  pending.clear();
};
type Command = Request extends infer R
  ? R extends Request
    ? Omit<R, "id">
    : never
  : never;
const send = (request: Command) =>
  new Promise<Response>((resolve, reject) => {
    const id = ++requestId;
    pending.set(id, { resolve, reject });
    worker.postMessage({ ...request, id });
  });
interface Metric {
  ms: number;
  scanned: number;
  rows: number;
}
interface Studio {
  dataset: Dataset;
  sql: string;
  schema: SchemaTable[];
  results: QueryResult[];
  busy: boolean;
  error?: Response["error"];
  history: string[];
  compare: boolean;
  comparison?: Comparison;
  metrics: Metric[];
  ready: boolean;
  setSql: (sql: string) => void;
  setCompare: (compare: boolean) => void;
  run: (sql?: string) => Promise<void>;
  load: (dataset: Dataset) => Promise<void>;
  importCsv: (csv: string) => Promise<void>;
  generate: (count: number) => Promise<void>;
}
export const useStudio = create<Studio>((set, get) => ({
  dataset: "sekolah",
  sql: examples.sekolah,
  schema: [],
  results: [],
  busy: false,
  history: [],
  compare: false,
  metrics: [],
  ready: false,
  setSql: (sql) => set({ sql, error: undefined }),
  setCompare: (compare) => set({ compare, comparison: undefined }),
  run: async (sql = get().sql) => {
    if (get().busy) return;
    set({ busy: true, error: undefined, comparison: undefined });
    try {
      const r = await send({ type: "run", sql, compare: get().compare });
      set((s) => ({
        schema: r.schema,
        results: r.results ?? [],
        error: r.error,
        comparison: r.comparison,
        history: r.error
          ? s.history
          : [sql, ...s.history.filter((x) => x !== sql)].slice(0, 30),
        metrics: r.results
          ? [
              ...s.metrics,
              {
                ms: r.results.reduce((n, r) => n + r.ms, 0),
                scanned: r.results
                  .flatMap((r) => r.trace)
                  .filter((t) => t.operator === "Imbasan jadual")
                  .reduce((n, t) => n + t.rowsOut, 0),
                rows: r.results.at(-1)?.rows.length ?? 0,
              },
            ].slice(-30)
          : s.metrics,
      }));
    } catch (e) {
      set({ error: { message: String(e), offset: 0 } });
    } finally {
      set({ busy: false });
    }
  },
  load: async (dataset) => {
    if (get().busy) return;
    set({ busy: true, error: undefined, results: [], comparison: undefined });
    try {
      const r = await send({ type: "load", dataset });
      set({
        dataset,
        sql: examples[dataset],
        schema: r.schema,
        error: r.error,
        ready: true,
      });
    } catch (e) {
      set({
        error: {
          message: e instanceof Error ? e.message : String(e),
          offset: 0,
        },
      });
    } finally {
      set({ busy: false });
    }
    if (!get().error) await get().run();
  },
  importCsv: async (csv) => {
    if (get().busy) return;
    set({ busy: true, error: undefined });
    try {
      const r = await send({ type: "import", csv });
      set({ schema: r.schema, error: r.error });
      if (!r.error)
        set({ sql: `SELECT * FROM ${r.schema.at(-1)?.name} LIMIT 100;` });
    } catch (e) {
      set({
        error: {
          message: e instanceof Error ? e.message : String(e),
          offset: 0,
        },
      });
    } finally {
      set({ busy: false });
    }
    if (!get().error) await get().run();
  },
  generate: async (count) => {
    if (get().busy) return;
    set({ busy: true, error: undefined });
    try {
      const r = await send({ type: "generate", count });
      set({
        schema: r.schema,
        error: r.error,
        sql: "SELECT * FROM data_janaan LIMIT 100;",
      });
    } catch (e) {
      set({
        error: {
          message: e instanceof Error ? e.message : String(e),
          offset: 0,
        },
      });
    } finally {
      set({ busy: false });
    }
    if (!get().error) await get().run();
  },
}));
