import test from 'node:test';import assert from 'node:assert';import {parseCsv} from '../src/csv.js';import {normalizePosts,MAX_ROWS} from '../src/importer.js';
test('csv: quotes, commas, escaped quotes, CRLF, header aliases',()=>{
 const r=parseCsv('Date,Media Type,Likes,Reach,Caption\r\n2026-09-01,Reel,"1,200",5000,"Hello, ""world"""\r\n2026-09-02,Photo,10,100,\r\n');
 assert.strictEqual(r.length,2);assert.strictEqual(r[0].caption,'Hello, "world"');assert.strictEqual(r[0].media_type,'Reel')});
test('normalize maps aliases and types, strips thousands separators',()=>{
 const{rows,invalid}=normalizePosts(parseCsv('date,media_type,likes,comments,reach\n2026-09-01,Reel,"1,200",5,5000'));
 assert.strictEqual(invalid.length,0);assert.strictEqual(rows[0].type,'REEL');assert.strictEqual(rows[0].likes,1200);assert.strictEqual(rows[0].saves,0)});
test('normalize reports bad rows without throwing',()=>{
 const{rows,invalid}=normalizePosts([{posted_at:'nope',reach:1},{posted_at:'2026-09-01',type:'story',reach:5},{posted_at:'2026-09-01',likes:-3,reach:5},{posted_at:'2026-09-01',likes:1},{posted_at:'2026-09-01',type:'image',reach:9}]);
 assert.strictEqual(rows.length,1);assert.strictEqual(invalid.length,4)});
test('normalize rejects non-arrays and oversized input',()=>{assert.throws(()=>normalizePosts({}));assert.throws(()=>normalizePosts(new Array(MAX_ROWS+1).fill({})))});
