import { tokenize } from './tokenizer';
import { SqlError, type Token, type Expr, type Statement, type Column, type Select, type Source } from './types';
const reserved=new Set('from where group having order limit offset join inner left right full natural outer cross on asc desc nulls first last union intersect except when then else end as set values and or not in between like is over returning'.split(' '));
const literal=(value:null|number|string|boolean):Expr=>({kind:'literal',value});
export class Parser {
  private i=0;
  private tokens:Token[];
  constructor(sql:string){this.tokens=tokenize(sql);}
  private get t(){return this.tokens[this.i];}
  private is(s:string){return this.t.value===s.toLowerCase()&&this.t.kind!=='string'&&!['"','`','['].includes(this.t.text[0]);}
  private eat(s:string){if(this.is(s)){this.i++;return true;}return false;}
  private fail(expected:string):never{throw new SqlError(`Token ${this.t.kind==='eof'?'akhir input':`“${this.t.text}”`} tidak dijangka.`,this.t,expected);}
  private need(s:string){if(!this.eat(s))this.fail(s.toUpperCase());}
  private name(){if(this.t.kind!=='word')return this.fail('nama');return this.tokens[this.i++].value;}
  private list<T>(f:()=>T):T[]{const out=[f()];while(this.eat(','))out.push(f());return out;}
  parse():Statement[]{const out:Statement[]=[];while(this.t.kind!=='eof'){if(this.eat(';'))continue;out.push(this.statement());if(!this.is(''))this.need(';');}return out;}
  private statement():Statement {
    if(this.is('select'))return this.select();
    if(this.eat('explain')){const analyze=this.eat('analyze');return {kind:'explain',analyze,query:this.select()};}
    if(this.eat('create')){
      const unique=this.eat('unique');
      if(this.eat('index')){let ifNotExists=false;if(this.eat('if')){this.need('not');this.need('exists');ifNotExists=true;}const name=this.name();this.need('on');const table=this.name();this.need('(');const columns=this.list(()=>this.name());this.need(')');return {kind:'createIndex',name,table,columns,unique,ifNotExists};}
      if(unique)this.fail('INDEX');this.need('table');let ifNotExists=false;if(this.eat('if')){this.need('not');this.need('exists');ifNotExists=true;}
      const name=this.name();this.need('(');const columns:Column[]=[];
      const constraints:{kind:string;names:string[];ref?:{table:string;column:string}}[]=[];
      do {
        if(this.eat('constraint'))this.name();
        if(this.is('primary')||this.is('foreign')||this.is('unique')){
          const kind=this.name();if(kind!=='unique')this.need('key');this.need('(');const names=this.list(()=>this.name());this.need(')');
          let ref:{table:string;column:string}|undefined;if(kind==='foreign'){this.need('references');const table=this.name();this.need('(');const column=this.name();this.need(')');ref={table,column};}
          if(names.length!==1)this.fail('kekangan satu lajur');constraints.push({kind,names,ref});continue;
        }
        const colName=this.name(),type=this.name().toUpperCase();
        if(!['INTEGER','REAL','TEXT','BOOLEAN'].includes(type))this.fail('INTEGER, REAL, TEXT atau BOOLEAN');
        const col:Column={name:colName,type:type as Column['type'],primary:false,notNull:false,unique:false};
        for(;;){
          if(this.eat('primary')){this.need('key');col.primary=true;col.unique=true;col.notNull=true;}
          else if(this.eat('not')){this.need('null');col.notNull=true;}
          else if(this.eat('null'))col.notNull=false;
          else if(this.eat('unique'))col.unique=true;
          else if(this.eat('default'))col.default=this.expr(8);
          else if(this.eat('references')){const table=this.name();this.need('(');const column=this.name();this.need(')');col.references={table,column};}
          else break;
        }
        columns.push(col);
      }while(this.eat(','));
      this.need(')');
      for(const c of constraints){const col=columns.find(x=>x.name===c.names[0]);if(!col)throw new SqlError(`Lajur “${c.names[0]}” tidak wujud.`);if(c.kind==='primary'){col.primary=true;col.notNull=true;col.unique=true;}if(c.kind==='unique')col.unique=true;if(c.ref)col.references=c.ref;}
      return {kind:'createTable',name,columns,ifNotExists};
    }
    if(this.eat('drop')){const isTable=this.eat('table');if(!isTable)this.need('index');let ifExists=false;if(this.eat('if')){this.need('exists');ifExists=true;}return {kind:isTable?'dropTable':'dropIndex',name:this.name(),ifExists};}
    if(this.eat('insert')){this.need('into');const table=this.name();let columns:string[]|undefined;if(this.eat('(')){columns=this.list(()=>this.name());this.need(')');}this.need('values');const values=this.list(()=>{this.need('(');const row=this.list(()=>this.expr());this.need(')');return row;});return {kind:'insert',table,columns,values};}
    if(this.eat('update')){const table=this.name();this.need('set');const sets=this.list(()=>{const column=this.name();this.need('=');return {column,expr:this.expr()};});const where=this.eat('where')?this.expr():undefined;return {kind:'update',table,sets,where};}
    if(this.eat('delete')){this.need('from');const table=this.name();const where=this.eat('where')?this.expr():undefined;return {kind:'delete',table,where};}
    return this.fail('SELECT, CREATE, DROP, INSERT, UPDATE atau DELETE');
  }
  private source():Source{const table=this.name();let alias=table;if(this.eat('as'))alias=this.name();else if(this.t.kind==='word'&&(!reserved.has(this.t.value)||['"','`','['].includes(this.t.text[0])))alias=this.name();return {table,alias};}
  private select():Select{
    this.need('select');const distinct=this.eat('distinct');if(!distinct)this.eat('all');
    const columns=this.list(()=>{const expr=this.expr();let alias:string|undefined;if(this.eat('as'))alias=this.name();else if(this.t.kind==='word'&&(!reserved.has(this.t.value)||['"','`','['].includes(this.t.text[0])))alias=this.name();return {expr,alias};});
    const q:Select={kind:'select',distinct,columns,joins:[],group:[],order:[]};
    if(this.eat('from')){
      q.from=this.source();
      while(this.is(',')||this.is('join')||this.is('inner')||this.is('left')||this.is('cross')){
        let kind:'INNER'|'LEFT'|'CROSS'='INNER';
        if(this.eat(','))kind='CROSS';else{if(this.eat('left')){kind='LEFT';this.eat('outer');}else if(this.eat('cross'))kind='CROSS';else this.eat('inner');this.need('join');}
        const source=this.source();const on=this.eat('on')?this.expr():undefined;if(kind!=='CROSS'&&!on)this.fail('ON');q.joins.push({kind,source,on});
        if(q.joins.length>3)throw new SqlError('Maksimum empat jadual bagi satu pertanyaan.',this.t);
      }
    }
    if(this.eat('where'))q.where=this.expr();
    if(this.eat('group')){this.need('by');q.group=this.list(()=>this.expr());}
    if(this.eat('having'))q.having=this.expr();
    if(this.eat('order')){this.need('by');q.order=this.list(()=>{const expr=this.expr();const desc=this.eat('desc');if(!desc)this.eat('asc');let nulls:'FIRST'|'LAST'|undefined;if(this.eat('nulls')){if(this.eat('first'))nulls='FIRST';else{this.need('last');nulls='LAST';}}return {expr,desc,nulls};});}
    if(this.eat('limit')){q.limit=this.expr();if(this.eat('offset'))q.offset=this.expr();else if(this.eat(',')){q.offset=q.limit;q.limit=this.expr();}}
    return q;
  }
  private expr(min=0):Expr{
    let left:Expr;
    if(this.eat('not'))left={kind:'unary',op:'NOT',expr:this.expr(3)};
    else if(this.is('+')||this.is('-')){const op=this.t.value;this.i++;left={kind:'unary',op,expr:this.expr(8)};}
    else if(this.eat('(')){left=this.expr();this.need(')');}
    else if(this.eat('*'))left={kind:'star'};
    else if(this.eat('null'))left=literal(null);
    else if(this.eat('true'))left=literal(true);
    else if(this.eat('false'))left=literal(false);
    else if(this.t.kind==='number'){left={kind:'literal',value:Number(this.t.value),real:/[.eE]/.test(this.t.value)};this.i++;}
    else if(this.t.kind==='string'){left=literal(this.t.value);this.i++;}
    else if(this.eat('case')){
      const base=this.is('when')?undefined:this.expr();const branches:{when:Expr;then:Expr}[]=[];
      while(this.eat('when')){const when=this.expr();this.need('then');branches.push({when,then:this.expr()});}
      if(!branches.length)this.fail('WHEN');const otherwise=this.eat('else')?this.expr():literal(null);this.need('end');left={kind:'case',base,branches,otherwise};
    }else if(this.t.kind==='word'&&(!reserved.has(this.t.value)||['"','`','['].includes(this.t.text[0]))){
      const name=this.name();
      if(this.eat('(')){const distinct=this.eat('distinct');const args=this.is(')')?[]:this.list(()=>this.expr());this.need(')');left={kind:'call',name,args,distinct};}
      else if(this.eat('.')){left=this.eat('*')?{kind:'star',table:name}:{kind:'column',table:name,name:this.name()};}
      else left={kind:'column',name};
    }else return this.fail('ungkapan, nama lajur atau nilai');
    const precedence:Record<string,number>={or:1,and:2,'=':3,'==':3,'!=':3,'<>':3,'<':4,'>':4,'<=':4,'>=':4,is:3,like:3,in:3,between:3,'+':5,'-':5,'*':6,'/':6,'%':6,'||':7};
    for(;;){
      const negated=this.is('not')&&['in','between','like'].includes(this.tokens[this.i+1].value);
      const op=negated?this.tokens[this.i+1].value:this.t.value;
      const p=precedence[op];if(p===undefined||p<min||this.t.kind==='string'||['"','`','['].includes(this.t.text[0]))break;
      this.i+=negated?2:1;
      if(op==='between'){const low=this.expr(p+1);this.need('and');const high=this.expr(p+1);left={kind:'between',expr:left,low,high,not:negated};}
      else if(op==='in'){this.need('(');const values=this.is(')')?[]:this.list(()=>this.expr());this.need(')');left={kind:'in',expr:left,values,not:negated};}
      else {let operator=op.toUpperCase();if(op==='is'&&this.eat('not'))operator='IS NOT';left={kind:'binary',op:operator,left,right:this.expr(p+1)};if(negated)left={kind:'unary',op:'NOT',expr:left};}
    }
    return left;
  }
}
export const parse=(sql:string)=>new Parser(sql).parse();
