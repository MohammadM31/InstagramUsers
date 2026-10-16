// Roadmap O.6: Settings > Business Profile. Edit every answer from the setup wizard, one section at a time (PUT /api/profile, a partial update that does not
// touch onboarding progress), redo the brand voice step (VoiceStep also lists and deletes examples), and a pointer to the Instagram card for disconnecting.
import {useEffect,useState} from 'react';
import {api} from '../api';
import {Card} from '../ui';
import {FIELDS,TITLES,PROFILE_SECTIONS,toForm,toPayload,isDirty,summaryLines} from '../onb';
import type {Form,ProfileSection} from '../onb';
import {Input} from './Onboarding';
import VoiceStep from './VoiceStep';

type Profile=Record<string,any>;
const NOTE:Partial<Record<ProfileSection,string>>={goals:'Changing the measure or the target number starts a new starting value for your progress.'};

export default function ProfileCard(){
  const[p,setP]=useState<Profile|null>(null),[loadErr,setLoadErr]=useState(''),[edit,setEdit]=useState<ProfileSection|null>(null),[form,setForm]=useState<Form>({}),
    [err,setErr]=useState(''),[bz,setBz]=useState(false),[saved,setSaved]=useState(''),[voice,setVoice]=useState(false);
  useEffect(()=>{api<Profile>('/profile').then(setP).catch(e=>setLoadErr(e.message))},[]);
  const open=(s:ProfileSection)=>{setEdit(s);setForm(toForm(s,p||{}));setErr('');setSaved('')};
  const save=async()=>{
    if(!edit||!p)return;const r=toPayload(edit,form);if('error' in r){setErr(r.error);return}
    setBz(true);setErr('');
    try{const d=await api<Profile>('/profile',{method:'PUT',body:r.body});setP(d);setSaved(TITLES[edit]+' saved.');setEdit(null)}
    catch(e:any){setErr(e.message)}finally{setBz(false)}};
  return <Card full t="Business profile" tip="The answers from setup. The assistant, captions, goal progress and priorities use them.">
    <div className="pf">
    {loadErr&&<div className="st dn">⚠ {loadErr}</div>}
    {!p&&!loadErr&&<div className="sk"/>}
    {saved&&<div className="up" role="status">✓ {saved}</div>}
    {p&&PROFILE_SECTIONS.map(s=><div key={s} className="pfs">
      <div className="row" style={{margin:0}}><b>{TITLES[s]}</b>{edit!==s&&<button className="btn g s" onClick={()=>open(s)}>Edit</button>}</div>
      {edit===s?<>
        {NOTE[s]&&<p className="mu">{NOTE[s]}</p>}
        {FIELDS[s].map(f=><Input key={f.k} f={f} v={form[f.k]} set={x=>setForm(o=>({...o,[f.k]:x}))}/>)}
        {err&&<div className="dn" role="alert">⚠ {err}</div>}
        <div className="row" style={{justifyContent:'flex-start'}}>
          <button className="btn" disabled={bz||!isDirty(s,form,p)} onClick={save}>{bz?'Saving…':'Save'}</button>
          <button className="btn g" disabled={bz} onClick={()=>{setEdit(null);setErr('')}}>Cancel</button></div>
      </>:(()=>{const L=summaryLines(s,p);return L.length?<dl className="pfd">{L.map(x=><div key={x.label}><dt className="mu">{x.label}</dt><dd>{x.value}</dd></div>)}</dl>:<p className="mu">Nothing saved here yet.</p>})()}
    </div>)}
    {p&&<div className="pfs">
      <div className="row" style={{margin:0}}><b>Brand voice</b><button className="btn g s" onClick={()=>setVoice(v=>!v)}>{voice?'Close':'Edit'}</button></div>
      {voice?<VoiceStep busy={false} onAccept={()=>setVoice(false)}/>:<p className="mu">How your captions sound, and the example captions behind it. Every save keeps the earlier version.</p>}
    </div>}
    {p&&<p className="mu" style={{marginBottom:0}}>To disconnect Instagram, use the Instagram connection card above.</p>}
    </div>
  </Card>}
