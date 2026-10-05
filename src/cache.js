import IORedis from 'ioredis';
export const redis=new IORedis(process.env.REDIS_URL||'redis://localhost:6379',{maxRetriesPerRequest:null,lazyConnect:true});
export async function cached(key,ttl,fn){const h=await redis.get(key);if(h)return JSON.parse(h);const v=await fn();await redis.setex(key,ttl,JSON.stringify(v));return v}
