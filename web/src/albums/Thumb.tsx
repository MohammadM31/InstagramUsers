import {Icon} from '../icons';
import {useThumb} from './thumbstore';

// One thumbnail. It only READS the session store; the parent loads all ids in batches.
// '' = still loading (skeleton), 'x' = no thumbnail available (neutral placeholder, never a broken image).
export function Img({id,alt=''}:{id?:string;alt?:string}){
  const t=useThumb(id);
  if(t==='')return <span className="alb-img sk" aria-hidden="true"/>;
  if(t==='x')return <span className="alb-img none" role="img" aria-label={alt||'No preview'}><Icon name="content" size={22}/></span>;
  return <img className="alb-img" src={t} alt={alt} loading="lazy" draggable={false}/>;
}

// Phone-album cover: up to 4 thumbnails in a square. 1 fills it, 2 split it, 3 and 4 use a 2x2 grid.
export function Collage({ids,empty}:{ids:string[];empty?:string}){
  const list=(ids||[]).slice(0,4);
  if(!list.length)return <span className="alb-collage empty"><Icon name="albums" size={30}/><em>{empty||'Empty'}</em></span>;
  return <span className={'alb-collage n'+list.length}>{list.map(id=><Img key={id} id={id}/>)}</span>;
}