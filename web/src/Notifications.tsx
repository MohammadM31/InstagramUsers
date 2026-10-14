// Roadmap 2.3: bell with an unread badge and the latest 20 notifications. Every item can be marked read or dismissed.
import {useCallback,useEffect,useState} from 'react';
import {api} from './api';
import {ICONS} from './icons';

type N={id:number;kind:string;title:string;body:string;watch?:string|null;created_at:string;read_at:string|null};
const ago=(v:string)=>{const m=Math.round((Date.now()-new Date(v).getTime())/6e4);return m<1?'just now':m<60?m+' min ago':m<1440?Math.round(m/60)+' h ago':Math.round(m/1440)+' d ago'};

export default function Notifications(){
  const[d,setD]=useState<{unread:number;items:N[]}>({unread:0,items:[]}),[open,setOpen]=useState(false),[err,setErr]=useState('');
  const load=useCallback(()=>{api('/notifications').then(x=>{setD(x);setErr('')}).catch(e=>setErr(e.message))},[]);
  useEffect(()=>{load();const t=setInterval(load,60000);return()=>clearInterval(t)},[load]);
  const act=(p:string,o:{method:string;body?:any})=>api(p,o).then(load).catch(e=>setErr(e.message));
  return <span className="bellw">
    <button className="ib" aria-label={'Notifications'+(d.unread?` (${d.unread} unread)`:'')} onClick={()=>{setOpen(o=>!o);if(!open)load()}}>{ICONS.bell}{d.unread>0&&<span className="bb">{d.unread>9?'9+':d.unread}</span>}</button>
    {open&&<><div className="nscrim" onClick={()=>setOpen(false)}/><div className="nlist" role="dialog" aria-label="Notifications">
      <div className="row" style={{margin:'0 0 4px',justifyContent:'space-between'}}><b>Notifications</b>{d.unread>0&&<button className="btn g s" onClick={()=>act('/notifications/read-all',{method:'PATCH'})}>Mark all read</button>}</div>
      {err&&<div className="st dn">⚠ {err}</div>}
      {!err&&!d.items.length&&<div className="st">Nothing new. Alerts appear when reach or engagement moves, a post sets a new best, or a competitor pulls ahead.</div>}
      {d.items.map(n=><div key={n.id} className={'nit'+(n.read_at?'':' un')} onClick={()=>!n.read_at&&act('/notifications/'+n.id,{method:'PATCH',body:{read:true}})}>
        <button className="nx" aria-label="Dismiss" onClick={e=>{e.stopPropagation();act('/notifications/'+n.id,{method:'DELETE'})}}>✕</button>
        <b>{n.title}</b><p>{n.body}</p>
        <span className="mu">{n.watch&&<>Watch: {n.watch}. </>}{ago(n.created_at)}</span></div>)}
    </div></>}
  </span>}
