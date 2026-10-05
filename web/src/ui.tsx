import {ReactNode,useState} from 'react';
export const St=({l,e,empty,children}:{l:boolean;e:string;empty?:boolean;children:ReactNode})=>
 l?<div><div className="sk"/><div className="sk" style={{marginTop:8}}/></div>:e?<div className="st dn">⚠ {e}</div>:empty?<div className="st">📭 No data yet. Seed demo data or connect Instagram.</div>:<>{children}</>;
export const Card=({t,tip,full,children}:{t:string;tip?:string;full?:boolean;children:ReactNode})=><div className={'card'+(full?' full':'')}><h3 title={tip||t}>{t} ⓘ</h3>{children}</div>;
export const Kpi=({n,v,d,tip}:{n:string;v:any;d?:number;tip:string})=><div className="card" title={tip}><h3>{n} ⓘ</h3><div className="v">{v}</div>{d!==undefined&&<span className={d>0?'up':d<0?'dn':'mu'}>{d>0?'↑':d<0?'↓':'→'} {Math.abs(d)}% vs prev. 30d</span>}</div>;
const cmp=(a:any,b:any)=>{const x=parseFloat(a),y=parseFloat(b);return !isNaN(x)&&!isNaN(y)?x-y:String(a).localeCompare(String(b))};
export function DataTable({cols,rows,onRow,name='export'}:{cols:{k:string;l:string;f?:(v:any,r:any)=>ReactNode}[];rows:any[];onRow?:(r:any)=>void;name?:string}){
 const[q,setQ]=useState(''),[s,setS]=useState(''),[d,setD]=useState(1);
 let r=rows.filter(x=>JSON.stringify(x).toLowerCase().includes(q.toLowerCase()));if(s)r=[...r].sort((a,b)=>cmp(a[s],b[s])*d);
 const csv=()=>{const t=[cols.map(c=>c.l),...r.map(x=>cols.map(c=>JSON.stringify(x[c.k]??'')))].map(a=>a.join(',')).join('\n'),a=document.createElement('a');a.href='data:text/csv,'+encodeURIComponent(t);a.download=name+'.csv';a.click()};
 return <><div className="row"><input placeholder="Filter…" value={q} onChange={e=>setQ(e.target.value)}/><button className="btn g s" onClick={csv}>CSV</button><span className="mu">{r.length} rows</span></div>
 <div className="sc"><table><thead><tr>{cols.map(c=><th key={c.k} onClick={()=>{setS(c.k);setD(s===c.k?-d:1)}}>{c.l}{s===c.k?(d>0?' ↑':' ↓'):''}</th>)}</tr></thead>
 <tbody>{r.map((x,i)=><tr key={i} className={onRow?'c':''} onClick={()=>onRow?.(x)}>{cols.map(c=><td key={c.k}>{c.f?c.f(x[c.k],x):String(x[c.k]??'—')}</td>)}</tr>)}</tbody></table></div></>}
