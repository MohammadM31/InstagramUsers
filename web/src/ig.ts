// Roadmap A.1d: shared bits of the Instagram connection UI (status type, redirect handling, "ago").
export type IgStatus={configured:boolean;connected:boolean;status:string;source:string;username:string|null;followers:number|null;followerPoints:number;lastFollowerAt:string|null;followerSource:string|null;followersAtConnect:number|null;lastSyncAt:string|null;lastError:string|null;tokenExpiresAt:string|null;daysLeft:number|null;scopes:string[]};
// Other components listen for this to refresh their copy of the status (badge, cards) after connect / sync / disconnect.
export const igChanged=()=>window.dispatchEvent(new Event('ig-changed'));
export const igAgo=(v?:string|null)=>{if(!v)return 'never';const m=Math.round((Date.now()-new Date(v).getTime())/6e4);return m<1?'just now':m<60?m+' min ago':m<1440?Math.round(m/60)+' h ago':Math.round(m/1440)+' d ago'};
// The server's callback ends in a redirect to /?ig=connected or /?ig=error&reason=<code>. Same wording as CONNECT_ERRORS in src/igconnect.js, shortened.
export const IG_REASONS:Record<string,string>={
 not_configured:'Instagram connection is not set up on this server yet.',
 state_invalid:'The connection attempt expired or did not start from this app. Please try again.',
 declined:'You declined the permissions, so Instagram data cannot be read.',
 no_page:'No Facebook Page was found. Instagram professional accounts must be linked to a Page you manage.',
 wrong_type:'None of your Pages has an Instagram professional (Business or Creator) account linked. Switch the account to professional in Instagram settings and link it to a Page.',
 missing_permissions:'Some permissions were not granted. Connect again and keep every box ticked.',
 token_error:'Instagram did not accept the login. Please try again.'};
export function parseIgRedirect(search=location.search):{ok:boolean;text:string}|null{
 const p=new URLSearchParams(search),r=p.get('ig');if(!r)return null;
 if(r==='connected')return{ok:true,text:'Instagram connected. Run “Sync now” to pull your posts and numbers.'};
 if(r==='error'){const c=p.get('reason')||'';return{ok:false,text:IG_REASONS[c]||'Instagram could not be connected. Please try again.'}}
 return null}
