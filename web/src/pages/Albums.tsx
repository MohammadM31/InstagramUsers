// Albums: saved posts organised like a phone photo album (contract 4.5). Overview tiles and folders on top, a paged grid of posts when one is opened.
// Reads: GET /api/albums, GET /api/albums/items. Writes (optimistic, rolled back when the server refuses): PATCH/DELETE /api/albums/items/:id,
// POST /api/albums/items/move, POST/PATCH/DELETE /api/albums/folders. Thumbnails come in batches of 40 from GET /api/images?ids= (see albums/thumbstore.ts).
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import '../albums.css';
import {Icon} from '../icons';
import {CATEGORIES,categoryLabel,duplicateFolder,orderedAlbums,ratioShape} from '../albums/model';
import type {AlbumSummary,Category,FolderSummary,Item,Overview,Status} from '../albums/model';
import * as A from '../albums/client';
import {Collage,Img} from '../albums/Thumb';
import {usePrefetch} from '../albums/thumbstore';
import ItemSheet from '../albums/ItemSheet';
import {Confirm,Prompt} from '../albums/Dialog';

type View={kind:'home'}|{kind:'all'}|{kind:'category';category:Category}|{kind:'folder';folderId:string};
type Notify=(text:string,bad?:boolean)=>void;
type Dlg=null|{k:'new'}|{k:'rename';f:FolderSummary}|{k:'del';f:FolderSummary};

const plural=(n:number,one:string,many=one+'s')=>n+' '+(n===1?one:many);

export default function Albums({go}:{go?:(page:string)=>void}){
  const [ov,setOv]=useState<Overview|null>(null);
  const [err,setErr]=useState('');
  const [view,setView]=useState<View>({kind:'home'});
  const [dlg,setDlg]=useState<Dlg>(null);
  const [dErr,setDErr]=useState('');
  const [busy,setBusy]=useState(false);
  const [toast,setToast]=useState<{text:string;bad:boolean}|null>(null);
  const timer=useRef<any>(0),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;clearTimeout(timer.current)}},[]);

  const notify:Notify=useCallback((text,bad=false)=>{setToast({text,bad});clearTimeout(timer.current);timer.current=setTimeout(()=>setToast(null),bad?7000:4000)},[]);
  const load=useCallback(()=>A.getOverview().then(d=>{if(alive.current){setOv(d);setErr('')}}),[]);
  useEffect(()=>{load().catch(e=>{if(alive.current)setErr((e&&e.message)||'Could not load your albums')})},[load]); // first load: failures show the error state
  const refresh=useCallback(()=>{load().catch(()=>{})},[load]); // after a change: a failed refresh keeps what is on screen

  const folders=ov?.folders||[];
  const albums=orderedAlbums(ov?.albums); // always the five categories in the fixed order
  const covers=useMemo(()=>[...(ov?.albums||[]).flatMap(a=>a.coverImageIds||[]),...(ov?.folders||[]).flatMap(f=>f.coverImageIds||[])],[ov]);
  usePrefetch(covers);

  const dupMsg=(m:string)=>duplicateFolder(m)?'A folder with that name already exists.':m;
  const createFolder=async(name:string)=>{
    setBusy(true);setDErr('');
    try{await A.createFolder(name);setDlg(null);refresh();notify('Folder “'+name+'” created')}
    catch(e){setDErr(dupMsg((e&&e.message)||'Could not create the folder'))}
    finally{setBusy(false)}
  };
  const renameFolder=async(f:FolderSummary,name:string)=>{
    setDlg(null);if(name===f.name)return;
    const before=ov;
    setOv(o=>o&&{...o,folders:o.folders.map(x=>x.id===f.id?{...x,name}:x)}); // optimistic
    try{await A.renameFolder(f.id,name);refresh()}
    catch(e){setOv(before);refresh();notify('Could not rename the folder. '+dupMsg((e&&e.message)||''),true)} // rollback
  };
  const removeFolder=async(f:FolderSummary)=>{
    setDlg(null);
    const before=ov;
    if(view.kind==='folder'&&view.folderId===f.id)setView({kind:'home'});
    setOv(o=>o&&{...o,folders:o.folders.filter(x=>x.id!==f.id)}); // optimistic
    try{await A.deleteFolder(f.id);refresh();notify('Folder deleted. Its posts are now unfiled.')}
    catch(e){setOv(before);refresh();notify('Could not delete the folder: '+((e&&e.message)||'try again'),true)} // rollback
  };

  const viewKey=view.kind==='category'?'c:'+view.category:view.kind==='folder'?'f:'+view.folderId:view.kind;
  return <div className="alb">
    {view.kind==='home'
      ? <Home ov={ov} err={err} albums={albums} folders={folders} go={go} onRetry={()=>{setErr('');load().catch(e=>setErr((e&&e.message)||'Could not load your albums'))}}
          onOpen={setView} onNew={()=>{setDErr('');setDlg({k:'new'})}} onRename={f=>{setDErr('');setDlg({k:'rename',f})}} onDelete={f=>setDlg({k:'del',f})}/>
      : <ItemList key={viewKey} view={view} folders={folders} onBack={()=>{setView({kind:'home'});refresh()}} refresh={refresh} notify={notify}/>}

    {toast&&<div className={'alb-toast'+(toast.bad?' bad':'')} role={toast.bad?'alert':'status'}><span>{toast.text}</span><button className="alb-x sm" aria-label="Dismiss" onClick={()=>setToast(null)}><Icon name="close" size={16}/></button></div>}

    {dlg?.k==='new'&&<Prompt title="New folder" label="Folder name" confirmLabel="Create" busy={busy} error={dErr} onSubmit={createFolder} onCancel={()=>setDlg(null)}/>}
    {dlg?.k==='rename'&&<Prompt title="Rename folder" label="Folder name" initial={dlg.f.name} onSubmit={n=>renameFolder(dlg.f,n)} onCancel={()=>setDlg(null)}/>}
    {dlg?.k==='del'&&<Confirm title={'Delete the folder “'+dlg.f.name+'”?'} danger confirmLabel="Delete folder" onCancel={()=>setDlg(null)} onConfirm={()=>removeFolder(dlg.f)}
      body={<>Only the folder is deleted. Its {plural(dlg.f.count,'post')} {dlg.f.count===1?'stays':'stay'} in your albums and become unfiled: nothing is deleted.</>}/>}
  </div>;
}

