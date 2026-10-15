import {useState,useRef,useEffect} from 'react';
import type {FormEvent} from 'react';
import {api} from './api';
import {ICONS} from './icons';

type R={type:string;text:string;data?:any};

function Result({r}:{r:R}){
  const d=r.data||{};
  if(r.type==='image'&&d.url)return <><img src={d.url} alt="Generated"/><div className="row"><span className="mu">{r.text}</span><a className="btn s" href={d.url} download="post.png">Save</a></div></>;
  if(r.type==='analytics')return <>
    <div className="ring"><i>{d.health.score}</i></div><p style={{textAlign:'center'}}><b>{r.text}</b></p>
    <div className="row"><span>Reach 30d <b>{d.metrics.reach30d.toLocaleString()}</b></span><span>Engagement <b>{d.metrics.er}%</b></span><span>Reach change <b>{d.metrics.reachChange}%</b></span></div>
    {d.top.map((t:any,i:number)=><p key={i}>• {t.text}</p>)}</>;
  if(r.type==='finance')return <><span className="tag">${d.capital.toLocaleString()} suggested split</span>
    {d.money.map((m:any)=><div key={m.area}><div className="row" style={{margin:0}}><span>{m.area}</span><b>${m.amount}</b></div><div className="bar"><div style={{width:m.share+'%'}}/></div></div>)}
    {d.time.map((t:string,i:number)=><p key={i}>{t}</p>)}</>;
  return <><p style={{margin:0}}>{r.text}</p>{d.more?.map((t:any,i:number)=><p key={i} className="mu">{t.text}</p>)}</>}

const BAR_KEY='rt:assistant:bar';
const POS_KEY='rt:assistant:pos';
const DOCKED_KEY='rt:assistant:docked';   // 'left' | 'right' | 'top' | 'bottom' | null
const SNAP=40;   // px from an edge that triggers docking on release
const CARD_W=380,CARD_H=220; // approx card size for clamping

type Dock='left'|'right'|'top'|'bottom'|null;

