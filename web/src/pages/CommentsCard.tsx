// Roadmap A.2: the comments card inside the post analysis panel (Statistics > click a post row).
import {useQ} from '../api';
import {St} from '../ui';
import {CommentsData,emptyMessage,sentimentParts,openQuestions,clip,freshness} from '../cmt';

export default function CommentsCard({id}:{id:number}){
  const c=useQ<CommentsData>('/posts/'+id+'/comments');
  const d=c.d;
  return <div style={{marginTop:12,paddingTop:10,borderTop:'1px solid var(--bd)'}}>
    <b style={{fontSize:13}}>Comments</b>
    <St l={c.l} e={c.e}>{d&&(d.insights.total===0
      ?<p className="mu" style={{margin:'6px 0 0'}}>{emptyMessage(d.reason)}</p>
      :<div>
        <p style={{margin:'6px 0'}}>{d.insights.summary}</p>
        <div className="row" style={{margin:0,justifyContent:'flex-start'}} title={d.insights.sentimentNote}>
          {sentimentParts(d.insights.sentiment).map(s=><span key={s.label} className="pill">{s.n} {s.label}</span>)}
          <span className="mu">estimate: keywords and emoji only</span>
        </div>
        {openQuestions(d.comments).length>0&&<div style={{marginTop:8}}>
          <div className="mu">Questions you have not answered</div>
          <ul style={{margin:'4px 0 0',paddingLeft:18}}>{openQuestions(d.comments).map((q,i)=><li key={i}><b>@{q.username||'someone'}</b>: {clip(q.text)}</li>)}</ul>
        </div>}
        {d.insights.topCommenters.length>0&&<div style={{marginTop:8}}><span className="mu">Most active: </span>
          {d.insights.topCommenters.map(t=><span key={t.username} className="pill">@{t.username} · {t.comments}</span>)}</div>}
        {d.insights.themes.length>0&&<div style={{marginTop:4}}><span className="mu">Words that come up in several comments: </span>
          {d.insights.themes.map(t=><span key={t.word} className="pill">{t.word} · {t.comments}</span>)}</div>}
      </div>)}
      {d&&<div className="mu" style={{marginTop:6}}>{freshness(d.lastFetchedAt)}. Comment text is kept {d.retentionDays} days.</div>}
    </St>
  </div>}
