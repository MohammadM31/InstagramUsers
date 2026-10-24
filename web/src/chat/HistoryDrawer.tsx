// History drawer: conversations (title, last message, cover image, age) with open, new chat, rename and delete (with confirmation).
import {useState,useEffect} from 'react';
import {api} from '../api';
import {loadThumbs,cachedThumb} from './thumbs';
import {relTime} from './helpers';

type Convo = {id: string; title: string; updatedAt?: string; lastMessage?: string; messageCount?: number; coverImageId?: string};

export default function HistoryDrawer({currentId, onClose, onOpen, onNew, onDeleted, onRenamed}: {
  currentId: string | null;
  onClose: () => void;
  onOpen: (id: string) => void;
  onNew: () => void;
  onDeleted: (id: string) => void;
  onRenamed: (id: string, title: string) => void;
}) {
  const [items, setItems] = useState<Convo[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);
  const [, bump] = useState(0);

  const load = async (before?: string | null) => {
    setBusy(true); setErr('');
    try {
      const r = await api<any>('/conversations?limit=30' + (before ? '&before=' + encodeURIComponent(before) : ''));
      const list: Convo[] = Array.isArray(r.conversations) ? r.conversations : [];
      setItems(l => { const seen = new Set(l.map(x => x.id)); return [...l, ...list.filter(x => !seen.has(x.id))]; });
      setNext(r.next || null);
      const covers = list.map(c => c.coverImageId).filter(Boolean) as string[];
      if (covers.length) loadThumbs(covers).then(() => bump(n => n + 1));
    } catch (e: any) { setErr(e.message || 'Could not load your chats'); }
    setBusy(false);
  };
  useEffect(() => { load(null); }, []); // eslint-disable-line
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [onClose]);

  const rename = async (id: string) => {
    const title = draft.trim().slice(0, 120);
    if (!title) { setEditing(null); return; }
    try {
      const r = await api<any>('/conversations/' + encodeURIComponent(id), {method: 'PATCH', body: {title}});
      const t = String(r?.title || title);
      setItems(l => l.map(c => c.id === id ? {...c, title: t} : c));
      onRenamed(id, t);
      setEditing(null);
    } catch (e: any) { setErr(e.message || 'Could not rename'); }
  };
  const remove = async (id: string) => {
    try {
      await api('/conversations/' + encodeURIComponent(id), {method: 'DELETE'});
      setItems(l => l.filter(c => c.id !== id));
      setConfirm(null);
      onDeleted(id);
    } catch (e: any) { setErr(e.message || 'Could not delete'); }
  };

  return <div className="hist-back" onClick={onClose}>
    <aside className="hist-drawer" role="dialog" aria-modal="true" aria-label="Chat history" onClick={e => e.stopPropagation()}>
      <div className="picker-head">
        <b>Chats</b>
        <div style={{display:'flex',gap:6}}>
          <button type="button" className="btn s" onClick={onNew}>New chat</button>
          <button type="button" className="x" onClick={onClose} aria-label="Close">×</button>
        </div>
      </div>
      {err && <p className="mu img-err" role="alert">{err}</p>}
      {!busy && !err && items.length === 0 && <p className="mu" style={{padding:'12px 4px'}}>No chats yet. Ask something and it will be saved here.</p>}
      <ul className="hist-list">
        {items.map(c => {
          const cover = c.coverImageId ? cachedThumb(c.coverImageId) : undefined;
          return <li key={c.id} className={'hist-item' + (c.id === currentId ? ' on' : '')}>
            {editing === c.id
              ? <div className="hist-edit">
                  <input autoFocus value={draft} maxLength={120} onChange={e => setDraft(e.target.value)} aria-label="Chat title"
                    onKeyDown={e => { if (e.key === 'Enter') rename(c.id); if (e.key === 'Escape') { e.stopPropagation(); setEditing(null); } }}/>
                  <button type="button" className="btn s" onClick={() => rename(c.id)}>Save</button>
                  <button type="button" className="btn g s" onClick={() => setEditing(null)}>Cancel</button>
                </div>
              : <button type="button" className="hist-open" onClick={() => onOpen(c.id)}>
                  <span className="hist-cover">{cover ? <img src={cover} alt=""/> : <span className="mu">AI</span>}</span>
                  <span className="hist-text">
                    <b>{c.title || 'New chat'}</b>
                    <span className="mu hist-last">{c.lastMessage || ''}</span>
                  </span>
                  <span className="mu hist-when">{relTime(c.updatedAt)}</span>
                </button>}
            {editing !== c.id && (confirm === c.id
              ? <div className="hist-acts">
                  <span className="mu">Delete this chat?</span>
                  <button type="button" className="btn s hist-del" onClick={() => remove(c.id)}>Delete</button>
                  <button type="button" className="btn g s" onClick={() => setConfirm(null)}>Cancel</button>
                </div>
              : <div className="hist-acts">
                  <button type="button" className="btn g s" onClick={() => { setEditing(c.id); setDraft(c.title || ''); setConfirm(null); }}>Rename</button>
                  <button type="button" className="btn g s" onClick={() => setConfirm(c.id)}>Delete</button>
                </div>)}
          </li>;
        })}
      </ul>
      {busy && <p className="mu" style={{textAlign:'center'}}>Loading…</p>}
      {!busy && next && <div style={{textAlign:'center',paddingTop:8}}><button type="button" className="btn g s" onClick={() => load(next)}>Load more</button></div>}
    </aside>
  </div>;
}