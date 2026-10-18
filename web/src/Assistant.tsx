import {useState,useRef,useEffect} from 'react';
import type {FormEvent} from 'react';
import {api} from './api';
import {ICONS} from './icons';
import {canEditResponse,checkEdit,applyEdit} from './resp';
import {scheduleBody,IMAGE_NOT_ATTACHED} from './cc';
import {LANGS,NOTICE,NOTICE_KEY,defaultLang,getRecognition,describeSpeechError,splitResults,mergeTranscript} from './speech';

type R={type:string;text:string;data?:any;original?:string;edited?:boolean};

// 4.2: plain text replies can be edited. The original and the edit are both saved on the server (POST /responses/save); edited text carries a small marker.
function Editable({r,onSaved}:{r:R;onSaved:(t:string)=>void}){
  const[editing,setEditing]=useState(false),[draft,setDraft]=useState(''),[err,setErr]=useState(''),[bz,setBz]=useState(false);
  const start=()=>{setDraft(r.text);setErr('');setEditing(true)};
  const save=async()=>{
    const original=r.original??r.text,c=checkEdit(original,draft);if('error' in c){setErr(c.error);return}
    setBz(true);setErr('');
    try{const x=await api<{response:{edited:string}}>('/responses/save',{method:'POST',body:{kind:'assistant',original,edited:c.text}});onSaved(x.response.edited);setEditing(false)}
    catch(e:any){setErr(e.message)}finally{setBz(false)}};
  if(editing)return <div>
    <textarea rows={4} style={{width:'100%'}} aria-label="Edit the response" value={draft} onChange={e=>setDraft(e.target.value)}/>
    {err&&<div className="dn" role="alert">⚠ {err}</div>}
    <div className="row" style={{justifyContent:'flex-start'}}><button className="btn s" disabled={bz} onClick={save}>{bz?'Saving…':'Save'}</button><button className="btn g s" disabled={bz} onClick={()=>setEditing(false)}>Cancel</button></div></div>;
  return <div><p style={{margin:0}}>{r.text}</p>
    <div className="row" style={{margin:'6px 0 0',justifyContent:'flex-start'}}>
      {r.edited&&<span className="mu edited" title={r.original?'Original: '+r.original:undefined}>edited</span>}
      <button className="btn g s" onClick={start}>Edit</button></div></div>}

// "Schedule this post" under a generated image: caption + time, then POST /schedule (the same call the Content AI tab uses).
// The image rides along only when the server returned a public URL (urls, present when image storage is set up); otherwise only the caption is queued and the note says so.
function ScheduleThis({publicUrl}:{publicUrl?:string}){
  const[open,setOpen]=useState(false),[cap,setCap]=useState(''),[when,setWhen]=useState(''),[bz,setBz]=useState(false),[msg,setMsg]=useState<{ok:boolean;text:string}|null>(null);
  const submit=async()=>{
    const b=scheduleBody(cap,when,publicUrl,Date.now());if('error' in b){setMsg({ok:false,text:b.error});return}
    setBz(true);setMsg(null);
    try{await api('/schedule',{method:'POST',body:b.body});setMsg({ok:true,text:'Scheduled. See the Scheduling tab.'+(b.body.image?'':' '+IMAGE_NOT_ATTACHED)});setOpen(false);setCap('');setWhen('')}
    catch(e:any){setMsg({ok:false,text:e.message})}finally{setBz(false)}};
  return <div className="schedthis">
    {!open&&<button type="button" className="btn s" onClick={()=>{setOpen(true);setMsg(null)}}>Schedule this post</button>}
    {open&&<div>
      <textarea rows={3} aria-label="Caption" placeholder="Caption for this post" value={cap} onChange={e=>setCap(e.target.value)}/>
      <div className="row" style={{justifyContent:'flex-start'}}>
        <input type="datetime-local" aria-label="Publish at" value={when} onChange={e=>setWhen(e.target.value)}/>
        <button type="button" className="btn s" disabled={bz} onClick={submit}>{bz?'Scheduling…':'Add to queue'}</button>
        <button type="button" className="btn g s" disabled={bz} onClick={()=>setOpen(false)}>Cancel</button></div>
      {!publicUrl&&<p className="mu" style={{margin:'2px 0'}}>{IMAGE_NOT_ATTACHED}</p>}</div>}
    {msg&&<div className={msg.ok?'mu':'dn'} role={msg.ok?'status':'alert'}>{msg.ok?'✔ ':'⚠ '}{msg.text}</div>}</div>}

