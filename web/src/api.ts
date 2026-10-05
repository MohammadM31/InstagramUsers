import {useEffect,useState,useCallback} from 'react';
export const tok=()=>localStorage.getItem('t')||'';
export async function api<T=any>(p:string,o:{method?:string;body?:any}={}):Promise<T>{
 const r=await fetch('/api'+p,{method:o.method||'GET',headers:{'Content-Type':'application/json',Authorization:'Bearer '+tok()},body:o.body?JSON.stringify(o.body):undefined});
 const j=await r.json().catch(()=>({}));
 if(r.status===401&&!p.startsWith('/auth')){localStorage.removeItem('t');location.reload()}
 if(!r.ok)throw new Error(j.error||r.statusText);return j}
export function useQ<T=any>(p:string){const[d,setD]=useState<T|null>(null),[e,setE]=useState(''),[l,setL]=useState(true);
 const run=useCallback(()=>{setL(true);api<T>(p).then(x=>{setD(x);setE('')}).catch(x=>setE(x.message)).finally(()=>setL(false))},[p]);
 useEffect(run,[run]);return{d,e,l,reload:run}}
