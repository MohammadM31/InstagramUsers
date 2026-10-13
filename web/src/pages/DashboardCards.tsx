// Phase 1 cards for the Dashboard: Today's Priorities (1.1) and AI Context (1.2).
import {useState} from 'react';
import {useQ} from '../api';
import {St,Card} from '../ui';
import {ICONS} from '../icons';

type Tip={priority:number;kind:string;text:string;why?:string;watch?:string};
const ago=(v?:string|null)=>{if(!v)return '—';const d=Math.round((Date.now()-new Date(v).getTime())/864e5);return d<=0?'today':d===1?'1 day ago':d+' days ago'};

// Act and Dismiss are Phase 1 no-ops on the server: Act opens the reasoning ("why" and the metric to watch), Dismiss hides the tip for this visit.
export function Priorities(){
  const p=useQ<{priorities:Tip[]}>('/priorities'),[hidden,setHidden]=useState<string[]>([]),[open,setOpen]=useState('');
  const list=(p.d?.priorities||[]).filter(t=>!hidden.includes(t.kind)).slice(0,5);
  return <Card full t="Today's Priorities" tip="Ranked by expected impact. Collabs, mentions and community come before hashtags.">
    <St l={p.l} e={p.e} empty={!!p.d&&!p.d.priorities.length}>
      {list.map(t=><div key={t.kind} className="prio">
        <div className="row" style={{margin:0,alignItems:'flex-start'}}>
          <span className="pi">{ICONS[t.kind]||ICONS.start}</span>
          <span style={{flex:1}}>{t.text}</span>
          <button className="btn s" onClick={()=>setOpen(open===t.kind?'':t.kind)}>Act</button>
          <button className="btn g s" onClick={()=>setHidden(h=>[...h,t.kind])}>Dismiss</button>
        </div>
        {open===t.kind&&<p className="mu" style={{margin:'6px 0 0 36px'}}><b>Why:</b> {t.why}<br/><b>Watch:</b> {t.watch}</p>}
      </div>)}
    </St>
  </Card>}

export function AIContext(){
  const c=useQ<any>('/ai/context'),d=c.d;
  return <Card full t="AI Context" tip="What the advice is based on, how fresh it is, and what is missing.">
    <St l={c.l} e={c.e}>{d&&<div className="grid" style={{gridTemplateColumns:'repeat(auto-fit,minmax(240px,1fr))'}}>
      <div><div className="ring"><i>{d.health.score}</i></div><p style={{textAlign:'center',margin:0}}><b>{d.health.label}</b></p>
        <p className="mu" style={{textAlign:'center'}}>Reach 30d {d.metrics.reach30d.toLocaleString()} · ER {d.metrics.er}% · reach change {d.metrics.reachChange}%</p>
        <p className="mu" style={{textAlign:'center'}}>{d.coverage.posts} posts over {d.coverage.days} days · {d.coverage.competitors} competitors</p></div>
      <div className="sc"><table><thead><tr><th>Source</th><th>Rows</th><th>Updated</th></tr></thead>
        <tbody>{d.sources.map((s:any)=><tr key={s.name}><td>{s.name}</td><td>{s.rows}</td><td>{ago(s.lastUpdated)}</td></tr>)}</tbody></table></div>
      <div><span className="tag">Gaps</span><ul style={{margin:0,paddingLeft:18}}>{d.gaps.map((g:string)=><li key={g}>{g}</li>)}</ul></div>
    </div>}</St>
  </Card>}
