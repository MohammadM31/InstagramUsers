import './loadenv.js'; // first import: cache.js and db.js read REDIS_URL / DATABASE_URL when they load
import {startNotifications} from './notifications.js';import {startComments} from './comments.js';import {igConnect,igSync,getIgCreds,graph,comments} from './igwire.js';import {Worker,UnrecoverableError} from 'bullmq';import {scrapeQ} from './queue.js';import {makeCompetitors} from './competitors.js';import {parseDiscovery,classifyDiscoveryError,NOT_PUBLIC_CODE} from './competitorintel.js';import {redis,cached} from './cache.js';import {q,db} from './db.js';import {generateImage} from './images.js';import {makeProcessImport} from './importjob.js';import {keyFor} from './keys.js';import {validateEnv} from './config.js';import {startSnapshots} from './snapshots.js';
const DISCLAIMER='Public data only. User confirmed ToS at signup; scrape logged for audit.';
async function fetchProfile(handle,uid){
 const cr=await getIgCreds(uid); // per-user credentials (A.1a). Throws IgNotConnected when a connected account needs reconnecting: fail loud, no demo data.
 if(cr){ // Preferred: official Business Discovery API (public business/creator accounts)
  const f=`business_discovery.username(${handle}){followers_count,media_count,media.limit(25){like_count,comments_count,media_type,timestamp,caption}}`;
  let r;try{r=await graph.get(cr.igUserId,{fields:f},cr.token)}catch(e){throw classifyDiscoveryError(e,handle)} // personal/private/unknown handle -> a clear error, token/permission/rate errors untouched
  return parseDiscovery(r,handle);}
 // DEMO MODE: synthetic data. INTEGRATION POINT: add proxy-rotated scraper here if you accept the ToS risk.
 const T=['REEL','CAROUSEL_ALBUM','IMAGE'];
 return{source:'demo',followers:5000+Math.floor(Math.random()*30000),posts:Array.from({length:12},(_,i)=>({type:T[i%3],at:new Date(Date.now()-i*864e5*2).toISOString(),likes:Math.floor(Math.random()*3000),comments:Math.floor(Math.random()*120),caption:'Demo post '+i}))};}
// A.3: history + daily job. Scrapes queued by the job go through the same 200 calls/hour limiter as manual ones.
const competitors=makeCompetitors({q,getIgCreds,enqueue:(data,jobId)=>scrapeQ.add('scrape',data,{jobId,attempts:3,backoff:{type:'exponential',delay:5000}})});
export async function processScrape({userId,competitorId,handle}){
 const d=await cached(`scrape:${userId}:${handle}`,3600,()=>fetchProfile(handle,userId)); // cache is per user: results depend on whose credentials were used // Redis TTL 1h
 await q('INSERT INTO scrape_audit(user_id,handle,source,disclaimer) VALUES($1,$2,$3,$4)',[userId,handle,d.source,DISCLAIMER]);
 await q('UPDATE competitors SET followers=$1,last_scraped=now() WHERE id=$2',[d.followers,competitorId]);
 await q('DELETE FROM competitor_posts WHERE competitor_id=$1',[competitorId]);
 for(const p of d.posts)await q(`INSERT INTO competitor_posts(competitor_id,type,posted_at,likes,comments,caption,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '30 days')`,[competitorId,p.type,p.at,p.likes,p.comments,p.caption]);
 await competitors.record(competitorId,d); // A.3: one history row per competitor per UTC day; demo data stores nothing
 return d.source;}
/* ---- 0.1 importPosts: bulk insert scoped to the job's user, duplicates skipped by the posts_dedupe unique index ---- */
async function igOwnPosts(uid){ // legacy path for POST /import/posts {source:'instagram'}; the A.1b sync (igsync.js) supersedes it for connected accounts
 const cr=await getIgCreds(uid);
 if(!cr)throw new Error('Instagram import needs a connected Instagram account (Settings)');
 const l=await graph.get(`${cr.igUserId}/media`,{fields:'id,timestamp,media_type,like_count,comments_count,caption',limit:50},cr.token);
 const out=[];
 for(const m of l.data||[]){let ins={};try{const r=await graph.get(`${m.id}/insights`,{metric:'reach,saved,shares'},cr.token);ins=Object.fromEntries((r.data||[]).map(x=>[x.name,x.values?.[0]?.value]))}catch{} // insights are best-effort (not available for every media type)
  out.push({posted_at:m.timestamp,type:m.media_type==='VIDEO'?'REEL':m.media_type,likes:m.like_count,comments:m.comments_count,saves:ins.saved,shares:ins.shares,reach:ins.reach,caption:m.caption||''})}
 return out}
