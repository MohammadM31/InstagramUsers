import crypto from 'node:crypto';
const key=()=>Buffer.from(process.env.ENCRYPTION_KEY||'0'.repeat(64),'hex');
export function encrypt(t){const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key(),iv),e=Buffer.concat([c.update(t,'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),e]).toString('base64')}
export function decrypt(s){const b=Buffer.from(s,'base64'),d=crypto.createDecipheriv('aes-256-gcm',key(),b.subarray(0,12));d.setAuthTag(b.subarray(12,28));return Buffer.concat([d.update(b.subarray(28)),d.final()]).toString('utf8')}
