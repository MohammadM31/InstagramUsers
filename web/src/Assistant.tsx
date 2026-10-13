import {useState,useRef} from 'react';import type {FormEvent} from 'react';import {api} from './api';import {ICONS} from './icons';
type R={type:string;text:string;data?:any};
function Result({r}:{r:R}){const d=r.data||{};
 if(r.type==='image'&&d.url)return <><img src={d.url} alt="Generated"/><div className="row"><span className="mu">{r.text}</span><a className="btn s" href={d.url} download="post.png">Save</a></div></>;
 if(r.type==='analytics')return <>
  <div className="ring"><i>{d.health.score}</i></div><p style={{textAlign:'center'}}><b>{r.text}</b></p>
  <div className="row"><span>Reach 30d <b>{d.metrics.reach30d.toLocaleString()}</b></span><span>Engagement <b>{d.metrics.er}%</b></span><span>Reach change <b>{d.metrics.reachChange}%</b></span></div>
  {d.top.map((t:any,i:number)=><p key={i}>• {t.text}</p>)}</>;
 if(r.type==='finance')return <><span className="tag">${d.capital.toLocaleString()} suggested split</span>
  {d.money.map((m:any)=><div key={m.area}><div className="row" style={{margin:0}}><span>{m.area}</span><b>${m.amount}</b></div><div className="bar"><div style={{width:m.share+'%'}}/></div></div>)}
  {d.time.map((t:string,i:number)=><p key={i}>{t}</p>)}</>;
 return <><p style={{margin:0}}>{r.text}</p>{d.more?.map((t:any,i:number)=><p key={i} className="mu">{t.text}</p>)}</>}

// One input, one result card. A new request REPLACES the previous card: no chat thread.
export default function Assistant(){const[m,setM]=useState(''),[r,setR]=useState<R|null>(null),[b,setB]=useState(false),[ref,setRef]=useState(''),f=useRef<HTMLInputElement>(null),seq=useRef(0);
 const pick=(e:any)=>{const x=e.target.files?.[0];if(!x)return;const fr=new FileReader();fr.onload=()=>setRef(String(fr.result));fr.readAsDataURL(x)};
 const send=async(e:FormEvent)=>{e.preventDefault();if(!m.trim()||b)return;setB(true);
  const id=++seq.current; // a newer request replaces this card, so an older poll must stop
  try{const x=await api<R>('/assistant',{method:'POST',body:{message:m,referenceImage:ref||undefined}});setR(x);
   if(x.type==='image'&&x.data?.jobId)await poll(x.data.jobId,id)}catch(x:any){setR({type:'info',text:x.message})}
  setB(false);setM('');setRef('')};
 // 0.8: image jobs run on the queue. Poll every 2s for up to 60s, same as Content AI.
 const poll=async(jobId:string,id:number)=>{for(let i=1;i<=30;i++){await new Promise(r=>setTimeout(r,2000));if(id!==seq.current)return;
   const s=await api<any>('/content/image/'+jobId);
   if(s.status==='done'){setR({type:'image',text:'Here you go.',data:{url:s.images[0]}});return}
   if(s.status==='failed'){setR({type:'info',text:'Image generation failed: '+(s.error||'try again')});return}
   setR({type:'image',text:'Generating your image… '+i*2+'s',data:{jobId}})}
  setR({type:'info',text:'Still generating after 60s. Try again in a moment.'})};
 const go=(t:string)=>setM(t);
 return <div className="composer">{r&&<div className="card result"><Result r={r}/></div>}
  {!r&&!m&&<div className="chips">{['How am I doing?','What should I do next?','Budget $1000','Image of a coffee cup'].map(c=><button key={c} onClick={()=>go(c)}>{c}</button>)}</div>}
  <form onSubmit={send}><input ref={f} type="file" accept="image/*" hidden onChange={pick}/><button type="button" className={ref?'on':''} aria-label="Attach product photo" title="Attach a product photo to edit" onClick={()=>f.current?.click()}>{ICONS.clip}</button><input value={m} onChange={e=>setM(e.target.value)} placeholder="Ask for analytics, an image, ideas, a budget…"/><button disabled={b||!m.trim()}>{b?'…':'Send'}</button></form></div>}
