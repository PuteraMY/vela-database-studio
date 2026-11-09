import { SqlError, type Expr, type Row, type Value } from './types';
export const aggregates=new Set(['count','sum','avg','min','max']);
export const normalize=(v:Value):number|string|null=>typeof v==='boolean'?Number(v):v;
export function truth(v:Value):boolean|null {return v===null?null:typeof v==='string'?Number.parseFloat(v)!==0&&!Number.isNaN(Number.parseFloat(v)):Boolean(v);}
export function compare(a:Value,b:Value):number {const x=normalize(a),y=normalize(b);if(x===y)return 0;if(x===null)return -1;if(y===null)return 1;if(typeof x!==typeof y)return typeof x==='number'?-1:1;return x<y?-1:1;}
export const equal=(a:Value,b:Value):Value=>a===null||b===null?null:compare(a,b)===0;
export function logic(op:string,a:Value,b:Value):Value {const x=truth(a),y=truth(b);if(op==='AND')return x===false||y===false?false:x===null||y===null?null:true;return x===true||y===true?true:x===null||y===null?null:false;}
const num=(v:Value)=>typeof v==='number'?v:typeof v==='boolean'?Number(v):Number.parseFloat(v??'')||0;
export function binary(op:string,a:Value,b:Value):Value {
  if(op==='AND'||op==='OR')return logic(op,a,b);
  if(op==='IS'||op==='IS NOT'){const same=a===null&&b===null||a!==null&&b!==null&&compare(a,b)===0;return op==='IS'?same:!same;}
  if(a===null||b===null)return null;
  const c=compare(a,b);
  switch(op){
    case '=':case '==':return c===0;case '!=':case '<>':return c!==0;case '<':return c<0;case '>':return c>0;case '<=':return c<=0;case '>=':return c>=0;
    case '+':return num(a)+num(b);case '-':return num(a)-num(b);case '*':return num(a)*num(b);
    case '/':return num(b)===0?null:Number.isInteger(num(a))&&Number.isInteger(num(b))?Math.trunc(num(a)/num(b)):num(a)/num(b);
    case '%':return Math.trunc(num(b))===0?null:Math.trunc(num(a))%Math.trunc(num(b));case '||':return String(normalize(a))+String(normalize(b));
    case 'LIKE':{const pattern=String(b).replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/%/g,'[\\s\\S]*').replace(/_/g,'[\\s\\S]');return new RegExp(`^${pattern}$`,'i').test(String(a));}
    default:throw new SqlError(`Operator “${op}” tidak disokong.`);
  }
}
export function walk(expr:Expr,fn:(e:Expr)=>void):void {
  fn(expr);switch(expr.kind){
    case 'unary':walk(expr.expr,fn);break;
    case 'binary':walk(expr.left,fn);walk(expr.right,fn);break;
    case 'in':walk(expr.expr,fn);expr.values.forEach(e=>walk(e,fn));break;
    case 'between':walk(expr.expr,fn);walk(expr.low,fn);walk(expr.high,fn);break;
    case 'call':expr.args.forEach(e=>walk(e,fn));break;
    case 'case':if(expr.base)walk(expr.base,fn);expr.branches.forEach(b=>{walk(b.when,fn);walk(b.then,fn);});walk(expr.otherwise,fn);break;
  }
}
export function hasAggregate(expr:Expr){let found=false;walk(expr,e=>{if(e.kind==='call'&&aggregates.has(e.name))found=true;});return found;}
export function columnValue(row:Row,name:string,table?:string):Value {
  const key=table?`${table}.${name}`:name;
  if(Object.hasOwn(row,key))return row[key];
  if(!table){const keys=Object.keys(row).filter(k=>k.endsWith(`.${name}`));if(keys.length===1)return row[keys[0]];if(keys.length>1)throw new SqlError(`Lajur “${name}” kabur. Gunakan nama jadual.`);}
  throw new SqlError(`Lajur “${key}” tidak wujud.`);
}
const functionArity:Record<string,[number,number]>={abs:[1,1],round:[1,2],floor:[1,1],ceil:[1,1],ceiling:[1,1],sqrt:[1,1],power:[2,2],mod:[2,2],length:[1,1],lower:[1,1],upper:[1,1],trim:[1,2],ltrim:[1,2],rtrim:[1,2],substr:[2,3],substring:[2,3],replace:[3,3],coalesce:[2,Infinity],ifnull:[2,2],nullif:[2,2],date:[1,1],datetime:[1,1],strftime:[2,2],typeof:[1,1]};
export function validateFunction(e:Extract<Expr,{kind:'call'}>){
  const arity=aggregates.has(e.name)?[1,1]:functionArity[e.name];
  if(!arity)throw new SqlError(`Fungsi “${e.name.toUpperCase()}” tidak disokong.`);
  if(e.args.length<arity[0]||e.args.length>arity[1])throw new SqlError(`Bilangan argumen untuk ${e.name.toUpperCase()} tidak sah.`);
  if(e.args.some(x=>x.kind==='star')&&(e.name!=='count'||e.distinct))throw new SqlError('Hanya COUNT(*) menerima tanda *.');
}
function scalar(name:string,a:Value[]):Value {
  if(name==='coalesce'||name==='ifnull')return a.find(x=>x!==null)??null;
  if(name==='nullif')return equal(a[0],a[1])===true?null:a[0];
  if(name==='typeof')return a[0]===null?'null':typeof a[0]==='string'?'text':Number.isInteger(num(a[0]))?'integer':'real';
  if(a.some(v=>v===null))return null;
  const s=String(a[0]),n=num(a[0]);
  switch(name){
    case 'abs':return Math.abs(n);case 'floor':return Math.floor(n);case 'ceil':case 'ceiling':return Math.ceil(n);case 'sqrt':return n<0?null:Math.sqrt(n);case 'power':return Math.pow(n,num(a[1]));case 'mod':return num(a[1])===0?null:n%num(a[1]);
    case 'round':{const p=10**Math.max(0,Math.min(15,num(a[1]??0)));return Math.sign(n)*Math.round(Math.abs(n)*p)/p;}
    case 'length':return Array.from(s).length;case 'lower':return s.replace(/[A-Z]/g,c=>c.toLowerCase());case 'upper':return s.replace(/[a-z]/g,c=>c.toUpperCase());
    case 'trim':case 'ltrim':case 'rtrim':{const chars=a[1]===undefined?' ':String(a[1]);let start=0,end=s.length;if(name!=='rtrim')while(start<end&&chars.includes(s[start]))start++;if(name!=='ltrim')while(end>start&&chars.includes(s[end-1]))end--;return s.slice(start,end);}
    case 'substr':case 'substring':{const chars=Array.from(s),start=num(a[1]),index=start>0?start-1:start<0?Math.max(0,chars.length+start):0;let length=a[2]===undefined?chars.length:num(a[2]);if(start===0&&length>0)length--;return length<0?chars.slice(Math.max(0,index+length),index).join(''):chars.slice(index,index+length).join('');}
    case 'replace':return String(a[1])===''?s:s.split(String(a[1])).join(String(a[2]));
    case 'date':case 'datetime':case 'strftime':{
      const input=name==='strftime'?String(a[1]):s;const date=new Date(input==='now'?Date.now():input.length===10?`${input}T00:00:00Z`:input.endsWith('Z')?input:input.replace(' ','T')+'Z');
      if(Number.isNaN(date.getTime()))return null;const iso=date.toISOString();if(name==='date')return iso.slice(0,10);if(name==='datetime')return iso.slice(0,19).replace('T',' ');
      const parts:Record<string,string>={'%Y':iso.slice(0,4),'%m':iso.slice(5,7),'%d':iso.slice(8,10),'%H':iso.slice(11,13),'%M':iso.slice(14,16),'%S':iso.slice(17,19),'%w':String(date.getUTCDay()),'%s':String(Math.floor(date.getTime()/1000)),'%%':'%'};
      let valid=true;const result=s.replace(/%./g,k=>{if(!(k in parts))valid=false;return parts[k]??'';});return valid?result:null;
    }
    default:throw new SqlError(`Fungsi “${name}” tidak disokong.`);
  }
}
export function evaluate(e:Expr,row:Row={},group?:Row[]):Value {
  switch(e.kind){
    case 'literal':return e.value;
    case 'column':return columnValue(row,e.name,e.table);
    case 'star':throw new SqlError('Tanda * tidak sah dalam ungkapan ini.');
    case 'unary':{const v=evaluate(e.expr,row,group);return e.op==='NOT'?truth(v)===null?null:!truth(v):v===null?null:e.op==='-'?-num(v):num(v);}
    case 'binary':return binary(e.op,evaluate(e.left,row,group),evaluate(e.right,row,group));
    case 'between':{const v=evaluate(e.expr,row,group);const result=logic('AND',binary('>=',v,evaluate(e.low,row,group)),binary('<=',v,evaluate(e.high,row,group)));return e.not&&result!==null?!result:result;}
    case 'in':{const v=evaluate(e.expr,row,group);let result:Value=false;for(const item of e.values){const eq=equal(v,evaluate(item,row,group));if(eq===true){result=true;break;}if(eq===null)result=null;}return e.not&&result!==null?!result:result;}
    case 'case':{const base=e.base?evaluate(e.base,row,group):undefined;for(const b of e.branches){const when=evaluate(b.when,row,group);if(base===undefined?truth(when)===true:equal(base,when)===true)return evaluate(b.then,row,group);}return evaluate(e.otherwise,row,group);}
    case 'call':{
      validateFunction(e);
      if(aggregates.has(e.name)){
        if(!group)throw new SqlError('Fungsi agregat tidak sah di sini.');
        if(e.name==='count'&&e.args[0].kind==='star')return group.length;
        let values=group.map(r=>evaluate(e.args[0],r)).filter((v):v is Exclude<Value,null>=>v!==null);
        if(e.distinct)values=[...new Map(values.map(v=>[JSON.stringify(normalize(v)),v])).values()];
        if(e.name==='count')return values.length;if(!values.length)return null;
        if(e.name==='sum'||e.name==='avg'){const sum=values.reduce<number>((n,v)=>n+num(v),0);return e.name==='sum'?sum:sum/values.length;}
        return values.reduce((a,b)=>(e.name==='min'?compare(a,b)<=0:compare(a,b)>=0)?a:b);
      }
      return scalar(e.name,e.args.map(a=>evaluate(a,row,group)));
    }
  }
}
export function expressionName(e:Expr):string {
  switch(e.kind){case 'column':return e.name;case 'literal':return e.value===null?'NULL':String(e.value);case 'star':return '*';case 'call':return `${e.name.toUpperCase()}(${e.distinct?'DISTINCT ':''}${e.args.map(expressionName).join(', ')})`;case 'unary':return `${e.op} ${expressionName(e.expr)}`;case 'binary':return `${expressionName(e.left)} ${e.op} ${expressionName(e.right)}`;default:return e.kind.toUpperCase();}
}
