import express from 'express';import helmet from 'helmet';import cors from 'cors';import rateLimit from 'express-rate-limit';
import {auth} from './auth.js';import {api} from './routes.js';import {startWorker,startPublisher} from './worker.js';import path from 'node:path';import fs from 'node:fs';
const app=express();app.set('trust proxy',1);app.use(helmet(),cors({origin:process.env.CORS_ORIGIN?.split(',')||true}),express.json({limit:'8mb'}));
app.use(rateLimit({windowMs:6e4,limit:120}));
app.get('/health',(_,r)=>r.json({ok:true}));
app.use('/api/auth',auth);app.use('/api',api);
const dist=path.resolve('web/dist');if(fs.existsSync(dist)){app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')))}
app.use((e,_q,res,_n)=>{console.error(e);res.status(e.status||500).json({error:e.message})});
const port=process.env.PORT||3000;app.listen(port,()=>console.log('API on :'+port));
if(process.env.INLINE_WORKER==='1'){startWorker();startPublisher()}
