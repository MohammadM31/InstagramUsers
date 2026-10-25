// /api/me (mounted behind requireAuth in server.js). R.2 adds /usage here.
import {Router} from 'express';import {q} from '../db.js';import {makeMe} from '../rbac/meHandler.js';
export const me=Router();
me.get('/',(req,res,next)=>makeMe({q})(req,res).catch(next));
export default me;
