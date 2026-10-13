import {validateEnv} from './config.js';validateEnv(); // 0.2: exit nonzero with a clear message before anything else loads
import express from 'express';import helmet from 'helmet';import cors from 'cors';import rateLimit from 'express-rate-limit';
import {db} from './db.js';import {redis} from './cache.js';import {auth} from './auth.js';import {api} from './routes.js';import {startWorker,startPublisher} from './worker.js';import path from 'node:path';import fs from 'node:fs';
const app=express();app.set('trust proxy',1);app.use(helmet(),cors({origin:process.env.CORS_ORIGIN?.split(',')||(process.env.NODE_ENV==='production'?false:true)}),express.json({limit:'8mb'}),express.text({type:'text/csv',limit:'5mb'}));
app.use(rateLimit({windowMs:6e4,limit:120}));
app.get('/health',(_,r)=>r.json({ok:true}));
app.get('/ready',async(_,r)=>{try{await db.query('SELECT 1');await redis.ping();r.json({ok:true,db:true,redis:true})}catch(e){r.status(503).json({ok:false,error:e.message})}}); // checks the dependencies /health does not
app.use('/api/auth',auth);app.use('/api',api);
const dist=path.resolve('web/dist');if(fs.existsSync(dist)){app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')))}
app.use((e,_q,res,_n)=>{console.error(e);res.status(e.status||500).json({error:e.message})});
const port=process.env.PORT||3000;app.listen(port,()=>console.log('API on :'+port));
if(process.env.INLINE_WORKER==='1'){startWorker();startPublisher()}
