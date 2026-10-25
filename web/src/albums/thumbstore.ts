import {useEffect,useSyncExternalStore} from 'react';
import {api} from '../api';
import {makeThumbStore,makeFullCache} from './thumbs';
import type {ThumbRow} from './thumbs';

// One store for the whole session (module scope): leaving and re-opening Albums does not refetch thumbnails.
// ids are joined with a literal comma (GET /api/images?ids=<comma uuids>, max 40: thumbs.ts chunks the calls).
export const thumbStore=makeThumbStore(async ids=>{
  const r=await api<{images:ThumbRow[]}>('/images?ids='+ids.map(encodeURIComponent).join(','));
  return r.images||[];
});
// Full image (GET /api/images/:id) is fetched only when a post is opened.
export const fullImages=makeFullCache(async id=>(await api<{dataUrl:string}>('/images/'+encodeURIComponent(id))).dataUrl);

// A parent that shows many thumbnails calls this once with ALL their ids, so they travel in batches of 40.
// Individual <Img> components only read the store (they never fetch): child effects would otherwise fire one request per image.
export function usePrefetch(ids:string[]){
  const key=ids.join(',');
  useEffect(()=>{if(ids.length)void thumbStore.load(ids)},[key]);
}

// '' = not here yet, 'x' = could not be loaded (missing or failed), otherwise the data URL. A string snapshot, so only this image re-renders.
export function useThumb(id?:string):string{
  return useSyncExternalStore(thumbStore.subscribe,()=>!id?'x':thumbStore.get(id)||(thumbStore.isMissing(id)||thumbStore.isFailed(id)?'x':''));
}