import {useEffect,useRef,useState} from 'react';
import {Icon} from '../icons';
import {Modal,CloseBtn,Confirm} from './Dialog';
import {Img} from './Thumb';
import {fullImages,usePrefetch} from './thumbstore';
import {CATEGORIES,ratioCss} from './model';
import type {Item,Category,Status} from './model';
import type {ItemPatch} from './client';
import {ccHash} from './hash';

// Large preview. Only the image on screen is fetched in full (GET /api/images/:id); the thumbnail sits underneath as the placeholder.
// More than one image: arrow buttons, ArrowLeft/ArrowRight on the focused gallery, swipe on touch screens, and dots.
function Gallery({ids,ratio,title}:{ids:string[];ratio:string|null;title:string}){
  const [i,setI]=useState(0);
  const [st,setSt]=useState<{id:string;url?:string;err?:string}>({id:''});
  const [nonce,setNonce]=useState(0);
  const touch=useRef<number|null>(null);
  const n=ids.length,cur=Math.min(i,Math.max(0,n-1)),id=ids[cur];
  const step=(d:number)=>{if(n>1)setI(x=>(Math.min(x,n-1)+d+n)%n)};
  useEffect(()=>{
    if(!id)return;
    let live=true;
    const hit=fullImages.get(id);
    if(hit)setSt({id,url:hit});
    else{
      setSt({id});
      fullImages.load(id).then(url=>{if(live)setSt({id,url})}).catch(e=>{if(live)setSt({id,err:(e&&e.message)||'Could not load the image'})});
    }
    return()=>{live=false};
  },[id,nonce]);
  if(!id)return <div className="alb-gal"><div className="alb-stage" style={{aspectRatio:ratioCss(ratio)}}><span className="alb-img none"><Icon name="content" size={28}/></span></div></div>;
  const shown=st.id===id?st:{id} as {id:string;url?:string;err?:string};
  return <div className="alb-gal" tabIndex={0} aria-roledescription="carousel" aria-label={title+', image '+(cur+1)+' of '+n}
    onKeyDown={e=>{if(e.key==='ArrowLeft'){e.preventDefault();step(-1)}else if(e.key==='ArrowRight'){e.preventDefault();step(1)}}}
    onTouchStart={e=>{touch.current=e.touches[0].clientX}}
    onTouchEnd={e=>{const x0=touch.current;touch.current=null;if(x0===null)return;const dx=e.changedTouches[0].clientX-x0;if(Math.abs(dx)>40)step(dx<0?1:-1)}}>
    <div className="alb-stage" style={{aspectRatio:ratioCss(ratio)}}>
      <Img id={id}/>
      {shown.url&&<img className="alb-full" src={shown.url} alt={title+' ('+(cur+1)+' of '+n+')'} draggable={false}/>}
      {!shown.url&&!shown.err&&<span className="alb-spin" role="status" aria-label="Loading image"/>}
      {shown.err&&<span className="alb-fail" role="alert"><span>{shown.err}</span><button className="btn s" onClick={()=>setNonce(x=>x+1)}>Retry</button></span>}
    </div>
    {n>1&&<>
      <button className="alb-arrow l" onClick={()=>step(-1)} aria-label="Previous image"><Icon name="chevLeft" size={22}/></button>
      <button className="alb-arrow r" onClick={()=>step(1)} aria-label="Next image"><Icon name="chevRight" size={22}/></button>
      <div className="alb-dots">{ids.map((x,k)=><button key={x+k} className={k===cur?'on':''} aria-label={'Image '+(k+1)+' of '+n} aria-current={k===cur||undefined} onClick={()=>setI(k)}/>)}</div>
    </>}
  </div>;
}

