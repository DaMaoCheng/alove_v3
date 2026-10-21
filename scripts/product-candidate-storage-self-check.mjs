import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { markProductCandidateDisplayed, readProductCandidateState } from '../server/product-candidate-state-service.js';
const state={version:1,status:'active',siteId:'site_fixture',characterId:'character_fixture',owner:'single',targetEvidence:'Real Madrid away shirt',requirements:{requestedTeam:'Real Madrid',requestedProductType:'shirt',requestedPrinting:'none'},proposal:null,suspectedTerm:null};
const shown=markProductCandidateDisplayed(state,{id:'candidate',name:'Real Madrid away shirt',matchStatus:'candidate'},{approvedReply:'Is this the shirt? Sleeve remains unverified.',confirmationRequested:true});
assert.equal(shown.proposal.status,'displayed');
assert.equal(markProductCandidateDisplayed(state,null,{approvedReply:'Try later.',confirmationRequested:false}).proposal,null);
const ns='_productCandidateState', calls=[];let rows=[];
const pool={execute:async(sql,params)=> {calls.push({sql,params});return sql.includes('FROM chat_sessions') ? [[{id:'session',site_id:'site_fixture'}]] : [rows];}};
mysql.createPool=()=>pool;
const {insertMessage,mapMessageRow,listRecentMessagesBeforeOrder}=await import('../server/chat-message-store.js');
const {getReportingConversation}=await import('../server/reporting-data-service.js');
const message={sessionId:'session',characterId:state.characterId,senderType:'character',contentType:'text',text:'Is this the shirt?',displayOrder:20,productCandidateState:shown};
const inserted=await insertMessage(pool,message);
const raw=JSON.parse(calls.at(-1).params[9]);assert.ok(raw[ns]);assert.equal(inserted.product,null);
assert.equal(mapMessageRow({content_type:'text',product_payload_json:raw}).product,null);
assert.equal(mapMessageRow({content_type:'text',product_payload_json:JSON.stringify({...raw,legacy:'kept'})}).product.legacy,'kept');
rows=[{sender_type:'character',content_type:'text',product_payload_json:raw,display_order:20,text_content:'Is this the shirt?'}];
const recent=await listRecentMessagesBeforeOrder(pool,{sessionId:'session',beforeDisplayOrder:30});assert.equal(readProductCandidateState(recent,{siteId:state.siteId,characterId:state.characterId}).proposal.candidateId,'candidate');
const token={allSites:true,siteIds:[],scopes:['messages:read']};const url=new URL('http://localhost/');
for(const payload of [raw,JSON.stringify(raw)]) {
 rows=[{content_type:'text',product_payload_json:payload}];
 const report=await getReportingConversation(token,url,'user','session');assert.ok(!JSON.stringify(report).includes(ns));
}
await insertMessage(pool,{...message,senderType:'user'});assert.equal(calls.at(-1).params[9],null);
console.log('product candidate storage self-check passed (mock DB, no writes/network)');
