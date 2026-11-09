import {useEffect} from 'react';
import {useStudio} from './state/studio';
export default function App(){const s=useStudio();useEffect(()=>{if(!useStudio.getState().ready&&!useStudio.getState().busy)void useStudio.getState().load('sekolah');},[]);return <main><h1>VELA — Studio Pangkalan Data</h1><textarea aria-label="Editor SQL" value={s.sql} onChange={e=>s.setSql(e.target.value)}/><button disabled={s.busy} onClick={()=>void s.run()}>Jalankan</button><pre>{s.error?.message??JSON.stringify(s.results.at(-1)?.rows,null,2)}</pre></main>;}