export default function ItemSheet({item,folders,onClose,onPatch,onDelete}:{item:Item;folders:{id:string;name:string}[];onClose:()=>void;onPatch:(p:ItemPatch)=>void;onDelete:()=>void}){
  const [title,setTitle]=useState(item.title);
  const [caption,setCaption]=useState(item.caption||'');
  const [ask,setAsk]=useState(false);
  // The parent applies edits optimistically and rolls them back on failure; either way the field follows the item.
  useEffect(()=>{setTitle(item.title)},[item.title]);
  useEffect(()=>{setCaption(item.caption||'')},[item.caption]);
  usePrefetch(item.imageIds||[]);

  const saveTitle=()=>{const t=title.trim();if(!t){setTitle(item.title);return}if(t!==item.title)onPatch({title:t})};
  const saveCaption=()=>{if(caption!==(item.caption||''))onPatch({caption})};
  const canContinue=!!item.conversationId;
  const why='This post was not created from a chat, so there is no conversation to reopen.';
  // "Continue editing": the Command Center reads #cc=<conversationId>&ref=<coverImageId> (contract 4.7) and App.tsx re-reads the hash on `nav`.
  const cont=()=>{
    if(!item.conversationId)return;
    location.hash=ccHash(item.conversationId,item.imageIds?.[0]);
    window.dispatchEvent(new Event('nav'));
  };

  return <>
  <Modal label={'Post: '+item.title} onClose={onClose} sheet>
    <div className="alb-sheet">
      <div className="alb-sheet-head"><span className="mu">Saved {new Date(item.createdAt).toLocaleDateString()}</span><CloseBtn onClick={onClose}/></div>
      <div className="alb-sheet-body">
        <Gallery ids={item.imageIds||[]} ratio={item.ratio} title={item.title}/>
        <div className="alb-form">
          <label className="alb-field"><span>Title</span>
            <input value={title} maxLength={120} onChange={e=>setTitle(e.target.value)} onBlur={saveTitle} onKeyDown={e=>{if(e.key==='Enter')(e.target as HTMLInputElement).blur()}}/></label>
          <label className="alb-field"><span>Caption</span>
            <textarea rows={5} value={caption} maxLength={2200} onChange={e=>setCaption(e.target.value)} onBlur={saveCaption} placeholder="Write a caption…"/></label>
          <div className="alb-two">
            <label className="alb-field"><span>Category</span>
              <select value={item.category} onChange={e=>onPatch({category:e.target.value as Category})}>
                {CATEGORIES.map(c=><option key={c.key} value={c.key}>{c.single}</option>)}</select>
              <small className="mu">{item.categorySource==='user'?'Set by you':'Detected automatically'}</small></label>
            <label className="alb-field"><span>Folder</span>
              <select value={item.folderId||''} onChange={e=>onPatch({folderId:e.target.value||null})}>
                <option value="">No folder</option>{folders.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
          </div>
          <div className="alb-field"><span>Status</span>
            <div className="alb-seg" role="group" aria-label="Status">
              {(['draft','ready'] as Status[]).map(s=><button key={s} className={item.status===s?'on':''} aria-pressed={item.status===s} onClick={()=>{if(item.status!==s)onPatch({status:s})}}>{s==='draft'?'Draft':'Ready'}</button>)}
            </div></div>
          <div className="alb-actions-row">
            <span className="alb-tip" title={canContinue?undefined:why}>
              <button className="btn" onClick={cont} disabled={!canContinue} title={canContinue?'Reopen the chat this post came from':why}><Icon name="chat" size={16}/> Continue editing</button>
            </span>
            <button className="btn g alb-del" onClick={()=>setAsk(true)}><Icon name="trash" size={16}/> Delete</button>
          </div>
          {!canContinue&&<p className="mu alb-note">{why}</p>}
        </div>
      </div>
    </div>
  </Modal>
  {ask&&<Confirm title="Delete this post?" danger confirmLabel="Delete post" onCancel={()=>setAsk(false)} onConfirm={()=>{setAsk(false);onDelete()}}
      body={<>“{item.title}” will be removed from your albums. The images stay in your image library.</>}/>}
  </>;
}