/* ---------- overview: category tiles + folders ---------- */
function Home({ov,err,albums,folders,go,onRetry,onOpen,onNew,onRename,onDelete}:{ov:Overview|null;err:string;albums:AlbumSummary[];folders:FolderSummary[];go?:(p:string)=>void;onRetry:()=>void;onOpen:(v:View)=>void;onNew:()=>void;onRename:(f:FolderSummary)=>void;onDelete:(f:FolderSummary)=>void}){
  return <>
    <header className="alb-head">
      <div><h1>Albums</h1><p className="mu">{ov?plural(ov.total,'saved post'):'Your saved posts, organised'}</p></div>
      <button className="btn g" onClick={onNew} disabled={!ov}><Icon name="plus" size={16}/> New folder</button>
    </header>
    {!ov&&!err&&<div className="alb-grid" aria-busy="true" aria-label="Loading albums">{Array.from({length:5},(_,i)=><span key={i} className="alb-tile-sk sk"/>)}</div>}
    {!ov&&err&&<div className="alb-state" role="alert"><p>⚠ {err}</p><button className="btn" onClick={onRetry}>Try again</button></div>}
    {ov&&<>
      {ov.total===0&&<div className="alb-empty">
        <Icon name="albums" size={34}/>
        <p><b>Nothing saved yet</b></p>
        <p className="mu">Create an image in the Command Center and save it as a post. It will show up here, sorted into the right album.</p>
        {go&&<button className="btn" onClick={()=>go('Dashboard')}>Open Command Center</button>}
      </div>}
      <section aria-labelledby="alb-cats">
        <h2 className="alb-h2" id="alb-cats">Categories</h2>
        <div className="alb-grid">{albums.map(a=>
          <button key={a.category} className="alb-tile" onClick={()=>onOpen({kind:'category',category:a.category})} aria-label={categoryLabel(a.category)+', '+plural(a.count,'post')}>
            <Collage ids={a.coverImageIds} empty="No posts yet"/>
            <span className="alb-meta"><b>{categoryLabel(a.category)}</b><span>{a.count}</span></span>
          </button>)}</div>
      </section>
      <section aria-labelledby="alb-folders">
        <h2 className="alb-h2" id="alb-folders">Folders</h2>
        {folders.length===0
          ? <p className="alb-note">No folders yet. Create one with “New folder” to group posts your own way.</p>
          : <div className="alb-grid">{folders.map(f=>
              <div key={f.id} className="alb-tile-wrap">
                <button className="alb-tile" onClick={()=>onOpen({kind:'folder',folderId:f.id})} aria-label={'Folder '+f.name+', '+plural(f.count,'post')}>
                  <Collage ids={f.coverImageIds} empty="Empty folder"/>
                  <span className="alb-meta"><b>{f.name}</b><span>{f.count}</span></span>
                </button>
                <span className="alb-tile-tools">
                  <button className="alb-x sm" aria-label={'Rename folder '+f.name} title="Rename" onClick={()=>onRename(f)}><Icon name="edit" size={15}/></button>
                  <button className="alb-x sm" aria-label={'Delete folder '+f.name} title="Delete" onClick={()=>onDelete(f)}><Icon name="trash" size={15}/></button>
                </span>
              </div>)}</div>}
      </section>
      {ov.total>0&&<button className="alb-all" onClick={()=>onOpen({kind:'all'})}>All posts ({ov.total})</button>}
    </>}
  </>;
}

