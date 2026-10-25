import {useState,useEffect,lazy,Suspense} from 'react';
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
import Albums from './pages/Albums';
import Assistant from './Assistant';
import {useNotifications,Bell,AlertBanner} from './Notifications';
import Onboarding from './pages/Onboarding';
import {Icon} from './icons';
import type {IconName} from './icons';
import {IgBadge} from './pages/InstagramCard';
import {parseIgRedirect} from './ig';
import {pageFromHash,hashAfterNav,isEmptyHash} from './albums/hash';
import {useMe} from './admin/useCan';
import {isStaffMe,isAdminPath} from './admin/pure';

const AdminShell = lazy(()=>import('./admin/AdminShell'));

const IGR = parseIgRedirect();

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
  Albums,
  Marketing: (p:any)=><NotBuilt name="Marketing" see={ANALYTICS_HINT} {...p}/>,
  CRM: (p:any)=><NotBuilt name="CRM" {...p}/>,
  Ads: (p:any)=><NotBuilt name="Ads" {...p}/>,
  Collabs: (p:any)=><NotBuilt name="Collabs" see={ANALYTICS_HINT} {...p}/>
};

type NavItem={label:string;page:string;icon:IconName};
const NAV:NavItem[] = [
  {label:'Business',page:'Dashboard',icon:'home'},
  {label:'Marketing',page:'Marketing',icon:'marketing'},
  {label:'CRM',page:'CRM',icon:'crm'},
  {label:'Ads',page:'Ads',icon:'ads'},
  {label:'Collabs',page:'Collabs',icon:'collabs'},
  {label:'Analytics',page:'Statistics',icon:'analytics'},
  {label:'Posts',page:'Content AI',icon:'posts'},
  {label:'Albums',page:'Albums',icon:'albums'}
];
const MORE:NavItem[] = [
  {label:'Competitors',page:'Competitors',icon:'Competitors'},
  {label:'Scheduling',page:'Scheduling',icon:'Scheduling'},
  {label:'Finance',page:'Finance & Capital',icon:'Finance & Capital'},
  {label:'Roadmap',page:'Roadmap',icon:'Roadmap'}
];

