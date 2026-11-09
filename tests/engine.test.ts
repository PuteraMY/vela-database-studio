import {describe,it,expect} from 'vitest';
import {Database} from '../src/engine/database';
import {tokenize} from '../src/engine/tokenizer';
import {parse} from '../src/engine/parser';
import {logic,normalize} from '../src/engine/expression';
import {cases,fixture} from './cases';
import type {Value} from '../src/engine/types';
describe('curated SQL semantics',()=>{it.each(cases)('%s',(sql,expected)=>{const db=new Database();db.execute(fixture);expect(db.execute(sql)[0].rows).toEqual(expected);});});
describe('tokenizer',()=>{
 it.each(['SELECT','table_1','nama','murid.id','1','2.3','.5','1e3',"'teks'",'"select"','`nama`','[nama]','<=','>=','<>','!=','||','-- comment\nSELECT','/* comment */ SELECT',"'it''s'"])('tokenizes %s',sql=>{expect(tokenize(sql).length).toBeGreaterThan(1);});
 it.each(["'open",'"open','/* open','@','!','[open'])('rejects %s',sql=>expect(()=>tokenize(sql)).toThrow(/Baris/));
 it('tracks precise lines and columns',()=>{expect(tokenize('SELECT\n  nama')[1]).toMatchObject({line:2,column:3,offset:9});});
 it('ignores comment tokens',()=>expect(tokenize('-- x\n/* y */').length).toBe(1));
});
describe('parser',()=>{
 it.each(['SELECT FROM','SELECT (1','SELECT 1 +','SELECT * FROM a RIGHT JOIN b ON a.id=b.id','CREATE TABLE t (a BLOB)','SELECT * FROM a JOIN b','SELECT COUNT(','SELECT 1; bad','SELECT 1 OVER ()','INSERT INTO t VALUES (1,)', 'DELETE t','UPDATE t x = 1','CREATE INDEX x t(a)','SELECT CASE END','SELECT 1 ORDER id'])('rejects invalid SQL %s',sql=>expect(()=>parse(sql)).toThrow(/Baris/));
 it('parses multiple statements and comments',()=>expect(parse('SELECT 1; --a\n SELECT 2;;')).toHaveLength(2));
 it('rejects five-table joins',()=>expect(()=>parse('SELECT * FROM a,b,c,d,e')).toThrow(/empat/));
});
describe('three-valued logic',()=>{
 const values:Value[]=[false,true,null];
 const and=[[false,false,false],[false,true,null],[false,null,null]];
 const or=[[false,true,null],[true,true,true],[null,true,null]];
 for(let i=0;i<3;i++)for(let j=0;j<3;j++)for(const op of ['AND','OR'])it(`${values[i]} ${op} ${values[j]}`,()=>expect(logic(op,values[i],values[j])).toBe((op==='AND'?and:or)[i][j]));
 it('normalizes booleans',()=>expect(normalize(true)).toBe(1));
});
describe('DDL, mutation atomicity and constraints',()=>{
 const newDb=()=>{const db=new Database();db.execute(fixture);return db;};
 it.each([
  'INSERT INTO murid VALUES (1,\'X\',10,1,TRUE)',
  'INSERT INTO murid VALUES (9,NULL,10,1,TRUE)',
  'INSERT INTO murid VALUES (9,\'X\',10,99,TRUE)',
  'INSERT INTO murid VALUES (9,\'X\',1.5,1,TRUE)',
  'INSERT INTO murid VALUES (9,\'X\',10,1,2)',
  'INSERT INTO murid VALUES (9,\'X\',10,1)',
  'INSERT INTO murid (missing) VALUES (1)',
  'INSERT INTO murid (id,id) VALUES (8,9)',
  'UPDATE murid SET id = 1 WHERE id = 2',
  'UPDATE murid SET nama = NULL',
  'UPDATE murid SET kelas_id = 99',
  'DELETE FROM kelas WHERE id = 1',
  'UPDATE kelas SET id = 99 WHERE id = 1',
  'DROP TABLE kelas',
  'CREATE TABLE murid (id INTEGER)',
  'CREATE TABLE test (id INTEGER, id TEXT)',
  'CREATE TABLE test (id INTEGER PRIMARY KEY, x INTEGER PRIMARY KEY)',
  'CREATE UNIQUE INDEX dup ON murid(kelas_id)',
  'CREATE INDEX idx ON murid(missing)',
  'DROP INDEX missing',
  'DROP TABLE missing',
  'UPDATE murid SET missing = 1',
  'SELECT missing FROM murid WHERE 0',
  'SELECT id FROM murid m JOIN kelas k ON m.kelas_id=k.id',
  'SELECT NOPE(1)',
  'SELECT SUM(COUNT(*)) FROM murid',
  'SELECT id FROM murid WHERE COUNT(*) > 0',
  'SELECT id FROM murid LIMIT NULL',
 ])('rejects atomically: %s',sql=>{const db=newDb(),before=db.export();expect(()=>db.execute(sql)).toThrow();expect(db.export()).toEqual(before);});
 it('rolls back all rows in a multi-row insert',()=>{const db=newDb();expect(()=>db.execute("INSERT INTO kelas VALUES (4,'Lain'),(1,'Duplikat')")).toThrow();expect(db.schema()[0].rowCount).toBe(3);});
 it('applies defaults and omitted nullable values',()=>{const db=newDb();db.execute("INSERT INTO murid (id,nama) VALUES (6,'Farah')");expect(db.execute('SELECT markah, aktif FROM murid WHERE id=6')[0].rows).toEqual([[null,1]]);});
 it('supports update expressions evaluated against old row',()=>{const db=newDb();db.execute('UPDATE murid SET markah=markah+10 WHERE id=1');expect(db.execute('SELECT markah FROM murid WHERE id=1')[0].rows).toEqual([[100]]);});
 it('deletes with unknown predicates excluded',()=>{const db=newDb();expect(db.execute('DELETE FROM murid WHERE markah < 80')[0].affected).toBe(2);});
 it('supports index catalog lifecycle',()=>{const db=newDb();db.execute('CREATE INDEX idx ON murid(markah)');expect(db.schema()[1].indexes).toHaveLength(1);db.execute('DROP INDEX idx');expect(db.schema()[1].indexes).toHaveLength(0);});
 it('allows multiple NULLs in UNIQUE columns',()=>{const db=new Database();db.execute('CREATE TABLE t (id INTEGER UNIQUE); INSERT INTO t VALUES(NULL),(NULL)');expect(db.schema()[0].rowCount).toBe(2);});
 it('enforces table-level constraints',()=>{const db=new Database();db.execute('CREATE TABLE t (id INTEGER, PRIMARY KEY(id))');expect(()=>db.execute('INSERT INTO t VALUES(NULL)')).toThrow();});
 it('supports IF EXISTS variants',()=>{const db=newDb();db.execute('CREATE TABLE IF NOT EXISTS murid (id INTEGER); DROP TABLE IF EXISTS absent; DROP INDEX IF EXISTS absent');});
 it('round-trips state',()=>{const db=newDb(),copy=new Database();copy.restore(db.export());expect(copy.execute('SELECT * FROM murid')).toMatchObject([{rows:db.execute('SELECT * FROM murid')[0].rows}]);});
 it('records pull counts and stops scans at LIMIT',()=>{const db=newDb(),r=db.execute('SELECT id FROM murid LIMIT 2')[0];expect(r.trace[0].rowsOut).toBe(2);expect(r.trace.at(-1)?.rowsOut).toBe(2);expect(r.trace.every(t=>t.ms>=0)).toBe(true);});
 it('exposes real traces through EXPLAIN ANALYZE',()=>{const db=newDb();expect(db.execute('EXPLAIN ANALYZE SELECT * FROM murid')[0].trace.length).toBeGreaterThan(1);});
});
