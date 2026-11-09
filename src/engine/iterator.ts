import type { Row, Trace, Value } from './types';
export interface Frame {row:Row;group?:Row[];values?:Value[];sort?:Value[]}
/** A pull-based Volcano operator. Blocking operators still expose next(). */
export class Operator implements Iterable<Frame> {
  readonly trace:Trace;
  private iterator:Iterator<Frame>|undefined;
  constructor(id:number,name:string,detail:string,public inputs:Operator[],private produce:()=>Generator<Frame>){
    this.trace={id,operator:name,detail,rowsIn:0,rowsOut:0,ms:0};inputs.forEach(x=>{x.trace.parent=id;});
  }
  next():IteratorResult<Frame>{
    this.iterator??=this.produce();const start=performance.now();
    try{const result=this.iterator.next();if(!result.done)this.trace.rowsOut++;return result;}
    finally{this.trace.ms+=performance.now()-start;this.trace.rowsIn=this.inputs.reduce((n,o)=>n+o.trace.rowsOut,0);}
  }
  [Symbol.iterator](){return this;}
}
