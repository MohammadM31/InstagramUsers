import bcrypt from 'bcryptjs';import {db,q} from './db.js';
const[u]=await q(`INSERT INTO users(email,pass_hash,tos_accepted_at) VALUES('demo@growthengine.ai',$1,now()) ON CONFLICT(email) DO UPDATE SET email=EXCLUDED.email RETURNING id`,[await bcrypt.hash('demo1234',10)]);
await q('DELETE FROM posts WHERE user_id=$1',[u.id]);const T=['REEL','CAROUSEL_ALBUM','IMAGE'];
for(let i=0;i<50;i++){const t=T[i%3],m=t==='REEL'?3:1,r=(1500+Math.floor(Math.random()*3500))*m;
 await q(`INSERT INTO posts(user_id,type,posted_at,likes,comments,saves,shares,reach,impressions,watch_s,caption) VALUES($1,$2,now()-($3||' days')::interval,$4,$5,$6,$7,$8,$9,$10,$11)`,[u.id,t,String(i*1.2),Math.round(r*.04),10+i%30,20*m+i%50,5*m+i%20,r,Math.round(r*1.3),t==='REEL'?10+i%20:0,'Demo caption '+i]);}
for(const h of['compa','compb','compc'])await q('INSERT INTO competitors(user_id,handle) VALUES($1,$2) ON CONFLICT DO NOTHING',[u.id,h]);
console.log('seeded demo@growthengine.ai / demo1234');await db.end();
