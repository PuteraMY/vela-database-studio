import { SqlError, type Token } from './types';
export function tokenize(sql:string):Token[] {
  const tokens:Token[]=[];
  let i=0,line=1,column=1;
  const advance=()=>{const c=sql[i++]; if(c==='\n'){line++;column=1;}else column++;return c;};
  while(i<sql.length){
    const c=sql[i];
    if(/\s/.test(c)){advance();continue;}
    if(sql.slice(i,i+2)==='--'){while(i<sql.length&&sql[i]!=='\n')advance();continue;}
    const pos={offset:i,line,column};
    if(sql.slice(i,i+2)==='/*'){
      advance();advance();while(i<sql.length&&sql.slice(i,i+2)!=='*/')advance();
      if(i===sql.length)throw new SqlError('Komen tidak ditutup.',pos,'*/');
      advance();advance();continue;
    }
    if(c==="'"||c==='"'||c==='`'||c==='['){
      const end=c==='['?']':c;advance();let value='',closed=false;
      while(i<sql.length){const ch=advance();if(ch===end){if(sql[i]===end){value+=advance();}else{closed=true;break;}}else value+=ch;}
      if(!closed)throw new SqlError('Teks tidak ditutup.',pos,end);
      tokens.push({...pos,kind:c==="'"?'string':'word',text:sql.slice(pos.offset,i),value:c==="'"?value:value.toLowerCase()});continue;
    }
    const num=sql.slice(i).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/);
    if(num){for(let k=0;k<num[0].length;k++)advance();tokens.push({...pos,kind:'number',text:num[0],value:num[0]});continue;}
    const word=sql.slice(i).match(/^[\p{L}_][\p{L}\p{N}_$]*/u);
    if(word){for(let k=0;k<word[0].length;k++)advance();tokens.push({...pos,kind:'word',text:word[0],value:word[0].toLowerCase()});continue;}
    const pair=sql.slice(i,i+2);
    if(['<=','>=','!=','<>','||','=='].includes(pair)){advance();advance();tokens.push({...pos,kind:'symbol',text:pair,value:pair});continue;}
    if('(),;.*+-/%=<>'.includes(c)){advance();tokens.push({...pos,kind:'symbol',text:c,value:c});continue;}
    throw new SqlError(`Aksara “${c}” tidak dikenali.`,pos,'token SQL');
  }
  tokens.push({kind:'eof',text:'',value:'',offset:i,line,column});return tokens;
}
