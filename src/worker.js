import './loadenv.js'; // first import: cache.js and db.js read REDIS_URL / DATABASE_URL when they load
import {Worker} from 'bullmq';import {redis,cached} from './cache.js';import {q,db} from './db.js';import {generateImage} from './images.js';import {normalizePosts} from './importer.js';import {keyFor} from './keys.js';import {validateEnv} from './config.js';
const DISCLAIMER='Public data only. User confirmed ToS at signup; scrape logged for audit.';
async function fetchProfile(handle){
 const {IG_ACCESS_TOKEN:t,IG_USER_ID:id}=process.env;
 if(t&&id){ // Preferred: official Business Discovery API (public business/creator accounts)
  const f=`business_discovery.username(${handle}){followers_count,media.limit(25){like_count,comments_count,media_type,timestamp,caption}}`;
  const r=await(await fetch(`https://graph.facebook.com/v21.0/${id}?fields=${encodeURIComponent(f)}&access_token=${t}`)).json();
  const b=r.business_discovery;if(!b)throw new Error(r.error?.message||'Business Discovery failed');
  return{source:'business_discovery',followers:b.followers_count,posts:(b.media?.data||[]).map(m=>({type:m.media_type,at:m.timestamp,likes:m.like_count,comments:m.comments_count,caption:m.caption||''}))};}
 // DEMO MODE: synthetic data. INTEGRATION POINT: add proxy-rotated scraper here if you accept the ToS risk.
 const T=['REEL','CAROUSEL_ALBUM','IMAGE'];
 return{source:'demo',followers:5000+Math.floor(Math.random()*30000),posts:Array.from({length:12},(_,i)=>({type:T[i%3],at:new Date(Date.now()-i*864e5*2).toISOString(),likes:Math.floor(Math.random()*3000),comments:Math.floor(Math.random()*120),caption:'Demo post '+i}))};}
export async function processScrape({userId,competitorId,handle}){
 const d=await cached(`scrape:${handle}`,3600,()=>fetchProfile(handle)); // Redis TTL 1h
 await q('INSERT INTO scrape_audit(user_id,handle,source,disclaimer) VALUES($1,$2,$3,$4)',[userId,handle,d.source,DISCLAIMER]);
 await q('UPDATE competitors SET followers=$1,last_scraped=now() WHERE id=$2',[d.followers,competitorId]);
 await q('DELETE FROM competitor_posts WHERE competitor_id=$1',[competitorId]);
 for(const p of d.posts)await q(`INSERT INTO competitor_posts(competitor_id,type,posted_at,likes,comments,caption,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '30 days')`,[competitorId,p.type,p.at,p.likes,p.comments,p.caption]);
 return d.source;}
/* ---- 0.1 importPosts: bulk insert scoped to the job's user, duplicates skipped by the posts_dedupe unique index ---- */
async function igOwnPosts(uid){ // optional Graph API path; needs IG_ACCESS_TOKEN + IG_USER_ID (or the user's stored 'instagram' key)
 const t=await keyFor(uid,'instagram',process.env.IG_ACCESS_TOKEN),id=process.env.IG_USER_ID;
 if(!t||!id)throw new Error('Instagram import needs IG_USER_ID and an access token');
 const g=async u=>{const j=await(await fetch(u)).json();if(j.error)throw new Error(j.error.message);return j};
 const l=await g(`https://graph.facebook.com/v21.0/${id}/media?fields=id,timestamp,media_type,like_count,comments_count,caption&limit=50&access_token=${t}`);
 const out=[];
 for(const m of l.data||[]){let ins={};try{const r=await g(`https://graph.facebook.com/v21.0/${m.id}/insights?metric=reach,saved,shares&access_token=${t}`);ins=Object.fromEntries((r.data||[]).map(x=>[x.name,x.values?.[0]?.value]))}catch{} // insights are best-effort (not available for every media type)
  out.push({posted_at:m.timestamp,type:m.media_type==='VIDEO'?'REEL':m.media_type,likes:m.like_count,comments:m.comments_count,saves:ins.saved,shares:ins.shares,reach:ins.reach,caption:m.caption||''})}
 return out}
