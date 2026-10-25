// Demo route proving the admin plumbing: GET /api/admin/ping (needs users:read, so every staff role passes).
import {Router} from 'express';import {requirePermission} from '../../rbac/middleware.js';
export const mount='/ping';
const r=Router();
r.get('/',requirePermission('users:read'),(req,res)=>res.json({ok:true,role:req.user.role}));
export default r;
