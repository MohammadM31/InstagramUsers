import {useState} from 'react';import {api} from '../api';import {Card,St} from '../ui';
export default function Finance(){const[cap,setCap]=useState(1000),[p,setP]=useState<any>(null),[l,setL]=useState(false),[e,setE]=useState('');
 const run=async()=>{setL(true);setE('');try{setP(await api('/finance/plan?capital='+cap))}catch(x:any){setE(x.message)}setL(false)};
 return <><Card full t="Capital available"><div className="row" style={{justifyContent:'flex-start'}}><input type="number" min={0} value={cap} onChange={e=>setCap(+e.target.value)}/><button className="btn" onClick={run}>Plan it</button><span className="mu">Planning guidance based on your page's current numbers, not financial advice.</span></div></Card>
 <div style={{marginTop:12}}><St l={l} e={e}>{p&&<div className="grid">
  <Card t="Where the money goes">{p.money.map((m:any)=><div key={m.area}><div className="row" style={{margin:0}}><span>{m.area}{m.note&&<i className="mu"> ({m.note})</i>}</span><b>${m.amount}</b></div><div className="bar"><div style={{width:m.share+'%'}}/></div></div>)}</Card>
  <Card t="Time and effort (free)">{p.time.length?p.time.map((t:string,i:number)=><p key={i}>{t}</p>):<p className="mu">Nothing urgent. Keep your current routine.</p>}</Card></div>}</St></div></>}
