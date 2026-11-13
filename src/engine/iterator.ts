import type { Row, Trace, Value } from "./types";
export interface Frame {
  row: Row;
  group?: Row[];
  values?: Value[];
  sort?: Value[];
}
/** A pull-based Volcano operator. Blocking operators still expose next(). */
export class Operator implements Iterable<Frame> {
  readonly trace: Trace;
  private iterator: Iterator<Frame> | undefined;
  private closed = false;
  constructor(
    id: number,
    name: string,
    detail: string,
    public inputs: Operator[],
    private produce: () => Generator<Frame>,
  ) {
    this.trace = { id, operator: name, detail, rowsIn: 0, rowsOut: 0, ms: 0 };
    inputs.forEach((x) => {
      x.trace.parent = id;
    });
  }
  next(): IteratorResult<Frame> {
    if (this.closed) return { done: true, value: undefined };
    this.iterator ??= this.produce();
    const start = performance.now();
    try {
      const result = this.iterator.next();
      if (!result.done) this.trace.rowsOut++;
      else this.return();
      return result;
    } catch (error) {
      try {
        this.return();
      } catch {
        // Preserve the execution error if cleanup also fails.
      }
      throw error;
    } finally {
      this.trace.ms += performance.now() - start;
      this.trace.rowsIn = this.inputs.reduce((n, o) => n + o.trace.rowsOut, 0);
    }
  }
  /** IteratorClose propagates through manual pulls (LIMIT) and nested operators. */
  return(): IteratorResult<Frame> {
    if (this.closed) return { done: true, value: undefined };
    this.closed = true;
    try {
      this.iterator?.return?.();
    } finally {
      for (const input of this.inputs) input.return();
    }
    return { done: true, value: undefined };
  }
  [Symbol.iterator]() {
    return this;
  }
}
