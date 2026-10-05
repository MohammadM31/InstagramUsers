import test from 'node:test';import assert from 'node:assert/strict';
import {advise,health,financePlan} from '../src/advisor.js';
const base={hasData:true,reach30d:1000,reachChange:0,er:2,postsPerWeek:1,mentions30d:0,collabs30d:0,types:[{type:'reel',er:6,share:0.1},{type:'image',er:2,share:0.9}],topCompetitor:'rival'};
test('collab and mention advice outrank hashtags',()=>{const t=advise(base);assert.equal(t[0].kind,'collab');assert.equal(t.at(-1).kind,'hashtags');assert.ok(t.some(x=>x.kind==='content'&&/reel/.test(x.text)))});
test('no data gives a starter tip',()=>assert.equal(advise({hasData:false})[0].kind,'start'));
test('finance split sums near capital and holds paid promo when ER is low',()=>{const p=financePlan({...base,er:1.5},1000);const s=p.money.reduce((a,x)=>a+x.amount,0);assert.ok(Math.abs(s-1000)<=5);assert.ok(p.money.find(x=>x.area.startsWith('Paid')).note)});
test('health is bounded',()=>{const h=health({...base,er:10,reachChange:50,postsPerWeek:9,collabs30d:9});assert.equal(h.score,100)});
