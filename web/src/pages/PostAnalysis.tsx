// Roadmap 2.2: the analysis shown when a row in Statistics > Post Performance is opened.
import {useQ} from '../api';
import {St} from '../ui';
import CommentsCard from './CommentsCard';

type Analysis={text:string;delta:any;rank:{position:number;of:number;type:string;typePosition:number;typeOf:number;by:string}|null;snapshots:{count:number;lastAt:string|null}};
const sgn=(v:number|null,u='')=>v===null||v===undefined?'—':(v>0?'+':'')+v+u;

export default function PostAnalysis({id}:{id:number}){
  const a=useQ<Analysis>('/posts/'+id+'/analysis');
  return <St l={a.l} e={a.e}>{a.d&&<div>
    <p style={{margin:'0 0 8px'}}>{a.d.text}</p>
    <div className="row" style={{margin:0}}>
      {a.d.rank&&<><span className="pill">#{a.d.rank.position} of {a.d.rank.of} posts by {a.d.rank.by}</span><span className="pill">#{a.d.rank.typePosition} of {a.d.rank.typeOf} {a.d.rank.type}s</span></>}
      {a.d.delta&&<><span className="pill">Reach {sgn(a.d.delta.reach.pct,'%')}</span><span className="pill">ER {sgn(a.d.delta.er.points,' pts')}</span></>}
      <span className="mu">{a.d.snapshots.count} daily snapshot(s){a.d.snapshots.lastAt?', last '+new Date(a.d.snapshots.lastAt).toLocaleDateString():''}</span>
    </div><CommentsCard id={id}/></div>}</St>}
