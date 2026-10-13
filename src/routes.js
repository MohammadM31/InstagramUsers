import {assistant,financeRoute,pageMetrics} from './assistant.js';import {makeInsights} from './insights.js';import {enqueueImage} from './imagejobs.js';
import {Router} from 'express';import {q} from './db.js';import {requireAuth} from './auth.js';import {scrapeQ,importQ,imageQ} from './queue.js';import {limit} from './ratelimit.js';import {llmConfig,keyFor} from './keys.js';import {parseCsv} from './csv.js';import {MAX_ROWS} from './importer.js';import {encrypt,decrypt} from './crypto.js';import {generateImage} from './images.js';
export const api=Router();api.use(requireAuth);
const wrap=f=>(req,res,next)=>Promise.resolve(f(req,res,next)).catch(next); // Express 4 needs this for async errors
const hs=f=>f.map((h,i)=>i===f.length-1?wrap(h):h); // variadic: route(path, ...middleware, handler); only the last one is async-wrapped
const get=(p,...f)=>api.get(p,...hs(f)),post=(p,...f)=>api.post(p,...hs(f)),put=(p,...f)=>api.put(p,...hs(f)),del=(p,...f)=>api.delete(p,...hs(f));
const pct=(a,b)=>b?+((a-b)/b*100).toFixed(1):0;
const L30="posted_at>now()-interval '30 days'",P30="posted_at BETWEEN now()-interval '60 days' AND now()-interval '30 days'";
get('/dashboard',async(req,res)=>{
 const[c]=await q(`SELECT sum(reach) FILTER(WHERE ${L30}) r1,sum(reach) FILTER(WHERE ${P30}) r0,
 sum(likes+comments+saves+shares) FILTER(WHERE ${L30})::float/NULLIF(sum(reach) FILTER(WHERE ${L30}),0) er,
 sum(likes+comments+saves+shares) FILTER(WHERE ${P30})::float/NULLIF(sum(reach) FILTER(WHERE ${P30}),0) er0,
 count(*) FILTER(WHERE posted_at>now()-interval '7 days') wk,
 sum(shares) FILTER(WHERE ${L30})::float/NULLIF(sum(reach) FILTER(WHERE ${L30}),0) sr FROM posts WHERE user_id=$1`,[req.uid]);
 res.json({reach:{value:+c.r1||0,changePct:pct(+c.r1,+c.r0)},avgER:{value:+((c.er||0)*100).toFixed(2),changePct:pct(c.er,c.er0)},postsThisWeek:+c.wk,sendsPerReach:+((c.sr||0)*100).toFixed(2)})});
get('/posts',async(req,res)=>res.json(await q(`SELECT *,round((likes+comments+saves+shares)*100.0/NULLIF(reach,0),2) er FROM posts WHERE user_id=$1 AND ($2::text IS NULL OR type=$2) ORDER BY posted_at DESC LIMIT 200`,[req.uid,req.query.type||null])));
get('/competitors',async(req,res)=>res.json(await q('SELECT * FROM competitors WHERE user_id=$1 ORDER BY handle',[req.uid])));
post('/competitors',async(req,res)=>{const h=String(req.body?.handle||'').replace('@','').trim();if(!/^[\w.]{1,30}$/.test(h))return res.status(400).json({error:'bad handle'});
 const[c]=await q('INSERT INTO competitors(user_id,handle) VALUES($1,$2) ON CONFLICT(user_id,handle) DO UPDATE SET handle=$2 RETURNING *',[req.uid,h]);res.json(c)});
del('/competitors/:id',async(req,res)=>{await q('DELETE FROM competitors WHERE id=$1 AND user_id=$2',[req.params.id,req.uid]);res.json({ok:true})});
post('/scrape/:id',async(req,res)=>{const[c]=await q('SELECT * FROM competitors WHERE id=$1 AND user_id=$2',[req.params.id,req.uid]);if(!c)return res.sendStatus(404);
 const j=await scrapeQ.add('scrape',{userId:req.uid,competitorId:c.id,handle:c.handle},{attempts:3,backoff:{type:'exponential',delay:5000}});res.status(202).json({jobId:j.id})});