export default function Assistant(){
  const[m,setM]=useState(''),[r,setR]=useState<R|null>(null),[b,setB]=useState(false),[ref,setRef]=useState(''),
    f=useRef<HTMLInputElement>(null),seq=useRef(0);

  const[barHidden,setBarHidden]=useState(()=>localStorage.getItem(BAR_KEY)==='0');
  const[pos,setPos]=useState<{x:number;y:number}|null>(()=>{try{const s=localStorage.getItem(POS_KEY);return s?JSON.parse(s):null}catch{return null}});
  const[docked,setDocked]=useState<Dock>(()=>{
    const s=localStorage.getItem(DOCKED_KEY);
    return (s==='left'||s==='right'||s==='top'||s==='bottom')?s:null;
  });
  const[dragging,setDragging]=useState(false);
  const[edgeHint,setEdgeHint]=useState<Dock>(null); // which edge is highlighted while dragging
  const drag=useRef<{dx:number;dy:number}>({dx:0,dy:0});
  const cardRef=useRef<HTMLDivElement>(null);

  useEffect(()=>{localStorage.setItem(BAR_KEY,barHidden?'0':'1')},[barHidden]);
  useEffect(()=>{try{pos?localStorage.setItem(POS_KEY,JSON.stringify(pos)):localStorage.removeItem(POS_KEY)}catch{}},[pos]);
  useEffect(()=>{try{docked?localStorage.setItem(DOCKED_KEY,docked):localStorage.removeItem(DOCKED_KEY)}catch{}},[docked]);

  // X button — this is the ONLY thing that clears r
  const hideResponse=()=>{setR(null);setPos(null);setDocked(null)};

  // Hiding the bar does NOT clear r: the response is preserved and re-shown on unhide.
  const toggleBar=()=>setBarHidden(h=>!h);

  const pick=(e:any)=>{const x=e.target.files?.[0];if(!x)return;const fr=new FileReader();fr.onload=()=>setRef(String(fr.result));fr.readAsDataURL(x)};

  const send=async(e:FormEvent)=>{
    e.preventDefault();
    if(!m.trim()||b)return;
    setB(true);
    const id=++seq.current;
    // A new request resets any dock/position so the fresh card appears attached
    setPos(null);setDocked(null);
    try{
      const x=await api<R>('/assistant',{method:'POST',body:{message:m,referenceImage:ref||undefined}});
      setR(x);
      if(x.type==='image'&&x.data?.jobId)await poll(x.data.jobId,id);
    }catch(x:any){setR({type:'info',text:x.message})}
    setB(false);setM('');setRef('');
  };

  const poll=async(jobId:string,id:number)=>{
    for(let i=1;i<=30;i++){
      await new Promise(r=>setTimeout(r,2000));
      if(id!==seq.current)return;
      const s=await api<any>('/content/image/'+jobId);
      if(s.status==='done'){setR({type:'image',text:'Here you go.',data:{url:s.images[0]}});return}
      if(s.status==='failed'){setR({type:'info',text:'Image generation failed: '+(s.error||'try again')});return}
      setR({type:'image',text:'Generating your image… '+i*2+'s',data:{jobId}});
    }
    setR({type:'info',text:'Still generating after 60s. Try again in a moment.'});
  };

  // ----- Drag -----
  const onDown=(e:React.PointerEvent)=>{
    // Ignore drags starting on buttons, links, or the X
    const t=e.target as HTMLElement;
    if(t.closest('button,a'))return;
    if(!cardRef.current)return;
    const rect=cardRef.current.getBoundingClientRect();
    drag.current={dx:e.clientX-rect.left,dy:e.clientY-rect.top};
    if(pos===null)setPos({x:rect.left,y:rect.top});
    setDragging(true);
    setDocked(null); // undock as soon as you start dragging
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onMove=(e:React.PointerEvent)=>{
    if(!dragging)return;
    const w=window.innerWidth,h=window.innerHeight;
    let x=e.clientX-drag.current.dx,y=e.clientY-drag.current.dy;
    // Keep it partially on-screen while dragging
    x=Math.max(-CARD_W/2,Math.min(w-CARD_W/2,x));
    y=Math.max(0,Math.min(h-40,y));
    setPos({x,y});
    // Which edge is the pointer near?
    const px=e.clientX,py=e.clientY;
    const nearL=px<SNAP,nearR=px>w-SNAP,nearT=py<SNAP,nearB=py>h-SNAP;
    setEdgeHint(nearL?'left':nearR?'right':nearT?'top':nearB?'bottom':null);
  };

  const onUp=(e:React.PointerEvent)=>{
    if(!dragging)return;
    setDragging(false);
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);

    const w=window.innerWidth,h=window.innerHeight;
    const px=e.clientX,py=e.clientY;
    // Dock if the pointer is near an edge
    const dockTo:Dock = px<SNAP?'left':px>w-SNAP?'right':py<SNAP?'top':py>h-SNAP?'bottom':null;
    if(dockTo){setDocked(dockTo);setEdgeHint(null);return}

    // Otherwise clamp the card so it sits fully on-screen
    if(pos){
      let{x,y}=pos;
      if(x<8)x=8;
      if(x+CARD_W>w-8)x=w-CARD_W-8;
      if(y<8)y=8;
      if(y+CARD_H>h-8)y=h-CARD_H-8;
      setPos({x:Math.max(8,x),y:Math.max(8,y)});
    }
    setEdgeHint(null);
  };

  // Attached position (above the composer)
  const attachedStyle:React.CSSProperties={left:'50%',transform:'translateX(-50%)',bottom:118};

  // Response visibility rules:
  //  - r must exist
  //  - if the bar is hidden AND the card is attached → hide
  //  - if docked → show as a tab (see below)
  //  - otherwise show
  const responseVisible = !!r && !(barHidden && pos===null && docked===null);

  const go=(t:string)=>setM(t);

  // Renders the collapsed tab for a docked response
  const DockedTab=()=>{
    if(!docked)return null;
    const cls=`docked-tab docked-${docked}`;
    return <button className={cls} aria-label="Show response" title="Show response" onClick={()=>setDocked(null)}>
      <span className="dock-dot"/><span>Result</span>
    </button>;
  };

  return <>
    {/* Response card — shown when it exists and is not (attached + bar hidden) */}
    {responseVisible && !docked && (
      <div
        ref={cardRef}
        className={'card result'+(pos?' detached':' attached')+(dragging?' dragging':'')+(edgeHint?' edge-'+edgeHint:'')}
        style={pos?{left:pos.x,top:pos.y,position:'fixed',transform:'none',bottom:'auto',right:'auto'}:attachedStyle}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <div className="result-head">
          <span className="drag-handle" title={pos?'Drag to move':'Drag to detach and move'}>⋮⋮</span>
          <button className="x" aria-label="Hide response" title="Hide response"
            onPointerDown={e=>e.stopPropagation()}
            onClick={hideResponse}>×</button>
        </div>
        <Result r={r}/>
      </div>
    )}

    {/* Docked tab — visible when the response is docked */}
    {r && docked && <DockedTab/>}

    {/* Composer bar */}
    {!barHidden && (
      <div className="composer">
        {!r&&!m&&<div className="chips">{['How am I doing?','What should I do next?','Budget $1000','Image of a coffee cup'].map(c=><button key={c} onClick={()=>go(c)}>{c}</button>)}</div>}
        <form onSubmit={send}>
          <input ref={f} type="file" accept="image/*" hidden onChange={pick}/>
          <button type="button" className={ref?'on':''} aria-label="Attach product photo" title="Attach a product photo to edit" onClick={()=>f.current?.click()}>{ICONS.clip}</button>
          <input value={m} onChange={e=>setM(e.target.value)} placeholder="Ask for analytics, an image, ideas, a budget…"/>
          <button type="submit" disabled={b||!m.trim()}>{b?'…':'Send'}</button>
          <button type="button" className="toggle" aria-label="Hide assistant" title="Hide assistant" onClick={toggleBar}>{ICONS.chevDown}</button>
        </form>
      </div>
    )}

    {/* Restore pill when the bar is hidden */}
    {barHidden && (
      <button
        className="composer-restore"
        aria-label="Show assistant"
        title="Show assistant"
        onClick={toggleBar}
      >
        {ICONS.chevUp}
        <span>Assistant</span>
      </button>
    )}
  </>}