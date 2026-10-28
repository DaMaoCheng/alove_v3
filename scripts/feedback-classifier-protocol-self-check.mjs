// This script exercises the retained LLM fallback transport/contract only; JEV admission has its own integration checks.
import assert from 'node:assert/strict';
Object.assign(process.env,{AIOVE_PROVIDER_LOG_WRITE_ENABLED:'false',VENICE_API_KEY:'fixture',OPENAI_API_KEY:'fixture',OPENAI_FALLBACK_API_KEY:'fixture',OPENAI_FALLBACK_MODEL:'fixture-fallback'});
const{classifyCommerceIntentFallback: classifyCommerceIntent,commerceClassificationTimeout}=await import('../server/product-intent-classifier-service.js');
const text='Ya he rellenado el formulario';
const history=[{id:'entry_owned',senderType:'character',contentType:'feedback_action',text:'',displayOrder:20}];
assert.equal(commerceClassificationTimeout(text,{recentMessages:history}),40000,'the added feedback-state protocol gets the existing full protocol budget');
assert.equal(commerceClassificationTimeout(text,{recentMessages:[]}),10000);
assert.equal(commerceClassificationTimeout('Me interesan las del Barcelona morado',{recentMessages:[]}),10000,'ordinary D08 classification profile is unchanged');
const valid={route:'store_policy',topic:'support',needsLiveProductData:false,searchQuery:'',referencedProductId:'',referencedProductIds:[],knowledgeScope:'business',knowledgeQuery:text,knowledgeRequest:{kind:'business_question',evidence:text},answerRequired:true,businessInquiry:null,humanHandoff:null,promotionInquiry:null,checkoutIssue:null,replyBoundary:{salesAllowed:false,contactAllowed:true},commerceConstraints:{edition:null,team:null},productRequest:{relation:'none',action:'new',items:[],selectedIndex:null,selectionEvidence:''},productRequirement:{action:'none',evidence:'',updates:[],suspectedTerm:null,priorTargetEvidence:''},candidateResponse:{action:'none',evidence:'',candidateId:''},confidence:1,supportFollowup:{relation:'submitted_followup',evidence:text}};
const calls=[];const fetchImpl=async(_url,options)=>{calls.push(JSON.parse(options.body));return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(valid)}}]}));};
const result=await classifyCommerceIntent(text,{recentMessages:history,fetchImpl});
assert.equal(result.commerceClassificationFailure,undefined,'actual provider parse/validate/normalize must accept feedback schema');
assert.equal(result.supportFollowup?.relation,'submitted_followup');assert.equal(calls.length,1,'valid primary feedback protocol must not consume backups');
const directCalls=[];const config={id:'fixture',apiKey:'fixture',baseUrl:'https://fixture.invalid/v1',model:'fixture',apiMode:'chat_completions',timeoutMs:1000};
const direct=await classifyCommerceIntent(text,{recentMessages:history,config,fetchImpl:async(_url,options)=>{directCalls.push(JSON.parse(options.body));return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(valid)}}]}));}});
assert.equal(direct.supportFollowup?.relation,'submitted_followup');assert.equal(directCalls.length,1);
assert(directCalls[0].response_format.json_schema.schema.required.includes('supportFollowup'));
const old={...valid};delete old.supportFollowup;let oldCalls=0;
const plain=await classifyCommerceIntent(text,{recentMessages:[],fetchImpl:async()=>{oldCalls++;return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(old)}}]}));}});
assert.equal(plain.commerceClassificationFailure,undefined);assert.equal(oldCalls,1);assert.equal(plain.supportFollowup,undefined);
let recoveryCalls=0;
const recovered=await classifyCommerceIntent(text,{recentMessages:history,fetchImpl:async()=>{recoveryCalls++;const value=recoveryCalls===1?{...valid,supportFollowup:{relation:'submitted_followup',evidence:123}}:valid;return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(value)}}]}));}});
assert.equal(recoveryCalls,2);assert.equal(recovered.supportFollowup?.relation,'submitted_followup');
let invalidNativeCalls=0;
const invalidNative=await classifyCommerceIntent(text,{recentMessages:history,config,fetchImpl:async()=>{invalidNativeCalls++;return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({...valid,supportFollowup:{relation:'invalid',evidence:text}})}}]}));}});
assert(invalidNative.commerceClassificationFailure);assert.equal(invalidNative.supportFollowup,undefined);assert.equal(invalidNativeCalls,1);
// Real provider responses may use null only in explicitly inactive evidence slots.
const inactiveNull = { ...valid, humanHandoff: { explicitRequest:false,businessReviewRequired:false,reviewReason:'none',evidence:null },
  candidateResponse: {action:'none',evidence:null,candidateId:null} };
