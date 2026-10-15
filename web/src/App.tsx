import {useState,useEffect} from 'react';
import type {ComponentType} from 'react';
import {tok} from './api';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Analytics from './pages/Analytics';
import Competitors from './pages/Competitors';
import Content from './pages/Content';
import Schedule from './pages/Schedule';
import Settings from './pages/Settings';
import Roadmap from './pages/Roadmap';
import Finance from './pages/Finance';
import Assistant from './Assistant';
import Notifications from './Notifications';
import {ICONS} from './icons';

const PAGES:Record<string,ComponentType>={Dashboard,Statistics:Analytics,Competitors,'Content AI':Content,Scheduling:Schedule,'Finance & Capital':Finance,Settings,Roadmap};

export default function App(){
  const[t,setT]=useState(tok()),[p,setP]=useState('Dashboard'),[open,setOpen]=useState(false),
    [dk,setDk]=useState(()=>localStorage.getItem('theme')?localStorage.getItem('theme')==='dark':matchMedia('(prefers-color-scheme:dark)').matches);
  useEffect(()=>{document.documentElement.dataset.theme=dk?'dark':'light';localStorage.setItem('theme',dk?'dark':'light')},[dk]);
  useEffect(()=>{const k=(e:KeyboardEvent)=>e.key==='Escape'&&setOpen(false);addEventListener('keydown',k);return()=>removeEventListener('keydown',k)},[]);
  if(!t)return <Login onAuth={()=>setT(tok())}/>;
  const P=PAGES[p];
  return <div className={'shell'+(open?' drawer-open':'')}>
    <aside className="rail">
      <div className="logo">R</div>
      <button className="ib" aria-label="Menu" title="Menu" onClick={()=>setOpen(o=>!o)}>{ICONS.menu}</button>
      <button className="ib" aria-label="Toggle theme" title="Toggle theme" style={{marginTop:'auto'}} onClick={()=>setDk(d=>!d)}>{dk?ICONS.sun:ICONS.moon}</button>
      <button className="ib" aria-label="Log out" title="Log out" onClick={()=>{localStorage.removeItem('t');setT('')}}>{ICONS.logout}</button>
    </aside>
    <div className={'scrim'+(open?' on':'')} onClick={()=>setOpen(false)}/>
    <nav className={'drawer'+(open?' open':'')} aria-hidden={!open}>
      <h2>Explore</h2>
      {Object.keys(PAGES).map(k=><button key={k} className={k===p?'on':''} onClick={()=>{setP(k);setOpen(false)}}>{ICONS[k]}{k}</button>)}
    </nav>
    <main>
      <header className="top">
        <span className="wm">RaidTechs</span>
        <span className="mu">{p}</span>
        <span style={{marginLeft:'auto'}}><Notifications/></span>
      </header>
      <P/>
    </main>
    <Assistant/>
  </div>}