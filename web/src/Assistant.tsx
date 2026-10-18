import {useState,useRef,useEffect} from 'react';
import type {FormEvent} from 'react';
import {api} from './api';
import {ICONS} from './icons';

type R={type:string;text:string;data?:any;jobId?:string};
export type Prefill={id:number;text:string;isReport?:boolean};

function Result({r}:{r:R}){
  const d=r.data||{};
  if(r.type==='image'&&d.url)return <><img src={d.url} alt="Generated"/><div className="row"><span className="mu">{r.text}</span><a className="btn s" href={d.url} download="post.png">Save</a></div></>;
  if(r.type==='analytics')return <>
    <div className="ring"><i>{d.health.score}</i></div><p style={{textAlign:'center'}}><b>{r.text}</b></p>
    <div className="row"><span>Reach 30d <b>{d.metrics.reach30d.toLocaleString()}</b></span><span>Engagement <b>{d.metrics.er}%</b></span><span>Reach change <b>{d.metrics.reachChange}%</b></span></div>
    {d.top.map((t:any,i:number)=><p key={i}>• {t.text}</p>)}</>;
  if(r.type==='finance')return <><span className="tag">${d.capital.toLocaleString()} suggested split</span>
    {d.money.map((m:any)=><div key={m.area}><div className="row" style={{margin:0}}><span>{m.area}</span><b>${m.amount}</b></div><div className="bar"><div style={{width:m.share+'%'}}/></div></div>)}
    {d.time.map((t:string,i:number)=><p key={i}>{t}</p>)}</>;
  return <><p style={{margin:0}}>{r.text}</p>{d.more?.map((t:any,i:number)=><p key={i} className="mu">{t.text}</p>)}</>}

export default function Assistant({isEmbedded=false, prefill=null}:{isEmbedded?:boolean; prefill?:Prefill|null}){
  const [m,setM]=useState(''), [r,setR]=useState<R|null>(null), [b,setB]=useState(false), [ref,setRef]=useState(''),
    f=useRef<HTMLInputElement>(null), seq=useRef(0);

  const [mode,setMode]=useState<'chat'|'image'>('chat');
  const [imgRatio,setImgRatio]=useState('1:1');

  // Handle external prefill (like "Generate Daily Report")
  useEffect(()=>{
    if(prefill){
      if(prefill.isReport){
        generateReport();
      } else {
        setM(prefill.text);
      }
    }
  },[prefill]);

  // Dedicated handler for the Daily Report that bypasses the chat AI
  const generateReport = async () => {
    setB(true);
    setR({type:'info', text:'Generating your daily report...'});
    try {
      const [metrics, priorities] = await Promise.all([
        api<any>('/ai/context'),
        api<any>('/priorities')
      ]);
      
      const health = metrics.health;
      const gaps = metrics.gaps || [];
      const tips = priorities.priorities || [];
      
      let text = `**Account Health:** ${health.label} (${health.score}/100)\n\n`;
      text += `**Top Priorities:**\n`;
      tips.slice(0,3).forEach((t:any, i:number) => {
        text += `${i+1}. ${t.text}\n`;
      });
      if (gaps.length > 0) {
        text += `\n**Watch out for:**\n${gaps[0]}\n`;
      }
      
      setR({type:'info', text});
    } catch (e:any) {
      setR({type:'info', text:'Failed to generate report: ' + e.message});
    }
    setB(false);
  };

  const pick=(e:any)=>{const x=e.target.files?.[0];if(!x)return;const fr=new FileReader();fr.onload=()=>setRef(String(fr.result));fr.readAsDataURL(x)};

  const send=async(e:FormEvent)=>{
    e.preventDefault();
    if(!m.trim()||b)return;
    setB(true);
    const id=++seq.current;
    try{
      if(mode==='image'){
        const x = await api<R>('/content/image',{method:'POST',body:{prompt:m, ratio:imgRatio, referenceImage:ref||undefined}});
        if (x.jobId) await poll(x.jobId, id);
      } else {
        const x=await api<R>('/assistant',{method:'POST',body:{message:m,referenceImage:ref||undefined}});
        setR(x);
        if(x.type==='image'&&x.data?.jobId)await poll(x.data.jobId,id);
      }
    }catch(x:any){setR({type:'info',text:x.message})}
    setB(false);setM('');setRef('');
  };

  const poll=async(jobId:string,id:number)=>{
    for(let i=1;i<=30;i++){
      await new Promise(r=>setTimeout(r,2000));
      if(id!==seq.current)return;
      const s=await api<any>('/content/image/'+jobId);
      if(s.status==='done'){setR({type:'image',text:'Here you go.',data:{url:s.images[0]}});return}
      if(s.status==='failed'){setR({type:'info',text:'Image generation failed: '+(s.error||'try again')});return}
      setR({type:'image',text:'Generating your image… '+i*2+'s',data:{jobId}});
    }
    setR({type:'info',text:'Still generating after 60s. Try again in a moment.'});
  };

  const go=(t:string)=>setM(t);
  const hideResponse=()=>setR(null);

  return <div className={isEmbedded ? "assistant-embed" : "composer"}>
    
    {r && (
      <div className={isEmbedded ? 'card result inline' : 'card result attached'}>
        <div className="result-head">
          <span className="drag-handle" style={{visibility: isEmbedded ? 'hidden' : 'visible'}}>⋮⋮</span>
          <button className="x" onClick={hideResponse}>×</button>
        </div>
        <Result r={r}/>
      </div>
    )}

    <div className="assistant-bar-wrap">
      {!m && !r && (
        <div className="chips">
          <button onClick={()=>go('How am I doing?')}>How am I doing?</button>
          <button onClick={()=>go('What should I do next?')}>What should I do next?</button>
          <button onClick={()=>go('Budget $1000')}>Budget $1000</button>
          <button onClick={()=>go('Image of a coffee cup')}>Image of a coffee cup</button>
        </div>
      )}

      <form onSubmit={send} className="chat-form">
        <input ref={f} type="file" accept="image/*" hidden onChange={pick}/>
        <button type="button" className={ref?'on':''} onClick={()=>f.current?.click()} title="Attach image">{ICONS.clip}</button>
        
        <input 
          value={m} 
          onChange={e=>setM(e.target.value)} 
          placeholder={mode==='image' ? "Describe the image to generate..." : "Ask for analytics, an image, ideas, a budget…"}
        />

        {mode==='image' && (
          <select value={imgRatio} onChange={e=>setImgRatio(e.target.value)} className="ratio-select">
            <option value="1:1">1:1</option>
            <option value="4:5">4:5</option>
            <option value="9:16">9:16</option>
          </select>
        )}

        {/* Just an icon for post generation */}
        <button 
          type="button" 
          className={'mode-toggle-icon'+(mode==='image'?' on':'')} 
          onClick={()=>setMode(m=>m==='chat'?'image':'chat')}
          title={mode==='image' ? "Turn off Image Generation" : "Turn on Image Generation"}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19l7-7 3 3-7 7-3-3z"></path>
            <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"></path>
            <path d="M2 2l7.586 7.586"></path>
            <circle cx="11" cy="11" r="2"></circle>
          </svg>
        </button>

        <button type="submit" id="assistant-send" disabled={b||!m.trim()}>{b?'…':'Send'}</button>
      </form>
    </div>
  </div>
}