import type { Difference } from "./compare";
import type { Dataset } from "../engine/datasets";
import type { QueryResult, SchemaTable } from "../engine/types";
export type Request =
  | { id: number; type: "load"; dataset: Dataset }
  | { id: number; type: "run"; sql: string; compare: boolean }
  | { id: number; type: "import"; csv: string }
  | { id: number; type: "generate"; count: number };
export interface Comparison {
  match: boolean;
  velaMs: number;
  sqliteMs: number;
  detail: string;
  differences: Difference[];
}
export interface Response {
  id: number;
  schema: SchemaTable[];
  results?: QueryResult[];
  error?: { message: string; offset: number };
  comparison?: Comparison;
}
