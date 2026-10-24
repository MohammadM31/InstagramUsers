// The default landing page: centered layout with a dynamic greeting, floating report trigger, and an embedded conversation.
import {useState,useEffect} from 'react';
import {useQ} from '../api';
import Assistant from '../Assistant';
import type {Prefill,DeepLink} from '../Assistant';
import type {IgStatus} from '../ig';
import {briefing, connectionView} from '../cc';
import type {Tip} from '../cc';
import {parseHash} from '../chat/helpers';

export default function CommandCenter(){
  const dash = useQ<any>('/dashboard');
  const ctx = useQ<any>('/ai/context');
  const pr = useQ<{priorities:Tip[]}>('/priorities');
  const prof = useQ<any>('/profile');
  const ig = useQ<IgStatus>('/instagram/status');

  const [prefill, setPrefill] = useState<Prefill|null>(null);
  const [deepLink, setDeepLink] = useState<DeepLink|null>(null);
  const [interacted, setInteracted] = useState(false);

  const name = (prof.d?.display_name || '').trim();
  const tips = pr.d?.priorities || [];
  const b = briefing({ name, dash: dash.d, ctx: ctx.d, focus: tips[0]?.text });
  const conn = connectionView(ig.e ? null : ig.d);

  // Deep links: "#cc=<conversationId>&ref=<imageId>". Read on mount, on hashchange and on the window "nav" event;
  // apply it (hand it to the chat), then clear it with history.replaceState so a reload does not replay it.
  // Other hashes (#settings, #albums) are not ours: parseHash gives null and they are left alone for App.tsx.
  useEffect(() => {
    const read = () => {
      const link = parseHash(location.hash);
      if (!link) return;
      setInteracted(true);
      setDeepLink({ id: Date.now(), ...link });
      history.replaceState(null, '', location.pathname + location.search);
    };
    read();
    addEventListener('hashchange', read);
    addEventListener('nav', read);
    return () => { removeEventListener('hashchange', read); removeEventListener('nav', read); };
  }, []);

  const triggerReport = () => {
    setInteracted(true);
    setPrefill({ id: Date.now(), text: "Generate my daily report. Give me a summary of my account health, my top priorities right now, and what I should focus on today." });
  };

  // The connection pill: set the hash first, then dispatch "nav" (App.tsx listens to both and switches to Settings).
  const goSettings = () => {
    if (location.hash !== '#settings') location.hash = '#settings';
    dispatchEvent(new Event('nav'));
  };

  return (
    <div className="cc-centered">
      <div className="cc-topbar">
        <button className="ccconn-pill" onClick={goSettings} title={conn.title}>
          <i className={'ccdot'+(conn.on?' on':' off')} />
          <span>{conn.label}</span>
        </button>
      </div>

      <div className={'cc-content' + (interacted ? ' interacted' : '')}>
        <div className={'cc-briefing-watermark ' + b.tone + (interacted ? ' hidden' : '')}>
          <h1>{b.headline}</h1>
          <div className="cc-briefing-lines">
            {b.lines.map((l, i) => <p key={i}>{l}</p>)}
          </div>
        </div>

        <div className="cc-chat-wrapper">
          {!interacted && (
            <div className="cc-chat-actions">
              <button className="pgchip" onClick={triggerReport}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                Generate Daily Report
              </button>
            </div>
          )}
          <Assistant variant="page" prefill={prefill} deepLink={deepLink} onInteract={()=>setInteracted(true)} onReset={()=>setInteracted(false)}/>
        </div>
      </div>
    </div>
  );
}