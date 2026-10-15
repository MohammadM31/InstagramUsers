// Roadmap O.1: first-run setup wizard. Shown by App.tsx until the server says completed. Every step saves on Continue, so a reload resumes where the user stopped.
// Steps 'connect' (O.2) reuses the Instagram card; 'voice' (O.3) is a placeholder that is marked skipped so it is offered again once it exists.
import {useEffect,useState} from 'react';
import {api} from '../api';
import {STEPS,TITLES,FIELDS,toForm,toPayload,startIndex,detectedZone} from '../onb';
import type {StepKey,Form,Field} from '../onb';
import InstagramCard from './InstagramCard';

type Ob={profile:Record<string,any>;step:string;skippedSteps:string[];completed:boolean};

function Input({f,v,set}:{f:Field;v:string|boolean;set:(x:string|boolean)=>void}){
  if(f.kind==='bool')return <label className="obchk"><input type="checkbox" style={{width:'auto'}} checked={!!v} onChange={e=>set(e.target.checked)}/> <span>{f.label}</span></label>;
  const common={value:String(v??''),onChange:(e:any)=>set(e.target.value)};
  return <label className="obf"><span>{f.label}{f.required&&' *'}</span>
    {f.kind==='area'?<textarea rows={4} {...common}/>
     :f.kind==='select'?<select {...common}><option value="">Choose…</option>{f.options!.map(([k,l])=><option key={k} value={k}>{l}</option>)}</select>
     :<input type={f.kind==='num'?'number':f.kind==='date'?'date':'text'} {...common}/>}
    {f.hint&&<span className="mu">{f.hint}</span>}</label>}

export default function Onboarding({onDone,igMsg}:{onDone:()=>void;igMsg?:{ok:boolean;text:string}|null}){
  const[ob,setOb]=useState<Ob|null>(null),[i,setI]=useState(0),[form,setForm]=useState<Form>({}),[err,setErr]=useState(''),[bz,setBz]=useState(false),[loadErr,setLoadErr]=useState('');
  const step:StepKey=STEPS[i];
  const open=(d:Ob,idx:number)=>{setI(idx);const s=STEPS[idx];const f=toForm(s,d.profile);
    if(s==='about'){if(!f.timezone)f.timezone=detectedZone();if(!f.languages)f.languages='en'} // suggestions only; saved when the user continues
    setForm(f);setErr('')};
  useEffect(()=>{api<Ob>('/onboarding').then(d=>{setOb(d);open(d,startIndex(d.step))}).catch(e=>setLoadErr(e.message))},[]);
  const go=(idx:number,d=ob!)=>{if(idx>=STEPS.length)return finish();open(d,idx)};
  const save=async(body:any)=>{setBz(true);setErr('');
    try{const d=await api<Ob>('/onboarding/'+step,{method:'PATCH',body});setOb(d);return d}catch(e:any){setErr(e.message);return null}finally{setBz(false)}};
  const finish=async()=>{setBz(true);setErr('');try{await api('/onboarding/complete',{method:'POST'});onDone()}catch(e:any){setErr(e.message)}finally{setBz(false)}};
  const next=async()=>{
    let body:any={};
    if(FIELDS[step].length){const p=toPayload(step,form);if('error' in p){setErr(p.error);return}body=p.body}
    const d=await save(body);if(d)go(i+1,d)};
  const skip=async()=>{const d=await save({skipped:true});if(d)go(i+1,d)};
  const saved=!!ob&&(ob.step!=='about'||ob.profile.display_name); // the name exists on the server, so "finish now" is allowed
  if(loadErr)return <div className="ob card"><div className="st dn">⚠ {loadErr}</div><button className="btn" onClick={onDone}>Continue to the app</button></div>;
  if(!ob)return <div className="ob"><div className="sk"/></div>;
  return <div className="ob">
    <div className="obdots" aria-label={`Step ${i+1} of ${STEPS.length}`}>{STEPS.map((s,k)=><i key={s} className={k===i?'on':k<i?'done':''} title={TITLES[s]}/>)}</div>
    <div className="card"><h3>{TITLES[step]} <span className="mu">· step {i+1} of {STEPS.length}</span></h3>
      {igMsg&&step==='connect'&&<div className={'banner '+(igMsg.ok?'ok':'bad')} role="status"><span>{igMsg.text}</span></div>}
      {step==='about'&&<p className="mu">Tell us a little so advice fits you. Only your name is required; you can skip everything else and change it later in Settings.</p>}
      {step==='connect'&&<><p className="mu">Connect your Instagram professional account so the app can use your real numbers. You can skip this and import a CSV instead.</p><InstagramCard/></>}
      {step==='voice'&&<p className="mu">Brand voice (how your captions should sound) arrives in an upcoming update. You will be able to set it in Settings.</p>}
      {step==='goals'&&<p className="mu">Pick what matters most. The Dashboard will show progress toward it using your real numbers.</p>}
      {FIELDS[step].map(f=><Input key={f.k} f={f} v={form[f.k]} set={x=>setForm(s=>({...s,[f.k]:x}))}/>)}
      {err&&<div className="dn" role="alert">⚠ {err}</div>}
      <div className="row" style={{justifyContent:'flex-start'}}>
        {i>0&&<button className="btn g" disabled={bz} onClick={()=>go(i-1)}>Back</button>}
        {step!=='voice'&&<button className="btn" disabled={bz} onClick={next}>{bz?'Saving…':i===STEPS.length-1?'Finish':'Continue'}</button>}
        {step!=='about'&&<button className="btn g" disabled={bz} onClick={skip}>Skip for now</button>}
        {saved&&i<STEPS.length-1&&<button className="btn g" disabled={bz} onClick={finish}>Skip the rest, go to the Dashboard</button>}
      </div></div></div>}
