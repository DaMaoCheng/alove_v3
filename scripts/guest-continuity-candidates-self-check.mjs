import assert from 'node:assert/strict';
import { continuityEvidence, getGuestContinuityCandidates } from '../server/guest-continuity-candidates-service.js';
const a = {id:'a',site_id:'cf',created_at:'2026-09-18T01:00:00Z',last_ip:'192.0.2.1',external_source_context_json:{sourcePageUrl:'https://example.test/product/1'}};
const b = {...a,id:'b',created_at:'2026-09-18T01:05:00Z'};
assert.equal(continuityEvidence(a,b).length,3);
assert.deepEqual(continuityEvidence(a,{...b,site_id:'bs'}),[]);
assert.deepEqual(continuityEvidence(a,{...b,created_at:'2026-09-18T02:00:00Z'}),[]);
assert.deepEqual(continuityEvidence(a,{...b,external_source_context_json:null}),[]);
assert.deepEqual(continuityEvidence(a,{...b,last_ip:'192.0.2.2'}),[]);
assert.deepEqual(continuityEvidence(a,a),[]);
const texts=new Map([['a','Quiero esta camiseta para mi hijo'],['b','Quiero esta camiseta para mi hijo']]);
assert.equal(continuityEvidence(a,{...b,last_ip:'192.0.2.2'},texts).length,3);
assert.deepEqual(continuityEvidence(a,{...b,last_ip:'192.0.2.2'},new Map([['a','hola'],['b','hola']])),[]);
for (const text of ['我想给孩子买这款球衣请问有适合小朋友穿的尺码吗', 'أريد هذا القميص لطفلي هل لديكم مقاسات مناسبة']) {
  assert.ok(continuityEvidence(a,{...b,external_source_context_json:null},new Map([['a',text],['b',text]])).length);
}
let queries=0;
const db={execute:async(sql,params)=>{queries++; if(sql.includes('LIMIT 200'))return [[b]];return [[{id:'a',text_content:'Hello there this is a test'},{id:'b',text_content:'Hello there this is a test'}]];}};
const result=await getGuestContinuityCandidates(db,[a]);
assert.equal(result.get('a').candidates[0].guestId,'b');
assert.equal(queries,2,'Batch reads, no per-guest DB query');
const longDb={execute:async(sql)=>sql.includes('LIMIT 200')?[[{...b,external_source_context_json:null}]]:[[{id:'a',text_content:'x'.repeat(1001)},{id:'b',text_content:'x'.repeat(1001)}]]};
assert.deepEqual((await getGuestContinuityCandidates(longDb,[a])).get('a').candidates,[],'Long text prefixes are not equal-text evidence');
console.log('guest continuity candidate self-check passed');
