// R.0: session tokens (jsonwebtoken). The claims logic lives in claims.js.
import jwt from 'jsonwebtoken';
import { makeClaims, readClaims } from './claims.js';
const S = () => { const s = process.env.JWT_SECRET; if (!s || s.length < 32) throw new Error('JWT_SECRET missing or shorter than 32 chars'); return s; }; // no fallback: validated at boot by config.js
export const signToken = u => jwt.sign(makeClaims(u), S(), { expiresIn: '7d' });
export const verifyToken = header => readClaims(jwt.verify(String(header || '').replace('Bearer ', ''), S()));
