export type Value = number | string | boolean | null;
export type Row = Record<string, Value>;
export interface Position {
  offset: number;
  line: number;
  column: number;
}
export interface Token extends Position {
  kind: "word" | "number" | "string" | "symbol" | "eof";
  text: string;
  value: string;
}
export class SqlError extends Error {
  constructor(
    message: string,
    public position: Position = { offset: 0, line: 1, column: 1 },
    public expected?: string,
  ) {
    super(
      `Baris ${position.line}, lajur ${position.column}: ${message}${expected ? ` Jangkaan: ${expected}.` : ""}`,
    );
    this.name = "SqlError";
  }
}
export type Expr =
  | { kind: "literal"; value: Value; real?: boolean }
  | { kind: "column"; name: string; table?: string; real?: boolean }
  | { kind: "star"; table?: string }
  | { kind: "unary"; op: string; expr: Expr }
  | { kind: "binary"; op: string; left: Expr; right: Expr }
  | { kind: "call"; name: string; args: Expr[]; distinct: boolean }
  | {
      kind: "case";
      base?: Expr;
      branches: { when: Expr; then: Expr }[];
      otherwise: Expr;
    }
  | { kind: "in"; expr: Expr; values: Expr[]; not: boolean }
  | { kind: "between"; expr: Expr; low: Expr; high: Expr; not: boolean };
export interface Column {
  name: string;
  type: "INTEGER" | "REAL" | "TEXT" | "BOOLEAN";
  primary: boolean;
  notNull: boolean;
  unique: boolean;
  default?: Expr;
  references?: { table: string; column: string };
}
export interface Source {
  table: string;
  alias: string;
}
export interface Join {
  kind: "INNER" | "LEFT" | "CROSS";
  source: Source;
  on?: Expr;
}
export interface Select {
  kind: "select";
  distinct: boolean;
  columns: { expr: Expr; alias?: string }[];
  from?: Source;
  joins: Join[];
  where?: Expr;
  group: Expr[];
  having?: Expr;
  order: { expr: Expr; desc: boolean; nulls?: "FIRST" | "LAST" }[];
  limit?: Expr;
  offset?: Expr;
}
export type Statement =
  | Select
  | {
      kind: "createTable";
      name: string;
      columns: Column[];
      ifNotExists: boolean;
    }
  | { kind: "dropTable"; name: string; ifExists: boolean }
  | {
      kind: "createIndex";
      name: string;
      table: string;
      columns: string[];
      unique: boolean;
      ifNotExists: boolean;
    }
  | { kind: "dropIndex"; name: string; ifExists: boolean }
  | { kind: "insert"; table: string; columns?: string[]; values: Expr[][] }
  | {
      kind: "update";
      table: string;
      sets: { column: string; expr: Expr }[];
      where?: Expr;
    }
  | { kind: "delete"; table: string; where?: Expr }
  | { kind: "explain"; analyze: boolean; query: Select };
export interface Table {
  name: string;
  columns: Column[];
  rows: Row[];
}
export interface IndexDefinition {
  name: string;
  table: string;
  columns: string[];
  unique: boolean;
}
export interface DatabaseState {
  tables: Table[];
  indexes: IndexDefinition[];
}
export type ScanReason =
  | "forced"
  | "multiple-tables"
  | "unsupported-predicate"
  | "unsafe-constant"
  | "null-or-nonfinite"
  | "incompatible-type"
  | "no-compatible-index"
  | "key-capacity";
export type AccessTrace =
  | { kind: "table-scan"; table: string; reason: ScanReason }
  | {
      kind: "index-equality";
      table: string;
      index: string;
      /** Physical equality cursors opened (zero if the source is never pulled). */
      lookupCalls: number;
      /** Validated entries actually pulled, not total matching cardinality. */
      matchedRowIds: number;
    };
export interface Trace {
  id: number;
  parent?: number;
  operator: string;
  detail: string;
  rowsIn: number;
  rowsOut: number;
  ms: number;
  access?: AccessTrace;
}
export interface QueryResult {
  columns: string[];
  rows: Value[][];
  affected: number;
  ms: number;
  trace: Trace[];
  message: string;
}
export interface SchemaTable {
  name: string;
  columns: Column[];
  rowCount: number;
  indexes: IndexDefinition[];
}
