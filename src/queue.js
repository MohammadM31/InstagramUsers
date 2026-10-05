import {Queue} from 'bullmq';import {redis} from './cache.js';
export const scrapeQ=new Queue('scrape',{connection:redis});
