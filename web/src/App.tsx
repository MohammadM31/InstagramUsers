import {useState,useEffect} from 'react';
import type {ComponentType} from 'react';
import {tok,api} from './api';
import Login from './pages/Login';
import CommandCenter from './pages/CommandCenter';
import Analytics from './pages/Analytics';
import Competitors from './pages/Competitors';
import Content from './pages/Content';
import Schedule from './pages/Schedule';
import Settings from './pages/Settings';
import Roadmap from './pages/Roadmap';
import Finance from './pages/Finance';
import Assistant from './Assistant';
import Notifications from './Notifications';
import Onboarding from './pages/Onboarding';
import {ICONS} from './icons';
import {IgBadge} from './pages/InstagramCard';
import {parseIgRedirect} from './ig';

const IGR = parseIgRedirect(); // /?ig=connected|error&reason=... after the Instagram login

const PAGES:Record<string,ComponentType<any>> = {
  Dashboard: CommandCenter,
  Statistics: Analytics,
  Competitors,
  'Content AI': Content,
  Scheduling: Schedule,
  'Finance & Capital': Finance,
  Settings,
  Roadmap
};

export default function App(){
  const [t,setT] = useState(tok());
  const [p,setP] = useState(IGR ? 'Settings' : 'Dashboard');
  const [igMsg,setIgMsg] = useState(IGR);
  const [open,setOpen] = useState(false);
  const [ob,setOb] = useState<'loading'|'needed'|'ok'>('loading');
  const [dk,setDk] = useState(()=>localStorage.getItem('theme') ? localStorage.getItem('theme')==='dark' : matchMedia('(prefers-color-scheme:dark)').matches);

  useEffect(()=>{document.documentElement.dataset.theme = dk ? 'dark' : 'light';localStorage.setItem('theme', dk ? 'dark' : 'light')},[dk]);
  useEffect(()=>{if(IGR)history.replaceState(null,'',location.pathname)},[]);
  
  // O.1: new accounts see the setup wizard first.
  useEffect(()=>{
    if(!t){setOb('loading');return}
    let live=true;
    api<{completed:boolean}>('/onboarding').then(d=>live&&setOb(d.completed?'ok':'needed')).catch(()=>live&&setOb('ok'));
    return()=>{live=false}
  },[t]);
  
  useEffect(()=>{
    const k=(e:KeyboardEvent)=>e.key==='Escape'&&setOpen(false);
    addEventListener('keydown',k);
    return()=>removeEventListener('keydown',k)
  },[]);

  if(!t) return <Login onAuth={()=>setT(tok())}/>;
  if(ob==='loading') return <div className="st" style={{margin:24}}>Loading…</div>;
  if(ob==='needed') return <Onboarding igMsg={igMsg} onDone={()=>setOb('ok')}/>;

  const P=PAGES[p], cc=p==='Dashboard', logout=()=>{localStorage.removeItem('t');setT('')};
  
  return <div className={'shell'+(open?' drawer-open':'')}>
    <aside className="rail">
      <div className="logo">R</div>
      <button className="ib" aria-label="Menu" title="Menu" onClick={()=>setOpen(o=>!o)}>{ICONS.menu}</button>
      <button className="ib" aria-label="Toggle theme" title="Toggle theme" style={{marginTop:'auto'}} onClick={()=>setDk(d=>!d)}>{dk?ICONS.sun:ICONS.moon}</button>
      <button className="ib" aria-label="Log out" title="Log out" onClick={logout}>{ICONS.logout}</button>
    </aside>
    <div className={'scrim'+(open?' on':'')} onClick={()=>setOpen(false)}/>
    <nav className={'drawer'+(open?' open':'')} aria-hidden={!open}>
      <h2>Explore</h2>
      {Object.keys(PAGES).map(k=><button key={k} className={k===p?'on':''} onClick={()=>{setP(k);setOpen(false)}}>{ICONS[k]}{k}</button>)}
    </nav>
    <main className={cc?'cc-main':undefined}>
      <header className="top">
        <span className="wm">RaidTechs</span>
        <span className="mu">{p}</span>
        <span style={{marginLeft:'auto',display:'flex',gap:8,alignItems:'center'}}><IgBadge onClick={()=>setP('Settings')}/><Notifications/></span>
      </header>
      {igMsg&&<div className={'banner '+(igMsg.ok?'ok':'bad')} role="status"><span>{igMsg.text}</span><button className="btn g s" onClick={()=>setIgMsg(null)}>Close</button></div>}
      
      {/* CommandCenter no longer needs props, it accesses global state via API */}
      {cc ? <CommandCenter/> : <P/>}
    </main>
    
    {/* The global bottom chat is hidden on the Command Center, which embeds its own. */}
    {!cc && <Assistant isEmbedded={false}/>}
  </div>}