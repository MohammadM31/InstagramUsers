import {Router} from 'express';import {q} from './db.js';import {requireAuth} from './auth.js';import {scrapeQ} from './queue.js';import {encrypt,decrypt} from './crypto.js';import {generateImage} from './images.js';
export const api=Router();api.use(requireAuth);
const wrap=f=>(req,res,next)=>Promise.resolve(f(req,res,next)).catch(next); // Express 4 needs this for async errors
const get=(p,f)=>api.get(p,wrap(f)),post=(p,f)=>api.post(p,wrap(f)),put=(p,f)=>api.put(p,wrap(f)),del=(p,f)=>api.delete(p,wrap(f));
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
async function llm(system,user){const base=process.env.LLM_BASE_URL||'https://api.openai.com/v1',key=process.env.LLM_API_KEY;if(!key)throw Object.assign(new Error('LLM_API_KEY not set'),{status:503});
 const r=await fetch(base+'/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.LLM_MODEL||'gpt-4o-mini',messages:[{role:'system',content:system},{role:'user',content:user}],response_format:{type:'json_object'}})});
 const j=await r.json();if(!r.ok)throw new Error(j.error?.message||'llm error');return JSON.parse(j.choices[0].message.content)}
post('/content/captions',async(req,res)=>{const{topic,tone='professional',goal='engagement',emoji='med'}=req.body||{};
 res.json(await llm('You write Instagram captions. Return JSON {"variants":[{"hook":"","body":"","cta":""}]} with exactly 5 variants.',`Topic: ${topic}\nTone: ${tone}\nGoal: ${goal}\nEmoji level: ${emoji}`))});
post('/content/hashtags',async(req,res)=>res.json(await llm('Return JSON {"high":[],"mid":[],"niche":[],"branded":[]} totalling 30 Instagram hashtags.',`Niche: ${req.body?.niche}`)));
post('/content/image',async(req,res)=>res.json({images:await generateImage(req.body||{})}));
put('/settings/keys/:name',async(req,res)=>{await q('INSERT INTO api_keys(user_id,name,enc) VALUES($1,$2,$3) ON CONFLICT(user_id,name) DO UPDATE SET enc=$3',[req.uid,req.params.name,encrypt(String(req.body?.value||''))]);res.json({ok:true})});
get('/settings/keys',async(req,res)=>res.json((await q('SELECT name,enc FROM api_keys WHERE user_id=$1',[req.uid])).map(k=>({name:k.name,masked:'••••'+decrypt(k.enc).slice(-4)}))));
get('/gdpr/export',async(req,res)=>{const o={};for(const t of['posts','competitors','scrape_audit','hashtag_sets'])o[t]=await q(`SELECT * FROM ${t} WHERE user_id=$1`,[req.uid]);res.json(o)});
del('/gdpr/account',async(req,res)=>{await q('DELETE FROM users WHERE id=$1',[req.uid]);res.json({deleted:true})});
/* analytics */
const patch=(p,f)=>api.patch(p,wrap(f));
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
