import {Queue} from 'bullmq';import {redis} from './cache.js';
export const scrapeQ=new Queue('scrape',{connection:redis});
export const importQ=new Queue('import',{connection:redis,defaultJobOptions:{removeOnComplete:{age:3600},removeOnFail:{age:86400}}});
export const imageQ=new Queue('image',{connection:redis,defaultJobOptions:{removeOnComplete:{age:3600},removeOnFail:{age:3600},attempts:1}});
export const igsyncQ=new Queue('igsync',{connection:redis,defaultJobOptions:{removeOnComplete:{age:3600},removeOnFail:{age:86400}}});
