// Roadmap A.3: follower sparkline and momentum for the selected competitor (Competitors page).
import {useQ} from '../api';
import {St,Card} from '../ui';
import {HistData,EMPTY_HISTORY,sparkPoints,momentumLine,change30} from '../comp';

export default function CompetitorHistory({id,handle}:{id:number;handle:string}){
  const h=useQ<HistData>('/competitors/'+id+'/history?days=30'),d=h.d,pts=d?sparkPoints(d.points):null;
  return <Card t={`@${handle} followers (30 days)`}>
    <St l={h.l} e={h.e}>{d&&(d.points.length===0
      ?<p className="mu" style={{margin:0}}>{EMPTY_HISTORY}</p>
      :<div>
        <div className="row" style={{margin:0,justifyContent:'flex-start',gap:16}}>
          <b style={{fontSize:20}}>{(d.momentum.followers??0).toLocaleString('en-US')}</b>
          {pts?<svg width={160} height={36} role="img" aria-label={`Follower trend for @${handle}`}><polyline points={pts} fill="none" stroke="var(--ac)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"/></svg>
              :<span className="mu">One point so far; a trend needs two days.</span>}
          <span className="mu">{change30(d.momentum)}</span>
        </div>
        <p style={{margin:'8px 0 0'}}>{momentumLine(d.momentum,handle,d.ownFollowersKnown)}</p>
      </div>)}
      {d&&<div className="mu" style={{marginTop:6}}>{d.note}</div>}
    </St>
  </Card>}
