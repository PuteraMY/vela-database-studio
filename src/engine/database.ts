import { parse } from "./parser";
import { chooseEqualityAccess, type SelectAccessMode } from "./equality-access";
import {
  IndexReadPath,
  type IndexHandle,
  type RowReference,
  type TableHandle,
} from "./index-reader";
import type { RangeOptions } from "./storage/cursor";
import {
  allocateRowId,
  maintainIndexes,
  restoreIdentities,
  validateIndexes,
  type PhysicalIndexes,
  type RowIdentities,
  type TableIdentity,
} from "./indexes";
import type { TreeImage, TreeOptions } from "./storage/btree";
import {
  aggregates,
  columnValue,
  compare,
  evaluate,
  expressionName,
  hasAggregate,
  mapExpression,
  normalize,
  truth,
  validateFunction,
  walk,
} from "./expression";
import { Operator, type Frame } from "./iterator";
import {
  SqlError,
  type AccessTrace,
  type DatabaseState,
  type Expr,
  type QueryResult,
  type Row,
  type SchemaTable,
  type ScanReason,
  type Select,
  type Source,
  type Statement,
  type Table,
  type Value,
} from "./types";
const qualified = (row: Row, alias: string): Row =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [`${alias}.${k}`, v]));
export interface DatabaseOptions {
  indexStorage?: TreeOptions;
  /** Internal reference mode; never exposed as SQL syntax or a studio toggle. */
  selectAccess?: SelectAccessMode;
}
export class Database {
  private state: DatabaseState = { tables: [], indexes: [] };
  private identities: RowIdentities = new Map();
  private indexes: PhysicalIndexes = new Map();
  private readonly reads = new IndexReadPath();
  private readonly indexStorage?: TreeOptions;
  private readonly selectAccess: SelectAccessMode;
  /** Optional fixed page limits support bounded hosts and deterministic failure tests. */
  constructor(options: DatabaseOptions = {}) {
    this.selectAccess = options.selectAccess ?? "auto";
    this.indexStorage = options.indexStorage
      ? Object.freeze({ ...options.indexStorage })
      : undefined;
  }
  export(): DatabaseState {
    return structuredClone(this.state);
  }
  restore(state: DatabaseState) {
    const copy = structuredClone(state);
    this.validate(copy);
    const identities = restoreIdentities(copy);
    const indexes = maintainIndexes(
      { tables: [], indexes: [] },
      copy,
      new Map(),
      identities,
      new Map(),
      this.indexStorage,
    );
    const readState = this.reads.prepare(copy, identities, indexes, true);
    this.state = copy;
    this.identities = identities;
    this.indexes = indexes;
    this.reads.publish(readState);
  }
  schema(): SchemaTable[] {
    return structuredClone(
      this.state.tables.map((t) => ({
        name: t.name,
        columns: t.columns,
        rowCount: t.rows.length,
        indexes: this.state.indexes.filter((i) => i.table === t.name),
      })),
    );
  }
  /** Detached internal diagnostics; identifiers are not SQL columns or durable handles. */
  inspectRows(name: string): { rowId: number; row: Row }[] {
    const table = this.table(name),
      identity = this.identity(name);
    return table.rows.map((row, i) => ({
      rowId: identity.ids[i],
      row: { ...row },
    }));
  }
  inspectIndex(name: string): TreeImage {
    const tree = this.indexes.get(name);
    if (!tree) throw new SqlError(`Indeks “${name}” tidak wujud.`);
    return tree.exportImage();
  }
  validateIndexes() {
    const result = validateIndexes(this.state, this.identities, this.indexes);
    this.reads.validate(this.state, this.identities, this.indexes);
    return result;
  }
  /** Internal read APIs, also used by the narrowly eligible SELECT source. */
  tableHandle(name: string) {
    return this.reads.tableHandle(name);
  }
  indexHandle(table: TableHandle, name: string) {
    return this.reads.indexHandle(table, name);
  }
  resolveRow(reference: RowReference) {
    return this.reads.resolveRow(reference);
  }
  resolveRows(table: TableHandle, references: readonly RowReference[]) {
    return this.reads.resolveRows(table, references);
  }
  lookupIndex(index: IndexHandle, key: readonly Value[]) {
    return this.reads.lookupIndex(index, key);
  }
  scanIndex(index: IndexHandle, options: RangeOptions = {}) {
    return this.reads.scanIndex(index, options);
  }
  private identity(name: string, identities = this.identities): TableIdentity {
    const identity = identities.get(name);
    if (!identity) throw new SqlError(`Identiti jadual “${name}” tidak wujud.`);
    return identity;
  }
  execute(sql: string): QueryResult[] {
    return parse(sql).map((s) => this.run(s));
  }
  private table(name: string, state = this.state): Table {
    const table = state.tables.find((t) => t.name === name);
    if (!table) throw new SqlError(`Jadual “${name}” tidak wujud.`);
    return table;
  }
  private validate(state: DatabaseState) {
    for (const table of state.tables) {
      const uniqueSets = table.columns
        .filter((c) => c.unique || c.primary)
        .map((c) => [c.name])
        .concat(
          state.indexes
            .filter((i) => i.table === table.name && i.unique)
            .map((i) => i.columns),
        );
      for (const keys of uniqueSets) {
        const seen = new Set<string>();
        for (const row of table.rows) {
          const values = keys.map((k) => row[k]);
          if (values.some((v) => v === null)) continue;
          const key = JSON.stringify(values.map(normalize));
          if (seen.has(key))
            throw new SqlError(
              `Kekangan UNIQUE gagal: ${table.name}.${keys.join(", ")}.`,
            );
          seen.add(key);
        }
      }
      for (const c of table.columns) {
        let parentValues: Set<string> | undefined;
        if (c.references) {
          const parent = this.table(c.references.table, state);
          const pc = parent.columns.find(
            (x) => x.name === c.references?.column,
          );
          if (!pc || (!pc.unique && !pc.primary))
            throw new SqlError(
              `Rujukan asing ${c.name} memerlukan lajur induk UNIQUE.`,
            );
          parentValues = new Set(
            parent.rows.map((r) => JSON.stringify(normalize(r[pc.name]))),
          );
        }
        for (const row of table.rows) {
          const v = row[c.name];
          if (v === null) {
            if (c.notNull || c.primary)
              throw new SqlError(
                `Kekangan NOT NULL gagal: ${table.name}.${c.name}.`,
              );
            continue;
          }
          const valid =
            c.type === "TEXT"
              ? typeof v === "string"
              : c.type === "BOOLEAN"
                ? typeof v === "boolean" || v === 0 || v === 1
                : typeof v === "number" &&
                  Number.isFinite(v) &&
                  (c.type !== "INTEGER" || Number.isInteger(v));
          if (!valid)
            throw new SqlError(
              `Jenis nilai untuk ${table.name}.${c.name} mesti ${c.type}.`,
            );
          if (parentValues && !parentValues.has(JSON.stringify(normalize(v))))
            throw new SqlError(
              `Kekangan FOREIGN KEY gagal: ${table.name}.${c.name}.`,
            );
        }
      }
    }
  }
  private run(s: Statement): QueryResult {
    if (s.kind === "select") return this.select(s);
    if (s.kind === "explain") {
      if (!s.analyze)
        throw new SqlError(
          "EXPLAIN tanpa ANALYZE memerlukan pengoptimum P1. Gunakan EXPLAIN ANALYZE untuk jejak sebenar.",
        );
      const r = this.select(s.query);
      return {
        ...r,
        columns: [
          "operator",
          "butiran",
          "baris_masuk",
          "baris_keluar",
          "masa_ms",
        ],
        rows: r.trace.map((t) => [
          t.operator,
          t.detail,
          t.rowsIn,
          t.rowsOut,
          t.ms,
        ]),
        message: "Jejak pelaksanaan sebenar; anggaran kos belum tersedia.",
      };
    }
    const start = performance.now(),
      state = structuredClone(this.state),
      identities = structuredClone(this.identities);
    let affected = 0;
    switch (s.kind) {
      case "createTable": {
        if (state.tables.some((t) => t.name === s.name)) {
          if (s.ifNotExists) break;
          throw new SqlError(`Jadual “${s.name}” sudah wujud.`);
        }
        if (new Set(s.columns.map((c) => c.name)).size !== s.columns.length)
          throw new SqlError("Nama lajur berulang.");
        if (s.columns.filter((c) => c.primary).length > 1)
          throw new SqlError("Hanya satu PRIMARY KEY disokong.");
        s.columns.forEach((c) => {
          if (c.default) evaluate(c.default);
        });
        state.tables.push({ name: s.name, columns: s.columns, rows: [] });
        identities.set(s.name, { ids: [], nextId: 1 });
        break;
      }
      case "dropTable": {
        if (!state.tables.some((t) => t.name === s.name)) {
          if (s.ifExists) break;
          this.table(s.name, state);
        }
        state.tables = state.tables.filter((t) => t.name !== s.name);
        identities.delete(s.name);
        state.indexes = state.indexes.filter((i) => i.table !== s.name);
        break;
      }
      case "createIndex": {
        if (state.indexes.some((i) => i.name === s.name)) {
          if (s.ifNotExists) break;
          throw new SqlError(`Indeks “${s.name}” sudah wujud.`);
        }
        const t = this.table(s.table, state);
        s.columns.forEach((c) => {
          if (!t.columns.some((x) => x.name === c))
            throw new SqlError(`Lajur “${c}” tidak wujud.`);
        });
        state.indexes.push({
          name: s.name,
          table: s.table,
          columns: s.columns,
          unique: s.unique,
        });
        break;
      }
      case "dropIndex": {
        if (!state.indexes.some((i) => i.name === s.name) && !s.ifExists)
          throw new SqlError(`Indeks “${s.name}” tidak wujud.`);
        state.indexes = state.indexes.filter((i) => i.name !== s.name);
        break;
      }
      case "insert": {
        const t = this.table(s.table, state),
          names = s.columns ?? t.columns.map((c) => c.name);
        if (new Set(names).size !== names.length)
          throw new SqlError("Lajur INSERT berulang.");
        names.forEach((n) => {
          if (!t.columns.some((c) => c.name === n))
            throw new SqlError(`Lajur “${n}” tidak wujud.`);
        });
        for (const values of s.values) {
          if (values.length !== names.length)
            throw new SqlError(
              "Bilangan nilai tidak sepadan dengan bilangan lajur.",
            );
          const row: Row = Object.fromEntries(
            t.columns.map((c) => [
              c.name,
              c.default ? evaluate(c.default) : null,
            ]),
          );
          names.forEach((n, i) => {
            row[n] = evaluate(values[i]);
          });
          t.rows.push(row);
          const identity = this.identity(t.name, identities);
          identity.ids.push(allocateRowId(identity));
          affected++;
        }
        break;
      }
      case "update": {
        const t = this.table(s.table, state);
        s.sets.forEach((a) => {
          if (!t.columns.some((c) => c.name === a.column))
            throw new SqlError(`Lajur “${a.column}” tidak wujud.`);
        });
        const sample = qualified(
          Object.fromEntries(t.columns.map((c) => [c.name, null])),
          t.name,
        );
        if (s.where) this.bind(s.where, sample, false);
        s.sets.forEach((a) =>
          this.bind(
            a.expr,
            sample,
            false,
            new Set(
              t.columns
                .filter((c) => c.type === "REAL")
                .map((c) => `${t.name}.${c.name}`),
            ),
          ),
        );
        t.rows = t.rows.map((row) => {
          const ctx = qualified(row, t.name);
          if (s.where && truth(evaluate(s.where, ctx)) !== true) return row;
          affected++;
          return {
            ...row,
            ...Object.fromEntries(
              s.sets.map((a) => [a.column, evaluate(a.expr, ctx)]),
            ),
          };
        });
        break;
      }
      case "delete": {
        const t = this.table(s.table, state),
          identity = this.identity(t.name, identities),
          retainedIds: number[] = [];
        if (s.where)
          this.bind(
            s.where,
            qualified(
              Object.fromEntries(t.columns.map((c) => [c.name, null])),
              t.name,
            ),
            false,
          );
        t.rows = t.rows.filter((row, i) => {
          const remove =
            !s.where ||
            truth(evaluate(s.where, qualified(row, t.name))) === true;
          if (remove) affected++;
          else retainedIds.push(identity.ids[i]);
          return !remove;
        });
        identity.ids = retainedIds;
        break;
      }
    }
    this.validate(state);
    const indexes = maintainIndexes(
      this.state,
      state,
      this.identities,
      identities,
      this.indexes,
      this.indexStorage,
    );
    const readState = this.reads.prepare(state, identities, indexes);
    this.state = state;
    this.identities = identities;
    this.indexes = indexes;
    this.reads.publish(readState);
    return {
      columns: [],
      rows: [],
      affected,
      ms: performance.now() - start,
      trace: [],
      message: affected
        ? `${affected} baris terjejas.`
        : "Pernyataan berjaya dilaksanakan.",
    };
  }
  private bind(
    e: Expr,
    sample: Row,
    allowAggregate: boolean,
    realColumns: Set<string> = new Set(),
  ) {
    const allowedStars = new Set<Expr>();
    walk(e, (n) => {
      if (
        n.kind === "call" &&
        n.name === "count" &&
        n.args[0]?.kind === "star" &&
        !n.args[0].table &&
        !n.distinct
      )
        allowedStars.add(n.args[0]);
    });
    walk(e, (n) => {
      if (n.kind === "star" && !allowedStars.has(n))
        throw new SqlError("Tanda * tidak sah dalam ungkapan ini.");
      if (n.kind === "column") {
        columnValue(sample, n.name, n.table);
        const key = n.table
          ? `${n.table}.${n.name}`
          : Object.hasOwn(sample, n.name)
            ? n.name
            : Object.keys(sample).find((k) => k.endsWith(`.${n.name}`));
        if (key?.includes(".")) n.table = key.slice(0, key.lastIndexOf("."));
        n.real = !!key && realColumns.has(key);
      }
      if (n.kind === "call") {
        validateFunction(n);
        if (aggregates.has(n.name)) {
          if (!allowAggregate)
            throw new SqlError("Agregat tidak dibenarkan dalam klausa ini.");
          if (n.args.some(hasAggregate))
            throw new SqlError("Agregat bersarang tidak dibenarkan.");
        }
      }
    });
  }
  private select(q: Select): QueryResult {
    const start = performance.now(),
      ops: Operator[] = [];
    const op = (
      name: string,
      detail: string,
      inputs: Operator[],
      produce: () => Generator<Frame>,
    ) => {
      const o = new Operator(ops.length, name, detail, inputs, produce);
      ops.push(o);
      return o;
    };
    const sourceSample = (s: Source) =>
      qualified(
        Object.fromEntries(
          this.table(s.table).columns.map((c) => [c.name, null]),
        ),
        s.alias,
      );
    const sources = q.from ? [q.from, ...q.joins.map((j) => j.source)] : [];
    if (new Set(sources.map((s) => s.alias)).size !== sources.length)
      throw new SqlError("Alias jadual berulang.");
    const sample = Object.assign({}, ...sources.map(sourceSample)) as Row;
    const realColumns = new Set(
      sources.flatMap((s) =>
        this.table(s.table)
          .columns.filter((c) => c.type === "REAL")
          .map((c) => `${s.alias}.${c.name}`),
      ),
    );
    for (const c of q.columns)
      if (
        c.expr.kind === "star" &&
        c.expr.table &&
        !sources.some(
          (s) => s.alias === (c.expr.kind === "star" ? c.expr.table : ""),
        )
      )
        throw new SqlError(`Jadual “${c.expr.table}” tidak wujud.`);
    const columns = q.columns.flatMap((c) =>
      c.expr.kind === "star"
        ? Object.keys(sample)
            .filter(
              (k) =>
                !("table" in c.expr) ||
                !c.expr.table ||
                k.startsWith(`${c.expr.table}.`),
            )
            .map((k) => ({
              expr: {
                kind: "column",
                table: k.split(".")[0],
                name: k.split(".")[1],
              } as Expr,
              alias: undefined,
            }))
        : [c],
    );
    if (!columns.length) throw new SqlError("Tiada lajur dipilih.");
    columns.forEach((c) => this.bind(c.expr, sample, true, realColumns));
    if (q.where) this.bind(q.where, sample, false, realColumns);
    const resolveAliases = (e: Expr, preferAlias = false): Expr =>
      mapExpression(e, (n) => {
        if (
          n.kind === "column" &&
          !n.table &&
          (preferAlias ||
            !Object.keys(sample).some((k) => k.endsWith(`.${n.name}`)))
        )
          return columns.find((c) => c.alias === n.name)?.expr ?? n;
        return n;
      });
    const resolveOrdinal = (e: Expr): Expr => {
      if (
        e.kind === "literal" &&
        typeof e.value === "number" &&
        Number.isInteger(e.value) &&
        !e.real
      ) {
        if (e.value < 1 || e.value > columns.length)
          throw new SqlError("Kedudukan lajur di luar julat SELECT.");
        return columns[e.value - 1].expr;
      }
      return e;
    };
    const groupExpressions = q.group.map((e) =>
      resolveAliases(resolveOrdinal(e)),
    );
    groupExpressions.forEach((e) => this.bind(e, sample, false, realColumns));
    const having = q.having ? resolveAliases(q.having) : undefined;
    if (having) this.bind(having, sample, true, realColumns);
    const orderExpressions = q.order.map((o) =>
      resolveAliases(resolveOrdinal(o.expr), o.expr.kind === "column"),
    );
    orderExpressions.forEach((e) => this.bind(e, sample, true, realColumns));
    if (
      !q.group.length &&
      !columns.some((c) => hasAggregate(c.expr)) &&
      !having &&
      orderExpressions.some(hasAggregate)
    )
      throw new SqlError("Agregat ORDER BY memerlukan pertanyaan agregat.");
    const scan = (s: Source, reason: ScanReason) => {
      const table = this.table(s.table);
      const source = op(
        "Imbasan jadual",
        `${s.table} · ${table.rows.length} baris`,
        [],
        function* () {
          for (const row of table.rows) yield { row: qualified(row, s.alias) };
        },
      );
      source.trace.access = { kind: "table-scan", table: s.table, reason };
      return source;
    };
    const baseSource = () => {
      if (!q.from)
        return op("Nilai tetap", "Satu baris", [], function* () {
          yield { row: {} };
        });
      const s = q.from;
      const access = chooseEqualityAccess(
        q,
        this.table(s.table).columns,
        this.state.indexes,
        this.indexes,
        this.selectAccess,
      );
      if (access.kind === "table-scan") return scan(s, access.reason);
      const openCursor = () =>
        this.scanIndex(
          this.indexHandle(this.tableHandle(s.table), access.index),
          { lower: { key: access.key }, upper: { key: access.key } },
        );
      const evidence: Extract<AccessTrace, { kind: "index-equality" }> = {
        kind: "index-equality",
        table: s.table,
        index: access.index,
        lookupCalls: 0,
        matchedRowIds: 0,
      };
      const source = op(
        "Carian indeks",
        `${s.table} · ${access.index} · padanan tepat`,
        [],
        function* () {
          evidence.lookupCalls++;
          // Equal inclusive bounds retain stable-ID order without collecting matches.
          for (const entry of openCursor()) {
            evidence.matchedRowIds++;
            yield { row: qualified(entry.row, s.alias) };
          }
        },
      );
      source.trace.access = evidence;
      return source;
    };
    let current = baseSource();
    for (const join of q.joins) {
      const left = current,
        right = scan(join.source, "multiple-tables");
      if (join.on) this.bind(join.on, sample, false, realColumns);
      const nullRow = sourceSample(join.source);
      current = op(
        join.kind === "LEFT" ? "Cantuman kiri" : "Cantuman gelung",
        `${join.kind} · ${join.source.table}`,
        [left, right],
        function* () {
          const rightRows = [...right];
          for (const l of left) {
            let matched = false;
            for (const r of rightRows) {
              const row = { ...l.row, ...r.row };
              if (!join.on || truth(evaluate(join.on, row)) === true) {
                matched = true;
                yield { row };
              }
            }
            if (!matched && join.kind === "LEFT")
              yield { row: { ...l.row, ...nullRow } };
          }
        },
      );
    }
    if (q.where) {
      const input = current,
        where = q.where;
      current = op("Tapis", expressionName(where), [input], function* () {
        for (const f of input)
          if (truth(evaluate(where, f.row)) === true) yield f;
      });
    }
    const isAggregate =
      columns.some((c) => hasAggregate(c.expr)) ||
      (!!having && hasAggregate(having));

    if (q.group.length || isAggregate) {
      const input = current;
      current = op(
        "Agregat",
        q.group.length
          ? `Kumpulan · ${q.group.map(expressionName).join(", ")}`
          : "Semua baris",
        [input],
        function* () {
          const groups = new Map<string, Row[]>();
          if (!q.group.length) groups.set("all", []);
          for (const f of input) {
            const key = q.group.length
              ? JSON.stringify(
                  groupExpressions.map((e) => normalize(evaluate(e, f.row))),
                )
              : "all";
            const group = groups.get(key);
            if (group) group.push(f.row);
            else groups.set(key, [f.row]);
          }
          for (const group of groups.values())
            yield { row: group[0] ?? sample, group };
        },
      );
    } else if (q.having)
      throw new SqlError("HAVING memerlukan GROUP BY atau agregat.");
    {
      const input = current;
      current = op(
        "Unjuran",
        columns.map((c) => c.alias ?? expressionName(c.expr)).join(", "),
        [input],
        function* () {
          for (const f of input) {
            const values = columns.map((c) => evaluate(c.expr, f.row, f.group));
            const row = {
              ...f.row,
              ...Object.fromEntries(
                columns
                  .filter((c) => c.alias)
                  .map((c) => [c.alias as string, values[columns.indexOf(c)]]),
              ),
            };
            if (having && truth(evaluate(having, f.row, f.group)) !== true)
              continue;
            const sort = orderExpressions.map((e) => evaluate(e, row, f.group));
            yield { ...f, row, values, sort };
          }
        },
      );
    }
    if (q.distinct) {
      const input = current;
      current = op("Unik", "DISTINCT", [input], function* () {
        const seen = new Set<string>();
        for (const f of input) {
          const key = JSON.stringify(f.values?.map(normalize));
          if (!seen.has(key)) {
            seen.add(key);
            yield f;
          }
        }
      });
    }
    if (q.order.length) {
      const input = current;
      current = op(
        "Susun",
        q.order
          .map((o) => `${expressionName(o.expr)} ${o.desc ? "DESC" : "ASC"}`)
          .join(", "),
        [input],
        function* () {
          const frames = [...input];
          frames.sort((a, b) => {
            for (let i = 0; i < q.order.length; i++) {
              const o = q.order[i],
                x = a.sort?.[i] ?? null,
                y = b.sort?.[i] ?? null;
              let c = compare(x, y);
              if (o.nulls && (x === null || y === null))
                c =
                  x === y
                    ? 0
                    : x === null
                      ? o.nulls === "FIRST"
                        ? -1
                        : 1
                      : o.nulls === "FIRST"
                        ? 1
                        : -1;
              else if (o.desc) c = -c;
              if (c) return c;
            }
            return 0;
          });
          yield* frames;
        },
      );
    }
    if (q.limit) {
      const input = current,
        limit = evaluate(q.limit),
        offset = q.offset ? evaluate(q.offset) : 0;
      if (
        typeof limit !== "number" ||
        !Number.isInteger(limit) ||
        typeof offset !== "number" ||
        !Number.isInteger(offset)
      )
        throw new SqlError("LIMIT dan OFFSET mesti integer.");
      current = op(
        "Had",
        `LIMIT ${limit} · OFFSET ${offset}`,
        [input],
        function* () {
          let skipped = 0,
            count = 0;
          while (limit < 0 || count < limit) {
            const next = input.next();
            if (next.done) break;
            if (skipped++ < Math.max(0, offset)) continue;
            count++;
            yield next.value;
          }
        },
      );
    }
    const rows = [...current].map((f) => (f.values ?? []).map(normalize));
    return {
      columns: columns.map((c) => c.alias ?? expressionName(c.expr)),
      rows,
      affected: 0,
      ms: performance.now() - start,
      trace: ops.map((o) => o.trace),
      message: `${rows.length} baris dipulangkan.`,
    };
  }
}
