import {useState} from 'react';import type {ComponentType} from 'react';import {tok} from './api';
import Login from './pages/Login';import Dashboard from './pages/Dashboard';import Analytics from './pages/Analytics';import Competitors from './pages/Competitors';import Content from './pages/Content';import Schedule from './pages/Schedule';import Settings from './pages/Settings';import Roadmap from './pages/Roadmap';
const PAGES:Record<string,ComponentType>={Dashboard,'My Account':Analytics,Competitors,'Content AI':Content,Scheduling:Schedule,Settings,Roadmap};
export default function App(){const[t,setT]=useState(tok()),[p,setP]=useState('Dashboard');
 if(!t)return <Login onAuth={()=>setT(tok())}/>;const P=PAGES[p];
 return <><header><b>🚀 GrowthEngine</b>{Object.keys(PAGES).map(k=><button key={k} className={k===p?'on':''} onClick={()=>setP(k)}>{k}</button>)}<button style={{marginLeft:'auto'}} onClick={()=>{localStorage.removeItem('t');setT('')}}>Log out</button></header><main><P/></main></>}
