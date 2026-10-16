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
export function parseIgRedirect(search=location.search):{ok:boolean;text:string;code?:string}|null{
 const p=new URLSearchParams(search),r=p.get('ig');if(!r)return null;
 if(r==='connected')return{ok:true,text:'Instagram connected. Run “Sync now” to pull your posts and numbers.'};
 if(r==='error'){const c=p.get('reason')||'';return{ok:false,code:c,text:IG_REASONS[c]||'Instagram could not be connected. Please try again.'}}
 return null}

// ---- Roadmap O.2: the onboarding connect step. Pure helpers (no React), so test/onboardingO2.test.js can check them against the server's lists. ----

// What the person needs BEFORE pressing Connect (shown as a checklist, so a failure at Facebook is not a surprise).
export const IG_REQUIREMENTS:{title:string;detail:string}[]=[
 {title:'An Instagram Business or Creator account',detail:'Personal accounts cannot be read. Switch in Instagram: Settings, Account type and tools, Switch to professional account (free).'},
 {title:'A Facebook Page linked to that account',detail:'Instagram: Settings, Account, Linked accounts (or Edit profile, Page). Create a Page if you have none.'},
 {title:'You manage that Page',detail:'Log in to Facebook with the profile that is an admin of the Page.'},
 {title:'Keep every permission ticked',detail:'If one is unticked, we cannot read your numbers and the connection is refused.'}];

// Why each permission is asked for. The test fails if this list and the server's IG_SCOPES (src/instagram.js) ever differ.
export const IG_PERMISSIONS:{scope:string;why:string}[]=[
 {scope:'instagram_basic',why:'Your account name, follower count and posts.'},
 {scope:'instagram_manage_insights',why:'Reach, views, saves, shares and follower numbers for your own account.'},
 {scope:'instagram_manage_comments',why:'Reserved for upcoming comment features. Comment text is not stored today.'},
 {scope:'pages_show_list',why:'To find the Facebook Page your Instagram account is linked to.'},
 {scope:'pages_read_engagement',why:'Needed by Facebook to read that link.'}];

// What to do about each failure. Same codes as CONNECT_ERRORS in src/igconnect.js. retry=false means pressing the button again cannot help.
export const IG_FIX:Record<string,{fix:string;retry:boolean}>={
 not_configured:{fix:'This is a server setting. Ask whoever runs this app to set up the Instagram connection, or import a CSV for now.',retry:false},
 state_invalid:{fix:'Press Try again and finish the Facebook screens without leaving the page for long.',retry:true},
 declined:{fix:'Press Try again and allow every permission. We only read your own account and never post without you.',retry:true},
 no_page:{fix:'Link your Instagram account to a Facebook Page you manage, then press Try again.',retry:true},
 wrong_type:{fix:'Switch the Instagram account to Business or Creator and link it to a Page, then press Try again.',retry:true},
 missing_permissions:{fix:'Press Try again and leave every permission box ticked.',retry:true},
 token_error:{fix:'Press Try again. If it keeps failing, wait a few minutes: Facebook may be slow.',retry:true}};
const GENERIC={text:'Instagram could not be connected.',fix:'Press Try again.',retry:true};
export function describeIgError(code:string):{text:string;fix:string;retry:boolean}{
 const text=IG_REASONS[code],f=IG_FIX[code];
 return text&&f?{text,...f}:GENERIC}

// One sentence for a finished sync job (GET /instagram/sync/:id). Honest about an empty result instead of saying "done".
export function syncMessage(j:any):string{
 if(!j)return '';
 if(j.status==='failed')return '⚠ '+(j.error||'The sync failed.');
 if(j.status!=='done')return 'Still syncing in the background. Check again in a minute.';
 const f=j.account?.followers;
 if(!j.fetched)return 'Connected, but Instagram returned no posts yet. If you have posted, try Sync now again later.'+(f!=null?` Followers: ${Number(f).toLocaleString()}.`:'');
 return `Synced: ${j.fetched} posts checked (${j.inserted} new, ${(j.updated||0)+(j.linked||0)} updated)${f!=null?`, ${Number(f).toLocaleString()} followers`:''}.${j.stoppedEarly?' '+j.stoppedEarly+'.':''}`}
