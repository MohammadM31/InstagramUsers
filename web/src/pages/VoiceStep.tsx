// Roadmap O.3: the "Brand voice" step of the setup wizard. Pick chips, add example captions, press Generate, then answer "Does this sound like you?":
// Yes (continue) / Tweak (edit the options, saved as a new version) / Redo (generate again). Every save is a new version on the server, so nothing is lost.
// AI is used only when the person has their OWN OpenAI key AND ticks the consent box; otherwise a template summary is written from the chips.
import {useEffect,useState} from 'react';
import {api} from '../api';
import {TONE_TAGS,MAX_TONE_TAGS,CHOICES,SAMPLE_KINDS,emptyForm,voiceToForm,toggleTag,toVoicePayload,hasSignal,sourceNote,sampleError} from '../voice';
import type {VoiceForm} from '../voice';

type Voice={version:number;summary:string|null;source:string};
type Sample={id:number;kind:string;text:string|null;url:string|null};
type State={voice:Voice|null;samples:Sample[];llm:{available:boolean}};
const KIND_LABEL:Record<string,string>={liked:'Like',disliked:'Avoid',reference_link:'Link'};

export default function VoiceStep({onAccept,busy}:{onAccept:()=>void;busy:boolean}){
  const[d,setD]=useState<State|null>(null),[form,setForm]=useState<VoiceForm>(emptyForm()),[consent,setConsent]=useState(false),[view,setView]=useState<'edit'|'result'>('edit'),
    [note,setNote]=useState(''),[err,setErr]=useState(''),[bz,setBz]=useState(false),[loadErr,setLoadErr]=useState(''),[kind,setKind]=useState('liked'),[text,setText]=useState(''),[url,setUrl]=useState('');
  useEffect(()=>{api<State>('/voice').then(x=>{setD(x);setForm(voiceToForm(x.voice));if(x.voice){setView('result');setNote(sourceNote(x.voice.source))}}).catch(e=>setLoadErr(e.message))},[]);
  const run=async(f:()=>Promise<void>)=>{setBz(true);setErr('');try{await f()}catch(e:any){setErr(e.message)}finally{setBz(false)}};
  const generate=()=>run(async()=>{
    const p=toVoicePayload(form,{consent:!!d?.llm.available&&consent});if('error' in p){setErr(p.error);return}
    const r=await api<{voice:Voice;llm:{used:boolean;reason?:string}}>('/onboarding/voice/generate',{method:'POST',body:p.body});
    setD(s=>s&&({...s,voice:r.voice}));setNote(sourceNote(r.voice.source,r.llm.reason));setView('result')});
  const saveEdits=()=>run(async()=>{
    const p=toVoicePayload(form);if('error' in p){setErr(p.error);return}
    const r=await api<{voice:Voice}>('/voice',{method:'PUT',body:p.body});setD(s=>s&&({...s,voice:r.voice}));setNote(sourceNote('edited'));setView('result')});
  const addSample=()=>{const m=sampleError(kind,text,url);if(m){setErr(m);return}
    run(async()=>{const body=kind==='reference_link'?{kind,url:url.trim(),...(text.trim()?{text:text.trim()}:{})}:{kind,text:text.trim()};
      const s=await api<Sample>('/voice/samples',{method:'POST',body});setD(x=>x&&({...x,samples:[...x.samples,s]}));setText('');setUrl('')})};
  const drop=(id:number)=>run(async()=>{await api('/voice/samples/'+id,{method:'DELETE'});setD(x=>x&&({...x,samples:x.samples.filter(s=>s.id!==id)}))});
  if(loadErr)return <div className="st dn">⚠ {loadErr}</div>;
  if(!d)return <div className="sk"/>;
  const consentBox=<label className="obchk">
    <input type="checkbox" style={{width:'auto'}} checked={consent} disabled={!d.llm.available} onChange={e=>setConsent(e.target.checked)}/>
    <span>{d.llm.available?'Let AI write the summary. My example captions will be sent to OpenAI using my own key.':'AI summaries need your own OpenAI key (add one in Settings). Until then the summary is written from your choices.'}</span></label>;
  return <div>
    {view==='result'&&d.voice?<div>
      <p className="vsum">{d.voice.summary||'No summary yet.'}</p><p className="mu">{note}</p>
      <b>Does this sound like you?</b>
      {err&&<div className="dn" role="alert">⚠ {err}</div>}
      {consentBox}
      <div className="row" style={{justifyContent:'flex-start'}}>
        <button className="btn" disabled={busy||bz} onClick={onAccept}>Yes, that is me</button>
        <button className="btn g" disabled={busy||bz} onClick={()=>{setErr('');setView('edit')}}>Tweak</button>
        <button className="btn g" disabled={busy||bz} onClick={generate}>{bz?'Working…':'Redo'}</button></div>
    </div>:<div>
      <p className="mu">Choose what fits how you want captions to sound. Everything here is optional; you can change it later.</p>
      <div className="obf"><span>Tone (up to {MAX_TONE_TAGS})</span><div>{TONE_TAGS.map(t=><button type="button" key={t} aria-pressed={form.tone_tags.includes(t)} className={'chip'+(form.tone_tags.includes(t)?' on':'')} onClick={()=>setForm(f=>({...f,tone_tags:toggleTag(f.tone_tags,t)}))}>{t}</button>)}</div></div>
      {(Object.keys(CHOICES) as (keyof typeof CHOICES)[]).map(k=><label className="obf" key={k}><span>{CHOICES[k].label}</span>
        <select value={form[k]} onChange={e=>setForm(f=>({...f,[k]:e.target.value}))}><option value="">No preference</option>{CHOICES[k].options.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>)}
      {([['do','Always do (one per line)'],['dont','Never do or say (one per line)'],['phrases','Signature phrases (one per line)']] as const).map(([k,l])=>
        <label className="obf" key={k}><span>{l}</span><textarea rows={3} value={form[k]} onChange={e=>setForm(f=>({...f,[k]:e.target.value}))}/></label>)}
      <div className="obf"><span>Example captions and links ({d.samples.length} saved)</span>
        <div className="row" style={{justifyContent:'flex-start'}}><select value={kind} onChange={e=>setKind(e.target.value)}>{SAMPLE_KINDS.map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></div>
        {kind==='reference_link'&&<input placeholder="https://…" value={url} onChange={e=>setUrl(e.target.value)}/>}
        <textarea rows={3} placeholder={kind==='reference_link'?'Optional note: what do you like about it?':'Paste a caption'} value={text} onChange={e=>setText(e.target.value)}/>
        <div><button type="button" className="btn g s" disabled={bz} onClick={addSample}>Add example</button> <span className="mu">Links are saved as a reminder; they are never opened or read.</span></div>
        {d.samples.length>0&&<ul className="vsamples">{d.samples.map(s=><li key={s.id}><span className="pill">{KIND_LABEL[s.kind]||s.kind}</span> <span>{s.url||''} {(s.text||'').slice(0,140)}{(s.text||'').length>140?'…':''}</span>
          <button type="button" className="btn g s" disabled={bz} aria-label="Delete this example" onClick={()=>drop(s.id)}>Delete</button></li>)}</ul>}</div>
      {consentBox}
      {err&&<div className="dn" role="alert">⚠ {err}</div>}
      <div className="row" style={{justifyContent:'flex-start'}}>
        <button className="btn" disabled={busy||bz||!hasSignal(form,d.samples.length)} onClick={generate}>{bz?'Working…':'Generate my voice'}</button>
        {d.voice&&<button className="btn g" disabled={busy||bz} onClick={saveEdits}>Save changes</button>}
        {d.voice&&<button className="btn g" disabled={busy||bz} onClick={()=>{setErr('');setView('result')}}>Cancel</button>}</div>
    </div>}
  </div>}
