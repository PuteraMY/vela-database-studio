/// <reference lib="webworker" />
import { Database } from '../engine/database';
import { createDataset, generatedTable } from '../engine/datasets';
import { csvTable } from '../engine/csv';
import { parse } from '../engine/parser';
import { SqlError, type DatabaseState } from '../engine/types';
import type { Request, Response, Comparison } from './protocol';
let db=new Database();
const sqlValue=(v:unknown)=>v===null?'NULL':typeof v==='string'?`'${v.replace(/'/g,"''")}'`:typeof v==='boolean'?Number(v):String(v);
async function sqliteCompare(state:DatabaseState,sql:string,velaRows:unknown,velaMs:number):Promise<Comparison>{
 const [{default:initSqlJs},{default:wasmUrl}]=await Promise.all([import('sql.js'),import('sql.js/dist/sql-wasm.wasm?url')]);
 const SQL=await initSqlJs({locateFile:()=>wasmUrl}),sqlite=new SQL.Database();
 try{
  for(const table of state.tables){sqlite.run(`CREATE TABLE "${table.name.replace(/"/g,'""')}" (${table.columns.map(c=>`"${c.name.replace(/"/g,'""')}" ${c.type}`).join(',')})`);for(let i=0;i<table.rows.length;i+=500){sqlite.run(`INSERT INTO "${table.name.replace(/"/g,'""')}" VALUES ${table.rows.slice(i,i+500).map(r=>`(${table.columns.map(c=>sqlValue(r[c.name])).join(',')})`).join(',')}`);}}
  const start=performance.now(),results=sqlite.exec(sql),sqliteMs=performance.now()-start;
  const match=JSON.stringify(results.map(r=>r.values))===JSON.stringify(velaRows);
  return {match,velaMs,sqliteMs,detail:match?'Semua nilai dan susunan baris sepadan.':'Hasil berbeza. Semak susunan ORDER BY dan jenis nilai.'};
 }finally{sqlite.close();}
}
let chain=Promise.resolve();
self.onmessage=(event:MessageEvent<Request>)=>{chain=chain.then(async()=>{
 const req=event.data;const response:Response={id:req.id,schema:[]};
 try{
  if(req.type==='load')db=createDataset(req.dataset);
  else if(req.type==='generate'){const state=db.export();state.tables=state.tables.filter(t=>t.name!=='data_janaan');state.tables.push(generatedTable(req.count));db.restore(state);}
  else if(req.type==='import'){const state=db.export();let n=1;while(state.tables.some(t=>t.name===`import_csv_${n}`))n++;state.tables.push(csvTable(req.csv,`import_csv_${n}`));db.restore(state);}
  else{
   if(req.compare&&parse(req.sql).some(s=>s.kind!=='select'))throw new SqlError('Banding SQLite hanya menerima pernyataan SELECT.');
   const state=req.compare?db.export():undefined;response.results=db.execute(req.sql);
   if(state)response.comparison=await sqliteCompare(state,req.sql,response.results.map(r=>r.rows),response.results.reduce((n,r)=>n+r.ms,0));
  }
 }catch(e){response.error={message:e instanceof Error?e.message:'Ralat enjin tidak diketahui.',offset:e instanceof SqlError?e.position.offset:0};}
 response.schema=db.schema();self.postMessage(response);
 });};
