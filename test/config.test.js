import test from 'node:test';import assert from 'node:assert';import {envProblems} from '../src/config.js';
const ok={JWT_SECRET:'j'.repeat(40),ENCRYPTION_KEY:'ab'.repeat(32),DATABASE_URL:'postgres://x'};
test('valid env has no problems',()=>assert.deepStrictEqual(envProblems(ok),[]));
test('missing ENCRYPTION_KEY is reported',()=>assert.match(envProblems({...ok,ENCRYPTION_KEY:undefined}).join(),/ENCRYPTION_KEY is missing/));
test('malformed ENCRYPTION_KEY is reported',()=>{for(const k of['short','z'.repeat(64),'ab'.repeat(31)])assert.match(envProblems({...ok,ENCRYPTION_KEY:k}).join(),/ENCRYPTION_KEY is malformed/)});
test('all-zero ENCRYPTION_KEY is rejected',()=>assert.match(envProblems({...ok,ENCRYPTION_KEY:'0'.repeat(64)}).join(),/all zeros/));
test('JWT_SECRET missing, short and dev placeholder are rejected',()=>{assert.match(envProblems({...ok,JWT_SECRET:''}).join(),/JWT_SECRET is missing/);assert.match(envProblems({...ok,JWT_SECRET:'short'}).join(),/too short/);assert.match(envProblems({...ok,JWT_SECRET:'dev-secret-change-me'}).join(),/too short|placeholder/)});
test('production rejects change-me style secrets',()=>assert.match(envProblems({...ok,NODE_ENV:'production',JWT_SECRET:'change-me-'.repeat(5)}).join(),/placeholder/));
test('DATABASE_URL required unless needDb=false',()=>{assert.match(envProblems({...ok,DATABASE_URL:''}).join(),/DATABASE_URL/);assert.deepStrictEqual(envProblems({...ok,DATABASE_URL:''},{needDb:false}),[])});