/* ---------- a grid of posts: one category, one folder, or everything ---------- */
function ItemList({view,folders,onBack,refresh,notify}:{view:View;folders:FolderSummary[];onBack:()=>void;refresh:()=>void;notify:Notify}){
  const [items,setItems]=useState<Item[]>([]);
  const [next,setNext]=useState<string|undefined>();
  const [phase,setPhase]=useState<'loading'|'ok'|'error'>('loading');
  const [err,setErr]=useState('');
  const [moreBusy,setMoreBusy]=useState(false);
  const [moreErr,setMoreErr]=useState('');
  const [q,setQ]=useState(''),[qd,setQd]=useState('');
  const [status,setStatus]=useState<'all'|Status>('all');
  const [selecting,setSelecting]=useState(false);
  const [sel,setSel]=useState<Set<string>>(new Set());
  const [dest,setDest]=useState('');
  const [moving,setMoving]=useState(false);
  const [openId,setOpenId]=useState<string|null>(null);
  const [nonce,setNonce]=useState(0);
  const req=useRef(0);

  useEffect(()=>{const t=setTimeout(()=>setQd(q.trim()),300);return()=>clearTimeout(t)},[q]); // search waits for a pause in typing
  const category=view.kind==='category'?view.category:undefined,folderId=view.kind==='folder'?view.folderId:undefined;
  const params=useMemo(()=>({category,folderId,status:status==='all'?undefined:status,q:qd||undefined,limit:50}),[category,folderId,status,qd]);

  useEffect(()=>{
    const id=++req.current; // a slower, older response can never overwrite a newer one
    setPhase('loading');setErr('');setMoreErr('');setSel(new Set());
    A.getItems(params)
      .then(r=>{if(id!==req.current)return;setItems(r.items||[]);setNext(r.next);setPhase('ok')})
      .catch(e=>{if(id!==req.current)return;setErr((e&&e.message)||'Could not load posts');setPhase('error')});
  },[params,nonce]);

  usePrefetch(useMemo(()=>items.map(i=>i.imageIds?.[0]).filter(Boolean) as string[],[items])); // one batched prefetch for every cover on screen

  const matches=(it:Item)=>(!category||it.category===category)&&(!folderId||it.folderId===folderId)&&(status==='all'||it.status===status);
  const title=view.kind==='category'?categoryLabel(view.category):view.kind==='folder'?(folders.find(f=>f.id===view.folderId)?.name||'Folder'):'All posts';

  const more=async()=>{
    if(!next||moreBusy)return;
    const id=req.current;setMoreBusy(true);setMoreErr('');
    try{
      const r=await A.getItems({...params,before:next});
      if(id!==req.current)return;
      setItems(cur=>{const seen=new Set(cur.map(i=>i.id));return[...cur,...(r.items||[]).filter(i=>!seen.has(i.id))]});
      setNext(r.next);
    }catch(e){if(id===req.current)setMoreErr((e&&e.message)||'Could not load more')}
    finally{setMoreBusy(false)}
  };

  // Edit one post. The change shows immediately; if the server refuses, only that post goes back to what it was.
  const patchOne=async(id:string,patch:A.ItemPatch)=>{
    const prev=items.find(i=>i.id===id);if(!prev)return;
    setItems(cur=>cur.map(i=>i.id===id?{...i,...patch,...(patch.category?{categorySource:'user' as const}:{})} as Item:i)); // optimistic
    try{const r=await A.patchItem(id,patch);setItems(cur=>cur.map(i=>i.id===id?r.item:i));refresh()}
    catch(e){setItems(cur=>cur.map(i=>i.id===id?prev:i));notify('Could not save: '+((e&&e.message)||'try again'),true)} // rollback
  };
  const removeOne=async(it:Item)=>{
    const at=items.findIndex(i=>i.id===it.id);
    setOpenId(null);setItems(cur=>cur.filter(i=>i.id!==it.id)); // optimistic
    try{await A.deleteItem(it.id);refresh();notify('Post deleted')}
    catch(e){ // rollback: put it back where it was
      setItems(cur=>{if(cur.some(i=>i.id===it.id))return cur;const c=[...cur];c.splice(Math.min(at,c.length),0,it);return c});
      notify('Could not delete the post: '+((e&&e.message)||'try again'),true);
    }
  };
  const closeSheet=()=>{setOpenId(null);setItems(cur=>cur.filter(matches))}; // a post edited out of this view leaves it once the sheet closes

  const toggle=(id:string)=>setSel(s=>{const n=new Set(s);if(n.has(id))n.delete(id);else n.add(id);return n});
  const moveSel=async()=>{
    const ids=[...sel];if(!ids.length||!dest)return;
    const body:A.MoveBody=dest.startsWith('cat:')?{ids,category:dest.slice(4) as Category}:{ids,folderId:dest==='folder:none'?null:dest.slice(7)};
    const snapshot=items;setMoving(true);
    setItems(cur=>cur.map(it=>ids.includes(it.id)?{...it,...(body.category?{category:body.category,categorySource:'user' as const}:{folderId:body.folderId??null})} as Item:it).filter(matches)); // optimistic
    try{
      const r=await A.moveItems(body);
      setSel(new Set());setDest('');setSelecting(false);refresh();
      if(r.moved<ids.length)notify('Moved '+r.moved+' of '+ids.length+' posts. The rest could not be moved.',true);else notify('Moved '+plural(r.moved,'post'));
    }catch(e){setItems(snapshot);notify('Could not move the posts: '+((e&&e.message)||'try again'),true)} // rollback
    finally{setMoving(false)}
  };

  const open=openId?items.find(i=>i.id===openId):undefined;
  const filtered=!!qd||status!=='all';
  return <>
    <header className="alb-head">
      <div className="alb-crumb"><button className="alb-back" onClick={onBack}><Icon name="chevLeft" size={18}/> Albums</button><h1>{title}</h1></div>
      <button className={'btn'+(selecting?'':' g')} aria-pressed={selecting} disabled={phase!=='ok'||!items.length} onClick={()=>{setSelecting(s=>!s);setSel(new Set());setDest('')}}>{selecting?'Done':'Select'}</button>
    </header>
    <div className="alb-filters">
      <label className="alb-search"><Icon name="search" size={16}/>
        <input type="search" value={q} onChange={e=>setQ(e.target.value)} placeholder="Search titles and captions" aria-label="Search posts"/></label>
      <select value={status} onChange={e=>setStatus(e.target.value as 'all'|Status)} aria-label="Filter by status">
        <option value="all">All statuses</option><option value="draft">Drafts</option><option value="ready">Ready</option></select>
    </div>
    {selecting&&<div className="alb-selbar" role="region" aria-label="Selection">
      <b>{sel.size} selected</b>
      <button className="btn g s" onClick={()=>setSel(new Set(items.map(i=>i.id)))}>Select all loaded</button>
      <select value={dest} onChange={e=>setDest(e.target.value)} aria-label="Move selected posts to">
        <option value="">Move to…</option>
        <optgroup label="Folder"><option value="folder:none">No folder</option>{folders.map(f=><option key={f.id} value={'folder:'+f.id}>{f.name}</option>)}</optgroup>
        <optgroup label="Category">{CATEGORIES.map(c=><option key={c.key} value={'cat:'+c.key}>{c.single}</option>)}</optgroup>
      </select>
      <button className="btn s" disabled={!sel.size||!dest||moving} onClick={moveSel}>{moving?'Moving…':'Move'}</button>
    </div>}

    {phase==='loading'&&<div className="alb-grid items" aria-busy="true" aria-label="Loading posts">{Array.from({length:8},(_,i)=><span key={i} className="alb-card-sk sk"/>)}</div>}
    {phase==='error'&&<div className="alb-state" role="alert"><p>⚠ {err}</p><button className="btn" onClick={()=>setNonce(n=>n+1)}>Try again</button></div>}
    {phase==='ok'&&!items.length&&<div className="alb-empty">
      <Icon name="albums" size={30}/>
      <p><b>{filtered?'No posts match':'No posts here yet'}</b></p>
      <p className="mu">{filtered?'Try a different search or status.':view.kind==='folder'?'Open a post and choose this folder, or select posts and move them here.':'Posts you save from the Command Center appear here.'}</p>
      {filtered&&<button className="btn g" onClick={()=>{setQ('');setQd('');setStatus('all')}}>Clear filters</button>}
    </div>}
    {phase==='ok'&&items.length>0&&<>
      <p className="mu alb-count" aria-live="polite">{plural(items.length,'post')}{next?' loaded, more available':''}</p>
      <div className="alb-grid items">{items.map(it=>{
        const on=sel.has(it.id),rs=ratioShape(it.ratio),n=it.imageIds?.length||0;
        return <button key={it.id} className={'alb-card'+(on?' sel':'')} onClick={()=>selecting?toggle(it.id):setOpenId(it.id)}
          aria-pressed={selecting?on:undefined} aria-label={it.title+', '+(it.status==='ready'?'ready':'draft')+(selecting?(on?', selected':', not selected'):'')}>
          <span className="alb-thumb">
            <Img id={it.imageIds?.[0]}/>
            {n>1&&<span className="alb-multi" title={n+' images'}>{n}</span>}
            {selecting&&<span className={'alb-check'+(on?' on':'')}>{on&&<Icon name="check" size={14} sw={3}/>}</span>}
          </span>
          <span className="alb-cmeta">
            <span className="alb-ctitle">{it.title}</span>
            <span className="alb-badges">
              <span className={'alb-status '+it.status}>{it.status==='ready'?'Ready':'Draft'}</span>
              <span className="alb-ratio" title={it.ratio||'1:1'}><i style={{width:rs.w,height:rs.h}}/>{it.ratio||'1:1'}</span>
            </span>
          </span>
        </button>;})}</div>
      {next&&<div className="alb-more"><button className="btn g" onClick={more} disabled={moreBusy}>{moreBusy?'Loading…':'Load more'}</button>
        {moreErr&&<span className="dn" role="alert">⚠ {moreErr}</span>}</div>}
    </>}

    {open&&<ItemSheet item={open} folders={folders} onClose={closeSheet} onPatch={p=>patchOne(open.id,p)} onDelete={()=>removeOne(open)}/>}
  </>;
}