get('/competitors/:id/posts',async(req,res)=>res.json(await q('SELECT cp.* FROM competitor_posts cp JOIN competitors c ON c.id=cp.competitor_id WHERE c.id=$1 AND c.user_id=$2 ORDER BY posted_at DESC',[req.params.id,req.uid])));
async function llm(uid,system,user){const c=await llmConfig(uid);if(!c)throw Object.assign(new Error('No LLM key: add one in Settings or set LLM_API_KEY'),{status:503});
 const r=await fetch(c.base+'/chat/completions',{method:'POST',signal:AbortSignal.timeout(30000),headers:{Authorization:'Bearer '+c.key,'Content-Type':'application/json'},body:JSON.stringify({model:c.model,messages:[{role:'system',content:system},{role:'user',content:user}],response_format:{type:'json_object'}})});
 const j=await r.json();if(!r.ok)throw new Error(j.error?.message||'llm error');return JSON.parse(j.choices[0].message.content)}
const text=limit('captions-hashtags',60,3600); // 0.3: one shared bucket
post('/content/captions',text,async(req,res)=>{const{topic,tone='professional',goal='engagement',emoji='med'}=req.body||{};
 res.json(await llm(req.uid,'You write Instagram captions. Return JSON {"variants":[{"hook":"","body":"","cta":""}]} with exactly 5 variants.',`Topic: ${topic}\nTone: ${tone}\nGoal: ${goal}\nEmoji level: ${emoji}`))});
post('/content/hashtags',text,async(req,res)=>res.json(await llm(req.uid,'Return JSON {"high":[],"mid":[],"niche":[],"branded":[]} totalling 30 Instagram hashtags.',`Niche: ${req.body?.niche}`)));
/* 0.5 async image generation: POST returns {jobId}; the worker does the slow part */
post('/content/image',limit('image',20,3600),async(req,res)=>{const b=req.body||{},prompt=String(b.prompt||'').trim().slice(0,1000);
 if(!prompt)return res.status(400).json({error:'prompt required'});
 const params={prompt,ratio:b.ratio,model:b.model,overlayText:b.overlayText?String(b.overlayText).slice(0,120):undefined,color:b.color,n:Math.min(Number(b.n)||1,2),referenceImage:b.referenceImage};
 const jobId=await enqueueImage(req.uid,params);res.status(202).json({jobId})}); // 503 if no Replicate key (see imagejobs.js)
get('/content/image/:jobId',async(req,res)=>{const j=await imageQ.getJob(req.params.jobId);if(!j||j.data.userId!==req.uid)return res.sendStatus(404);
 const st=await j.getState();if(st==='completed')return res.json({status:'done',images:j.returnvalue.images});
 if(st==='failed'){let r=j.failedReason;if(!r){await new Promise(x=>setTimeout(x,150));r=(await imageQ.getJob(req.params.jobId))?.failedReason} // BullMQ can flip state before the reason is written
  return res.json({status:'failed',error:r||'generation failed'})}res.json({status:'pending'})});
/* settings: keys (0.4). Stored keys are now actually used by assistant, captions, hashtags and images (see keys.js). */
const KEYS=['openai','replicate','instagram'];
put('/settings/keys/:name',async(req,res)=>{const v=String(req.body?.value||'').trim();
 if(!KEYS.includes(req.params.name))return res.status(400).json({error:'unknown key name'});if(!v)return res.status(400).json({error:'value required'});
 await q('INSERT INTO api_keys(user_id,name,enc) VALUES($1,$2,$3) ON CONFLICT(user_id,name) DO UPDATE SET enc=$3',[req.uid,req.params.name,encrypt(v)]);res.json({ok:true})});
