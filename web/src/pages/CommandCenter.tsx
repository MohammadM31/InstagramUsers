// The default landing page: centered layout with a dynamic greeting, floating report trigger, and embedded assistant.
import {useEffect, useState} from 'react';
import {useQ} from '../api';
import Assistant from '../Assistant';
import type {Prefill} from '../Assistant';
import type {IgStatus} from '../ig';
import {briefing, connectionView} from '../cc';
import type {Tip} from '../cc';

export default function CommandCenter(){
  const dash = useQ<any>('/dashboard');
  const ctx = useQ<any>('/ai/context');
  const pr = useQ<{priorities:Tip[]}>('/priorities');
  const prof = useQ<any>('/profile');
  const ig = useQ<IgStatus>('/instagram/status');
  
  const [prefill, setPrefill] = useState<Prefill|null>(null);
  const reloadIg = ig.reload;
  
  useEffect(() => {
    addEventListener('ig-changed', reloadIg);
    return () => removeEventListener('ig-changed', reloadIg);
  }, [reloadIg]);

  const name = (prof.d?.display_name || '').trim();
  const tips = pr.d?.priorities || [];
  const b = briefing({ name, dash: dash.d, ctx: ctx.d, focus: tips[0]?.text });
  const conn = connectionView(ig.e ? null : ig.d);

  // Trigger the daily report. We pass isReport: true so the Assistant 
  // bypasses the AI text router and generates a structured data report instead.
  const triggerReport = () => {
    setPrefill({ id: Date.now(), text: "Generate my daily report. Give me a summary of my account health, my top priorities right now, and what I should focus on today." });
  };

  return (
    <div className="cc-centered">
      {/* Connection status pill floating at the top right */}
      <div className="cc-topbar">
        <button className="ccconn-pill" onClick={() => window.location.hash = '#settings'} title={conn.title}>
          <i className={'ccdot'+(conn.on?' on':' off')} />
          <span>{conn.label}</span>
        </button>
      </div>

      {/* Main centered content */}
      <div className="cc-content">
        {/* The huge translucent welcome text */}
        <div className={'cc-briefing-watermark ' + b.tone}>
          <h1>{b.headline}</h1>
          <div className="cc-briefing-lines">
            {b.lines.map((l, i) => <p key={i}>{l}</p>)}
          </div>
        </div>

        {/* The chat area */}
        <div className="cc-chat-wrapper">
          <div className="cc-chat-actions">
            <button className="pgchip" onClick={triggerReport}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
              Generate Daily Report
            </button>
          </div>
          <Assistant isEmbedded prefill={prefill}/>
        </div>
      </div>
    </div>
  );
}