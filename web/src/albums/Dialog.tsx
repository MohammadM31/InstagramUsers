import {useEffect,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import {Icon} from '../icons';

// Accessible modal: role=dialog, Esc closes only the TOPMOST modal (a confirm opened over the item sheet closes first), Tab stays inside,
// focus returns to whatever had it before, and the page behind does not scroll.
const stack:object[]=[];
const FOCUSABLE='button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Modal({label,onClose,children,sheet}:{label:string;onClose:()=>void;children:ReactNode;sheet?:boolean}){
  const box=useRef<HTMLDivElement>(null);
  const close=useRef(onClose);close.current=onClose; // the key handler below is installed once, so read the latest onClose through a ref
  useEffect(()=>{
    const me={};stack.push(me);
    const prev=document.activeElement as HTMLElement|null;
    const items=()=>Array.from(box.current?.querySelectorAll<HTMLElement>(FOCUSABLE)||[]);
    if(box.current&&!box.current.contains(document.activeElement))(items()[0]||box.current).focus(); // an autoFocus input keeps focus
    const key=(e:KeyboardEvent)=>{
      if(stack[stack.length-1]!==me)return;
      if(e.key==='Escape'){e.stopPropagation();close.current();return}
      if(e.key!=='Tab')return;
      const f=items();if(!f.length){e.preventDefault();return}
      const first=f[0],last=f[f.length-1];
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
    };
    document.addEventListener('keydown',key);
    const was=document.body.style.overflow;document.body.style.overflow='hidden';
    return()=>{document.removeEventListener('keydown',key);stack.splice(stack.indexOf(me),1);document.body.style.overflow=was;prev?.focus?.()};
  },[]);
  return <div className={'alb-scrim'+(sheet?' sheet':'')} onMouseDown={e=>{if(e.target===e.currentTarget)close.current()}}>
    <div className={'alb-modal'+(sheet?' sheet':'')} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} ref={box}>{children}</div>
  </div>;
}

export function Confirm({title,body,confirmLabel='Confirm',danger,busy,onConfirm,onCancel}:{title:string;body:ReactNode;confirmLabel?:string;danger?:boolean;busy?:boolean;onConfirm:()=>void;onCancel:()=>void}){
  return <Modal label={title} onClose={onCancel}>
    <div className="alb-dlg">
      <h2>{title}</h2>
      <p>{body}</p>
      <div className="alb-dlg-actions">
        <button className="btn g" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className={'btn'+(danger?' alb-danger':'')} onClick={onConfirm} disabled={busy}>{confirmLabel}</button>
      </div>
    </div>
  </Modal>;
}

export const FOLDER_NAME_MAX=60;
export function Prompt({title,label,initial='',confirmLabel='Save',busy,error,onSubmit,onCancel}:{title:string;label:string;initial?:string;confirmLabel?:string;busy?:boolean;error?:string;onSubmit:(v:string)=>void;onCancel:()=>void}){
  const [v,setV]=useState(initial);
  const t=v.trim(),ok=t.length>0&&t.length<=FOLDER_NAME_MAX;
  return <Modal label={title} onClose={onCancel}>
    <form className="alb-dlg" onSubmit={e=>{e.preventDefault();if(ok&&!busy)onSubmit(t)}}>
      <h2>{title}</h2>
      <label className="alb-field"><span>{label}</span>
        <input autoFocus value={v} maxLength={FOLDER_NAME_MAX} onChange={e=>setV(e.target.value)} aria-invalid={!!error}/></label>
      {error&&<div className="alb-err" role="alert">{error}</div>}
      <div className="alb-dlg-actions">
        <button type="button" className="btn g" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="submit" className="btn" disabled={!ok||busy}>{confirmLabel}</button>
      </div>
    </form>
  </Modal>;
}

// Small round close button used by the item sheet.
export const CloseBtn=({onClick}:{onClick:()=>void})=><button className="alb-x" onClick={onClick} aria-label="Close"><Icon name="close" size={20}/></button>;