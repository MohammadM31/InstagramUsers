import bcrypt from 'bcryptjs';import jwt from 'jsonwebtoken';import {Router} from 'express';import {q} from './db.js';
const S=()=>process.env.JWT_SECRET||'dev-secret-change-me';
export const sign=u=>jwt.sign({sub:u.id},S(),{expiresIn:'7d'});
export function requireAuth(req,res,next){try{req.uid=jwt.verify((req.headers.authorization||'').replace('Bearer ',''),S()).sub;next()}catch{res.status(401).json({error:'unauthorized'})}}
export const auth=Router();
auth.post('/register',async(req,res)=>{const{email,password,acceptTos}=req.body||{};
 if(!email||!password||password.length<8)return res.status(400).json({error:'email and 8+ char password required'});
 if(!acceptTos)return res.status(400).json({error:'You must accept the ToS (public data only)'});
 try{const[u]=await q('INSERT INTO users(email,pass_hash,tos_accepted_at) VALUES($1,$2,now()) RETURNING id',[email.toLowerCase(),await bcrypt.hash(password,10)]);res.json({token:sign(u)})}catch{res.status(409).json({error:'email exists'})}});
auth.post('/login',async(req,res)=>{const{email,password}=req.body||{},[u]=await q('SELECT * FROM users WHERE email=$1',[(email||'').toLowerCase()]);
 if(!u||!await bcrypt.compare(password||'',u.pass_hash))return res.status(401).json({error:'invalid credentials'});res.json({token:sign(u)})});
