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
import NotBuilt from './pages/NotBuilt';
import Assistant from './Assistant';
import {useNotifications,Bell,AlertBanner} from './Notifications';
import Onboarding from './pages/Onboarding';
import {Icon} from './icons';
import type {IconName} from './icons';
import {IgBadge} from './pages/InstagramCard';
import {parseIgRedirect} from './ig';

const IGR = parseIgRedirect(); // /?ig=connected|error&reason=... after the Instagram login

const ANALYTICS_HINT = {label:'Open Analytics',page:'Statistics',why:'Marketing method estimates live there.'};
const PAGES:Record<string,ComponentType<any>> = {
  Dashboard: CommandCenter,
  Statistics: Analytics,
  Competitors,
  'Content AI': Content,
  Scheduling: Schedule,
  'Finance & Capital': Finance,
  Settings,
  Roadmap,
  // Design D sidebar entries that have no page yet: honest empty states.
  Marketing: (p:any)=><NotBuilt name="Marketing" see={ANALYTICS_HINT} {...p}/>,
  CRM: (p:any)=><NotBuilt name="CRM" {...p}/>,
  Ads: (p:any)=><NotBuilt name="Ads" {...p}/>,
  Collabs: (p:any)=><NotBuilt name="Collabs" see={ANALYTICS_HINT} {...p}/>
};

type NavItem={label:string;page:string;icon:IconName};
// Sidebar order from Design D. `page` is the key in PAGES, so App's page state is unchanged.
const NAV:NavItem[] = [
  {label:'Business',page:'Dashboard',icon:'home'},
  {label:'Marketing',page:'Marketing',icon:'marketing'},
  {label:'CRM',page:'CRM',icon:'crm'},
  {label:'Ads',page:'Ads',icon:'ads'},
  {label:'Collabs',page:'Collabs',icon:'collabs'},
  {label:'Analytics',page:'Statistics',icon:'analytics'},
  {label:'Posts',page:'Content AI',icon:'posts'}
];
// Existing pages that Design D has no slot for. They stay reachable here so nothing disappears in the reskin.
const MORE:NavItem[] = [
  {label:'Competitors',page:'Competitors',icon:'Competitors'},
  {label:'Scheduling',page:'Scheduling',icon:'Scheduling'},
  {label:'Finance',page:'Finance & Capital',icon:'Finance & Capital'},
  {label:'Roadmap',page:'Roadmap',icon:'Roadmap'}
];
// Pages that draw the 320px right column. Phase 2 puts the Daily report card there.
const RIGHT_COLUMN = new Set(['Dashboard']);

export default function App(){
  const [t,setT] = useState(tok());
  const [p,setP] = useState(IGR ? 'Settings' : 'Dashboard');
  const [igMsg,setIgMsg] = useState(IGR);
  const [ob,setOb] = useState<'loading'|'needed'|'ok'>('loading');
  const [name,setName] = useState('');
  const [dk,setDk] = useState(()=>localStorage.getItem('theme') ? localStorage.getItem('theme')==='dark' : matchMedia('(prefers-color-scheme:dark)').matches);
  const notif = useNotifications(!!t&&ob==='ok');

  useEffect(()=>{document.documentElement.dataset.theme = dk ? 'dark' : 'light';localStorage.setItem('theme', dk ? 'dark' : 'light')},[dk]);
  useEffect(()=>{if(IGR)history.replaceState(null,'',location.pathname)},[]);

  // O.1: new accounts see the setup wizard first.
  useEffect(()=>{
    if(!t){setOb('loading');return}
    let live=true;
    api<{completed:boolean}>('/onboarding').then(d=>live&&setOb(d.completed?'ok':'needed')).catch(()=>live&&setOb('ok'));
    return()=>{live=false}
  },[t]);

  // The sidebar's profile row shows the display name from the profile (no name set: it just says "Profile").
  useEffect(()=>{
    if(!t||ob!=='ok')return;
    let live=true;
    api<{display_name?:string}>('/profile').then(d=>live&&setName((d.display_name||'').trim())).catch(()=>{});
    return()=>{live=false}
  },[t,ob]);

  if(!t) return <Login onAuth={()=>setT(tok())}/>;
  if(ob==='loading') return <div className="st" style={{margin:24}}>Loading…</div>;
  if(ob==='needed') return <Onboarding igMsg={igMsg} onDone={()=>setOb('ok')}/>;

  const P=PAGES[p], cc=p==='Dashboard', rc=RIGHT_COLUMN.has(p), logout=()=>{localStorage.removeItem('t');setT('')};
  const item=(n:NavItem,sm=false)=><button key={n.page} className={'navb'+(sm?' sm':'')} aria-current={n.page===p?'page':undefined} onClick={()=>setP(n.page)}><Icon name={n.icon} size={sm?20:24}/>{n.label}</button>;

  return <div className={'shell'+(rc?' has-rc':'')}>
    <aside className="side" aria-label="Sidebar">
      <button className="wm" onClick={()=>setP('Dashboard')} aria-label="RaidTechs home">RaidTechs</button>
      <nav className="nav" aria-label="Main">
        {NAV.map(n=>item(n))}
        <div className="navg">More</div>
        {MORE.map(n=>item(n,true))}
      </nav>
      <div className="sidefoot">
        {item({label:'Settings',page:'Settings',icon:'settings'})}
        <button className="navb prof" aria-current={p==='Settings'?'page':undefined} onClick={()=>setP('Settings')}>
          <span className="rg"><i>{name?name[0].toUpperCase():<Icon name="user" size={20}/>}</i></span>{name||'Profile'}</button>
        <button className="navb out" onClick={logout}><Icon name="logout"/>Logout</button>
      </div>
    </aside>

    <main className={'ctr'+(cc?' cc-main':'')}>
      <header className="tb">
        <div className="barl">
          <Bell n={notif}/>
          {/* The Business page shows its own connection pill. */}
          {!cc&&<IgBadge onClick={()=>setP('Settings')}/>}
          {/* Temporary: Phase 5 replaces this with the System / Light / Dark switch in Settings. */}
          <button className="ib" aria-label="Toggle theme" title="Toggle theme" onClick={()=>setDk(d=>!d)}><Icon name={dk?'sun':'moon'}/></button>
        </div>
        <div className="barr"><AlertBanner n={notif}/></div>
      </header>
      <div className="page">
        {igMsg&&<div className={'banner '+(igMsg.ok?'ok':'bad')} role="status"><span>{igMsg.text}</span><button className="btn g s" onClick={()=>setIgMsg(null)}>Close</button></div>}
        {/* CommandCenter no longer needs props, it accesses global state via API */}
        {cc ? <CommandCenter/> : <P go={setP}/>}
      </div>
    </main>

    {rc&&<aside className="rcol" id="rcol" aria-label="Daily report"/>}

    {/* The global bottom chat is hidden on the Command Center, which embeds its own. */}
    {!cc && <Assistant isEmbedded={false}/>}
  </div>}
