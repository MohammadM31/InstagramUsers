// Roadmap A.1d: Settings > Instagram connection (connect, status, Sync now, disconnect) and the header badge.
import {useCallback,useEffect,useState} from 'react';
import {api,useQ} from '../api';
import {St,Card} from '../ui';
import {IgStatus,igChanged,igAgo} from '../ig';

export function IgBadge({onClick}:{onClick:()=>void}){
  const[s,setS]=useState<IgStatus|null>(null);
  const load=useCallback(()=>{api<IgStatus>('/instagram/status').then(setS).catch(()=>setS(null))},[]);
  useEffect(()=>{load();const t=setInterval(load,3e5);addEventListener('ig-changed',load);return()=>{clearInterval(t);removeEventListener('ig-changed',load)}},[load]);
  if(!s)return null;
  const bad=s.status==='reconnect_needed',on=s.status==='connected',
    label=on?'@'+(s.username||'instagram'):bad?'Reconnect Instagram':s.status==='dev_env'?'Instagram (dev env)':'Connect Instagram';
  return <button className={'igbadge'+(on?' on':bad?' bad':'')} onClick={onClick} title={on?'Instagram connected. Last sync '+igAgo(s.lastSyncAt):'Open Settings to connect Instagram'}><i className="igdot"/>{label}</button>}

export default function InstagramCard(){
  const st=useQ<IgStatus>('/instagram/status'),[bz,setBz]=useState(''),[msg,setMsg]=useState('');
  const s=st.d;
  const connect=async()=>{setBz('connect');setMsg('');try{const r=await api<{url:string}>('/instagram/connect/start');location.href=r.url}catch(e:any){setMsg('⚠ '+e.message);setBz('')}};
  const sync=async()=>{setBz('sync');setMsg('');
    try{const{jobId}=await api<{jobId:string}>('/instagram/sync',{method:'POST'});
      for(let i=0;i<40;i++){await new Promise(r=>setTimeout(r,1500));const j=await api<any>('/instagram/sync/'+jobId);
        if(j.status==='done'){setMsg(`Synced: ${j.fetched} posts checked (${j.inserted} new, ${(j.updated||0)+(j.linked||0)} updated)${j.account?.followers!=null?`, ${j.account.followers.toLocaleString()} followers`:''}.${j.stoppedEarly?' '+j.stoppedEarly+'.':''}`);break}
        if(j.status==='failed'){setMsg('⚠ '+j.error);break}
        if(i===39)setMsg('Still syncing in the background. Check again in a minute.')}
    }catch(e:any){setMsg('⚠ '+e.message)}
    setBz('');st.reload();igChanged()};
  const disconnect=async(data:'keep'|'delete')=>{
    if(!confirm(data==='delete'?'Disconnect Instagram and permanently delete the posts and follower history that came from it?':'Disconnect Instagram? Your stored posts and history stay.'))return;
    setBz('disc');setMsg('');
    try{const r=await api<any>('/instagram/disconnect?data='+data,{method:'DELETE'});setMsg(data==='delete'?`Disconnected. Deleted ${r.postsDeleted} posts and ${r.accountRowsDeleted} account rows.`:'Disconnected. Your data was kept.')}catch(e:any){setMsg('⚠ '+e.message)}
    setBz('');st.reload();igChanged()};
  return <Card full t="Instagram connection" tip="Connect your Instagram professional account so the app reads your own posts and numbers through the official Instagram API.">
    <St l={st.l} e={st.e}>{s&&<>
      {s.status==='connected'&&<>
        <p style={{margin:'0 0 6px'}}><b>@{s.username}</b> · {s.followers!=null?<>{s.followers.toLocaleString()} followers{s.followerSource==='reconstructed'&&<span className="mu"> (estimated from daily changes)</span>}</>:<span className="mu">follower count appears after the first sync</span>}</p>
        <p className="mu" style={{margin:0}}>Last sync: {igAgo(s.lastSyncAt)} · token valid for {s.daysLeft??'?'} more days · follower history: {s.followerPoints} day(s)</p>
        {s.lastError&&<p className="dn" style={{margin:'6px 0 0'}}>⚠ {s.lastError}</p>}
        <div className="row" style={{justifyContent:'flex-start'}}><button className="btn" disabled={!!bz} onClick={sync}>{bz==='sync'?'Syncing…':'Sync now'}</button>
          <button className="btn g" disabled={!!bz} onClick={()=>disconnect('keep')}>Disconnect, keep data</button><button className="btn g dn" disabled={!!bz} onClick={()=>disconnect('delete')}>Disconnect and delete Instagram data</button></div></>}
      {s.status==='reconnect_needed'&&<>
        <p className="dn" style={{margin:'0 0 6px'}}>⚠ {s.lastError||'The Instagram connection expired.'} New numbers are not being pulled.</p>
        <div className="row" style={{justifyContent:'flex-start'}}><button className="btn" disabled={!!bz} onClick={connect}>Reconnect Instagram</button><button className="btn g" disabled={!!bz} onClick={()=>disconnect('keep')}>Disconnect</button></div></>}
      {(s.status==='disconnected'||s.status==='not_connected'||s.status==='dev_env')&&<>
        {s.status==='dev_env'&&<p className="mu">This server uses a shared development token (IG_ACCESS_TOKEN), not your own account.</p>}
        <p className="mu" style={{margin:'0 0 6px'}}>You need an Instagram Business or Creator account that is linked to a Facebook Page you manage. We read your posts, insights and follower numbers. We never post or message without you.</p>
        {!s.configured?<p className="mu">Connecting is not set up on this server yet (the META_APP_ID, META_APP_SECRET and META_REDIRECT_URI settings are missing).</p>
          :<div className="row" style={{justifyContent:'flex-start'}}><button className="btn" disabled={!!bz} onClick={connect}>{bz==='connect'?'Opening…':'Connect Instagram'}</button><span className="mu">Without connecting, you can still import a CSV above.</span></div>}</>}
      {msg&&<p>{msg}</p>}
    </>}</St></Card>}
