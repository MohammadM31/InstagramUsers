import {useState} from 'react';import type {FormEvent} from 'react';import {api} from './api';
type R={type:string;text:string;data?:any};
function Result({r}:{r:R}){const d=r.data||{};
 if(r.type==='image'&&d.url)return <><img src={d.url} alt="Generated"/><p>{r.text}</p></>;
 if(r.type==='analytics')return <>
  <div className="ring"><i>{d.health.score}</i></div><p style={{textAlign:'center'}}><b>{r.text}</b></p>
  <div className="row"><span>Reach 30d <b>{d.metrics.reach30d.toLocaleString()}</b></span><span>Engagement <b>{d.metrics.er}%</b></span><span>Reach change <b>{d.metrics.reachChange}%</b></span></div>
  {d.top.map((t:any,i:number)=><p key={i}>• {t.text}</p>)}</>;
 if(r.type==='finance')return <><span className="tag">${d.capital.toLocaleString()} suggested split</span>
  {d.money.map((m:any)=><div key={m.area}><div className="row" style={{margin:0}}><span>{m.area}</span><b>${m.amount}</b></div><div className="bar"><div style={{width:m.share+'%'}}/></div></div>)}
  {d.time.map((t:string,i:number)=><p key={i}>{t}</p>)}</>;
 return <><p style={{margin:0}}>{r.text}</p>{d.more?.map((t:any,i:number)=><p key={i} className="mu">{t.text}</p>)}</>}

// One input, one result card. A new request REPLACES the previous card: no chat thread.
export default function Assistant(){const[m,setM]=useState(''),[r,setR]=useState<R|null>(null),[b,setB]=useState(false);
 const send=async(e:FormEvent)=>{e.preventDefault();if(!m.trim()||b)return;setB(true);
  try{setR(await api<R>('/assistant',{method:'POST',body:{message:m}}))}catch(x:any){setR({type:'info',text:x.message})}
  setB(false);setM('')};
 return <div className="composer">{r&&<div className="card result"><Result r={r}/></div>}
  <form onSubmit={send}><input value={m} onChange={e=>setM(e.target.value)} placeholder="Ask for analytics, an image, ideas, a budget…"/><button disabled={b||!m.trim()}>{b?'…':'Send'}</button></form></div>}
