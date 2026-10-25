// R.0: who am I and what may I do, from GET /api/me. One request per sign-in, shared by every hook. useCan works for platform AND organization permissions.
import {useState,useEffect} from 'react';
import {api,tok} from '../api';
import {canFrom} from './pure';
import type {Me} from './pure';

let cache:{t:string;p:Promise<Me>}|null=null;
export function loadMe():Promise<Me>{
  const t=tok();
  if(!cache||cache.t!==t){const p=api<Me>('/me');cache={t,p};p.catch(()=>{if(cache&&cache.p===p)cache=null})} // a failed request is not remembered
  return cache.p;
}
export const forgetMe=()=>{cache=null};

// `key` changes when the person signs in or out (App passes its token), which reloads /me.
export function useMe(key:string=tok()){
  const [me,setMe]=useState<Me|null>(null),[loading,setLoading]=useState(!!key);
  useEffect(()=>{
    if(!key){setMe(null);setLoading(false);return}
    let live=true;setLoading(true);
    loadMe().then(m=>live&&setMe(m)).catch(()=>live&&setMe(null)).finally(()=>live&&setLoading(false));
    return()=>{live=false};
  },[key]);
  return {me,loading};
}
// useCan('users:read') -> boolean (false while loading or signed out)
export function useCan(perm:string):boolean{const {me}=useMe();return canFrom(me,perm)}
