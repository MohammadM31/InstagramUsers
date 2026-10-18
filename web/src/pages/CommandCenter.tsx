// The default landing page: left = navigation + Instagram status + account, centre = morning briefing + the embedded assistant,
// right = alerts, the daily report (top 3 priorities with "Fix this") and the goal card.
import {useCallback,useEffect,useState} from 'react';
import {api,useQ} from '../api';
import {St,Card} from '../ui';
import {ICONS} from '../icons';
import Assistant from '../Assistant';
import type {Prefill} from '../Assistant';
import {GoalCard} from './DashboardCards';
import type {IgStatus} from '../ig';
import {briefing,fixQuestion,pickAlerts,connectionView} from '../cc';
import type {Tip,AlertItem} from '../cc';

// pages = the keys of App's PAGES map, passed in as props: importing PAGES from App would be a circular import (PAGES contains this page).
type Props={pages:string[];page:string;go:(k:string)=>void;onLogout:()=>void};
const ago=(v:string)=>{const m=Math.round((Date.now()-new Date(v).getTime())/6e4);return m<1?'just now':m<60?m+' min ago':m<1440?Math.round(m/60)+' h ago':Math.round(m/1440)+' d ago'};

function Alerts(){
  const[items,setItems]=useState<AlertItem[]>([]),[unread,setUnread]=useState(0),[err,setErr]=useState(''),[loaded,setLoaded]=useState(false);
  const load=useCallback(()=>{api<{unread:number;items:AlertItem[]}>('/notifications').then(x=>{setItems(x.items);setUnread(x.unread);setErr('')}).catch(e=>setErr(e.message)).finally(()=>setLoaded(true))},[]);
  useEffect(()=>{load();const t=setInterval(load,60000);return()=>clearInterval(t)},[load]);
  const dismiss=(id:number)=>api('/notifications/'+id,{method:'DELETE'}).then(load).catch(e=>setErr(e.message));
  const shown=pickAlerts(items,3);
  return <Card full t={'Alerts'+(unread?` (${unread} new)`:'')} tip="Changes in reach and engagement, new bests, competitors pulling ahead. Dismiss one to remove it.">
    {err&&<div className="st dn">⚠ {err}</div>}
    {!err&&!loaded&&<div className="st">Loading…</div>}
    {!err&&loaded&&!shown.length&&<p className="mu" style={{margin:0}}>No alerts. You will see one here when something changes.</p>}
    {shown.map(n=><div key={n.id} className={'ccalert'+(n.read_at?'':' un')}>
      <button className="nx" aria-label={'Dismiss alert: '+n.title} onClick={()=>dismiss(n.id)}>✕</button>
      <b>{n.title}</b><p>{n.body}</p><span className="mu">{ago(n.created_at)}</span></div>)}
    {items.length>shown.length&&<p className="mu" style={{margin:'6px 0 0'}}>{items.length-shown.length} more in the bell at the top.</p>}
  </Card>}

export default function CommandCenter({pages,page,go,onLogout}:Props){
  const dash=useQ<any>('/dashboard'),ctx=useQ<any>('/ai/context'),pr=useQ<{priorities:Tip[]}>('/priorities'),prof=useQ<any>('/profile'),ig=useQ<IgStatus>('/instagram/status');
  const[prefill,setPrefill]=useState<Prefill|null>(null);
  const reloadIg=ig.reload;
  useEffect(()=>{addEventListener('ig-changed',reloadIg);return()=>removeEventListener('ig-changed',reloadIg)},[reloadIg]);
  const name=(prof.d?.display_name||'').trim(),tips=pr.d?.priorities||[];
  const b=briefing({name,dash:dash.d,ctx:ctx.d,focus:tips[0]?.text});
  const conn=connectionView(ig.e?null:ig.d);
  return <div className="cc">
    <aside className="cc-left" aria-label="Navigation">
      <button className="ccconn" onClick={()=>go('Settings')} title={conn.title}>
        <i className={'ccdot'+(conn.on?' on':' off')} aria-label={conn.on?'Connected':'Not connected'}/>
        <span><b>{conn.label}</b><small className="mu">{conn.on?'Instagram connected':'Instagram not connected'}</small></span>
      </button>
      <nav className="ccnav">{pages.map(k=><button key={k} className={k===page?'on':''} aria-current={k===page?'page':undefined} onClick={()=>go(k)}>{ICONS[k]}{k}</button>)}</nav>
      <div className="ccuser">
        <div className="ccwho"><span className="ccav" aria-hidden="true">{(name||'U').slice(0,1).toUpperCase()}</span><span>{name||'Your account'}</span></div>
        <button onClick={()=>go('Settings')}>{ICONS.Settings}Profile</button>
        <button onClick={onLogout}>{ICONS.logout}Log out</button>
      </div>
    </aside>

    <section className="cc-mid">
      <Card full t="Morning Briefing">
        <St l={(dash.l||ctx.l)&&!dash.d&&!ctx.d} e={dash.e&&ctx.e?dash.e:''}>
          <div className={'ccbrief '+b.tone}>
            <b className="cchead">{b.headline}</b>
            {b.lines.map((l,i)=><p key={i}>{l}</p>)}
          </div>
        </St>
      </Card>
      <div className="card cc-chat"><Assistant isEmbedded prefill={prefill}/></div>
    </section>

    <aside className="cc-right">
      <Alerts/>
      <Card full t="Daily Report" tip="Your top three priorities today, ranked by expected impact.">
        <St l={pr.l&&!pr.d} e={pr.e} empty={!!pr.d&&!tips.length}>
          {tips.slice(0,3).map(t=><div key={t.kind} className="prio">
            <div className="row" style={{margin:0,alignItems:'flex-start',flexWrap:'nowrap'}}>
              <span className="pi">{ICONS[t.kind]||ICONS.start}</span>
              <span style={{flex:1}}>{t.text}</span>
              <button className="btn s" onClick={()=>setPrefill({id:Date.now(),text:fixQuestion(t)})}>Fix this</button>
            </div>
          </div>)}
        </St>
      </Card>
      <GoalCard/>
    </aside>
  </div>}