// The job itself lives in importjob.js (injected deps, unit-tested). update=true (0.1b, opt-in) refreshes metrics of existing posts,
// but only the metrics the file actually contained: a missing column never overwrites a stored value.
export const processImport=makeProcessImport({db,q,own:igOwnPosts});
/* ---- 0.5 generateImage: runs off the request path; GET /api/content/image/:jobId reads the result ---- */
// C.1: results stay base64 data URIs in the job's return value (1h TTL, unchanged). When the S3_* variables are set, each image is also converted to JPEG
// and uploaded, and the result gains `urls` (public JPEG urls, see storage.js / imageresult.js). No S3_* variables = exactly the old result.
import {makeStorage} from './storage.js';import {makeProcessImage} from './imageresult.js';
export const processImage=makeProcessImage({generate:generateImage,storage:makeStorage()});
// A.1: token refresh every 6 h (acts only on tokens with <15 days left) and a 10-minute tick that syncs accounts whose staggered daily slot has passed.
function startIgJobs(){
 const guard=(n,f)=>()=>f().then(r=>{if(r&&(r.due||r.refreshed||r.reconnect))console.log(n,r)}).catch(e=>console.error(n,e.message));
 setTimeout(guard('igRefresh',()=>igConnect.refreshTokens()),30000);setInterval(guard('igRefresh',()=>igConnect.refreshTokens()),216e5);
 setTimeout(guard('igSync',()=>igSync.runDue()),45000);setInterval(guard('igSync',()=>igSync.runDue()),6e5)}
function startCompetitorJobs(){
 const guard=(n,f)=>()=>f().then(r=>{if(r&&(r.queued||r.created))console.log(n,r)}).catch(e=>console.error(n,e.message));
 setTimeout(guard('competitorDaily',()=>competitors.scrapeDue()),120000);setInterval(guard('competitorDaily',()=>competitors.scrapeDue()),216e5);
 setTimeout(guard('competitorMomentum',()=>competitors.runMomentum()),600000);setInterval(guard('competitorMomentum',()=>competitors.runMomentum()),36e5)}
export function startWorker(){
 const w=new Worker('scrape',j=>processScrape(j.data).catch(e=>{throw e.code===NOT_PUBLIC_CODE?new UnrecoverableError(e.message):e}),{connection:redis,concurrency:2,limiter:{max:200,duration:3600000}}); // 200 calls/hr
 w.on('failed',(j,e)=>console.error('scrape failed',j?.data?.handle,e.message));
 const wi=new Worker('import',j=>processImport(j.data),{connection:redis,concurrency:2});wi.on('failed',(j,e)=>console.error('import failed',e.message));
 const wg=new Worker('image',j=>processImage(j.data),{connection:redis,concurrency:2});wg.on('failed',(j,e)=>console.error('image failed',e.message));
 const wk=new Worker('igsync',j=>igSync.syncUser(j.data.userId),{connection:redis,concurrency:1});wk.on('failed',(j,e)=>console.error('igsync failed',e.message)); // A.1b: manual 'Sync now'
 startCompetitorJobs(); // A.3: daily competitor re-scrape (6-hourly check) + hourly momentum alert
 startIgJobs(); // A.1a token refresh + A.1b staggered daily sync
 setInterval(()=>q('DELETE FROM competitor_posts WHERE expires_at<now()').catch(()=>{}),36e5); // 30-day retention
 startSnapshots(q); // 2.1: daily post snapshots + per-user baseline
 startNotifications(q); // 2.3: hourly alert detection against the baseline
 startComments(comments); // A.2: comments every 3 h (recent posts first), 90-day retention, unanswered-questions alert
 return w;}
if(process.argv[1].endsWith('worker.js')){validateEnv();startWorker()}
/* ---- publisher: runs every 30s, publishes due posts ---- */
async function publish(p){
 const cr=await getIgCreds(p.user_id); // per-user token; null = not connected anywhere -> demo mode
 if(!cr)return{status:'demo-published',error:'Demo mode: Instagram is not connected, nothing was sent'};
 if(!p.image||p.image.startsWith('data:'))throw new Error('Instagram requires a public image URL — upload to S3/CDN first');
 const c=await graph.post(`${cr.igUserId}/media`,{image_url:p.image,caption:p.caption},cr.token);await graph.post(`${cr.igUserId}/media_publish`,{creation_id:c.id},cr.token);return{status:'published'};}
export async function runPublisher(){
 const due=await q(`UPDATE scheduled_posts SET status='publishing' WHERE id IN (SELECT id FROM scheduled_posts WHERE status='scheduled' AND scheduled_at<=now() LIMIT 5 FOR UPDATE SKIP LOCKED) RETURNING *`);
 for(const p of due){try{const r=await publish(p);await q('UPDATE scheduled_posts SET status=$1,error=$2,published_at=now() WHERE id=$3',[r.status,r.error||null,p.id])}catch(e){await q(`UPDATE scheduled_posts SET status='failed',error=$1 WHERE id=$2`,[e.message,p.id])}}}
export function startPublisher(){return setInterval(()=>runPublisher().catch(e=>console.error('publisher',e.message)),3e4)}
