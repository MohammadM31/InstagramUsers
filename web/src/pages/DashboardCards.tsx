// Phase 1 cards for the Dashboard: Today's Priorities (1.1) and AI Context (1.2).
import {useState} from 'react';
import {api,useQ} from '../api';
import {St,Card} from '../ui';
import {ICONS} from '../icons';
import {IgStatus,igAgo} from '../ig';

type Tip={priority:number;kind:string;text:string;why?:string;watch?:string};
const ago=(v?:string|null)=>{if(!v)return '—';const d=Math.round((Date.now()-new Date(v).getTime())/864e5);return d<=0?'today':d===1?'1 day ago':d+' days ago'};

// Act opens the reasoning ("why" and the metric to watch). Dismiss hides the tip for 14 days on the server (A.1d), so it survives a reload; Undo and Restore bring it back.
const LABEL:Record<string,string>={collab:'Collab',mention:'Mentions and tags',community:'Community replies',giveaway:'Giveaway',swap:'Shoutout swap',content:'More of your best format',consistency:'Posting rhythm',hashtags:'Hashtags',follower_drop:'Follower drop',start:'Get started'};
export function Priorities(){
  const p=useQ<{priorities:Tip[];snoozed?:{key:string;until:string}[]}>('/priorities'),[open,setOpen]=useState(''),[undo,setUndo]=useState(''),[err,setErr]=useState('');
  const list=(p.d?.priorities||[]).slice(0,5),snoozed=p.d?.snoozed||[];
  const call=(k:string,method:'POST'|'DELETE',after:()=>void)=>{setErr('');api(`/priorities/${encodeURIComponent(k)}${method==='POST'?'/dismiss':''}`,{method,...(method==='POST'?{body:{}}:{})}).then(()=>{after();p.reload()}).catch(e=>setErr(e.message))};
  const hide=(k:string)=>call(k,'POST',()=>setUndo(k)),restore=(k:string)=>call(k,'DELETE',()=>{if(undo===k)setUndo('')});
  return <Card full t="Today's Priorities" tip="Ranked by expected impact. Collabs, mentions and community come before hashtags.">
    <St l={p.l&&!p.d} e={p.e} empty={!!p.d&&!p.d.priorities.length&&!snoozed.length}>
      {err&&<div className="st dn">⚠ {err}</div>}
      {undo&&<div className="undo mu">“{LABEL[undo]||undo}” is hidden for 14 days.<button className="btn g s" onClick={()=>restore(undo)}>Undo</button></div>}
      {!list.length&&<p className="mu">Every tip is hidden for now. Restore them below.</p>}
      {list.map(t=><div key={t.kind} className="prio">
        <div className="row" style={{margin:0,alignItems:'flex-start'}}>
          <span className="pi">{ICONS[t.kind]||ICONS.start}</span>
          <span style={{flex:1}}>{t.text}</span>
          <button className="btn s" onClick={()=>setOpen(open===t.kind?'':t.kind)}>Act</button>
          <button className="btn g s" title="Hide this tip for 14 days" onClick={()=>hide(t.kind)}>Dismiss</button>
        </div>
        {open===t.kind&&<p className="mu" style={{margin:'6px 0 0 36px'}}><b>Why:</b> {t.why}<br/><b>Watch:</b> {t.watch}</p>}
      </div>)}
      {snoozed.length>0&&<details style={{marginTop:8}}><summary className="mu">Hidden tips ({snoozed.length})</summary>
        {snoozed.map(x=><div key={x.key} className="row" style={{margin:'4px 0'}}><span>{LABEL[x.key]||x.key} <span className="mu">· back on {new Date(x.until).toLocaleDateString()}</span></span><button className="btn g s" onClick={()=>restore(x.key)}>Restore</button></div>)}</details>}
    </St>
  </Card>}

export function AIContext(){
  const c=useQ<any>('/ai/context'),d=c.d,ig=useQ<IgStatus>('/instagram/status').d;
  return <Card full t="AI Context" tip="What the advice is based on, how fresh it is, and what is missing.">
    <St l={c.l} e={c.e}>{d&&<div className="grid" style={{gridTemplateColumns:'repeat(auto-fit,minmax(240px,1fr))'}}>
      <div><div className="ring"><i>{d.health.score}</i></div><p style={{textAlign:'center',margin:0}}><b>{d.health.label}</b></p>
        <p className="mu" style={{textAlign:'center'}}>Reach 30d {d.metrics.reach30d.toLocaleString()} · ER {d.metrics.er}% · reach change {d.metrics.reachChange}%</p>
        <p className="mu" style={{textAlign:'center'}}>{d.coverage.posts} posts over {d.coverage.days} days · {d.coverage.competitors} competitors</p></div>
      <div className="sc"><table><thead><tr><th>Source</th><th>Rows</th><th>Updated</th></tr></thead>
        <tbody>{d.sources.map((s:any)=><tr key={s.name}><td>{s.name}</td><td>{s.rows}</td><td>{ago(s.lastUpdated)}</td></tr>)}</tbody></table></div>
      <div><span className="tag">Gaps</span><ul style={{margin:0,paddingLeft:18}}>{d.gaps.map((g:string)=><li key={g}>{g}</li>)}</ul></div>
    </div>}
    {d&&ig&&<div style={{marginTop:12}}><span className="tag">Live Instagram data</span>
      {ig.status==='connected'?<div className="sc"><table><thead><tr><th>Source</th><th>Value</th><th>Updated</th></tr></thead><tbody>
        <tr><td>Account</td><td>@{ig.username}</td><td>{igAgo(ig.lastSyncAt)}</td></tr>
        <tr><td>Followers</td><td>{ig.followers!=null?ig.followers.toLocaleString()+(ig.followerSource==='reconstructed'?' (estimated)':''):'—'}</td><td>{igAgo(ig.lastFollowerAt)}</td></tr>
        <tr><td>Follower history</td><td>{ig.followerPoints} day(s)</td><td>{igAgo(ig.lastFollowerAt)}</td></tr>
        <tr><td>Posts and insights</td><td>{d.coverage.posts} posts</td><td>{igAgo(ig.lastSyncAt)}</td></tr></tbody></table>
        {ig.lastError&&<p className="dn" style={{margin:'6px 0 0'}}>⚠ {ig.lastError}</p>}</div>
        :<p className="mu" style={{margin:0}}>{ig.status==='reconnect_needed'?'The Instagram connection expired, so the numbers above are not live. Reconnect in Settings.':'Instagram is not connected, so the advice uses imported or demo posts. Connect it in Settings.'}</p>}</div>}
    </St>
  </Card>}