del('/settings/keys/:name',async(req,res)=>{await q('DELETE FROM api_keys WHERE user_id=$1 AND name=$2',[req.uid,req.params.name]);res.json({ok:true})});
get('/settings/keys',async(req,res)=>res.json((await q('SELECT name,enc FROM api_keys WHERE user_id=$1',[req.uid])).map(k=>{let m='unreadable (re-save this key)';try{m='••••'+decrypt(k.enc).slice(-4)}catch{}return{name:k.name,masked:m}})));
/* 0.1 post import: JSON array, {posts:[..]}, {csv:".."}, text/csv body, or {source:'instagram'} (Graph API, needs IG token) */
post('/import/posts',limit('import',20,3600),async(req,res)=>{const b=req.body;let rows,source='json';
 if(typeof b==='string'){rows=parseCsv(b);source='csv'}else if(Array.isArray(b))rows=b;else if(b?.source==='instagram'){rows=[];source='instagram'}
 else if(typeof b?.csv==='string'){rows=parseCsv(b.csv);source='csv'}else if(Array.isArray(b?.posts))rows=b.posts;
 else return res.status(400).json({error:'send a JSON array, {posts:[...]}, CSV text (Content-Type: text/csv), or {source:"instagram"}'});
 if(rows.length>MAX_ROWS)return res.status(413).json({error:`too many rows (max ${MAX_ROWS})`});
 if(!rows.length&&source!=='instagram')return res.status(400).json({error:'no rows found'});
 const update=req.query.update==='1'||b?.updateExisting===true; // 0.1b opt-in: refresh metrics of posts that already exist
 const j=await importQ.add('import',{userId:req.uid,rows,source,update});
 for(let i=0;i<40;i++){const x=await importQ.getJob(j.id),st=await x.getState(); // wait up to ~10s so small imports answer with counts
  if(st==='completed')return res.json({jobId:j.id,status:'done',...x.returnvalue});if(st==='failed')return res.status(422).json({jobId:j.id,status:'failed',error:x.failedReason});await new Promise(r=>setTimeout(r,250))}
 res.status(202).json({jobId:j.id,status:'pending'})});
get('/import/jobs/:id',async(req,res)=>{const j=await importQ.getJob(req.params.id);if(!j||j.data.userId!==req.uid)return res.sendStatus(404);
 const st=await j.getState();res.json(st==='completed'?{status:'done',...j.returnvalue}:st==='failed'?{status:'failed',error:j.failedReason}:{status:'pending'})});
get('/import/status',async(req,res)=>{const[c]=await q('SELECT count(*)::int count FROM posts WHERE user_id=$1',[req.uid]),[l]=await q('SELECT source,at,imported,duplicates FROM import_log WHERE user_id=$1 ORDER BY at DESC LIMIT 1',[req.uid]);
 res.json({count:c.count,lastImportAt:l?.at||null,source:l?.source||null,lastResult:l?{imported:l.imported,duplicates:l.duplicates}:null})});
get('/gdpr/export',async(req,res)=>{const o={};for(const t of['posts','competitors','scrape_audit','hashtag_sets','import_log'])o[t]=await q(`SELECT * FROM ${t} WHERE user_id=$1`,[req.uid]);
 o.scheduled_posts=await q('SELECT id,caption,platforms,scheduled_at,status,error,published_at FROM scheduled_posts WHERE user_id=$1',[req.uid]);o.api_keys=await q('SELECT name FROM api_keys WHERE user_id=$1',[req.uid]);
 o.post_snapshots=await q('SELECT s.* FROM post_snapshots s JOIN posts p ON p.id=s.post_id WHERE p.user_id=$1 ORDER BY s.post_id,s.captured_at',[req.uid]);o.metrics_baseline=await q('SELECT * FROM metrics_baseline WHERE user_id=$1',[req.uid]);res.json(o)});