function Result({r,onSaved}:{r:R;onSaved:(t:string)=>void}){
  const d=r.data||{};
  if(r.type==='image'&&d.url)return <><img src={d.url} alt="Generated"/><div className="row"><span className="mu">{r.text}</span><a className="btn s" href={d.url} download="post.png">Save</a></div><ScheduleThis publicUrl={d.publicUrl}/></>;
  if(r.type==='analytics')return <>
    <div className="ring"><i>{d.health.score}</i></div><p style={{textAlign:'center'}}><b>{r.text}</b></p>
    <div className="row"><span>Reach 30d <b>{d.metrics.reach30d.toLocaleString()}</b></span><span>Engagement <b>{d.metrics.er}%</b></span><span>Reach change <b>{d.metrics.reachChange}%</b></span></div>
    {d.top.map((t:any,i:number)=><p key={i}>• {t.text}</p>)}</>;
  if(r.type==='finance')return <><span className="tag">${d.capital.toLocaleString()} suggested split</span>
    {d.money.map((m:any)=><div key={m.area}><div className="row" style={{margin:0}}><span>{m.area}</span><b>${m.amount}</b></div><div className="bar"><div style={{width:m.share+'%'}}/></div></div>)}
    {d.time.map((t:string,i:number)=><p key={i}>{t}</p>)}</>;
  if(canEditResponse(r))return <><Editable r={r} onSaved={onSaved}/>{d.more?.map((t:any,i:number)=><p key={i} className="mu">{t.text}</p>)}</>;
  return <><p style={{margin:0}}>{r.text}</p>{d.more?.map((t:any,i:number)=><p key={i} className="mu">{t.text}</p>)}</>}

const BAR_KEY='rt:assistant:bar';
const POS_KEY='rt:assistant:pos';
const DOCKED_KEY='rt:assistant:docked';   // 'left' | 'right' | 'top' | 'bottom' | null
const SNAP=40;   // px from an edge that triggers docking on release
const CARD_W=380,CARD_H=220; // approx card size for clamping

type Dock='left'|'right'|'top'|'bottom'|null;

