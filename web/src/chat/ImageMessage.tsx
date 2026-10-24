// One image message in the thread: pending (own placeholder), done (library thumbs, full image on open) or failed (error + retry).
import {useState,useEffect} from 'react';
import {loadThumbs,cachedThumb,thumbMissing,fullImage} from './thumbs';
import {imageIdsOf} from './helpers';
import type {Msg} from './helpers';

export type ImageHandlers = {
  attachRef: (id: string, thumb?: string) => void;
  cont: (id: string, ratio?: string, thumb?: string) => void;
  save: (msgId: string) => void;
  retry: (msgId: string) => void;
  layout: () => void;
};

// Thumbs for these ids through the batched library call. Re-renders when they arrive.
function useThumbs(ids: string[]) {
  const [, bump] = useState(0);
  const key = ids.join(',');
  useEffect(() => {
    let live = true;
    loadThumbs(ids).then(() => { if (live) bump(n => n + 1); });
    return () => { live = false; };
  }, [key]); // eslint-disable-line
  return ids.map(id => cachedThumb(id));
}

function Lightbox({id, inline, onClose}: {id?: string; inline?: string; onClose: () => void}) {
  const [src, setSrc] = useState<string>(inline || '');
  const [err, setErr] = useState('');
  useEffect(() => {
    if (inline || !id) return;
    let live = true;
    fullImage(id).then(s => { if (live) setSrc(s); }).catch(e => { if (live) setErr(e.message || 'Could not load the image'); });
    return () => { live = false; };
  }, [id, inline]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [onClose]);
  return <div className="lightbox" role="dialog" aria-modal="true" aria-label="Image" onClick={onClose}>
    <div className="lightbox-box" onClick={e => e.stopPropagation()}>
      {src ? <img src={src} alt="Generated"/> : <div className="lightbox-wait">{err || 'Loading…'}</div>}
      <div className="row">
        {src && <a className="btn s" href={src} download="post.jpg">Download</a>}
        <button type="button" className="btn g s" onClick={onClose}>Close</button>
      </div>
    </div>
  </div>;
}

export default function ImageMessage({m, h}: {m: Msg; h: ImageHandlers}) {
  const d = m.data || {};
  const ids = imageIdsOf(m);
  const inline: string[] = Array.isArray(d.inline) ? d.inline : d.url ? [d.url] : []; // fallback when the server sent no imageIds (legacy)
  const status: string = d.status || (ids.length || inline.length ? 'done' : 'pending');
  const thumbs = useThumbs(status === 'done' ? ids : []);
  const [open, setOpen] = useState<null | {id?: string; inline?: string}>(null);
  const ratio = typeof d.ratio === 'string' && /^\d+:\d+$/.test(d.ratio) ? d.ratio.replace(':', ' / ') : '1 / 1';

  if (status === 'failed') return <div className="img-fail">
    <b>Image generation failed</b>
    <p className="mu" style={{margin:'2px 0 6px'}}>{d.error || 'Something went wrong. Try again.'}</p>
    <button type="button" className="btn g s" onClick={() => h.retry(m.id)}>Retry</button>
  </div>;

  if (status !== 'done') return <div className="img-pending">
    <div className="img-skel sk" style={{aspectRatio: ratio}}/>
    <div className="img-pend-row">
      <i className="spin" aria-hidden="true"/>
      <div style={{minWidth:0}}>
        <div><b>{d.summary || m.text || 'Generating your image…'}</b></div>
        <span className="mu">Generating{typeof d.elapsed === 'number' && d.elapsed > 0 ? '… ' + d.elapsed + 's' : '…'}</span>
      </div>
    </div>
  </div>;

  const tiles: Array<{id?: string; src?: string; missing: boolean}> = ids.length
    ? ids.map((id, i) => ({id, src: thumbs[i], missing: thumbMissing(id)}))
    : inline.map(src => ({src, missing: false}));
  const saved = d.saved;
  return <div>
    <div className={'img-grid' + (tiles.length > 1 ? ' two' : '')}>
      {tiles.map((t, i) => <div className="img-tile" key={(t.id || 'inline') + ':' + i}>
        {t.src
          ? <button type="button" className="img-open" onClick={() => setOpen({id: t.id, inline: t.id ? undefined : t.src})} title="Open full image" aria-label="Open full image">
              <img src={t.src} alt={'Generated image ' + (i + 1)} onLoad={h.layout}/>
            </button>
          : <div className="img-skel sk" style={{aspectRatio: ratio}}>{t.missing && <span className="mu img-gone">Image unavailable</span>}</div>}
        {t.id && <div className="img-acts">
          <button type="button" className="btn g s" onClick={() => h.attachRef(t.id!, t.src)}>Use as reference</button>
          <button type="button" className="btn g s" onClick={() => h.cont(t.id!, d.ratio, t.src)}>Continue editing</button>
        </div>}
      </div>)}
    </div>
    <div className="row">
      <span className="mu">{d.summary || m.text || ''}</span>
      {ids.length > 0 && <button type="button" className="btn s" disabled={saved === 'saving' || saved === true} onClick={() => h.save(m.id)}>
        {saved === true ? 'Saved ✓' : saved === 'saving' ? 'Saving…' : 'Save'}
      </button>}
    </div>
    {d.saveError && <p className="mu img-err" role="alert">{d.saveError}</p>}
    {open && <Lightbox id={open.id} inline={open.inline} onClose={() => setOpen(null)}/>}
  </div>;
}