del('/gdpr/account',async(req,res)=>{await q('DELETE FROM users WHERE id=$1',[req.uid]);res.json({deleted:true})});
/* analytics */
const patch=(p,...f)=>api.patch(p,...hs(f));
get('/analytics/heatmap',async(req,res)=>res.json(await q(`SELECT extract(dow from posted_at)::int d,extract(hour from posted_at)::int h,round(avg((likes+comments+saves+shares)*100.0/NULLIF(reach,0)),2)::float er,count(*)::int n FROM posts WHERE user_id=$1 GROUP BY 1,2`,[req.uid])));
get('/analytics/types',async(req,res)=>res.json(await q(`SELECT type,count(*)::int n,round(avg((likes+comments+saves+shares)*100.0/NULLIF(reach,0)),2)::float er,round(avg(reach))::int reach FROM posts WHERE user_id=$1 GROUP BY type ORDER BY er DESC`,[req.uid])));
get('/analytics/insights',async(req,res)=>{
 const t=await q(`SELECT type,round(avg((likes+comments+saves+shares)*100.0/NULLIF(reach,0)),2)::float er,round(avg(reach))::int reach FROM posts WHERE user_id=$1 GROUP BY type ORDER BY er DESC`,[req.uid]);
 const[b]=await q(`SELECT extract(dow from posted_at)::int d,extract(hour from posted_at)::int h,round(avg((likes+comments+saves+shares)*100.0/NULLIF(reach,0)),2)::float er FROM posts WHERE user_id=$1 GROUP BY 1,2 HAVING count(*)>=2 ORDER BY er DESC LIMIT 1`,[req.uid]);
 const D=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'],out=[];
 if(t.length>1){const a=t[0],z=t.at(-1);out.push(`${a.type} posts earn ${a.er}% ER vs ${z.er}% for ${z.type} — shift more posts to ${a.type}.`);const r=[...t].sort((x,y)=>y.reach-x.reach)[0];out.push(`${r.type} has the highest avg reach (${r.reach}).`)}
 if(b)out.push(`Your best slot is ${D[b.d]} ${b.h}:00 (${b.er}% avg ER).`);
 const cs=await q(`SELECT handle,followers FROM competitors WHERE user_id=$1 AND followers IS NOT NULL ORDER BY followers DESC LIMIT 1`,[req.uid]);if(cs[0])out.push(`Largest tracked competitor: @${cs[0].handle} (${cs[0].followers} followers).`);
 res.json(out.length?out:['Not enough data yet — import posts or seed demo data.'])});
/* hashtag sets */
get('/hashtag-sets',async(req,res)=>res.json(await q('SELECT * FROM hashtag_sets WHERE user_id=$1 ORDER BY id',[req.uid])));
post('/hashtag-sets',async(req,res)=>{const[r]=await q('INSERT INTO hashtag_sets(user_id,name,tags) VALUES($1,$2,$3) RETURNING *',[req.uid,req.body?.name||'Set',req.body?.tags||[]]);res.json(r)});
del('/hashtag-sets/:id',async(req,res)=>{await q('DELETE FROM hashtag_sets WHERE id=$1 AND user_id=$2',[req.params.id,req.uid]);res.json({ok:true})});
/* scheduling */
get('/schedule',async(req,res)=>res.json(await q('SELECT id,caption,platforms,scheduled_at,status,error,published_at,(image IS NOT NULL) has_image FROM scheduled_posts WHERE user_id=$1 ORDER BY scheduled_at DESC',[req.uid])));
post('/schedule',async(req,res)=>{const{caption,image,platforms,scheduledAt}=req.body||{};if(!caption||!scheduledAt)return res.status(400).json({error:'caption and scheduledAt required'});
 const[r]=await q('INSERT INTO scheduled_posts(user_id,caption,image,platforms,scheduled_at) VALUES($1,$2,$3,$4,$5) RETURNING id',[req.uid,caption,image||null,platforms||['instagram'],scheduledAt]);res.json(r)});
patch('/schedule/:id',async(req,res)=>{await q(`UPDATE scheduled_posts SET status='scheduled',error=NULL,scheduled_at=COALESCE($3,now()) WHERE id=$1 AND user_id=$2`,[req.params.id,req.uid,req.body?.scheduledAt||null]);res.json({ok:true})});
del('/schedule/:id',async(req,res)=>{await q('DELETE FROM scheduled_posts WHERE id=$1 AND user_id=$2',[req.params.id,req.uid]);res.json({ok:true})});
/* assistant + finance */
post('/assistant',limit('assistant',30,3600),assistant);get('/finance/plan',financeRoute);
/* Phase 1: priorities (1.1), AI context (1.2), marketing breakdown (1.4). Handlers live in insights.js */
const ins=makeInsights({q,pageMetrics});get('/priorities',ins.priorities);get('/ai/context',ins.aiContext);get('/marketing/breakdown',ins.marketing);