export type Prefill={id:number;text:string};
// isEmbedded=false: the global bar fixed at the bottom of the shell (every tab except the Command Center).
// isEmbedded=true: the same chat laid out in normal flow inside a page (the Command Center). prefill: set {id,text} to fill the input from outside ("Fix this"); a new id refills even the same text.
export default function Assistant({isEmbedded=false,prefill=null}:{isEmbedded?:boolean;prefill?:Prefill|null}){
  const[m,setM]=useState(''),[r,setR]=useState<R|null>(null),[b,setB]=useState(false),[ref,setRef]=useState(''),
    f=useRef<HTMLInputElement>(null),txt=useRef<HTMLInputElement>(null),seq=useRef(0);
  // Post generation mode: OFF = the normal assistant (/assistant). ON = the text goes to the image generator (/content/image) instead.
  const[gen,setGen]=useState(false),[ratio,setRatio]=useState('1:1');

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

  useEffect(()=>()=>{seq.current++},[]); // leaving the page ends any image polling loop
  useEffect(()=>{if(prefill&&prefill.text){setGen(false);setM(prefill.text);setTimeout(()=>txt.current?.focus(),0)}},[prefill?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // The embedded chat never reads or writes the saved dock/position/hidden state of the global bar.
  const ps=isEmbedded?null:pos,dk:Dock=isEmbedded?null:docked;

  // X button — this is the ONLY thing that clears r
  const hideResponse=()=>{setR(null);if(!isEmbedded){setPos(null);setDocked(null)}};

  // Hiding the bar does NOT clear r: the response is preserved and re-shown on unhide.
  const toggleBar=()=>setBarHidden(h=>!h);

  // D.1 voice input: browser speech recognition, no backend. The mic is not drawn when the browser has none (e.g. Firefox).
  const Rec=getRecognition(window),recRef=useRef<any>(null),baseRef=useRef('');
  const[listening,setListening]=useState(false),[vOff,setVOff]=useState(''),[vMsg,setVMsg]=useState(''),[vOpts,setVOpts]=useState(false),[vNotice,setVNotice]=useState(false),
    [cont,setCont]=useState(false),[lang,setLang]=useState('en-US'),langTouched=useRef(false);
  useEffect(()=>{if(!Rec)return;api<any>('/profile').then(p=>{if(!langTouched.current)setLang(defaultLang(p.languages))}).catch(()=>{})},[]);
  useEffect(()=>()=>{try{recRef.current?.abort()}catch{}},[]);
  const stopVoice=()=>{try{recRef.current?.stop()}catch{}};
  const startVoice=()=>{
    setVMsg('');baseRef.current=m;
    try{
      const x=new Rec();x.lang=lang;x.continuous=cont;x.interimResults=true;
      x.onresult=(e:any)=>{const s=splitResults(e.results);setM(mergeTranscript(baseRef.current,s.finals,s.interim))};
      x.onerror=(e:any)=>{const d=describeSpeechError(e.error);if(d.message)setVMsg(d.message);if(d.fatal)setVOff(d.message)};
      x.onend=()=>{setListening(false);recRef.current=null};
      recRef.current=x;x.start();setListening(true);
    }catch{setVMsg('Voice input could not start. You can still type.');setListening(false)}};
  const micClick=()=>{
    if(listening){stopVoice();return}
    let seen='1';try{seen=localStorage.getItem(NOTICE_KEY)||''}catch{}
    if(!seen){setVNotice(true);return}
    startVoice()};
  const acceptNotice=()=>{try{localStorage.setItem(NOTICE_KEY,'1')}catch{}setVNotice(false);startVoice()};

  const pick=(e:any)=>{const x=e.target.files?.[0];if(!x)return;const fr=new FileReader();fr.onload=()=>setRef(String(fr.result));fr.readAsDataURL(x)};

  const send=async(e:FormEvent)=>{
    e.preventDefault();
    if(!m.trim()||b)return;
    stopVoice();
    setB(true);
    const id=++seq.current;
    // A new request resets any dock/position so the fresh card appears attached
    if(!isEmbedded){setPos(null);setDocked(null)}
    try{
      if(gen){ // Post generation ON: skip the assistant, go straight to the image generator (same call as the Content AI tab)
        const j=await api<{jobId:string}>('/content/image',{method:'POST',body:{prompt:m.trim(),ratio,referenceImage:ref||undefined}});
        setR({type:'image',text:'Generating your image… 0s',data:{jobId:j.jobId}});
        await poll(j.jobId,id);
      }else{
        const x=await api<R>('/assistant',{method:'POST',body:{message:m,referenceImage:ref||undefined}});
        setR(x);
        if(x.type==='image'&&x.data?.jobId)await poll(x.data.jobId,id);
      }
    }catch(x:any){setR({type:'info',text:x.message})}
    setB(false);setM('');setRef('');
  };

  const poll=async(jobId:string,id:number)=>{
    for(let i=1;i<=30;i++){
      await new Promise(r=>setTimeout(r,2000));
      if(id!==seq.current)return;
      const s=await api<any>('/content/image/'+jobId);
      if(s.status==='done'){setR({type:'image',text:'Here you go.',data:{url:s.images[0],publicUrl:s.urls?.[0]}});return}
      if(s.status==='failed'){setR({type:'info',text:'Image generation failed: '+(s.error||'try again')});return}
      setR({type:'image',text:'Generating your image… '+i*2+'s',data:{jobId}});
    }
    setR({type:'info',text:'Still generating after 60s. Try again in a moment.'});
  };

  // ----- Drag -----
  const onDown=(e:React.PointerEvent)=>{
    // Ignore drags starting on buttons, links, or the X
    const t=e.target as HTMLElement;
    if(t.closest('button,a,textarea,input'))return;
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
  const responseVisible = !!r && (isEmbedded || !(barHidden && pos===null && docked===null));

  const go=(t:string)=>setM(t);

  // Renders the collapsed tab for a docked response
  const DockedTab=()=>{
    if(!docked)return null;
    const cls=`docked-tab docked-${docked}`;
    return <button className={cls} aria-label="Show response" title="Show response" onClick={()=>setDocked(null)}>
      <span className="dock-dot"/><span>Result</span>
    </button>;
  };

  const body=<>
    {/* Response card — shown when it exists and is not (attached + bar hidden). Embedded: an ordinary card above the input, no dragging or docking. */}
    {responseVisible && !dk && (
      <div
        ref={cardRef}
        className={'card result'+(isEmbedded?' inline':ps?' detached':' attached')+(dragging?' dragging':'')+(edgeHint?' edge-'+edgeHint:'')}
        style={isEmbedded?undefined:ps?{left:ps.x,top:ps.y,position:'fixed',transform:'none',bottom:'auto',right:'auto'}:attachedStyle}
        onPointerDown={isEmbedded?undefined:onDown}
        onPointerMove={isEmbedded?undefined:onMove}
        onPointerUp={isEmbedded?undefined:onUp}
        onPointerCancel={isEmbedded?undefined:onUp}
      >
        <div className="result-head">
          {isEmbedded?<span/>:<span className="drag-handle" title={ps?'Drag to move':'Drag to detach and move'}>⋮⋮</span>}
          <button className="x" aria-label="Hide response" title="Hide response"
            onPointerDown={e=>e.stopPropagation()}
            onClick={hideResponse}>×</button>
        </div>
        <Result r={r} onSaved={t=>setR(x=>x&&applyEdit(x,t))}/>
      </div>
    )}

    {/* Docked tab — visible when the response is docked */}
    {r && dk && <DockedTab/>}

    {/* Composer bar */}
    {(isEmbedded||!barHidden) && (
      <div className={'composer'+(isEmbedded?' embedded':'')}>
        {!r&&!m&&!gen&&<div className="chips">{['How am I doing?','What should I do next?','Budget $1000','Image of a coffee cup'].map(c=><button key={c} onClick={()=>go(c)}>{c}</button>)}</div>}
        {Rec&&(listening||vMsg||vNotice||vOpts||vOff)&&<div className="voicebar" role="status">
          {vNotice&&<div><p className="mu" style={{margin:'0 0 6px'}}>{NOTICE}</p><button type="button" className="btn s" onClick={acceptNotice}>Got it, start listening</button> <button type="button" className="btn g s" onClick={()=>setVNotice(false)}>Cancel</button></div>}
          {listening&&<span className="mu">Listening… speak now{cont?' (keeps listening until you stop)':''}</span>}
          {(vMsg||vOff)&&<span className="dn">{vOff||vMsg}</span>}
          {vOpts&&<span className="row" style={{margin:0}}>
            <label className="mu">Language <select value={lang} disabled={listening} onChange={e=>{langTouched.current=true;setLang(e.target.value)}}>{LANGS.map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></label>
            <label className="mu"><input type="checkbox" style={{width:'auto'}} checked={cont} disabled={listening} onChange={e=>setCont(e.target.checked)}/> Keep listening</label></span>}
          <button type="button" className="btn g s" aria-label="Voice options" aria-expanded={vOpts} onClick={()=>setVOpts(o=>!o)}>⚙</button>
        </div>}
        <div className="pgrow">
          <button type="button" className={'pgtoggle'+(gen?' on':'')} aria-pressed={gen} title={gen?'Post generation is on: your message becomes an image prompt. Click to turn it off.':'Turn your message into a generated image instead of asking the assistant'} onClick={()=>setGen(g=>!g)}>{gen?'🪄 Post Generation ON':'🪄 Activate Post Generation'}</button>
          {gen&&<select aria-label="Image shape" value={ratio} onChange={e=>setRatio(e.target.value)}><option value="1:1">1:1</option><option value="4:5">4:5</option><option value="9:16">9:16</option></select>}
        </div>
        <form onSubmit={send}>
          <input ref={f} type="file" accept="image/*" hidden onChange={pick}/>
          <button type="button" className={ref?'on':''} aria-label="Attach product photo" title="Attach a product photo to edit" onClick={()=>f.current?.click()}>{ICONS.clip}</button>
          <input ref={txt} value={m} onChange={e=>setM(e.target.value)} placeholder={gen?'Describe the image you want to generate...':'Ask for analytics, an image, ideas, a budget…'}/>
          {Rec&&<button type="button" className={'mic'+(listening?' listening':'')} disabled={!!vOff} aria-pressed={listening} aria-label={listening?'Stop voice input':'Start voice input'} title={vOff||(listening?'Stop voice input':'Speak your request')} onClick={micClick}>{ICONS.mic}</button>}
          <button type="submit" disabled={b||!m.trim()}>{b?'…':'Send'}</button>
          {!isEmbedded&&<button type="button" className="toggle" aria-label="Hide assistant" title="Hide assistant" onClick={toggleBar}>{ICONS.chevDown}</button>}
        </form>
      </div>
    )}

    {/* Restore pill when the bar is hidden */}
    {!isEmbedded && barHidden && (
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
  </>;
  return isEmbedded?<div className="assistant-embed">{body}</div>:body}
