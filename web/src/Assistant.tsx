import {useState,useRef,useEffect} from 'react';
import type {FormEvent} from 'react';
import {api} from './api';
import {ICONS} from './icons';

export type Prefill={id:number;text:string};
export type DeepLink={id:number;conversationId:string;ref:string|null};

type Msg =
  | { role:'user'; text:string }
  | { role:'assistant'; type:string; text:string; data?:any; jobId?:string };

function Message({m}:{m:Msg}){
  if(m.role==='user') return <div className="chat-msg user"><div className="bubble">{m.text}</div></div>;
  const d=m.data||{};
  let body;
  if(m.type==='image'&&d.url) body = <><img src={d.url} alt="Generated"/><div className="row"><span className="mu">{m.text}</span><a className="btn s" href={d.url} download="post.png">Save</a></div></>;
  else if(m.type==='analytics') body = <>
    <div className="ring"><i>{d.health.score}</i></div><p style={{textAlign:'center'}}><b>{m.text}</b></p>
    <div className="row"><span>Reach 30d <b>{d.metrics.reach30d.toLocaleString()}</b></span><span>Engagement <b>{d.metrics.er}%</b></span><span>Reach change <b>{d.metrics.reachChange}%</b></span></div>
    {d.top?.map((t:any,i:number)=><p key={i}>• {t.text}</p>)}</>;
  else if(m.type==='finance') body = <><span className="tag">${d.capital.toLocaleString()} suggested split</span>
    {d.money?.map((x:any)=><div key={x.area}><div className="row" style={{margin:0}}><span>{x.area}</span><b>${x.amount}</b></div><div className="bar"><div style={{width:x.share+'%'}}/></div></div>)}
    {d.time?.map((t:string,i:number)=><p key={i}>{t}</p>)}</>;
  else body = <><p style={{margin:0}}>{m.text}</p>{d.more?.map((t:any,i:number)=><p key={i} className="mu">{t.text}</p>)}</>;
  return <div className="chat-msg assistant">
    <div className="avatar"><span>AI</span></div>
    <div className="bubble">{body}</div>
  </div>;
}

