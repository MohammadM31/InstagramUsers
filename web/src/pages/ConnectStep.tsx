// Roadmap O.2: the "Connect Instagram" step of the setup wizard. Shows what is needed BEFORE the Facebook redirect, turns each failure into plain words
// with a fix and Try again, starts the first sync by itself once connected (with honest progress), and offers a CSV import as the way to skip.
// It reuses the A.1 endpoints; the Settings card (InstagramCard) stays the place for Disconnect and later changes.
import {useEffect,useRef,useState} from 'react';
import {api,useQ} from '../api';
import {IgStatus,igChanged,IG_REQUIREMENTS,IG_PERMISSIONS,describeIgError,syncMessage} from '../ig';

export default function ConnectStep({igMsg}:{igMsg?:{ok:boolean;text:string;code?:string}|null}){
  const st=useQ<IgStatus>('/instagram/status'),s=st.d;
  const[bz,setBz]=useState(''),[msg,setMsg]=useState(''),[csvMsg,setCsvMsg]=useState(''),[secs,setSecs]=useState(0),[showErr,setShowErr]=useState(true),
    auto=useRef(false),fr=useRef<HTMLInputElement>(null);
  useEffect(()=>{if(bz!=='sync')return;setSecs(0);const t=setInterval(()=>setSecs(x=>x+1),1000);return()=>clearInterval(t)},[bz]);
  const connect=async()=>{setBz('connect');setMsg('');setShowErr(false);try{const r=await api<{url:string}>('/instagram/connect/start');location.href=r.url}catch(e:any){setMsg('⚠ '+e.message);setBz('')}};
  const sync=async()=>{setBz('sync');setMsg('');
    try{const{jobId}=await api<{jobId:string}>('/instagram/sync',{method:'POST'});
      for(let i=0;i<40;i++){await new Promise(r=>setTimeout(r,1500));const j=await api<any>('/instagram/sync/'+jobId);
        if(j.status!=='pending'){setMsg(syncMessage(j));break}
        if(i===39)setMsg(syncMessage({status:'pending'}))}
    }catch(e:any){setMsg('⚠ '+e.message)}
    setBz('');st.reload();igChanged()};
  // First sync starts by itself, once, for an account that connected but never synced (the redirect from Facebook lands here).
  useEffect(()=>{if(s?.status==='connected'&&!s.lastSyncAt&&!auto.current){auto.current=true;sync()}},[s?.status,s?.lastSyncAt]); // eslint-disable-line
  const csv=(e:any)=>{const f=e.target.files?.[0];if(!f)return;const r=new FileReader();
    r.onload=async()=>{setBz('csv');setCsvMsg('');
      try{const x=await api<any>('/import/posts',{method:'POST',raw:String(r.result),ct:'text/csv'});
        setCsvMsg(x.status==='pending'?'Still importing in the background.':`Imported ${x.imported} posts${x.duplicates?`, skipped ${x.duplicates} duplicates`:''}${x.invalid?`, ${x.invalid} rows could not be read`:''}.`)}
      catch(e:any){setCsvMsg('⚠ '+e.message)}setBz('')};
    r.readAsText(f);e.target.value=''};
  if(st.l||st.e)return st.l?<div className="sk"/>:<div className="st dn">⚠ {st.e}</div>;
  if(!s)return null;
  const err=igMsg&&!igMsg.ok&&showErr?describeIgError(igMsg.code||''):null;
  if(s.status==='connected')return <div>
    <div className="banner ok" role="status"><span><b>@{s.username}</b> is connected{s.followers!=null?` · ${s.followers.toLocaleString()} followers`:''}.</span></div>
    {bz==='sync'&&<><p className="mu" style={{margin:'0 0 6px'}}>Reading your posts and numbers… {secs}s (usually under a minute). You can continue; it keeps going.</p><div className="prog"><i/></div></>}
    {msg&&<p className={msg.startsWith('⚠')?'dn':''}>{msg}</p>}
    {!bz&&!msg&&s.lastSyncAt&&<p className="mu">Last sync finished. Your numbers are in.</p>}
    {!bz&&<div className="row" style={{justifyContent:'flex-start'}}><button className="btn g" onClick={sync}>Sync again</button></div>}
  </div>;
  return <div>
    {s.status==='reconnect_needed'&&<div className="banner bad" role="alert"><span>⚠ {s.lastError||'The Instagram connection expired.'} Reconnect to keep your numbers up to date.</span></div>}
    {err&&<div className="banner bad" role="alert"><span><b>{err.text}</b><br/>{err.fix}</span>{err.retry&&s.configured&&<button className="btn s" disabled={!!bz} onClick={connect}>Try again</button>}</div>}
    <p style={{margin:'0 0 6px'}}><b>Before you press Connect, check you have:</b></p>
    <ol className="obreq">{IG_REQUIREMENTS.map(r=><li key={r.title}><b>{r.title}.</b> <span className="mu">{r.detail}</span></li>)}</ol>
    <details><summary className="mu">What we ask Facebook for, and why</summary>
      <ul className="obreq">{IG_PERMISSIONS.map(p=><li key={p.scope}><code>{p.scope}</code> <span className="mu">{p.why}</span></li>)}</ul>
      <p className="mu">We only read. Nothing is posted or sent without you, and you can disconnect and delete the data any time in Settings.</p></details>
    {!s.configured?<p className="mu">Connecting is not set up on this server yet, so use the CSV option below for now.</p>
      :<div className="row" style={{justifyContent:'flex-start'}}><button className="btn" disabled={!!bz} onClick={connect}>{bz==='connect'?'Opening Facebook…':s.status==='reconnect_needed'?'Reconnect Instagram':'Connect Instagram'}</button></div>}
    {msg&&<p className="dn">{msg}</p>}
    <hr style={{border:0,borderTop:'1px solid var(--bd)',margin:'14px 0'}}/>
    <p style={{margin:'0 0 6px'}}><b>No Instagram account to connect yet?</b> <span className="mu">Skip this step. The app will say plainly that it has no live data. You can also import a CSV of your posts now:</span></p>
    <div className="row" style={{justifyContent:'flex-start'}}><input ref={fr} type="file" accept=".csv,text/csv" hidden onChange={csv}/><button className="btn g" disabled={!!bz} onClick={()=>fr.current?.click()}>{bz==='csv'?'Importing…':'Import a CSV instead'}</button><span className="mu">Columns: date, type, likes, comments, saves, shares, reach, caption.</span></div>
    {csvMsg&&<p className={csvMsg.startsWith('⚠')?'dn':''}>{csvMsg}</p>}
  </div>}
