// Image picker: the person's library, newest first, paginated. Choosing one attaches it as the edit reference.
import {useState,useEffect} from 'react';
import {api} from '../api';
import {rememberThumb} from './thumbs';

type Img = {id: string; thumb: string; prompt?: string; instruction?: string; ratio?: string; createdAt?: string};

export default function ImagePicker({onPick, onClose}: {onPick: (img: {id: string; thumb: string}) => void; onClose: () => void}) {
  const [items, setItems] = useState<Img[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState('');

  const load = async (before?: string | null) => {
    setBusy(true); setErr('');
    try {
      const r = await api<any>('/images?limit=24' + (before ? '&before=' + encodeURIComponent(before) : ''));
      const list: Img[] = Array.isArray(r.images) ? r.images : [];
      list.forEach(i => rememberThumb(i.id, i.thumb));
      setItems(l => { const seen = new Set(l.map(x => x.id)); return [...l, ...list.filter(x => !seen.has(x.id))]; });
      setNext(r.next || null);
    } catch (e: any) { setErr(e.message || 'Could not load your images'); }
    setBusy(false);
  };
  useEffect(() => { load(null); }, []); // eslint-disable-line
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [onClose]);

  return <div className="picker-back" onClick={onClose}>
    <div className="picker" role="dialog" aria-modal="true" aria-label="Pick a reference image" onClick={e => e.stopPropagation()}>
      <div className="picker-head">
        <b>Pick a reference image</b>
        <button type="button" className="x" onClick={onClose} aria-label="Close">×</button>
      </div>
      {err && <p className="mu img-err" role="alert">{err}</p>}
      {!busy && !err && items.length === 0 && <p className="mu" style={{padding:'12px 4px'}}>No images yet. Generate one and it will show up here.</p>}
      <div className="picker-grid">
        {items.map(i => <button type="button" key={i.id} className="picker-item" title={i.instruction || i.prompt || 'Use this image'} onClick={() => onPick({id: i.id, thumb: i.thumb})}>
          <img src={i.thumb} alt={i.instruction || i.prompt || 'Library image'}/>
        </button>)}
      </div>
      {busy && <p className="mu" style={{textAlign:'center'}}>Loading…</p>}
      {!busy && next && <div style={{textAlign:'center',paddingTop:8}}><button type="button" className="btn g s" onClick={() => load(next)}>Load more</button></div>}
    </div>
  </div>;
}