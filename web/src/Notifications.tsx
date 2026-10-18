// Roadmap 2.3: notifications. One fetch (useNotifications) feeds two pieces of the top bar:
//   <Bell/>        heart icon with an unread badge and the latest 20 notifications; every item can be marked read or dismissed.
//   <AlertBanner/> the newest unread reach/engagement drop, shown as a dismissible banner. It only appears when the server has such an alert.
import {useCallback,useEffect,useState} from 'react';
import {api} from './api';
import {Icon} from './icons';
import type {IconName} from './icons';

type N={id:number;kind:string;title:string;body:string;watch?:string|null;created_at:string;read_at:string|null};
export type Notif=ReturnType<typeof useNotifications>;
const ago=(v:string)=>{const m=Math.round((Date.now()-new Date(v).getTime())/6e4);return m<1?'just now':m<60?m+' min ago':m<1440?Math.round(m/60)+' h ago':Math.round(m/1440)+' d ago'};
const KIND_ICON:Record<string,IconName>={reach_drop:'trendDown',er_drop:'trendDown',best_post:'trendUp',competitor:'crm',competitor_growth:'crm'};
const DROPS=['reach_drop','er_drop'];
const SEEN_KEY='rt:alert:dismissed';

// `enabled` must be false on the login and onboarding screens: a 401 from api() reloads the page, which would loop on the login form.
export function useNotifications(enabled:boolean){
  const[d,setD]=useState<{unread:number;items:N[]}>({unread:0,items:[]}),[err,setErr]=useState('');
  const load=useCallback(()=>{api('/notifications').then(x=>{setD(x);setErr('')}).catch(e=>setErr(e.message))},[]);
  useEffect(()=>{if(!enabled)return;load();const t=setInterval(load,60000);return()=>clearInterval(t)},[enabled,load]);
  const act=useCallback((p:string,o:{method:string;body?:any})=>api(p,o).then(load).catch(e=>setErr(e.message)),[load]);
  return{d,err,load,act};
}

export function Bell({n}:{n:Notif}){
  const{d,err,load,act}=n,[open,setOpen]=useState(false);
  return <span className="bellw">
    <button className="ib" aria-label={'Notifications'+(d.unread?` (${d.unread} unread)`:'')} aria-expanded={open} onClick={()=>{setOpen(o=>!o);if(!open)load()}}>
      <Icon name="heart"/>{d.unread>0&&<span className="bb">{d.unread>9?'9+':d.unread}</span>}</button>
    {open&&<><div className="nscrim" onClick={()=>setOpen(false)}/><div className="nlist" role="dialog" aria-label="Notifications">
      <div className="nhead"><b>Notifications</b>{d.unread>0&&<button className="btn g s" onClick={()=>act('/notifications/read-all',{method:'PATCH'})}>Mark all read</button>}</div>
      {err&&<div className="st dn">⚠ {err}</div>}
      {!err&&!d.items.length&&<div className="st">Nothing new. Alerts appear when reach or engagement moves, a post sets a new best, or a competitor pulls ahead.</div>}
      {d.items.map(x=><div key={x.id} className={'nit'+(x.read_at?'':' un')} onClick={()=>!x.read_at&&act('/notifications/'+x.id,{method:'PATCH',body:{read:true}})}>
        <span className="rg" style={{['--s' as any]:'44px'}}><i><Icon name={KIND_ICON[x.kind]||'analytics'} size={22}/></i></span>
        <div className="nbody">
          <button className="nx" aria-label="Dismiss" onClick={e=>{e.stopPropagation();act('/notifications/'+x.id,{method:'DELETE'})}}><Icon name="close" size={16}/></button>
          <b>{x.title}</b><p>{x.body}</p>
          <span className="mu">{x.watch&&<>Watch: {x.watch}. </>}{ago(x.created_at)}</span></div></div>)}
    </div></>}
  </span>}

export function AlertBanner({n}:{n:Notif}){
  const[gone,setGone]=useState(()=>{try{return sessionStorage.getItem(SEEN_KEY)}catch{return null}});
  const a=n.d.items.find(x=>!x.read_at&&DROPS.includes(x.kind));
  if(!a||String(a.id)===gone)return null;
  // Dismissing only hides the banner for this browser session; the notification stays in the bell until it is read or deleted.
  const hide=()=>{setGone(String(a.id));try{sessionStorage.setItem(SEEN_KEY,String(a.id))}catch{}};
  return <div className="alertb" role="alert"><Icon name="alert" size={22}/><span className="alt">Alert: {a.title}</span>
    <button className="alx" aria-label="Dismiss alert" onClick={hide}><Icon name="close" size={20}/></button></div>}