let inactiveCalls=0;
const inactive=await classifyCommerceIntent(text,{recentMessages:history,fetchImpl:async()=>{inactiveCalls++;return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(inactiveNull)}}]}));}});
assert.equal(inactive.commerceClassificationFailure,undefined,'inactive null slots must survive actual classify/provider/local validation');
assert.equal(inactive.supportFollowup?.relation,'submitted_followup');assert.equal(inactiveCalls,1,'inactive null representation must not consume backups');
assert.equal(inactive.humanHandoff,null);assert.equal(inactive.candidateResponse.action,'none');
for(const broken of [
  {...valid,candidateResponse:{action:'confirm',evidence:null,candidateId:'candidate_owned'}},
  {...valid,candidateResponse:{action:'confirm',candidateId:'candidate_owned'}},
  {...valid,candidateResponse:{action:'none',candidateId:null}},
  {...valid,humanHandoff:{explicitRequest:true,businessReviewRequired:false,reviewReason:'none',evidence:null}},
  {...valid,humanHandoff:{explicitRequest:false,businessReviewRequired:true,reviewReason:'quotation',evidence:null}},
  {...valid,humanHandoff:{explicitRequest:false,businessReviewRequired:false,reviewReason:'none'}},
  {...valid,productRequirement:{...valid.productRequirement,evidence:null}},
]) {
 let brokenCalls=0;const refused=await classifyCommerceIntent(text,{recentMessages:history,config,fetchImpl:async()=>{brokenCalls++;return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(broken)}}]}));}});
 assert(refused.commerceClassificationFailure,'active or missing evidence must not be normalized into permission');assert.equal(brokenCalls,1);
}
const{loadFeedbackConversationHistory,feedbackProtocolContext}=await import('../server/chat-feedback-submission-service.js');
const noCardDb={execute:async sql=>sql.includes('FROM chat_messages')?[[]]:[[{feedback_status:'new',created_at:new Date('2026-10-26T01:00:00Z')}]]};
const noCard=await loadFeedbackConversationHistory(noCardDb,{sessionId:'chat_owned',guestSessionId:'guest_owned',siteId:'site_owned',character:{id:'mascot_owned'},beforeDisplayOrder:30});
assert.equal(feedbackProtocolContext(noCard.entries).entryOffered,false);assert(feedbackProtocolContext(noCard.entries).savedSubmission.verified);
assert.equal(commerceClassificationTimeout(text,{recentMessages:noCard.entries}),40000);
const savedCalls=[];const saved=await classifyCommerceIntent(text,{recentMessages:noCard.entries,fetchImpl:async(_url,options)=>{savedCalls.push(JSON.parse(options.body));return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(valid)}}]}));}});
assert.equal(saved.supportFollowup?.relation,'submitted_followup');assert.equal(savedCalls.length,1);
const savedPacket=savedCalls[0].messages.map(row=>{try{return JSON.parse(row.content);}catch{return null;}}).find(row=>row?.feedbackHistory);
assert.equal(savedPacket.feedbackHistory.entryOffered,false);assert(savedPacket.feedbackHistory.savedSubmission.verified);
assert(!savedPacket.recentConversation.some(row=>row.text?.includes('form entry')));
console.log('feedback classifier protocol self-check passed: actual default/native classifier transport, conditional schema/local validation/normalization, old no-feedback format and single provider');