export default function App(){
  const [t,setT] = useState(tok());
  const [p,setP] = useState<string>(IGR ? 'Settings' : (pageFromHash(location.hash) ?? 'Dashboard'));
  const [igMsg,setIgMsg] = useState(IGR);
  const [navOpen, setNavOpen] = useState(true);
  const [ob,setOb] = useState<'loading'|'needed'|'ok'>('loading');
  const [name,setName] = useState('');
  const [dk,setDk] = useState(()=>localStorage.getItem('theme') ? localStorage.getItem('theme')==='dark' : matchMedia('(prefers-color-scheme:dark)').matches);
  const notif = useNotifications(!!t&&ob==='ok');
  const {me} = useMe(t);
  const [adminMode,setAdminMode] = useState(()=>isAdminPath(location.pathname));

  useEffect(()=>{document.documentElement.dataset.theme = dk ? 'dark' : 'light';localStorage.setItem('theme', dk ? 'dark' : 'light')},[dk]);
  useEffect(()=>{if(IGR)history.replaceState(null,'',location.pathname)},[]);
  useEffect(()=>{localStorage.setItem('nav', navOpen?'open':'closed')},[navOpen]);
  useEffect(()=>{const f=()=>setAdminMode(isAdminPath(location.pathname));addEventListener('popstate',f);return()=>removeEventListener('popstate',f)},[]);

  useEffect(()=>{
    const read=(fromNav:boolean)=>{
      const h=location.hash,pg=pageFromHash(h);
      if(pg)setP(pg);
      else if(!fromNav&&isEmptyHash(h))setP('Dashboard');
    };
    const onHash=()=>read(false),onNav=()=>read(true);
    window.addEventListener('hashchange',onHash);
    window.addEventListener('nav',onNav);
    return()=>{window.removeEventListener('hashchange',onHash);window.removeEventListener('nav',onNav)};
  },[]);

  useEffect(()=>{
    if(!t){setOb('loading');return}
    let live=true;
    api<{completed:boolean}>('/onboarding').then(d=>live&&setOb(d.completed?'ok':'needed')).catch(()=>live&&setOb('ok'));
    return()=>{live=false}
  },[t]);

  useEffect(()=>{
    if(!t||ob!=='ok')return;
    let live=true;
    api<{display_name?:string}>('/profile').then(d=>live&&setName((d.display_name||'').trim())).catch(()=>{});
    return()=>{live=false}
  },[t,ob]);

  if(!t) return <Login onAuth={()=>setT(tok())}/>;
  if(ob==='loading') return <div className="st" style={{margin:24}}>Loading…</div>;
  if(ob==='needed') return <Onboarding igMsg={igMsg} onDone={()=>setOb('ok')}/>;

  if(adminMode) return <Suspense fallback={<div className="st" style={{margin:24}}>Loading…</div>}><AdminShell onExit={()=>{history.pushState(null,'','/'+location.search);setAdminMode(false)}}/></Suspense>;

  const go=(page:string)=>{
    setP(page);
    const h=hashAfterNav(page,location.hash);
    if(h!==null)history.replaceState(null,'',location.pathname+location.search+h);
  };
  const P=PAGES[p], cc=p==='Dashboard', logout=()=>{localStorage.removeItem('t');setT('')};
  const item=(n:NavItem,sm=false)=><button key={n.page} className={'navb'+(sm?' sm':'')} aria-current={n.page===p?'page':undefined} onClick={()=>go(n.page)}><Icon name={n.icon} size={sm?20:24}/>{n.label}</button>;

  return <div className={'shell' + (navOpen ? ' nav-open' : ' nav-closed')}>
    <aside className="side" aria-label="Sidebar">
      <div className="side-top">
        <button className="wm" onClick={()=>go('Dashboard')} aria-label="RaidTechs home">RaidTechs</button>
      </div>
      <nav className="nav" aria-label="Main">
        {NAV.map(n=>item(n))}
        <div className="navg">More</div>
        {MORE.map(n=>item(n,true))}
      </nav>
      <div className="sidefoot">
        {item({label:'Settings',page:'Settings',icon:'settings'})}
        <button className="navb prof" aria-current={p==='Settings'?'page':undefined} onClick={()=>go('Settings')}>
          <span className="rg"><i>{name?name[0].toUpperCase():<Icon name="user" size={20}/>}</i></span>{name||'Profile'}</button>
        {isStaffMe(me)&&<button className="navb sm" onClick={()=>{history.pushState(null,'','/admin');setAdminMode(true)}}><Icon name="settings" size={20}/>Admin</button>}
        <button className="navb out" onClick={logout}><Icon name="logout"/>Logout</button>
      </div>
    </aside>

    <main className={'ctr'+(cc?' cc-main':'')}>
      <header className="tb">
        <div className="barl">
          <button className="ib nav-btn" aria-label={navOpen?'Hide navigation':'Show navigation'} title={navOpen?'Hide navigation':'Show navigation'} onClick={()=>setNavOpen(o=>!o)}><Icon name="menu"/></button>
          <Bell n={notif}/>
          {!cc&&<IgBadge onClick={()=>go('Settings')}/>}
          <button className="ib" aria-label="Toggle theme" title="Toggle theme" onClick={()=>setDk(d=>!d)}><Icon name={dk?'sun':'moon'}/></button>
        </div>
        <div className="barr"><AlertBanner n={notif}/></div>
      </header>
      <div className="page">
        {igMsg&&<div className={'banner '+(igMsg.ok?'ok':'bad')} role="status"><span>{igMsg.text}</span><button className="btn g s" onClick={()=>setIgMsg(null)}>Close</button></div>}
        {cc ? <CommandCenter/> : <P go={go}/>}
      </div>
    </main>

    {!cc && <Assistant isEmbedded={false}/>}
  </div>}