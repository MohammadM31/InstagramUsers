import bcrypt from 'bcryptjs';import {Router} from 'express';import {q} from './db.js';import {loginLocked,loginFailed,loginOk} from './ratelimit.js';import {signToken} from './rbac/token.js';import {requireAuth} from './rbac/middleware.js';import {loginBlock} from './rbac/loginPolicy.js';
export const sign=signToken; // R.0: the token also carries tv (token_version)
export {requireAuth}; // R.0: loads the user row on every request (src/rbac/middleware.js); routes.js still imports it from here
export const auth=Router();
const wrap=f=>(req,res,next)=>Promise.resolve(f(req,res,next)).catch(next);
auth.post('/register',wrap(async(req,res)=>{const{email,password,acceptTos}=req.body||{};
 if(typeof email!=='string'||typeof password!=='string'||!email.includes('@')||password.length<8)return res.status(400).json({error:'valid email and 8+ char password required'});
 if(!acceptTos)return res.status(400).json({error:'You must accept the ToS (public data only)'});
 try{const[u]=await q('INSERT INTO users(email,pass_hash,tos_accepted_at) VALUES($1,$2,now()) RETURNING id',[email.toLowerCase(),await bcrypt.hash(password,10)]);res.json({token:sign(u)})}catch(e){if(e.code==='23505')return res.status(409).json({error:'email exists'});throw e}}));
auth.post('/login',wrap(async(req,res)=>{const{email,password}=req.body||{};
 if(typeof email!=='string'||typeof password!=='string')return res.status(400).json({error:'email and password required'});
 const e=email.toLowerCase(),lock=await loginLocked(e,req.ip);
 if(lock){res.set('Retry-After',String(lock));return res.status(429).json({error:`Too many failed logins. Try again in ${Math.ceil(lock/60)} min.`})}
 const[u]=await q('SELECT * FROM users WHERE email=$1',[e]);
 if(!u||!await bcrypt.compare(password,u.pass_hash)){await loginFailed(e,req.ip);return res.status(401).json({error:'invalid credentials'})}
 await loginOk(e,req.ip);
 const blocked=loginBlock(u);if(blocked)return res.status(blocked.status).json({error:blocked.error}); // R.0: suspended accounts cannot log in
 await q('UPDATE users SET last_active_at=now() WHERE id=$1',[u.id]);res.json({token:sign(u)})}));
