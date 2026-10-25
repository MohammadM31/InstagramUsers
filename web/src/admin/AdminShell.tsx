// R.0: the admin area (/admin). Loaded lazily by App.tsx, so customers never download it. Pages are discovered automatically from ./pages/*.jsx:
// each exports a default component and `export const meta = { title, permission, order }`; the sidebar hides pages the person lacks the permission for.
import {useState,useEffect} from 'react';
import type {ComponentType} from 'react';
import {Icon} from '../icons';
import {useMe} from './useCan';
import {slugOf,visiblePages,currentPage,adminPath,isAdminPath,isStaffMe} from './pure';
import type {AdminPage} from './pure';

type Loaded=AdminPage&{Component:ComponentType<any>};
const mods=import.meta.glob('./pages/*.jsx',{eager:true}) as Record<string,{default?:ComponentType<any>;meta?:{title:string;permission?:string;order?:number}}>;
const PAGES:Loaded[]=Object.entries(mods).filter(([,m])=>m.default&&m.meta).map(([file,m])=>({slug:slugOf(file),...m.meta!,Component:m.default!}));

export default function AdminShell({onExit}:{onExit:()=>void}){
  const {me,loading}=useMe();
  const [path,setPath]=useState(location.pathname);
  useEffect(()=>{const f=()=>setPath(location.pathname);addEventListener('popstate',f);return()=>removeEventListener('popstate',f)},[]);
  useEffect(()=>{if(!loading&&!isStaffMe(me))onExit()},[loading,me]); // non-staff (or a failed /me) are sent back to the app

  if(loading||!isStaffMe(me))return <div className="st" style={{margin:24}}>Loading…</div>;
  const pages=visiblePages(PAGES,me),page=currentPage(PAGES,me,path),Page=page?.Component;
  const open=(slug:string)=>{history.pushState(null,'',adminPath(slug));setPath(adminPath(slug))};
  return <div className="shell nav-open">
    <aside className="side" aria-label="Admin sidebar">
      <div className="side-top"><span className="wm">Admin</span></div>
      <nav className="nav" aria-label="Admin pages">
        {pages.map(p=><button key={p.slug} className="navb" aria-current={page?.slug===p.slug?'page':undefined} onClick={()=>open(p.slug)}>{p.title}</button>)}
      </nav>
      <div className="sidefoot">
        <button className="navb" onClick={onExit}><Icon name="chevLeft"/>Back to app</button>
      </div>
    </aside>
    <main className="ctr">
      <header className="tb"><div className="barl"><span className="mu">{me!.user.email} · {me!.user.role}</span></div></header>
      <div className="page">{Page?<Page/>:<div className="st">No admin pages are available for your role.</div>}</div>
    </main>
  </div>;
}
