import './loadenv.js';
import {validateEnv} from './config.js';validateEnv();
import express from 'express';import helmet from 'helmet';import cors from 'cors';import rateLimit from 'express-rate-limit';
import {db} from './db.js';import {igConnect,compliance} from './igwire.js';import {redis} from './cache.js';import {auth,requireAuth} from './auth.js';import {api} from './routes.js';import {me} from './routes/me.js';import {org} from './routes/org.js';import {pub as publicRoutes} from './routes/public.js';import {adminRouter} from './admin/index.js';import {bootstrapOwner} from './rbac/bootstrap.js';import {recordSecurityEvent} from './ratelimit.js';import {startWorker,startPublisher} from './worker.js';import path from 'node:path';import fs from 'node:fs';
const app=express();app.set('trust proxy',1);app.use(helmet(),cors({origin:process.env.CORS_ORIGIN?.split(',')||(process.env.NODE_ENV==='production'?false:true)}),express.json({limit:'8mb'}),express.text({type:'text/csv',limit:'5mb'}));
app.use(rateLimit({windowMs:6e4,limit:120,handler:(_q,res,_n,o)=>{recordSecurityEvent('rate_limit');res.status(o.statusCode).send(o.message)}}));
app.get('/health',(_,r)=>r.json({ok:true}));
app.get('/ready',async(_,r)=>{try{await db.query('SELECT 1');await redis.ping();r.json({ok:true,db:true,redis:true})}catch(e){r.status(503).json({ok:false,error:e.message})}});
app.get('/api/instagram/connect/callback',(req,res,next)=>Promise.resolve(igConnect.callback(req,res)).catch(next));
const form=express.urlencoded({extended:false,limit:'16kb'}),pub=f=>(req,res,next)=>Promise.resolve(f(req,res)).catch(next);
app.post('/api/instagram/deauthorize',form,pub(compliance.deauthorize));app.post('/api/instagram/data-deletion',form,pub(compliance.dataDeletion));
app.get('/api/instagram/deletion-status',pub(compliance.deletionStatus));app.get('/privacy',pub(compliance.privacy));
app.use('/api/auth',auth);app.use('/api/public',publicRoutes);
app.use('/api/me',requireAuth,me);app.use('/api/org',requireAuth,org);app.use('/api/admin',await adminRouter());
app.use('/api',api);
const dist=path.resolve('web/dist');if(fs.existsSync(dist)){app.use(express.static(dist));app.get('*',(_q,r)=>r.sendFile(path.join(dist,'index.html')))}
app.use((e,_q,res,_n)=>{console.error(e);res.status(e.status||500).json({error:e.message})});
const port=process.env.PORT||3000;app.listen(port,()=>console.log('API on :'+port));
bootstrapOwner();
if(process.env.INLINE_WORKER==='1'){startWorker();startPublisher()}