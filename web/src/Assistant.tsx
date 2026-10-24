import {useState,useRef,useEffect,useLayoutEffect} from 'react';
import type {FormEvent} from 'react';
import {api} from './api';
import {ICONS} from './icons';
import {
  nearBottom,newClientId,messageId,patchMessage,appendMessage,pollPatch,pollDelay,POLL_MAX,
  fromServerMessage,retryParams,buildAssistantBody,imageIdsOf,RATIOS,
} from './chat/helpers';
import type {Msg} from './chat/helpers';
import {loadThumbs,cachedThumb,rememberThumb} from './chat/thumbs';
import ImageMessage from './chat/ImageMessage';
import type {ImageHandlers} from './chat/ImageMessage';
import HistoryDrawer from './chat/HistoryDrawer';
import ImagePicker from './chat/ImagePicker';

export type Prefill={id:number;text:string};
// A parsed "#cc=<conversationId>&ref=<imageId>" (CommandCenter reads the hash, clears it, and hands the result down).
export type DeepLink={id:number;cc?:string;ref?:string};

const CONVO_KEY='cc.convo'; // the open conversation, so a reload resumes it (page variant only)
const sleep=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));

function Message({m,h}:{m:Msg;h:ImageHandlers}){
  if(m.role==='user') return <div className="chat-msg user"><div className="bubble">{m.text}</div></div>;
  if(m.type==='image') return <div className="chat-msg assistant">
    <div className="avatar"><span>AI</span></div>
    <div className="bubble img-bubble"><ImageMessage m={m} h={h}/></div>
  </div>;
  const d=m.data||{};
  let body;
  if(m.type==='analytics'&&d.health&&d.metrics) body = <>
    <div className="ring"><i>{d.health.score}</i></div><p style={{textAlign:'center'}}><b>{m.text}</b></p>
    <div className="row"><span>Reach 30d <b>{Number(d.metrics.reach30d||0).toLocaleString()}</b></span><span>Engagement <b>{d.metrics.er}%</b></span><span>Reach change <b>{d.metrics.reachChange}%</b></span></div>
    {d.top?.map((t:any,i:number)=><p key={m.id+':t'+i}>• {t.text}</p>)}</>;
  else if(m.type==='finance'&&d.capital!==undefined) body = <><span className="tag">${Number(d.capital).toLocaleString()} suggested split</span>
    {d.money?.map((x:any)=><div key={m.id+':'+x.area}><div className="row" style={{margin:0}}><span>{x.area}</span><b>${x.amount}</b></div><div className="bar"><div style={{width:x.share+'%'}}/></div></div>)}
    {d.time?.map((t:string,i:number)=><p key={m.id+':s'+i}>{t}</p>)}</>;
  else body = <><p style={{margin:0}}>{m.text}</p>{d.more?.map((t:any,i:number)=><p key={m.id+':m'+i} className="mu">{t.text}</p>)}</>;
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
  const [m,setM]=useState(''), [msgs,setMsgs]=useState<Msg[]>([]), [b,setB]=useState(false), [typing,setTyping]=useState(false),
    f=useRef<HTMLInputElement>(null), inputRef=useRef<HTMLInputElement>(null);
  const [refImg,setRefImg]=useState<{id:string;thumb?:string}|null>(null); // the reference chip on the composer
  const [up,setUp]=useState(false);
  const [overlay,setOverlay]=useState('');
  const [notice,setNotice]=useState('');
  const [convoId,setConvoId]=useState<string|null>(null);
  const [title,setTitle]=useState('');
  const [histOpen,setHistOpen]=useState(false);
  const [pickOpen,setPickOpen]=useState(false);
  const [showJump,setShowJump]=useState(false);
  const [mode,setMode]=useState<'chat'|'image'>('chat');
  const [imgRatio,setImgRatio]=useState('1:1');
  const [hidden,setHidden]=useState(false);
  const [detached,setDetached]=useState(false);
  const [docked,setDocked]=useState<null|'left'|'right'|'top'|'bottom'>(null);
  const [dragging,setDragging]=useState(false);
  const [edge,setEdge]=useState<null|'left'|'right'|'top'|'bottom'>(null);
  const cardRef=useRef<HTMLDivElement>(null);
  const threadRef=useRef<HTMLDivElement>(null);
  const innerRef=useRef<HTMLDivElement>(null);

  // Drag state kept in refs so pointermove never triggers a React render.
  const dragState=useRef<{ox:number;oy:number;x:number;y:number}|null>(null);
  const rafRef=useRef<number|null>(null);
  const edgeRef=useRef<null|'left'|'right'|'top'|'bottom'>(null);

  const isPage = variant === 'page';

  // Chat state that async code (polls, saves) needs to read without stale closures.
  const msgsRef=useRef<Msg[]>([]); msgsRef.current=msgs;
  const convoRef=useRef<string|null>(null);
  const epoch=useRef(0);          // bumps when the visible conversation changes; late replies and polls for the old one stop
  const alive=useRef(true);
  const polling=useRef<Set<string>>(new Set());
  const stick=useRef(true);       // follow new content only while the reader is near the bottom
  const deepRef=useRef<DeepLink|null>(deepLink); deepRef.current=deepLink;

  useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[]);
  useEffect(()=>{if(prefill){setM(prefill.text);onInteract?.()}},[prefill]); // eslint-disable-line
  useEffect(()=>{if(msgs.length>0)onInteract?.()},[msgs.length>0]); // eslint-disable-line
  // Safety net: Escape restores the hidden composer.
  useEffect(()=>{
    const onKey=(e:KeyboardEvent)=>{ if(e.key==='Escape' && hidden){ setHidden(false); setDocked(null); } };
    addEventListener('keydown', onKey);
    return ()=>removeEventListener('keydown', onKey);
  },[hidden]);

  // ---- scrolling: the thread is its own scroller, bottom-anchored; it follows only while the reader is near the bottom ----
  const scrollBottom=()=>{const el=threadRef.current;if(el)el.scrollTop=el.scrollHeight};
  useLayoutEffect(()=>{if(stick.current)scrollBottom()},[msgs,typing]);
  const threadKey=`${msgs.length>0}|${detached}|${hidden}|${docked}`;
  useEffect(()=>{ // images loading and polls resizing a message also keep the bottom in view
    const inner=innerRef.current;
    if(!inner||typeof ResizeObserver==='undefined')return;
    const ro=new ResizeObserver(()=>{if(stick.current)scrollBottom()});
    ro.observe(inner);
    return()=>ro.disconnect();
  },[threadKey]);
  const onScroll=()=>{const near=nearBottom(threadRef.current);stick.current=near;setShowJump(!near)};
  const jump=()=>{stick.current=true;setShowJump(false);scrollBottom()};

  // ---- conversation id ----
  const setConvo=(id:string|null)=>{
    convoRef.current=id;setConvoId(id);
    if(isPage){try{id?localStorage.setItem(CONVO_KEY,id):localStorage.removeItem(CONVO_KEY)}catch{}}
  };

  // ---- image polling: every pending image polls on its own, keyed by its message id ----
  const pollImage=async(msgId:string,jobId:string,ep:number)=>{
    const key=ep+':'+msgId;
    if(polling.current.has(key))return;
    polling.current.add(key);
    const t0=Date.now();let errs=0;
    const stale=()=>!alive.current||ep!==epoch.current;
    try{
      for(let i=0;i<POLL_MAX;i++){
        await sleep(pollDelay(i));
        if(stale())return;
        try{
          const s=await api<any>('/content/image/'+encodeURIComponent(jobId));
          errs=0;
          if(stale())return;
          const r=pollPatch(s,Math.round((Date.now()-t0)/1000));
          setMsgs(l=>patchMessage(l,msgId,r.patch)); // updates THIS message only
          if(r.done)return;
        }catch{
          if(++errs>=5){setMsgs(l=>patchMessage(l,msgId,{data:{status:'failed',error:'Could not check on this image. Try again.'}}));return}
        }
      }
      if(!stale())setMsgs(l=>patchMessage(l,msgId,{data:{status:'failed',error:'Still generating after a few minutes. Try again.'}}));
    }finally{polling.current.delete(key)}
  };

  // ---- opening / resetting a conversation ----
  const openConversation=async(id:string,quiet=false)=>{
    const ep=++epoch.current;
    setHistOpen(false);setNotice('');
    try{
      const x=await api<any>('/conversations/'+encodeURIComponent(id));
      if(ep!==epoch.current||!alive.current)return;
      const list:Msg[]=(Array.isArray(x.messages)?x.messages:[]).map(fromServerMessage);
      stick.current=true;setShowJump(false);
      setMsgs(list);setConvo(String(x.id||id));setTitle(String(x.title||''));
      list.forEach(mm=>{if(mm.type==='image'&&mm.data?.status==='pending'&&mm.data?.jobId)pollImage(mm.id,mm.data.jobId,ep)}); // pending images resolve
    }catch(err:any){
      if(ep!==epoch.current||!alive.current)return;
      if(id===convoRef.current||quiet){setConvo(null)} // the remembered chat is gone: forget it
      if(!quiet)setNotice(err?.message||'Could not open that chat.');
    }
  };
  const newChat=()=>{
    epoch.current++;
    setMsgs([]);setConvo(null);setTitle('');setRefImg(null);setNotice('');setHistOpen(false);setM('');setShowJump(false);
    stick.current=true;
    onReset?.();
  };
  const clearThread=newChat;

  // Reload resumes the open conversation (a deep link, applied below, wins over it).
  useEffect(()=>{
    if(!isPage||deepRef.current?.cc)return;
    let id:string|null=null;try{id=localStorage.getItem(CONVO_KEY)}catch{}
    if(id)openConversation(id,true);
  },[]); // eslint-disable-line

  // ---- reference image ----
  const attachRef=(id:string,thumb?:string)=>{setRefImg({id,thumb:thumb||cachedThumb(id)});setNotice('');inputRef.current?.focus()};
  const cont=(id:string,ratio?:string,thumb?:string)=>{ // "Continue editing": reference + image mode + the same ratio
    attachRef(id,thumb);setMode('image');
    if(ratio&&RATIOS.includes(ratio))setImgRatio(ratio);
  };
  useEffect(()=>{ // a chip without a thumbnail yet (deep link) fetches it through the batched library call
    if(!refImg||refImg.thumb)return;
    const id=refImg.id;
    loadThumbs([id]).then(()=>setRefImg(r=>r&&r.id===id?{...r,thumb:cachedThumb(id)||''}:r));
  },[refImg?.id,refImg?.thumb]); // eslint-disable-line

  // Deep link from the hash: open that conversation and/or pre-select the reference image.
  useEffect(()=>{
    if(!deepLink)return;
    if(deepLink.cc&&deepLink.cc!==convoRef.current)openConversation(deepLink.cc);
    if(deepLink.ref)cont(deepLink.ref);
  },[deepLink?.id]); // eslint-disable-line

  // Legacy file upload: now goes through the library (POST /api/images/upload) and the chip carries the new image id.
  const pick=async(e:any)=>{
    const x=e.target.files?.[0];e.target.value='';
    if(!x)return;
    if(!/^image\/(png|jpe?g|webp)$/.test(x.type)){setNotice('Use a PNG, JPEG or WebP image.');return}
    if(x.size>6*1024*1024){setNotice('That image is over 6 MB.');return}
    setUp(true);setNotice('');
    try{
      const dataUrl=await new Promise<string>((res,rej)=>{const fr=new FileReader();fr.onload=()=>res(String(fr.result));fr.onerror=()=>rej(new Error('Could not read that file'));fr.readAsDataURL(x)});
      const u=await api<any>('/images/upload',{method:'POST',body:{dataUrl}});
      rememberThumb(u.id,u.thumb);setRefImg({id:u.id,thumb:u.thumb});
    }catch(err:any){setNotice(err?.message||'Upload failed')}
    setUp(false);
  };

  // ---- sending ----
  type Req={text:string;image:boolean;ratio:string;referenceImageId?:string;overlayText?:string;showUser:boolean};
  const submit=async(o:Req)=>{
    onInteract?.();setNotice('');setB(true);stick.current=true;
    const ep=epoch.current;
    const phId=newClientId();
    if(o.showUser)setMsgs(l=>appendMessage(l,{id:newClientId(),role:'user',type:'info',text:o.text}));
    // An image request appends its OWN placeholder; nothing already in the thread is touched.
    if(o.image)setMsgs(l=>appendMessage(l,{id:phId,role:'assistant',type:'image',text:'',data:{status:'pending',imageIds:[],ratio:o.ratio,referenceImageId:o.referenceImageId,overlayText:o.overlayText,summary:'Sending your request…'}}));
    else setTyping(true);
    try{
      const x=await api<any>('/assistant',{method:'POST',body:buildAssistantBody({text:o.text,conversationId:convoRef.current,image:o.image,ratio:o.ratio,referenceImageId:o.referenceImageId,overlayText:o.overlayText})});
      if(ep!==epoch.current||!alive.current)return; // the person moved to another chat meanwhile
      if(x.conversationId)setConvo(String(x.conversationId));
      const d=x.data&&typeof x.data==='object'?x.data:{};
      const isImg=x.type==='image'&&!!d.jobId;
      const serverId=x.messageId!==undefined&&x.messageId!==null?String(x.messageId):undefined;
      const reply={type:String(x.type||'info'),text:String(x.text||''),serverId,data:isImg?{...d,status:'pending',imageIds:[]}:d};
      const aid=o.image?phId:messageId(serverId);
      if(o.image)setMsgs(l=>patchMessage(l,phId,reply));
      else setMsgs(l=>appendMessage(l,{id:aid,role:'assistant',...reply}));
      if(isImg)pollImage(aid,d.jobId,ep);
    }catch(err:any){
      if(ep!==epoch.current||!alive.current)return;
      const text=err?.message||'Something went wrong';
      if(o.image)setMsgs(l=>patchMessage(l,phId,{data:{status:'failed',error:text}}));
      else setMsgs(l=>appendMessage(l,{id:newClientId(),role:'assistant',type:'info',text}));
      if(o.referenceImageId)setRefImg(r=>r||{id:o.referenceImageId!,thumb:cachedThumb(o.referenceImageId!)});
    }finally{setB(false);setTyping(false)}
  };
  const send=(e:FormEvent)=>{
    e.preventDefault();
    if(!m.trim()||b||up)return;
    const image=mode==='image';
    const o:Req={text:m.trim(),image,ratio:imgRatio,referenceImageId:refImg?.id,overlayText:image?overlay.trim():'',showUser:true};
    setM('');setRefImg(null);setOverlay('');
    submit(o);
  };
  const retry=(id:string)=>{
    if(b)return;
    const p=retryParams(msgsRef.current,id);
    if(!p)return;
    submit({text:p.text,image:true,ratio:p.ratio||imgRatio,referenceImageId:p.referenceImageId,overlayText:p.overlayText,showUser:false}); // a NEW placeholder; the failed one stays as it was
  };

  // ---- save to album: POST /api/albums/items. 201 (created) and 200 existing:true both mean it is saved. ----
  const save=async(id:string)=>{
    const mm=msgsRef.current.find(x=>x.id===id);
    const ids=imageIdsOf(mm);
    if(!mm||!ids.length||mm.data?.saved===true||mm.data?.saved==='saving')return;
    setMsgs(l=>patchMessage(l,id,{data:{saved:'saving',saveError:undefined}}));
    try{
      await api('/albums/items',{method:'POST',body:{imageIds:ids,ratio:mm.data?.ratio||undefined,conversationId:convoRef.current||undefined}});
      setMsgs(l=>patchMessage(l,id,{data:{saved:true}}));
    }catch(err:any){setMsgs(l=>patchMessage(l,id,{data:{saved:false,saveError:err?.message||'Could not save'}}))}
  };

  const handlers:ImageHandlers={attachRef,cont,save,retry,layout:()=>{if(stick.current)scrollBottom()}};


  const go=(t:string)=>{setM(t);onInteract?.()};

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
      {notice && <div className="chat-note" role="alert">{notice}</div>}
      {refImg && <div className="ref-chip">
        {refImg.thumb ? <img src={refImg.thumb} alt=""/> : <span className="ref-ph sk"/>}
        <span>Reference image</span>
        <button type="button" className="ref-x" onClick={()=>setRefImg(null)} aria-label="Remove reference image" title="Remove reference image">×</button>
      </div>}
      <form onSubmit={send} className="chat-form">
        <input ref={f} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={pick}/>
        <button type="button" className={refImg?'on':''} disabled={up} onClick={()=>f.current?.click()} title="Upload an image to use as the reference" aria-label="Upload a reference image">{up?'…':ICONS.clip}</button>
        <button type="button" onClick={()=>setPickOpen(true)} title="Pick a reference from your images" aria-label="Pick a reference from your images">{ICONS.content}</button>

        <input ref={inputRef} value={m} onChange={e=>setM(e.target.value)}
          placeholder={mode==='image' ? (refImg ? "Say what to change in the reference image..." : "Describe the image to generate...") : "Ask for analytics, an image, ideas, a budget…"}/>

        {mode==='image' && (
          <select value={imgRatio} onChange={e=>setImgRatio(e.target.value)} className="ratio-select" aria-label="Image ratio">
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

        <button type="submit" id="assistant-send" disabled={b||up||!m.trim()}>{b?'…':'Send'}</button>
      </form>
      {mode==='image' && <div className="overlay-row">
        <input value={overlay} maxLength={120} onChange={e=>setOverlay(e.target.value)} placeholder="Text on the image (optional)" aria-label="Text on the image"/>
      </div>}
    </div>
  );

  const thread = (
    <div className="thread-wrap">
      <div className={isPage ? 'chat-thread page-thread' : 'chat-thread'} ref={threadRef} onScroll={onScroll} role="log" aria-live="polite">
        <div className="thread-inner" ref={innerRef}>
          {msgs.map(msg=><Message key={msg.id} m={msg} h={handlers}/>)}
          {typing && <div className="chat-msg assistant"><div className="avatar"><span>AI</span></div><div className="bubble typing"><i/><i/><i/></div></div>}
        </div>
      </div>
      {showJump && <button type="button" className="jump-latest" onClick={jump}>↓ Jump to latest</button>}
    </div>
  );

  const toolbar = isPage && (
    <div className="chat-toolbar">
      <button type="button" className="chat-tool" onClick={()=>setHistOpen(true)} title="Chat history">{ICONS.Scheduling}<span>History</span></button>
      <button type="button" className="chat-tool" onClick={newChat} title="Start a new chat">{ICONS.start}<span>New chat</span></button>
      {title && <span className="chat-title mu" title={title}>{title}</span>}
    </div>
  );

  // Picker (both variants) and history drawer (page variant): fixed overlays, so they never move the layout.
  const overlays = <>
    {pickOpen && <ImagePicker onClose={()=>setPickOpen(false)} onPick={img=>{rememberThumb(img.id,img.thumb);attachRef(img.id,img.thumb);setPickOpen(false)}}/>}
    {isPage && histOpen && <HistoryDrawer currentId={convoId}
      onClose={()=>setHistOpen(false)}
      onNew={newChat}
      onOpen={id=>{setRefImg(null);if(id===convoRef.current)setHistOpen(false);else openConversation(id)}}
      onDeleted={id=>{if(id===convoRef.current)newChat()}}
      onRenamed={(id,t)=>{if(id===convoRef.current)setTitle(t)}}/>}
  </>;

  // ---- PAGE VARIANT (Command Center) ----
  if (isPage) {
    return (
      <div className="assistant-page">
        {toolbar}
        {showSuggestions && suggestionsRow}
        {msgs.length > 0 && thread}
        {composerForm()}
        {overlays}
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
    {overlays}
  </>;
}