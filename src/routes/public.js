// /api/public (mounted WITHOUT auth in server.js, before the authenticated /api router). Empty until R.4. Nothing private belongs here.
import {Router} from 'express';
export const pub=Router();
export default pub;