export async function processImport({userId,rows,source}){
 let input=rows;if(source==='instagram')input=await igOwnPosts(userId);
 const{rows:ok,invalid}=normalizePosts(input);let imported=0;
 for(let i=0;i<ok.length;i+=500){const c=ok.slice(i,i+500),col=k=>c.map(r=>r[k]);
  const r=await db.query(`INSERT INTO posts(user_id,type,posted_at,likes,comments,saves,shares,reach,impressions,watch_s,caption)
   SELECT $1,* FROM unnest($2::text[],$3::timestamptz[],$4::int[],$5::int[],$6::int[],$7::int[],$8::int[],$9::int[],$10::int[],$11::text[]) ON CONFLICT DO NOTHING`,
   [userId,col('type'),col('posted_at'),col('likes'),col('comments'),col('saves'),col('shares'),col('reach'),col('impressions'),col('watch_s'),col('caption')]);imported+=r.rowCount}
 const res={imported,duplicates:ok.length-imported,invalid:invalid.length,invalidSample:invalid.slice(0,5),source};
 await q('INSERT INTO import_log(user_id,source,imported,duplicates,invalid) VALUES($1,$2,$3,$4,$5)',[userId,source,imported,res.duplicates,res.invalid]);
 return res}
/* ---- 0.5 generateImage: runs off the request path; GET /api/content/image/:jobId reads the result ---- */
// SWAP POINT: results are base64 data URIs stored in the job's return value (1h TTL). Replace with an S3/CDN upload and return a URL here.
export async function processImage({userId,params}){return{images:await generateImage({...params,uid:userId})}}
export function startWorker(){
 const w=new Worker('scrape',j=>processScrape(j.data),{connection:redis,concurrency:2,limiter:{max:200,duration:3600000}}); // 200 calls/hr
 w.on('failed',(j,e)=>console.error('scrape failed',j?.data?.handle,e.message));
 const wi=new Worker('import',j=>processImport(j.data),{connection:redis,concurrency:2});wi.on('failed',(j,e)=>console.error('import failed',e.message));
 const wg=new Worker('image',j=>processImage(j.data),{connection:redis,concurrency:2});wg.on('failed',(j,e)=>console.error('image failed',e.message));
 setInterval(()=>q('DELETE FROM competitor_posts WHERE expires_at<now()').catch(()=>{}),36e5); // 30-day retention
 return w;}
if(process.argv[1].endsWith('worker.js')){validateEnv();startWorker()}
/* ---- publisher: runs every 30s, publishes due posts ---- */
async function publish(p){
 const {IG_ACCESS_TOKEN:t,IG_USER_ID:id}=process.env;
 if(!t||!id)return{status:'demo-published',error:'Demo mode: IG_ACCESS_TOKEN not set, nothing was sent'};
 if(!p.image||p.image.startsWith('data:'))throw new Error('Instagram requires a public image URL — upload to S3/CDN first');
 const g=async(u,b)=>{const r=await(await fetch(`https://graph.facebook.com/v21.0/${u}`,{method:'POST',body:new URLSearchParams({...b,access_token:t})})).json();if(r.error)throw new Error(r.error.message);return r};
 const c=await g(`${id}/media`,{image_url:p.image,caption:p.caption});await g(`${id}/media_publish`,{creation_id:c.id});return{status:'published'};}
export async function runPublisher(){
 const due=await q(`UPDATE scheduled_posts SET status='publishing' WHERE id IN (SELECT id FROM scheduled_posts WHERE status='scheduled' AND scheduled_at<=now() LIMIT 5 FOR UPDATE SKIP LOCKED) RETURNING *`);
 for(const p of due){try{const r=await publish(p);await q('UPDATE scheduled_posts SET status=$1,error=$2,published_at=now() WHERE id=$3',[r.status,r.error||null,p.id])}catch(e){await q(`UPDATE scheduled_posts SET status='failed',error=$1 WHERE id=$2`,[e.message,p.id])}}}
export function startPublisher(){return setInterval(()=>runPublisher().catch(e=>console.error('publisher',e.message)),3e4)}
