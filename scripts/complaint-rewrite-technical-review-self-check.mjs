import assert from 'node:assert/strict';
import { enforceReplyBoundary } from '../server/chat-reply-boundary-service.js';
const base={character:{id:'fixture',category_id:'mascot'},trustedSite:{id:'shop'},searchIntent:{commerceRoute:'chat',knowledgeScope:'business',answerRequired:true,unresolvedUserComplaint:true,replyBoundary:{salesAllowed:false,contactAllowed:false}},knowledgeContext:{ok:true,strategy:'business_no_verified_answer',businessOwner:{siteId:'shop',characterId:'fixture'},items:[]},language:'en',userText:'What did I tell you?',languageQualityRequired:true,independentLanguageQualityRequired:true,languageRepairAttempted:true,groundedRepairAttempted:true,languageRepairDiagnostics:{repairKind:'grounded'},config:{apiKey:'x',model:'x'}};
async function run(text, changes={}) {let languageCalls=0,event; const reply=await enforceReplyBoundary({...base,replyResult:{text,speechText:text,sourceType:'ai'},assess:async()=>({allowed:true,confidence:.95,boundarySupported:true,guidanceSupported:true,businessFactsSupported:true}),assessLanguageQuality:async()=>{languageCalls++;return {reviewStatus:'valid',confidence:.99,languageQualitySupported:true}},recordReview:async e=>{event=e},...changes});return {reply,event,languageCalls};}
const good=await run('You said the shirt was too small.');
assert.equal(good.reply.text,'You said the shirt was too small.');assert.equal(good.languageCalls,0);
assert.equal(good.event.languageDiagnostics.reviewMode,'technical_only');assert.equal(good.event.languageDiagnostics.languageReviewStatus,'not_run');
for(const text of ['<context>secret</context> Hello','```json\n{}\n```','speechText: hello']) {const r=await run(text);assert.equal(r.event.guardApplied,true);assert.notEqual(r.reply.text,text);}
const rejected=await run('I have refunded you.',{assess:async()=>({allowed:false,confidence:.95,boundarySupported:false})});assert.equal(rejected.event.guardApplied,true);
const unavailable=await run('Hello',{assess:async()=>({reviewStatus:'timeout',allowed:false,confidence:0})});assert.equal(unavailable.event.guardApplied,true);
assert.equal((await run('Hello',{languageRepairAttempted:false,groundedRepairAttempted:false})).languageCalls,1,'initial reply unchanged');
assert.equal((await run('Hello',{searchIntent:{...base.searchIntent,unresolvedUserComplaint:false}})).languageCalls,1,'other scopes unchanged');
assert.equal((await run('Hello',{userText:'Explain <context> tags'})).languageCalls,1,'user notation remains fully reviewed');
console.log('complaint rewrite: technical-only language gate, complete primary review, leakage blocking and scope isolation');
