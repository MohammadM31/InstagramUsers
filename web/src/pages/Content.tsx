import {useEffect,useState} from 'react';
import {api} from '../api';
import {Card} from '../ui';
import {getPageWork,onPageImage,setPageWork} from '../work';

type Cap = { hook?: string; body?: string; cta?: string };

const joinCap = (c: Cap) => [c.hook, c.body, c.cta].filter(Boolean).join('\n');
const hashLine = (tags: any) => {
  if (!tags || typeof tags !== 'object') return '';
  return Object.values(tags).flat().filter((t): t is string => typeof t === 'string' && !!t.trim())
    .map(t => t.startsWith('#') ? t : '#' + t.replace(/^#+/, '')).join(' ');
};
const tagList = (line: string) => line.split(/\s+/).map(t => t.trim()).filter(Boolean);

function IgMark() {
  return <svg className="ig-glyph" width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" strokeWidth="1.7"/>
    <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.7"/>
    <circle cx="17.4" cy="6.6" r="1.05" fill="currentColor"/>
  </svg>;
}
function IgIcon({d}: {d: string}) {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d}/></svg>;
}

export default function Content() {
  const saved = getPageWork();
  const [topic, setTopic] = useState('');
  const [tone, setTone] = useState('');
  const [caps, setCaps] = useState<Cap[]>(saved.captions || []);
  const [capText, setCapText] = useState(saved.captions?.[0]?.body || saved.captions?.[0]?.hook || '');
  const [ce, setCe] = useState('');
  const [cl, setCl] = useState(false);
  const [prompt, setPrompt] = useState(saved.prompt || '');
  const [ratio, setRatio] = useState(saved.ratio || '1:1');
  const [ov, setOv] = useState(saved.overlay || '');
  const [imgs, setImgs] = useState<string[]>(saved.image ? [saved.image] : []);
  const [ie, setIe] = useState('');
  const [il, setIl] = useState(false);
  const [prog, setProg] = useState('');
  const [niche, setNiche] = useState('');
  const [tagNote, setTagNote] = useState('');
  const [tags, setTags] = useState<any>(null);
  const [tagText, setTagText] = useState(hashLine(saved.tags));
  const [he, setHe] = useState('');
  const [when, setWhen] = useState('');
  const [album, setAlbum] = useState('');
  const [postNote, setPostNote] = useState('');
  const [postBusy, setPostBusy] = useState(false);

  const run = async (f: () => Promise<void>, setL: (b: boolean) => void, setE: (s: string) => void) => {
    setL(true); setE('');
    try { await f(); } catch (e: any) { setE(e.message); }
    setL(false);
  };

  // flux-schnell usually finishes in seconds. Keep polling for 5 minutes so a slower fallback is not reported as a failure.
  const genImage = async () => {
    const { jobId } = await api('/content/image', { method: 'POST', body: { prompt, ratio, overlayText: ov, model: 'flux-schnell' } });
    for (let i = 1; i <= 150; i++) {
      setProg('Generating… ' + i * 2 + 's');
      await new Promise(r => setTimeout(r, 2000));
      const s = await api('/content/image/' + jobId);
      if (s.status === 'done') { setImgs(s.images || []); setProg(''); return; }
      if (s.status === 'failed') throw new Error(s.error || 'Image generation failed');
    }
    throw new Error('Still working after 5 minutes. Press Generate again.');
  };

  useEffect(() => onPageImage(img => { setImgs([img]); setIe(''); setProg(''); }), []);

  useEffect(() => {
    const line = tagList(tagText);
    setPageWork({
      prompt, ratio, overlay: ov,
      captions: capText.trim() ? [{ body: capText }] : caps,
      tags: line.length ? { line } : (tags || undefined),
      imageCount: imgs.length,
      image: imgs[0],
      imageUrl: imgs.find(s => typeof s === 'string' && s.startsWith('http')),
    });
  }, [prompt, ratio, ov, capText, caps, tagText, tags, imgs]);

  const fullCaption = [capText.trim(), tagText.trim()].filter(Boolean).join('\n\n');

  const schedule = async () => {
    if (!fullCaption) return setPostNote('Add a caption or tags first.');
    if (!when) return setPostNote('Pick a date and time.');
    setPostBusy(true); setPostNote('');
    try {
      const image = imgs.find(s => s.startsWith('http')) || null;
      await api('/schedule', { method: 'POST', body: { caption: fullCaption, image, scheduledAt: new Date(when).toISOString() } });
      setPostNote(image ? 'Scheduled. It is in Scheduling.' : 'Scheduled the caption and tags. The photo is not a public link yet, so Instagram cannot publish the picture.');
    } catch (e: any) { setPostNote(e.message); }
    setPostBusy(false);
  };

  const saveAlbum = async () => {
    const name = album.trim();
    if (!name) return setPostNote('Name the album.');
    if (!fullCaption && !imgs[0]) return setPostNote('Nothing to save yet.');
    setPostBusy(true); setPostNote('');
    try {
      let folderId: string | null = null;
      try {
        const created = await api<{ folder: { id: string } }>('/albums/folders', { method: 'POST', body: { name } });
        folderId = created.folder.id;
      } catch {
        const ovw = await api<{ folders: { id: string; name: string }[] }>('/albums');
        folderId = ovw.folders.find(f => f.name.toLowerCase() === name.toLowerCase())?.id || null;
        if (!folderId) throw new Error('Could not open that album.');
      }
      await api('/albums/items', { method: 'POST', body: {
        title: (topic || prompt || name).slice(0, 140),
        caption: fullCaption,
        category: ratio === '9:16' ? 'reel' : 'photo',
        folderId, ratio, cover: imgs[0] || null,
      } });
      setPostNote('Saved into ' + name + '.');
    } catch (e: any) { setPostNote(e.message); }
    setPostBusy(false);
  };

  const scrap = () => {
    setCaps([]); setCapText(''); setTags(null); setTagText(''); setImgs([]); setIe(''); setProg(''); setPostNote('Scrapped. The picture, caption, and tags are cleared.');
  };

  return <div className="grid">
    <Card t="Caption"><div className="row">
      <input placeholder="Topic" value={topic} onChange={e => setTopic(e.target.value)}/>
      <input placeholder="How should it sound? Warm, a little witty, like a neighborhood cafe" value={tone} onChange={e => setTone(e.target.value)}/>
      <button className="btn" disabled={cl} onClick={() => run(async () => {
        const variants = (await api('/content/captions', { method: 'POST', body: { topic, tone: tone.trim() || 'natural' } })).variants || [];
        setCaps(variants);
        if (variants[0]) setCapText(joinCap(variants[0]));
      }, setCl, setCe)}>{cl ? 'Generating…' : 'Generate'}</button>
    </div>{ce && <div className="dn">{ce}</div>}
    {caps.length > 0 && <div className="cap-picks">{caps.map((c, i) => <button type="button" key={i} className={'cap-pick' + (joinCap(c) === capText ? ' on' : '')} onClick={() => setCapText(joinCap(c))}><b>{c.hook}</b> {c.body}</button>)}</div>}
    </Card>

    <Card t="Image"><div className="row">
      <input placeholder="What should the picture show?" value={prompt} onChange={e => setPrompt(e.target.value)}/>
      <select value={ratio} onChange={e => setRatio(e.target.value)} aria-label="Ratio"><option>1:1</option><option>4:5</option><option>9:16</option></select>
      <input placeholder="Text on the image (optional)" value={ov} onChange={e => setOv(e.target.value)}/>
      <button className="btn" disabled={il || !prompt.trim()} onClick={() => run(genImage, setIl, setIe)}>{il ? 'Generating…' : 'Generate'}</button>
    </div>{il && prog && <div className="mu">{prog}</div>}{ie && <div className="dn">{ie}</div>}
    </Card>

    <Card t="Hashtags"><div className="row">
      <input placeholder="What are the tags about?" value={niche} onChange={e => setNiche(e.target.value)}/>
      <input placeholder="Anything else? Local, niche, not too salesy" value={tagNote} onChange={e => setTagNote(e.target.value)}/>
      <button className="btn" onClick={() => run(async () => {
        const nicheText = [niche.trim(), tagNote.trim()].filter(Boolean).join('. ');
        const got = await api('/content/hashtags', { method: 'POST', body: { niche: nicheText } });
        setTags(got); setTagText(hashLine(got));
      }, () => {}, setHe)}>Generate</button>
    </div>{he && <div className="dn">{he}</div>}
    </Card>

    <Card full t="Post">
      <div className="ig-stage">
        <div className="ig-phone">
          <header className="ig-top">
            <div className="ig-brand">
              <IgMark/>
              <span className="ig-word">Instagram</span>
            </div>
            <IgIcon d="M22 3 11 14M22 3l-7 19-4-8-8-4 19-7z"/>
          </header>
          <div className={'ig-photo' + (imgs[0] ? ' has r' + ratio.replace(':', '') : '')}>
            {imgs[0] ? <img src={imgs[0]} alt="Post"/> : <span>The image shows up here.</span>}
          </div>
          <div className="ig-bar">
            <div className="ig-bar-l">
              <IgIcon d="M12 20s-7-4.4-7-9a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 4.6-7 9-7 9z"/>
              <IgIcon d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5c-.9 0-1.8-.2-2.6-.5L5 20.2l1.2-3.4A7.5 7.5 0 1 1 20 11.5z"/>
              <IgIcon d="M22 3 11 14M22 3l-7 19-4-8-8-4 19-7z"/>
            </div>
            <IgIcon d="M6 3.5h12a1 1 0 0 1 1 1V21l-7-3.5L5 21V4.5a1 1 0 0 1 1-1z"/>
          </div>
          <div className="ig-copy">
            <textarea rows={2} placeholder="Caption" value={capText} onChange={e => setCapText(e.target.value)} aria-label="Caption"/>
            <textarea className="ig-tags" rows={2} placeholder="#tags" value={tagText} onChange={e => setTagText(e.target.value)} aria-label="Hashtags"/>
          </div>
          <nav className="ig-tab" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24"><path fill="currentColor" d="M12 3.2 3 11.2V21h6.2v-6.2h5.6V21H21V11.2z"/></svg>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="12" r="8"/><path d="M12 8.5v7M8.5 12h7"/></svg>
          </nav>
        </div>
        <div className="ig-tools">
          <div className="row ig-actions">
            <input type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} aria-label="Schedule time"/>
            <button className="btn" disabled={postBusy} onClick={schedule}>Schedule</button>
            <input placeholder="Album name" value={album} onChange={e => setAlbum(e.target.value)} aria-label="Album name"/>
            <button className="btn g" disabled={postBusy} onClick={saveAlbum}>Save to album</button>
            <button className="btn g" onClick={scrap}>Scrap</button>
          </div>
          {postNote && <div className="mu">{postNote}</div>}
          <p className="ig-note mu">Ask the assistant to change only the picture, for example “make the image a bit darker.” The caption and tags stay as they are.</p>
        </div>
      </div>
    </Card>
  </div>;
}
