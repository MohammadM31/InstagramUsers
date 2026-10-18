import {Card} from '../ui';

// Sidebar entries that have no page yet (Marketing, CRM, Ads, Collabs). An honest empty state instead of a dead link or invented numbers.
export default function NotBuilt({name,go,see}:{name:string;go:(page:string)=>void;see?:{label:string;page:string;why:string}}){
  return <Card full t={name+' is not built yet'}>
    <p style={{margin:'0 0 10px'}}>There is nothing in {name} for this version of RaidTechs. The Roadmap page lists what is planned and what each item needs.</p>
    <div className="row" style={{justifyContent:'flex-start'}}>
      <button className="btn" onClick={()=>go('Roadmap')}>See the roadmap</button>
      {see&&<button className="btn g" onClick={()=>go(see.page)}>{see.label}</button>}
      {see&&<span className="mu">{see.why}</span>}</div></Card>}