export default function Assistant({
  isEmbedded = false,
  variant = 'float',
  prefill = null,
  deepLink = null,
  onInteract,
  onReset,
}:{
  isEmbedded?: boolean;
  variant?: 'float' | 'page';
  prefill?: Prefill | null;
  deepLink?: DeepLink | null;
  onInteract?: () => void;
  onReset?: () => void;
}){
  const [m,setM]=useState(''), [msgs,setMsgs]=useState<Msg[]>([]), [b,setB]=useState(false), [ref,setRef]=useState(''),
    f=useRef<HTMLInputElement>(null), seq=useRef(0);
  const [mode,setMode]=useState<'chat'|'image'>('chat');
  const [imgRatio,setImgRatio]=useState('1:1');
  const [hidden,setHidden]=useState(false);
  const [detached,setDetached]=useState(false);
  const [docked,setDocked]=useState<null|'left'|'right'|'top'|'bottom'>(null);
  const [dragging,setDragging]=useState(false);
  const [edge,setEdge]=useState<null|'left'|'right'|'top'|'bottom'>(null);
  const cardRef=useRef<HTMLDivElement>(null);
  const threadRef=useRef<HTMLDivElement>(null);

  // Drag state kept in refs so pointermove never triggers a React render.
  const dragState=useRef<{ox:number;oy:number;x:number;y:number}|null>(null);
  const rafRef=useRef<number|null>(null);
  const edgeRef=useRef<null|'left'|'right'|'top'|'bottom'>(null);

  const isPage = variant === 'page';

  useEffect(()=>{if(prefill){setM(prefill.text);onInteract?.()}},[prefill]); // eslint-disable-line
  useEffect(()=>{ if(deepLink) onInteract?.(); },[deepLink]); // eslint-disable-line
  useEffect(()=>{if(threadRef.current)threadRef.current.scrollTop=threadRef.current.scrollHeight},[msgs]);
  // Safety net: Escape restores the hidden composer.
  useEffect(()=>{
    const onKey=(e:KeyboardEvent)=>{ if(e.key==='Escape' && hidden){ setHidden(false); setDocked(null); } };
    addEventListener('keydown', onKey);
    return ()=>removeEventListener('keydown', onKey);
  },[hidden]);

  const pick=(e:any)=>{const x=e.target.files?.[0];if(!x)return;const fr=new FileReader();fr.onload=()=>setRef(String(fr.result));fr.readAsDataURL(x)};
  const push=(msg:Msg)=>setMsgs(list=>[...list,msg]);

  const send=async(e:FormEvent)=>{
    e.preventDefault();
    if(!m.trim()||b)return;
    onInteract?.();
    setB(true);
    const id=++seq.current;
    const userText=m;
    push({role:'user',text:userText});
    setM('');
    try{
      if(mode==='image'){
        const x = await api<any>('/content/image',{method:'POST',body:{prompt:userText, ratio:imgRatio, referenceImage:ref||undefined}});
        if (x.jobId) await poll(x.jobId, id);
      } else {
        const x=await api<any>('/assistant',{method:'POST',body:{message:userText,referenceImage:ref||undefined}});
        push({role:'assistant',type:x.type||'info',text:x.text||'',data:x.data});
        if(x.type==='image'&&x.data?.jobId) await poll(x.data.jobId, id);
      }
    }catch(err:any){push({role:'assistant',type:'info',text:err.message})}
    setB(false);setRef('');
  };

  const poll=async(jobId:string,id:number)=>{
    for(let i=1;i<=30;i++){
      await new Promise(r=>setTimeout(r,2000));
      if(id!==seq.current)return;
      const s=await api<any>('/content/image/'+jobId);
      if(s.status==='done'){push({role:'assistant',type:'image',text:'Here you go.',data:{url:s.images[0]}});return}
      if(s.status==='failed'){push({role:'assistant',type:'info',text:'Image generation failed: '+(s.error||'try again')});return}
      setMsgs(list=>{
        const copy=[...list];
        for(let k=copy.length-1;k>=0;k--){
          const c=copy[k] as any;
          if(c.role==='assistant'){copy[k]={...c,type:'image',text:'Generating your image… '+i*2+'s',data:{jobId}};break}
        }
        return copy;
      });
    }
    push({role:'assistant',type:'info',text:'Still generating after 60s. Try again in a moment.'});
  };

  const go=(t:string)=>{setM(t);onInteract?.()};
  const clearThread=()=>{ setMsgs([]); onReset?.(); };

  const onPointerDown=(e:React.PointerEvent<HTMLDivElement>)=>{
    if(isEmbedded||isPage)return;
    if((e.target as HTMLElement).closest('button,a,input,select,textarea'))return;
    const el=cardRef.current; if(!el)return;
    const r=el.getBoundingClientRect();
    // Take over positioning: pin to top-left and use translate3d for smooth movement.
    el.style.left='0px'; el.style.top='0px'; el.style.right='auto'; el.style.bottom='auto';
    el.style.transform=`translate3d(${r.left}px, ${r.top}px, 0)`;
    el.style.willChange='transform';
    dragState.current={ox:e.clientX-r.left, oy:e.clientY-r.top, x:r.left, y:r.top};
    edgeRef.current=null;
    setDragging(true);
    el.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove=(e:React.PointerEvent<HTMLDivElement>)=>{
    const ds=dragState.current; if(!ds)return;
    const el=cardRef.current; if(!el)return;
    const w=el.offsetWidth||420, h=el.offsetHeight||200;
    const x=Math.max(8,Math.min(window.innerWidth-w-8, e.clientX-ds.ox));
    const y=Math.max(8,Math.min(window.innerHeight-h-8, e.clientY-ds.oy));
    ds.x=x; ds.y=y;
    if(rafRef.current==null){
      rafRef.current=requestAnimationFrame(()=>{
        rafRef.current=null;
        const cur=dragState.current; const c=cardRef.current; if(!cur||!c)return;
        c.style.transform=`translate3d(${cur.x}px, ${cur.y}px, 0)`;
      });
    }
    const t=64;
    const nextEdge = e.clientY<t?'top':e.clientY>window.innerHeight-t?'bottom':e.clientX<t?'left':e.clientX>window.innerWidth-t?'right':null;
    if(nextEdge!==edgeRef.current){ edgeRef.current=nextEdge; setEdge(nextEdge); }
  };
  const onPointerUp=()=>{
    const el=cardRef.current;
    if(el){
      if(edgeRef.current){
        // Snap to edge: drop inline positioning so the docked-tab CSS takes over on re-render.
        el.style.left=''; el.style.top=''; el.style.right=''; el.style.bottom=''; el.style.transform=''; el.style.willChange='';
      } else {
        // Stay where it was dropped.
        el.style.transform=`translate3d(${dragState.current?.x ?? 0}px, ${dragState.current?.y ?? 0}px, 0)`;
        el.style.willChange='';
      }
    }
    dragState.current=null;
    if(rafRef.current!=null){cancelAnimationFrame(rafRef.current);rafRef.current=null;}
    setDragging(false);
    if(edgeRef.current){ setDocked(edgeRef.current); edgeRef.current=null; setEdge(null); }
  };

  const restore=()=>{setHidden(false);setDocked(null)};
  const hideComposer=()=>setHidden(true);

  const showSuggestions = msgs.length===0 && !m && !b;

  const suggestionsRow = (
    <div className={'suggestions-row'+(isPage?' suggestions-page':'')}>
      <button onClick={()=>go('How am I doing?')}>How am I doing?</button>
      <button onClick={()=>go('What should I do next?')}>What should I do next?</button>
      <button onClick={()=>go('Budget $1000')}>Budget $1000</button>
      <button onClick={()=>go('Image of a coffee cup')}>Image of a coffee cup</button>
    </div>
  );

  // Pass `floating` to include the down-arrow hide button (used by the floating composer only).
  const composerForm = (floating=false) => (
    <div className={isPage ? 'assistant-bar-wrap page-bar' : 'assistant-bar-wrap'}>
      <form onSubmit={send} className="chat-form">
        <input ref={f} type="file" accept="image/*" hidden onChange={pick}/>
        <button type="button" className={ref?'on':''} onClick={()=>f.current?.click()} title="Attach image">{ICONS.clip}</button>

        <input value={m} onChange={e=>setM(e.target.value)}
          placeholder={mode==='image' ? "Describe the image to generate..." : "Ask for analytics, an image, ideas, a budget…"}/>

        {mode==='image' && (
          <select value={imgRatio} onChange={e=>setImgRatio(e.target.value)} className="ratio-select">
            <option value="1:1">1:1</option>
            <option value="4:5">4:5</option>
            <option value="9:16">9:16</option>
          </select>
        )}

        <button type="button"
          className={'mode-toggle-icon'+(mode==='image'?' on':'')}
          onClick={()=>setMode(mm=>mm==='chat'?'image':'chat')}
          title={mode==='image' ? "Turn off Image Generation" : "Turn on Image Generation"}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19l7-7 3 3-7 7-3-3z"></path>
            <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"></path>
            <path d="M2 2l7.586 7.586"></path>
            <circle cx="11" cy="11" r="2"></circle>
          </svg>
        </button>

        {floating && (
          <button type="button" className="composer-hide" onClick={hideComposer}
            title="Hide the assistant bar" aria-label="Hide the assistant bar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </button>
        )}

        <button type="submit" id="assistant-send" disabled={b||!m.trim()}>{b?'…':'Send'}</button>
      </form>
    </div>
  );

  const thread = (
    <div className={isPage ? 'chat-thread page-thread' : 'chat-thread'} ref={threadRef}>
      {msgs.map((msg,i)=><Message key={i} m={msg}/>)}
      {b && <div className="chat-msg assistant"><div className="avatar"><span>AI</span></div><div className="bubble typing"><i/><i/><i/></div></div>}
    </div>
  );

  // ---- PAGE VARIANT (Command Center) ----
  if (isPage) {
    return (
      <div className="assistant-page">
        {showSuggestions && suggestionsRow}
        {msgs.length > 0 && thread}
        {composerForm()}
      </div>
    );
  }

  // ---- FLOATING / EMBEDDED VARIANTS ----

  // Attached tab: only visible while the composer is visible.
  const attachedTab = !isEmbedded && !detached && msgs.length > 0 && (
    <div
      ref={cardRef}
      className={`result-tab attached ${dragging ? 'dragging' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="result-head">
        <span className="drag-handle">⋮⋮</span>
        <div style={{display:'flex',gap:4}}>
          <button className="x" title="Detach from the assistant bar" onClick={()=>setDetached(true)}>⤢</button>
          <button className="x" onClick={clearThread} aria-label="Close">×</button>
        </div>
      </div>
      {thread}
    </div>
  );

  // Detached tab: independent floating card. Survives the composer being hidden, can be dragged, docks to an edge.
  const detachedTab = !isEmbedded && detached && msgs.length > 0 && (
    <div
      ref={cardRef}
      className={`result-tab detached ${dragging ? 'dragging' : ''} ${edge ? 'edge-'+edge : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="result-head">
        <span className="drag-handle">⋮⋮</span>
        <div style={{display:'flex',gap:4}}>
          <button className="x" title="Attach to the assistant bar" onClick={()=>setDetached(false)}>⇤</button>
          <button className="x" onClick={clearThread} aria-label="Close">×</button>
        </div>
      </div>
      {thread}
    </div>
  );

  // Embedded (not used by CommandCenter anymore, kept for compatibility): inline card.
  const embeddedTab = isEmbedded && msgs.length > 0 && (
    <div className="result-tab" ref={cardRef}>
      <div className="result-head">
        <span className="drag-handle" style={{visibility:'hidden'}}>⋮⋮</span>
        <button className="x" onClick={clearThread} aria-label="Close">×</button>
      </div>
      {thread}
    </div>
  );

  // Composer hidden. Render the restore button ALWAYS, plus any tab that should stay visible.
  if (hidden) {
    return <>
      {detachedTab}
      {docked && !isEmbedded && (
        <button
          className={`docked-tab docked-${docked}`}
          onClick={()=>{ setDocked(null); if(!detached) setHidden(false); }}
          title="Restore response"
        >
          <span className="dock-dot"/>
          <span>Assistant {msgs.length>0 && <>({msgs.length})</>}</span>
        </button>
      )}
      <button className="composer-restore" onClick={restore} title="Show the assistant">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        Assistant
      </button>
    </>;
  }

  // Visible composer but the response has been dragged to an edge → show the docked tab in its place.
  if (docked && !isEmbedded) {
    const cls = `docked-tab docked-${docked}`;
    return <button className={cls} onClick={()=>setDocked(null)} title="Restore assistant">
      <span className="dock-dot"/>
      <span>Assistant {msgs.length>0 && <>({msgs.length})</>}</span>
    </button>;
  }

  return <>
    {attachedTab}
    {detachedTab}
    {embeddedTab}
    <div className="composer">
      {showSuggestions && suggestionsRow}
      {composerForm(true)}
    </div>
  </>;
}